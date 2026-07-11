import type { TaskIntegrationProvider, IntegrationTarget, CreateExternalTaskInput, CreatedExternalTaskResult } from '@wisploc/shared'

interface GitLabConfig {
  baseUrl: string
  token: string
}

export function createGitLabProvider(config: GitLabConfig): TaskIntegrationProvider {
  const apiUrl = `${config.baseUrl}/api/v4`

  async function api(path: string, options: RequestInit = {}): Promise<any> {
    const res = await fetch(`${apiUrl}${path}`, {
      ...options,
      headers: {
        'PRIVATE-TOKEN': config.token,
        'Content-Type': 'application/json',
        ...(options.headers as Record<string, string>),
      },
    })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`GitLab API ${res.status}: ${text.slice(0, 200)}`)
    }
    return res.json()
  }

  return {
    provider: 'gitlab',

    async checkAuth() {
      try {
        await api('/user')
        return true
      } catch {
        return false
      }
    },

    async listTargets(): Promise<IntegrationTarget[]> {
      const projects = await api('/projects?per_page=100&membership=true&order_by=updated_at')
      return (projects || []).map((p: any) => ({
        id: String(p.id),
        key: p.path_with_namespace,
        name: p.name_with_namespace,
        type: 'project' as const,
      }))
    },

    async createTask(
      targetId: string,
      input: CreateExternalTaskInput,
    ): Promise<CreatedExternalTaskResult> {
      const body: any = {
        title: input.title,
        description: input.description,
      }
      if (input.labels?.length) {
        body.labels = input.labels.join(',')
      }
      if (input.assignee) {
        // GitLab expects user ID for assignee; passing username as assignee_id is accepted
        body.assignee_ids = [input.assignee]
      }
      if (input.sourceTimecode) {
        body.description = `Source timecode: ${input.sourceTimecode}\n\n${body.description}`
      }

      const issue = await api(`/projects/${targetId}/issues`, {
        method: 'POST',
        body: JSON.stringify(body),
      })

      return {
        externalId: String(issue.id),
        externalKey: `#${issue.iid}`,
        externalUrl: issue.web_url,
      }
    },
  }
}
