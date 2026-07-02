import type { FastifyInstance } from 'fastify'
import { loadConfig, saveConfig } from '@wisploc/core'

export async function settingsRoutes(app: FastifyInstance) {
  // GET /api/settings
  app.get('/api/settings', async () => {
    const config = loadConfig()
    return {
      language: config.language,
      chunkMinutes: config.chunkMinutes,
      cleanChunks: config.cleanChunks,
      appHost: config.appHost,
      appPort: config.appPort,
      ollamaHost: config.ollamaHost,
      llmModel: config.llmModel,
      setupCompleted: config.setupCompleted,
    }
  })

  // PATCH /api/settings
  app.patch('/api/settings', async (req) => {
    const body = req.body as any
    const config = loadConfig()

    if (body.language !== undefined) config.language = body.language
    if (body.chunkMinutes !== undefined) config.chunkMinutes = body.chunkMinutes
    if (body.cleanChunks !== undefined) config.cleanChunks = body.cleanChunks
    if (body.ollamaHost !== undefined) config.ollamaHost = body.ollamaHost
    if (body.llmModel !== undefined) config.llmModel = body.llmModel

    saveConfig(config)
    return { ok: true }
  })
}
