import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const originalHome = process.env.HOME
const originalUserProfile = process.env.USERPROFILE

afterEach(() => {
  process.env.HOME = originalHome
  process.env.USERPROFILE = originalUserProfile
  vi.resetModules()
})

describe('logger', () => {
  it('writes redacted jsonl diagnostics to the runtime logs directory', async () => {
    const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'wisploc-logger-'))
    process.env.HOME = home
    delete process.env.USERPROFILE
    vi.resetModules()

    const { createLogger, diagnosticsPaths } = await import('../packages/core/src/logger/index')
    const logger = createLogger('test', 'test.log')
    logger.info('message written', {
      mediaId: 'media-1',
      token: 'secret-token',
      nested: { authorization: 'Bearer secret' },
    })

    const logPath = path.join(home, '.wisploc/logs/test.log')
    const line = fs.readFileSync(logPath, 'utf-8').trim()
    const entry = JSON.parse(line) as Record<string, unknown>

    expect(entry.scope).toBe('test')
    expect(entry.message).toBe('message written')
    expect(entry.mediaId).toBe('media-1')
    expect(entry.token).toBe('[redacted]')
    expect(entry.nested).toEqual({ authorization: '[redacted]' })
    expect(diagnosticsPaths()).toContain(path.join(home, '.wisploc/logs/wisploc.log'))
  })
})
