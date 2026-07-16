import type { FastifyInstance } from 'fastify'
import { getMediaRecordRaw, listEvidenceFacts } from '@wisploc/core'

export async function factRoutes(app: FastifyInstance) {
  app.get('/api/media/:mediaId/facts', async (req, reply) => {
    const { mediaId } = req.params as { mediaId: string }
    if (!await getMediaRecordRaw(mediaId)) return reply.status(404).send({ error: 'Media not found' })
    return listEvidenceFacts(mediaId)
  })
}
