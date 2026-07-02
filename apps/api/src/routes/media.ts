import type { FastifyInstance } from 'fastify'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { PATHS } from '@wisploc/shared'
import {
  createMediaRecord,
  getMediaRecord,
  getMediaRecordRaw,
  listMediaRecords,
  deleteMediaRecord,
  updateMediaStatus,
  updateMediaDuration,
  probeMedia,
  createJob,
} from '@wisploc/core'

export async function mediaRoutes(app: FastifyInstance) {
  // POST /api/media/upload — streaming upload to disk
  app.post('/upload', async (req, reply) => {
    const data = await req.file()
    if (!data) {
      return reply.status(400).send({ error: 'No file uploaded' })
    }

    const safeName = `${randomUUID()}-${data.filename.replace(/[^a-zA-Z0-9._-]/g, '_')}`
    const uploadsDir = PATHS.uploads
    fs.mkdirSync(uploadsDir, { recursive: true })
    const destPath = path.join(uploadsDir, safeName)

    // Stream to disk
    await pipeline(data.file, fs.createWriteStream(destPath))

    const sizeBytes = fs.statSync(destPath).size

    const record = await createMediaRecord({
      originalName: data.filename,
      mimeType: data.mimetype,
      sizeBytes,
      sourcePath: destPath,
    })

    // Probe metadata in background (non-blocking)
    probeMedia(destPath)
      .then((probe) => {
        if (probe.durationSec) updateMediaDuration(record.id, probe.durationSec)
      })
      .catch(() => {})

    return record
  })

  // GET /api/media
  app.get('/', async () => {
    return listMediaRecords()
  })

  // GET /api/media/:id
  app.get('/:id', async (req, reply) => {
    const { id } = req.params as { id: string }
    const record = await getMediaRecordRaw(id)
    if (!record) return reply.status(404).send({ error: 'Media not found' })
    return record
  })

  // DELETE /api/media/:id
  app.delete('/:id', async (req, reply) => {
    const { id } = req.params as { id: string }
    const record = await getMediaRecordRaw(id)
    if (!record) return reply.status(404).send({ error: 'Media not found' })
    try { fs.unlinkSync(record.sourcePath) } catch {}
    await deleteMediaRecord(id)
    return { ok: true }
  })

  // POST /api/media/:id/process — create a PENDING job (worker picks it up)
  app.post('/:id/process', async (req, reply) => {
    const { id } = req.params as { id: string }
    const record = await getMediaRecord(id)
    if (!record) return reply.status(404).send({ error: 'Media not found' })

    const job = await createJob(id, 'full')
    return { jobId: job.id }
  })

  // POST /api/media/:id/cancel
  app.post('/:id/cancel', async (req, reply) => {
    const { id } = req.params as { id: string }
    await updateMediaStatus(id, 'CANCELLED')
    return { ok: true }
  })
}
