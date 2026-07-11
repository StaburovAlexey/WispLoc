import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const originalHome = process.env.HOME
const originalUserProfile = process.env.USERPROFILE
const originalDatabaseUrl = process.env.DATABASE_URL

afterEach(() => {
  process.env.HOME = originalHome
  process.env.USERPROFILE = originalUserProfile
  process.env.DATABASE_URL = originalDatabaseUrl
  vi.resetModules()
})

describe('runtime config', () => {
  it('loads defaults from a clean home and preserves configured llmModel', async () => {
    const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'wisploc-config-'))
    process.env.HOME = home
    delete process.env.USERPROFILE
    delete process.env.DATABASE_URL
    vi.resetModules()

    const { PATHS, DEFAULT_CONFIG } = await import('../packages/shared/src/constants/index')
    const { loadConfig, saveConfig, reloadConfig, getDatabaseUrl } = await import('../packages/core/src/config/index')

    expect(PATHS.home).toBe(path.join(home, '.wisploc'))
    expect(loadConfig().llmModel).toBe('qwen3:4b')
    expect(getDatabaseUrl()).toBe(`file:${path.join(home, '.wisploc/data/wisploc.db')}`)

    saveConfig({
      ...DEFAULT_CONFIG,
      llmModel: 'custom-local-model:latest',
      setupCompleted: true,
    })

    expect(reloadConfig().llmModel).toBe('custom-local-model:latest')
    expect(reloadConfig().setupCompleted).toBe(true)
  })
})
