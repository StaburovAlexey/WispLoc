/**
 * WispLoc Worker — polls SQLite for PENDING jobs and processes them sequentially.
 */
import { getPrisma } from '@wisploc/core'
import { runPipeline } from './processor/pipeline'

const prisma = getPrisma()
const POLL_INTERVAL_MS = 5_000
const STALE_PROCESSING_MS = 60_000
const JOB_HEARTBEAT_MS = 15_000
let workerStarted = false

export async function startWorker() {
  if (workerStarted) return
  workerStarted = true
  console.log('[worker] WispLoc worker started — polling for jobs')
  await recoverStaleProcessingJobs()
  await failDuplicateProcessingJobs()

  while (true) {
    try {
      await recoverStaleProcessingJobs()
      await failDuplicateProcessingJobs()

      const job = await prisma.processingJob.findFirst({
        where: { status: 'PENDING' },
        orderBy: { createdAt: 'asc' },
      })

      if (job) {
        const mediaId = job.mediaFileId
        if (!mediaId) {
          console.warn(`[worker] Job ${job.id} has no mediaFileId, marking FAILED`)
          const finishedAt = new Date()
          await prisma.processingJob.update({
            where: { id: job.id },
            data: {
              status: 'FAILED',
              errorMessage: 'No media file',
              finishedAt,
              durationMs: Math.max(0, finishedAt.getTime() - job.createdAt.getTime()),
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
          const finishedAt = new Date()
          await prisma.processingJob.update({
            where: { id: job.id },
            data: {
              status: 'FAILED',
              errorMessage: `Media is already processing in job ${activeJob.id}`,
              finishedAt,
              durationMs: Math.max(0, finishedAt.getTime() - job.createdAt.getTime()),
            },
          })
          continue
        }

        console.log(`[worker] Claiming job ${job.id} (type=${job.type}, media=${mediaId.slice(0, 8)}…)`)
        const startedAt = job.startedAt ?? new Date()
        await prisma.processingJob.update({
          where: { id: job.id },
          data: {
            status: 'PROCESSING',
            attempts: job.attempts + 1,
            startedAt,
            finishedAt: null,
            durationMs: null,
          },
        })

        try {
          await runWithHeartbeat(job.id, () => runPipeline(mediaId, job.id))
          await markJobFinished(job.id, 'DONE', startedAt)
          console.log(`[worker] Job ${job.id} completed`)
        } catch (err: any) {
          console.error(`[worker] Job ${job.id} failed:`, err.message)
          const cancelled = err.message === 'Job cancelled'
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
    }

    await sleep(POLL_INTERVAL_MS)
  }
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
    await prisma.processingJob.update({
      where: { id: job.id },
      data: {
        status: 'FAILED',
        errorMessage: 'Superseded by another processing job for the same media',
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
    }).catch((err) => console.warn(`[worker] Job heartbeat failed for ${jobId}:`, err))
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startWorker()
}
