import type { TaskIntegrationProvider, TaskProvider } from '@wisploc/shared'

/** Registry of integration providers — to be populated in Phase 5. */
const providers = new Map<TaskProvider, TaskIntegrationProvider>()

export function registerProvider(provider: TaskIntegrationProvider): void {
  providers.set(provider.provider, provider)
}

export function getProvider(name: TaskProvider): TaskIntegrationProvider | undefined {
  return providers.get(name)
}
