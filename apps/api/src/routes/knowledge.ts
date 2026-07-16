import type { FastifyInstance } from 'fastify'
import type { KnowledgeStage, UserCorrectionInput } from '@wisploc/core'
import {
  BUILTIN_RULES,
  createUserCorrection,
  listKnowledgeExamples,
  listKnowledgeExamplesForReview,
  listUserCorrections,
  listRagDebugManifests,
  reviewUserCorrection,
  setKnowledgeExampleEnabled,
} from '@wisploc/core'

export async function knowledgeRoutes(app: FastifyInstance) {
  app.get('/api/media/:mediaId/rag-manifests', async (req) => {
    const { mediaId } = req.params as { mediaId: string }
    return listRagDebugManifests(mediaId)
  })
  app.get('/api/knowledge/rules', async () => BUILTIN_RULES)

  app.get('/api/knowledge/examples', async (req) => {
    const query = req.query as { stage?: string; language?: string; review?: string }
    const stage = isKnowledgeStage(query.stage) ? query.stage : undefined
    const language = query.language === 'en' ? 'en' : query.language === 'ru' ? 'ru' : undefined
    return query.review === 'true'
      ? listKnowledgeExamplesForReview(stage, language)
      : listKnowledgeExamples(stage, language)
  })

  app.patch('/api/knowledge/examples/:id', async (req, reply) => {
    const { id } = req.params as { id: string }
    const enabled = (req.body as { enabled?: unknown } | undefined)?.enabled
    if (typeof enabled !== 'boolean') return reply.status(400).send({ error: 'enabled must be boolean' })
    try {
      await setKnowledgeExampleEnabled(id, enabled)
      return { ok: true }
    } catch (error: any) {
      return reply.status(409).send({ error: error.message })
    }
  })

  app.get('/api/knowledge/corrections', async (req) => {
    const status = (req.query as { status?: string }).status
    return listUserCorrections(status === 'accepted' || status === 'rejected' || status === 'pending' ? status : undefined)
  })

  app.post('/api/knowledge/corrections', async (req, reply) => {
    const body = req.body as Partial<UserCorrectionInput> | undefined
    if (!body || !isKnowledgeStage(body.stage)
      || !hasText(body.mediaFileId) || !hasText(body.processingJobId) || !hasText(body.sourceInput)
      || !hasText(body.generatedOutputJson) || !hasText(body.correctedOutputJson) || !hasText(body.evidenceJson)) {
      return reply.status(400).send({ error: 'Missing or invalid correction fields' })
    }
    return createUserCorrection(body as UserCorrectionInput)
  })

  app.post('/api/knowledge/corrections/:id/review', async (req, reply) => {
    const { id } = req.params as { id: string }
    const status = (req.body as { status?: unknown } | undefined)?.status
    if (status !== 'accepted' && status !== 'rejected') return reply.status(400).send({ error: 'Invalid review status' })
    try {
      return await reviewUserCorrection(id, status)
    } catch (error: any) {
      return reply.status(404).send({ error: error.message })
    }
  })
}

const KNOWLEDGE_STAGES = new Set<KnowledgeStage>([
  'fact-extraction', 'fact-repair', 'fact-deduplication', 'task-extraction',
  'summary-batch', 'summary-final', 'term-discovery',
])

function isKnowledgeStage(value: string | undefined): value is KnowledgeStage {
  return value !== undefined && KNOWLEDGE_STAGES.has(value as KnowledgeStage)
}

function hasText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}
