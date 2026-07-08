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

describe('api server smoke', () => {
  it('serves shallow health and restricts CORS to local origins', async () => {
    const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'wisploc-api-'))
    process.env.HOME = home
    delete process.env.USERPROFILE
    process.env.DATABASE_URL = `file:${path.join(home, '.wisploc/data/wisploc.db')}`
    vi.resetModules()

    const { createServer } = await import('../apps/api/src/server')
    const app = await createServer()

    try {
      const health = await app.inject({ method: 'GET', url: '/api/health' })
      expect(health.statusCode).toBe(200)
      expect(health.json()).toMatchObject({ status: 'ok' })

      const allowed = await app.inject({
        method: 'GET',
        url: '/api/health',
        headers: { origin: 'http://127.0.0.1:5173' },
      })
      expect(allowed.headers['access-control-allow-origin']).toBe('http://127.0.0.1:5173')

      const denied = await app.inject({
        method: 'GET',
        url: '/api/health',
        headers: { origin: 'http://example.com' },
      })
      expect(denied.headers['access-control-allow-origin']).toBeUndefined()
    } finally {
      await app.close()
    }
  })
})
