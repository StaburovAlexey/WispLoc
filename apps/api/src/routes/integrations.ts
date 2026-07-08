import type { FastifyInstance } from 'fastify'
import {
  createIntegration,
  listIntegrations,
  getIntegration,
  updateIntegration,
  deleteIntegration,
  saveTargets,
  getTargets,
  getTask,
  createExternalTaskRecord,
} from '@wisploc/core'
import {
  createYandexTrackerProvider,
  createGitHubProvider,
  createGitLabProvider,
} from '@wisploc/integrations'
import type { TaskIntegrationProvider } from '@wisploc/shared'

export async function integrationRoutes(app: FastifyInstance) {
  // ── CRUD ────────────────────────────────────────────
  app.get('/api/integrations', async () => {
    return listIntegrations()
  })

  app.post('/api/integrations', async (req) => {
    const body = req.body as any
    return createIntegration({
      provider: body.provider,
      displayName: body.displayName,
      baseUrl: body.baseUrl,
      authType: body.authType ?? 'token',
      token: body.token,
      organizationId: body.organizationId,
      settingsJson: body.settingsJson,
    })
  })

  app.get('/api/integrations/:id', async (req, reply) => {
    const { id } = req.params as { id: string }
    const integration = await getIntegration(id)
    if (!integration) return reply.status(404).send({ error: 'Integration not found' })
    // Mask token
    return {
      ...integration,
      token: integration.token ? '••••' + integration.token.slice(-4) : null,
    }
  })

  app.patch('/api/integrations/:id', async (req) => {
    const { id } = req.params as { id: string }
    const body = req.body as any
    return updateIntegration(id, {
      displayName: body.displayName,
      baseUrl: body.baseUrl,
      token: body.token,
      organizationId: body.organizationId,
      settingsJson: body.settingsJson,
    })
  })

  app.delete('/api/integrations/:id', async (req) => {
    const { id } = req.params as { id: string }
    await deleteIntegration(id)
    return { ok: true }
  })

  // ── Test connection ─────────────────────────────────
  app.post('/api/integrations/:id/test', async (req, reply) => {
    const { id } = req.params as { id: string }
    const integration = await getIntegration(id)
    if (!integration) return reply.status(404).send({ error: 'Integration not found' })

    const provider = buildProvider(integration)
    if (!provider) return reply.status(400).send({ error: 'Unknown provider' })

    const ok = await provider.checkAuth()
    return { ok, provider: integration.provider }
  })

  // ── List targets ────────────────────────────────────
  app.post('/api/integrations/:id/refresh-targets', async (req, reply) => {
    const { id } = req.params as { id: string }
    const integration = await getIntegration(id)
    if (!integration) return reply.status(404).send({ error: 'Integration not found' })

    const provider = buildProvider(integration)
    if (!provider) return reply.status(400).send({ error: 'Unknown provider' })

    const targets = await provider.listTargets()
    await saveTargets(
      id,
      targets.map((target) => ({
        externalId: target.id,
        key: target.key,
        name: target.name,
        type: target.type,
      })),
    )
    return { count: targets.length }
  })

  app.get('/api/integrations/:id/targets', async (req, reply) => {
    const { id } = req.params as { id: string }
    return getTargets(id)
  })

  // ── Create external task ─────────────────────────────
  app.post('/api/tasks/:taskId/create-external', async (req, reply) => {
    const { taskId } = req.params as { taskId: string }
    const body = req.body as { integrationId: string; targetId: string }

    const task = await getTask(taskId)
    if (!task) return reply.status(404).send({ error: 'Task not found' })

    const integration = await getIntegration(body.integrationId)
    if (!integration) return reply.status(404).send({ error: 'Integration not found' })

    const provider = buildProvider(integration)
    if (!provider) return reply.status(400).send({ error: 'Unknown provider' })

    try {
      const result = await provider.createTask(body.targetId, {
        title: task.title,
        description: task.description,
        priority: (task.priority as any) ?? undefined,
        labels: task.labels ?? undefined,
        assignee: task.assigneeHint ?? undefined,
        sourceTimecode: task.sourceTimecode ?? undefined,
      })

      await createExternalTaskRecord({
        extractedTaskId: taskId,
        provider: integration.provider,
        integrationId: body.integrationId,
        externalId: result.externalId,
        externalKey: result.externalKey,
        externalUrl: result.externalUrl,
        status: 'created',
      })

      return {
        success: true,
        externalUrl: result.externalUrl,
        externalKey: result.externalKey,
      }
    } catch (err: any) {
      await createExternalTaskRecord({
        extractedTaskId: taskId,
        provider: integration.provider,
        integrationId: body.integrationId,
        externalId: 'failed',
        externalUrl: '',
        status: 'failed',
      })

      return reply.status(500).send({
        success: false,
        error: err.message,
      })
    }
  })
}

// ── Provider factory ────────────────────────────────────
function buildProvider(integration: any): TaskIntegrationProvider | null {
  switch (integration.provider) {
    case 'yandex-tracker':
      return createYandexTrackerProvider({
        token: integration.token,
        organizationHeader: integration.organizationId?.startsWith('cloud')
          ? 'X-Cloud-Org-ID'
          : 'X-Org-ID',
        organizationId: integration.organizationId || '',
      })
    case 'github':
      return createGitHubProvider({ token: integration.token })
    case 'gitlab':
      return createGitLabProvider({
        baseUrl: integration.baseUrl || 'https://gitlab.com',
        token: integration.token,
      })
    default:
      return null
  }
}
