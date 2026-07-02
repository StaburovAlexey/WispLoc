/**
 * WispLoc Worker — polls SQLite for PENDING jobs and processes them sequentially.
 */
import { getPrisma } from '@wisploc/core'
import { runPipeline } from './processor/pipeline'

const prisma = getPrisma()
const POLL_INTERVAL_MS = 5_000
let workerStarted = false

export async function startWorker() {
  if (workerStarted) return
  workerStarted = true
  console.log('[worker] WispLoc worker started — polling for jobs')

  while (true) {
    try {
      const job = await prisma.processingJob.findFirst({
        where: { status: 'PENDING' },
        orderBy: { createdAt: 'asc' },
      })

      if (job) {
        const mediaId = job.mediaFileId
        if (!mediaId) {
          console.warn(`[worker] Job ${job.id} has no mediaFileId, marking FAILED`)
          await prisma.processingJob.update({
            where: { id: job.id },
            data: { status: 'FAILED', errorMessage: 'No media file' },
          })
          continue
        }

        console.log(`[worker] Claiming job ${job.id} (type=${job.type}, media=${mediaId.slice(0, 8)}…)`)
        await prisma.processingJob.update({
          where: { id: job.id },
          data: { status: 'PROCESSING', attempts: job.attempts + 1 },
        })

        try {
          await runPipeline(mediaId, job.id)
          console.log(`[worker] Job ${job.id} completed`)
        } catch (err: any) {
          console.error(`[worker] Job ${job.id} failed:`, err.message)
          const cancelled = err.message === 'Job cancelled'
          await prisma.processingJob.update({
            where: { id: job.id },
            data: {
              status: cancelled ? 'CANCELLED' : 'FAILED',
              errorMessage: cancelled ? null : err.message,
            },
          })
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startWorker()
}
