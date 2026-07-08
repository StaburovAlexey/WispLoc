/**
 * WispLoc Worker — polls SQLite for PENDING jobs and processes them sequentially.
 */
import { createLogger, getPrisma } from '@wisploc/core'
import { runPipeline } from './processor/pipeline'

const prisma = getPrisma()
const workerLog = createLogger('worker', 'worker.log')
const POLL_INTERVAL_MS = 5_000
const STALE_PROCESSING_MS = 60_000
const JOB_HEARTBEAT_MS = 15_000
let workerStarted = false

type ClaimedJob = {
  id: string
  mediaFileId: string | null
  type: string
  attempts: number
  createdAt: Date | string
  startedAt: Date | string | null
}

export async function startWorker() {
  if (workerStarted) return
  workerStarted = true
  console.log('[worker] WispLoc worker started — polling for jobs')
  workerLog.info('worker started', { pollIntervalMs: POLL_INTERVAL_MS })
  await recoverStaleProcessingJobs()
  await failDuplicateProcessingJobs()

  while (true) {
    try {
      await recoverStaleProcessingJobs()
      await failDuplicateProcessingJobs()

      const job = await claimNextPendingJob()

      if (job) {
        const mediaId = job.mediaFileId
        if (!mediaId) {
          console.warn(`[worker] Job ${job.id} has no mediaFileId, marking FAILED`)
          workerLog.error('job failed without media file', { jobId: job.id, type: job.type })
          const finishedAt = new Date()
          const createdAt = toDate(job.createdAt)
          await prisma.processingJob.update({
            where: { id: job.id },
            data: {
              status: 'FAILED',
              errorMessage: 'No media file',
              finishedAt,
              durationMs: Math.max(0, finishedAt.getTime() - createdAt.getTime()),
            },
          })
          continue
        }

        const activeJob = await prisma.processingJob.findFirst({
          where: {
            mediaFileId: mediaId,
            status: 'PROCESSING',
            id: { not: job.id },
          },
          orderBy: { updatedAt: 'desc' },
        })
        if (activeJob) {
          console.warn(`[worker] Rejecting duplicate job ${job.id}; media ${mediaId.slice(0, 8)} is already processing in ${activeJob.id}`)
          workerLog.warn('duplicate job rejected', {
            jobId: job.id,
            mediaId,
            activeJobId: activeJob.id,
          })
          const finishedAt = new Date()
          const createdAt = toDate(job.createdAt)
          await prisma.processingJob.update({
            where: { id: job.id },
            data: {
              status: 'FAILED',
              errorMessage: `Media is already processing in job ${activeJob.id}`,
              finishedAt,
              durationMs: Math.max(0, finishedAt.getTime() - createdAt.getTime()),
            },
          })
          continue
        }

        console.log(`[worker] Claiming job ${job.id} (type=${job.type}, media=${mediaId.slice(0, 8)}…)`)
        workerLog.info('job claimed', {
          jobId: job.id,
          mediaId,
          type: job.type,
          attempts: job.attempts,
        })
        const startedAt = toDate(job.startedAt)

        try {
          await runWithHeartbeat(job.id, () => runPipeline(mediaId, job.id))
          await markJobFinished(job.id, 'DONE', startedAt)
          console.log(`[worker] Job ${job.id} completed`)
          workerLog.info('job completed', { jobId: job.id, mediaId })
        } catch (err: any) {
          console.error(`[worker] Job ${job.id} failed:`, err.message)
          const cancelled = err.message === 'Job cancelled'
          workerLog.error(cancelled ? 'job cancelled' : 'job failed', {
            jobId: job.id,
            mediaId,
            error: err,
          })
          await markJobFinished(job.id, cancelled ? 'CANCELLED' : 'FAILED', startedAt, cancelled ? null : err.message)
          await prisma.mediaFile.update({
            where: { id: mediaId },
            data: {
              status: cancelled ? 'CANCELLED' : 'FAILED',
              errorMessage: cancelled ? null : err.message,
            },
          })
        }
      }
    } catch (err) {
      console.error('[worker] Poll error:', err)
      workerLog.error('worker poll error', { error: err })
    }

    await sleep(POLL_INTERVAL_MS)
  }
}

export async function claimNextPendingJob(): Promise<ClaimedJob | null> {
  const rows = await prisma.$queryRawUnsafe<ClaimedJob[]>(`
    UPDATE ProcessingJob
    SET
      status = 'PROCESSING',
      attempts = attempts + 1,
      startedAt = COALESCE(startedAt, CURRENT_TIMESTAMP),
      finishedAt = NULL,
      durationMs = NULL,
      errorMessage = NULL,
      updatedAt = CURRENT_TIMESTAMP
    WHERE id = (
      SELECT id
      FROM ProcessingJob
      WHERE status = 'PENDING'
      ORDER BY createdAt ASC
      LIMIT 1
    )
    RETURNING id, mediaFileId, type, attempts, createdAt, startedAt
  `)

  return rows[0] ?? null
}

async function markJobFinished(
  jobId: string,
  status: 'DONE' | 'FAILED' | 'CANCELLED',
  startedAt: Date,
  errorMessage: string | null = null,
): Promise<void> {
  const finishedAt = new Date()
  await prisma.processingJob.update({
    where: { id: jobId },
    data: {
      status,
      errorMessage,
      finishedAt,
      durationMs: Math.max(0, finishedAt.getTime() - startedAt.getTime()),
    },
  })
}

async function failDuplicateProcessingJobs(): Promise<void> {
  const jobs = await prisma.processingJob.findMany({
    where: {
      status: 'PROCESSING',
      mediaFileId: { not: null },
    },
    orderBy: [
      { mediaFileId: 'asc' },
      { updatedAt: 'desc' },
    ],
  })

  const activeByMedia = new Set<string>()
  for (const job of jobs) {
    if (!job.mediaFileId) continue
    if (!activeByMedia.has(job.mediaFileId)) {
      activeByMedia.add(job.mediaFileId)
      continue
    }

    console.warn(`[worker] Marking duplicate processing job ${job.id} as FAILED`)
    workerLog.warn('duplicate processing job marked failed', {
      jobId: job.id,
      mediaFileId: job.mediaFileId,
    })
    const finishedAt = new Date()
    const startedAt = job.startedAt ?? job.createdAt
    await prisma.processingJob.update({
      where: { id: job.id },
      data: {
        status: 'FAILED',
        errorMessage: 'Superseded by another processing job for the same media',
        finishedAt,
        durationMs: Math.max(0, finishedAt.getTime() - startedAt.getTime()),
      },
    })
  }
}

async function recoverStaleProcessingJobs(): Promise<void> {
  const staleBefore = new Date(Date.now() - STALE_PROCESSING_MS)
  const jobs = await prisma.processingJob.findMany({
    where: {
      status: 'PROCESSING',
      updatedAt: { lt: staleBefore },
    },
  })

  for (const job of jobs) {
    console.warn(`[worker] Recovering stale job ${job.id} from ${job.currentStep ?? 'unknown step'}`)
    workerLog.warn('stale processing job recovered', {
      jobId: job.id,
      mediaFileId: job.mediaFileId,
      currentStep: job.currentStep,
    })
    await prisma.processingJob.update({
      where: { id: job.id },
      data: {
        status: 'PENDING',
        errorMessage: null,
      },
    })

    if (job.mediaFileId) {
      await prisma.mediaFile.update({
        where: { id: job.mediaFileId },
        data: {
          status: mediaStatusForStep(job.currentStep),
          errorMessage: null,
        },
      })
    }
  }
}

async function runWithHeartbeat<T>(jobId: string, run: () => Promise<T>): Promise<T> {
  const timer = setInterval(() => {
    prisma.processingJob.update({
      where: { id: jobId },
      data: { updatedAt: new Date() },
    }).catch((err) => {
      console.warn(`[worker] Job heartbeat failed for ${jobId}:`, err)
      workerLog.warn('job heartbeat failed', { jobId, error: err })
    })
  }, JOB_HEARTBEAT_MS)

  try {
    return await run()
  } finally {
    clearInterval(timer)
  }
}

function mediaStatusForStep(step: string | null): string {
  if (!step) return 'UPLOADED'
  if (step.startsWith('extracting')) return 'EXTRACTING_AUDIO'
  if (step.startsWith('transcribing')) return 'TRANSCRIBING'
  if (step.startsWith('summarizing') || step === 'final_summary') return 'SUMMARIZING'
  if (step === 'extracting_tasks') return 'EXTRACTING_TASKS'
  return 'UPLOADED'
}

function toDate(value: Date | string | null | undefined): Date {
  if (value instanceof Date) return value
  if (value) return new Date(value)
  return new Date()
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startWorker()
}
