import type { FastifyInstance } from 'fastify'
import {
  clearProcessedResults,
  clearTemporaryFiles,
  deleteRuntimeDependencies,
  getMaintenanceStatus,
  resetAllLocalData,
} from '@wisploc/core'

export async function maintenanceRoutes(app: FastifyInstance) {
  app.get('/api/maintenance/status', async () => {
    return getMaintenanceStatus()
  })

  app.post('/api/maintenance/delete-dependencies', async (_req, reply) => {
    try {
      return await deleteRuntimeDependencies()
    } catch (err: any) {
      return reply.status(409).send({ error: err.message ?? 'Maintenance failed' })
    }
  })

  app.post('/api/maintenance/clear-temp', async (_req, reply) => {
    try {
      return await clearTemporaryFiles()
    } catch (err: any) {
      return reply.status(409).send({ error: err.message ?? 'Maintenance failed' })
    }
  })

  app.post('/api/maintenance/clear-results', async (_req, reply) => {
    try {
      return await clearProcessedResults()
    } catch (err: any) {
      return reply.status(409).send({ error: err.message ?? 'Maintenance failed' })
    }
  })

  app.post('/api/maintenance/reset-all', async (req, reply) => {
    const body = req.body as { confirmation?: string } | null
    if (body?.confirmation !== 'DELETE') {
      return reply.status(400).send({ error: 'Confirmation text DELETE is required' })
    }

    try {
      return await resetAllLocalData()
    } catch (err: any) {
      return reply.status(409).send({ error: err.message ?? 'Maintenance failed' })
    }
  })
}
