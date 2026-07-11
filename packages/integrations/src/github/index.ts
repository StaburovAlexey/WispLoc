import type { TaskIntegrationProvider, IntegrationTarget, CreateExternalTaskInput, CreatedExternalTaskResult } from '@wisploc/shared'

interface GitHubConfig {
  token: string
}

export function createGitHubProvider(config: GitHubConfig): TaskIntegrationProvider {
  const baseUrl = 'https://api.github.com'

  async function api(path: string, options: RequestInit = {}): Promise<any> {
    const res = await fetch(`${baseUrl}${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${config.token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
        ...(options.headers as Record<string, string>),
      },
    })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`GitHub API ${res.status}: ${text.slice(0, 200)}`)
    }
    return res.json()
  }

  return {
    provider: 'github',

    async checkAuth() {
      try {
        await api('/user')
        return true
      } catch {
        return false
      }
    },

    async listTargets(): Promise<IntegrationTarget[]> {
      // List user repos + org repos
      const repos: any[] = []
      const userRepos = await api('/user/repos?per_page=100&sort=updated')
      repos.push(...(userRepos || []))
      return repos.map((r: any) => ({
        // Issue endpoints address repositories by owner/name, not numeric id.
        id: String(r.full_name),
        key: r.full_name,
        name: r.full_name,
        type: 'repository' as const,
      }))
    },

    async createTask(
      targetId: string,
      input: CreateExternalTaskInput,
    ): Promise<CreatedExternalTaskResult> {
      // targetId is "owner/repo" (full_name)
      const body: any = {
        title: input.title,
        body: input.description,
      }
      if (input.labels?.length) {
        body.labels = input.labels
      }
      if (input.assignee) {
        body.assignees = [input.assignee]
      }
      if (input.sourceTimecode) {
        body.body = `Source timecode: ${input.sourceTimecode}\n\n${body.body}`
      }

      const issue = await api(`/repos/${targetId}/issues`, {
        method: 'POST',
        body: JSON.stringify(body),
      })

      return {
        externalId: String(issue.id),
        externalKey: `#${issue.number}`,
        externalUrl: issue.html_url,
      }
    },
  }
}
