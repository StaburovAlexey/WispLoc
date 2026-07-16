import type { FastifyInstance } from 'fastify'
import { dictionaryEntryInputSchema } from '@wisploc/shared'
import {
  createDictionaryEntry,
  getTermSuggestion,
  listTermSuggestions,
  setTermSuggestionStatus,
} from '@wisploc/core'

export async function termRoutes(app: FastifyInstance) {
  app.get('/api/media/:mediaId/terms', async (req) => {
    const { mediaId } = req.params as { mediaId: string }
    return listTermSuggestions(mediaId)
  })

  app.post('/api/terms/:id/accept', async (req, reply) => {
    const { id } = req.params as { id: string }
    const suggestion = await getTermSuggestion(id)
    if (!suggestion) return reply.status(404).send({ error: 'Term suggestion not found' })
    const parsed = dictionaryEntryInputSchema.safeParse(req.body ?? {
      canonical: suggestion.proposedCanonical,
      aliases: [suggestion.observedForm, ...suggestion.aliases],
    })
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() })
    const entry = await createDictionaryEntry(parsed.data)
    await setTermSuggestionStatus(id, 'ACCEPTED')
    return entry
  })

  app.post('/api/terms/:id/reject', async (req, reply) => {
    const { id } = req.params as { id: string }
    const suggestion = await getTermSuggestion(id)
    if (!suggestion) return reply.status(404).send({ error: 'Term suggestion not found' })
    await setTermSuggestionStatus(id, 'REJECTED')
    return { ok: true }
  })
}

