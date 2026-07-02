import type { TaskIntegrationProvider, IntegrationTarget, CreateExternalTaskInput, CreatedExternalTaskResult } from '@wisploc/shared'

interface YandexTrackerConfig {
  token: string
  organizationHeader: 'X-Org-ID' | 'X-Cloud-Org-ID'
  organizationId: string
}

export function createYandexTrackerProvider(config: YandexTrackerConfig): TaskIntegrationProvider {
  const baseUrl = 'https://api.tracker.yandex.net'

  async function api(path: string, options: RequestInit = {}): Promise<any> {
    const res = await fetch(`${baseUrl}${path}`, {
      ...options,
      headers: {
        Authorization: `OAuth ${config.token}`,
        [config.organizationHeader]: config.organizationId,
        'Content-Type': 'application/json',
        ...(options.headers as Record<string, string>),
      },
    })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Yandex Tracker API ${res.status}: ${text.slice(0, 200)}`)
    }
    return res.json()
  }

  return {
    provider: 'yandex-tracker',

    async checkAuth() {
      try {
        await api('/v2/myself')
        return true
      } catch {
        return false
      }
    },

    async listTargets(): Promise<IntegrationTarget[]> {
      const queues = await api('/v2/queues')
      return (queues || []).map((q: any) => ({
        id: String(q.id),
        key: q.key,
        name: q.display || q.key,
        type: 'queue' as const,
      }))
    },

    async createTask(
      targetId: string,
      input: CreateExternalTaskInput,
    ): Promise<CreatedExternalTaskResult> {
      const queue = await api(`/v2/queues/${targetId}`)
      const body: any = {
        queue: { key: queue.key },
        summary: input.title,
        description: input.description,
        type: 'task',
      }
      if (input.priority) {
        body.priority = input.priority === 'high' ? 'critical' : input.priority === 'medium' ? 'normal' : 'minor'
      }
      if (input.assignee) {
        body.assignee = input.assignee
      }
      if (input.sourceTimecode) {
        body.description = `Source timecode: ${input.sourceTimecode}\n\n${body.description}`
      }

      const issue = await api('/v2/issues', {
        method: 'POST',
        body: JSON.stringify(body),
      })

      return {
        externalId: String(issue.id),
        externalKey: issue.key,
        externalUrl: `${baseUrl}/issues/${issue.key}`,
      }
    },
  }
}
