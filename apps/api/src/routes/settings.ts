import type { FastifyInstance } from 'fastify'
import {
  installWhisperModel,
  listLocalOllamaModels,
  listWhisperModels,
  loadConfig,
  saveConfig,
  selectWhisperModel,
} from '@wisploc/core'

export async function settingsRoutes(app: FastifyInstance) {
  // GET /api/settings
  app.get('/api/settings', async () => {
    const config = loadConfig()
    return {
      language: config.language,
      chunkMinutes: config.chunkMinutes,
      cleanChunks: config.cleanChunks,
      deleteOriginalAfterProcessing: config.deleteOriginalAfterProcessing,
      appHost: config.appHost,
      appPort: config.appPort,
      ollamaHost: config.ollamaHost,
      llmModel: config.llmModel,
      summaryLanguage: config.summaryLanguage,
      setupCompleted: config.setupCompleted,
    }
  })

  app.get('/api/settings/llm-models', async (req, reply) => {
    try {
      return await listLocalOllamaModels()
    } catch (err: any) {
      return reply.status(500).send({ error: err.message ?? 'Failed to list local Ollama models' })
    }
  })

  app.get('/api/settings/whisper-models', async () => {
    return listWhisperModels()
  })

  app.post('/api/settings/whisper-models/:model/install', async (req, reply) => {
    try {
      const { model } = req.params as { model: string }
      const installed = await installWhisperModel(model)
      return installed
    } catch (err: any) {
      return reply.status(400).send({ error: err.message ?? 'Failed to install Whisper model' })
    }
  })

  app.post('/api/settings/whisper-models/:model/select', async (req, reply) => {
    try {
      const { model } = req.params as { model: string }
      const selected = selectWhisperModel(model)
      return selected
    } catch (err: any) {
      return reply.status(400).send({ error: err.message ?? 'Failed to select Whisper model' })
    }
  })

  // PATCH /api/settings
  app.patch('/api/settings', async (req) => {
    const body = req.body as any
    const config = loadConfig()

    if (body.language !== undefined) config.language = body.language
    if (body.summaryLanguage !== undefined) config.summaryLanguage = body.summaryLanguage
    if (body.chunkMinutes !== undefined) config.chunkMinutes = body.chunkMinutes
    if (body.cleanChunks !== undefined) config.cleanChunks = body.cleanChunks
    if (body.deleteOriginalAfterProcessing !== undefined) config.deleteOriginalAfterProcessing = body.deleteOriginalAfterProcessing
    if (body.ollamaHost !== undefined) config.ollamaHost = body.ollamaHost
    if (body.llmModel !== undefined) config.llmModel = body.llmModel

    saveConfig(config)
    return { ok: true }
  })
}
