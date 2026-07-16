import type { FastifyInstance } from 'fastify'
import {
  getFullTranscript,
  getSegments,
  getTranscriptContext,
} from '@wisploc/core'

export async function transcriptRoutes(app: FastifyInstance) {
  // GET /api/media/:mediaId/transcript — full transcript with segments
  app.get('/api/media/:mediaId/transcript', async (req, reply) => {
    const { mediaId } = req.params as { mediaId: string }
    const transcript = await getFullTranscript(mediaId)
    return transcript
  })

  // GET /api/media/:mediaId/transcript/segments — raw segments array
  app.get('/api/media/:mediaId/transcript/segments', async (req, reply) => {
    const { mediaId } = req.params as { mediaId: string }
    const segments = await getSegments(mediaId)
    return segments.map((s) => ({
      id: s.id,
      startSec: s.startSec,
      endSec: s.endSec,
      text: s.text,
      originalText: s.text,
      normalizedText: s.normalizedText,
      sequence: s.sequence,
      speaker: s.speaker,
    }))
  })

  app.post('/api/media/:mediaId/transcript/context', async (req, reply) => {
    const { mediaId } = req.params as { mediaId: string }
    const body = (req.body ?? {}) as Record<string, unknown>
    return getTranscriptContext({
      mediaFileId: mediaId,
      segmentIds: Array.isArray(body.segmentIds) ? body.segmentIds.filter((id): id is string => typeof id === 'string') : undefined,
      startSec: typeof body.startSec === 'number' ? body.startSec : undefined,
      endSec: typeof body.endSec === 'number' ? body.endSec : undefined,
      beforeSegments: typeof body.beforeSegments === 'number' ? body.beforeSegments : undefined,
      afterSegments: typeof body.afterSegments === 'number' ? body.afterSegments : undefined,
    })
  })

  // GET /api/media/:mediaId/export/transcript.txt
  app.get('/api/media/:mediaId/export/transcript.txt', async (req, reply) => {
    const { mediaId } = req.params as { mediaId: string }
    const { text } = await getFullTranscript(mediaId)
    reply.header('Content-Type', 'text/plain; charset=utf-8')
    reply.header('Content-Disposition', `attachment; filename="transcript-${mediaId}.txt"`)
    return text
  })

  // GET /api/media/:mediaId/export/transcript.json
  app.get('/api/media/:mediaId/export/transcript.json', async (req, reply) => {
    const { mediaId } = req.params as { mediaId: string }
    const { text, segments } = await getFullTranscript(mediaId)
    reply.header('Content-Type', 'application/json')
    reply.header('Content-Disposition', `attachment; filename="transcript-${mediaId}.json"`)
    return { text, segments }
  })
}
