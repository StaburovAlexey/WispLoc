import type { FastifyInstance } from 'fastify'
import {
  listJobs,
  getJob,
  retryJob,
  cancelJob,
  subscribeToJob,
} from '@wisploc/core'
import type { JobProgressEvent } from '@wisploc/core'

export async function jobsRoutes(app: FastifyInstance) {
  // GET /api/jobs
  app.get('/', async (req) => {
    const { mediaFileId } = req.query as { mediaFileId?: string }
    return listJobs(mediaFileId)
  })

  // GET /api/jobs/:id
  app.get('/:id', async (req, reply) => {
    const { id } = req.params as { id: string }
    const job = await getJob(id)
    if (!job) {
      return reply.status(404).send({ error: 'Job not found' })
    }
    return job
  })

  // POST /api/jobs/:id/retry
  app.post('/:id/retry', async (req, reply) => {
    const { id } = req.params as { id: string }
    const job = await getJob(id)
    if (!job) {
      return reply.status(404).send({ error: 'Job not found' })
    }
    await retryJob(id)
    return { ok: true }
  })

  // POST /api/jobs/:id/cancel
  app.post('/:id/cancel', async (req, reply) => {
    const { id } = req.params as { id: string }
    const job = await getJob(id)
    if (!job) {
      return reply.status(404).send({ error: 'Job not found' })
    }
    await cancelJob(id)
    return { ok: true }
  })

  // GET /api/jobs/:id/events — SSE stream
  app.get('/:id/events', async (req, reply) => {
    const { id } = req.params as { id: string }

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    })

    const send = (event: JobProgressEvent) => {
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`)
    }

    const unsubscribe = subscribeToJob(id, send)

    req.raw.on('close', () => {
      unsubscribe()
    })

    // Keep alive
    const keepAlive = setInterval(() => {
      reply.raw.write(': keepalive\n\n')
    }, 15_000)

    req.raw.on('close', () => {
      clearInterval(keepAlive)
    })
  })
}
