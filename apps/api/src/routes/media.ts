import type { FastifyInstance } from 'fastify'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { PATHS, SUPPORTED_MIME_TYPES } from '@wisploc/shared'
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
  createLogger,
} from '@wisploc/core'

const mediaLog = createLogger('media-api')

const SUPPORTED_EXTENSIONS = new Set([
  '.aac',
  '.avi',
  '.flac',
  '.m4a',
  '.mkv',
  '.mov',
  '.mp3',
  '.mp4',
  '.ogg',
  '.wav',
  '.webm',
])

export async function mediaRoutes(app: FastifyInstance) {
  // POST /api/media/upload — streaming upload to disk
  app.post('/upload', async (req, reply) => {
    const data = await req.file()
    if (!data) {
      mediaLog.warn('upload rejected: no file')
      return reply.status(400).send({ error: 'No file uploaded' })
    }

    const validationError = validateUpload(data.filename, data.mimetype)
    if (validationError) {
      data.file.resume()
      mediaLog.warn('upload rejected: unsupported media', {
        filename: data.filename,
        mimeType: data.mimetype,
        errorMessage: validationError,
      })
      return reply.status(415).send({ error: validationError })
    }

    const safeName = `${randomUUID()}-${data.filename.replace(/[^a-zA-Z0-9._-]/g, '_')}`
    const uploadsDir = PATHS.uploads
    fs.mkdirSync(uploadsDir, { recursive: true })
    const destPath = path.join(uploadsDir, safeName)

    // Stream to disk
    mediaLog.info('upload stream started', {
      filename: data.filename,
      mimeType: data.mimetype,
      destination: destPath,
    })
    await pipeline(data.file, fs.createWriteStream(destPath))

    const sizeBytes = fs.statSync(destPath).size

    const record = await createMediaRecord({
      originalName: data.filename,
      mimeType: data.mimetype,
      sizeBytes,
      sourcePath: destPath,
    })
    mediaLog.info('media uploaded', {
      mediaId: record.id,
      filename: data.filename,
      mimeType: data.mimetype,
      sizeBytes,
      sourcePath: destPath,
    })

    // Probe metadata in background (non-blocking)
    probeMedia(destPath)
      .then((probe) => {
        if (probe.durationSec) updateMediaDuration(record.id, probe.durationSec)
        mediaLog.info('media probe completed after upload', {
          mediaId: record.id,
          durationSec: probe.durationSec,
          audioCodec: probe.audioCodec,
          videoCodec: probe.videoCodec,
        })
      })
      .catch((err) => {
        mediaLog.warn('media probe failed after upload', { mediaId: record.id, error: err })
      })

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
    if (!isInsideDirectory(record.sourcePath, PATHS.uploads)) {
      mediaLog.error('media delete refused: source path outside uploads', {
        mediaId: id,
        sourcePath: record.sourcePath,
      })
      return reply.status(500).send({ error: 'Stored media path is outside uploads directory' })
    }
    fs.rmSync(record.sourcePath, { force: true })
    await deleteMediaRecord(id)
    mediaLog.info('media deleted', { mediaId: id, sourcePath: record.sourcePath })
    return { ok: true }
  })

  // POST /api/media/:id/process — create a PENDING job (worker picks it up)
  app.post('/:id/process', async (req, reply) => {
    const { id } = req.params as { id: string }
    const record = await getMediaRecord(id)
    if (!record) return reply.status(404).send({ error: 'Media not found' })

    const job = await createJob(id, 'full')
    mediaLog.info('media processing requested', { mediaId: id, jobId: job.id })
    return { jobId: job.id }
  })

  // POST /api/media/:id/cancel
  app.post('/:id/cancel', async (req, reply) => {
    const { id } = req.params as { id: string }
    await updateMediaStatus(id, 'CANCELLED')
    mediaLog.warn('media processing cancel requested', { mediaId: id })
    return { ok: true }
  })
}

export function validateUpload(filename: string, mimetype: string): string | null {
  const extension = path.extname(filename).toLowerCase()
  const knownMime = (SUPPORTED_MIME_TYPES as readonly string[]).includes(mimetype)
  const knownExtension = SUPPORTED_EXTENSIONS.has(extension)

  if (!knownMime && !knownExtension) {
    return 'Unsupported media format'
  }

  return null
}

export function isInsideDirectory(filePath: string, directory: string): boolean {
  const relative = path.relative(path.resolve(directory), path.resolve(filePath))
  return relative.length === 0 || (!relative.startsWith('..') && !path.isAbsolute(relative))
}
