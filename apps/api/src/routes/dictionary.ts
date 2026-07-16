import type { FastifyInstance } from 'fastify'
import { dictionaryEntryInputSchema } from '@wisploc/shared'
import {
  createDictionaryEntry,
  deleteDictionaryEntry,
  listDictionaryEntries,
  setDictionaryEntryStatus,
  updateDictionaryEntry,
} from '@wisploc/core'

export async function dictionaryRoutes(app: FastifyInstance) {
  app.get('/api/dictionary', async () => listDictionaryEntries())

  app.post('/api/dictionary', async (req, reply) => {
    const parsed = dictionaryEntryInputSchema.safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() })
    return createDictionaryEntry(parsed.data)
  })

  app.patch('/api/dictionary/:id', async (req, reply) => {
    const { id } = req.params as { id: string }
    const parsed = dictionaryEntryInputSchema.safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() })
    return updateDictionaryEntry(id, parsed.data)
  })

  app.post('/api/dictionary/:id/status', async (req, reply) => {
    const { id } = req.params as { id: string }
    const enabled = (req.body as { enabled?: unknown } | undefined)?.enabled
    if (typeof enabled !== 'boolean') return reply.status(400).send({ error: 'enabled must be boolean' })
    return setDictionaryEntryStatus(id, enabled)
  })

  app.delete('/api/dictionary/:id', async (req) => {
    const { id } = req.params as { id: string }
    await deleteDictionaryEntry(id)
    return { ok: true }
  })
}

