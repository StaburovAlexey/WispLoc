import type { FastifyInstance } from 'fastify'
import {
  getFullTranscript,
  getSegments,
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
