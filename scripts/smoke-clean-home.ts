import assert from 'node:assert/strict'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const originalHome = process.env.HOME
const originalUserProfile = process.env.USERPROFILE
const originalDatabaseUrl = process.env.DATABASE_URL

async function main(): Promise<void> {
  const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'wisploc-clean-home-'))
  process.env.HOME = home
  delete process.env.USERPROFILE
  process.env.DATABASE_URL = `file:${path.join(home, '.wisploc/data/wisploc.db')}`

  try {
    const { PATHS, DEFAULT_CONFIG } = await import('../packages/shared/src/constants/index')
    const { ensureDirectories } = await import('../packages/core/src/filesystem/index')
    const { loadConfig, saveConfig, reloadConfig } = await import('../packages/core/src/config/index')
    const { createServer } = await import('../apps/api/src/server')

    assert.equal(PATHS.home, path.join(home, '.wisploc'))
    ensureDirectories()

    for (const dir of [PATHS.bin, PATHS.data, PATHS.uploads, PATHS.chunks, PATHS.logs]) {
      const stat = await fsp.stat(dir)
      assert.equal(stat.isDirectory(), true, `${dir} should be a directory`)
    }

    assert.equal(loadConfig().setupCompleted, false)
    saveConfig({ ...DEFAULT_CONFIG, setupCompleted: false })
    assert.equal(reloadConfig().setupCompleted, false)

    const app = await createServer()
    try {
      const response = await app.inject({ method: 'GET', url: '/api/health' })
      assert.equal(response.statusCode, 200)
      assert.equal(response.json().status, 'ok')
    } finally {
      await app.close()
    }

    console.log(`clean-home smoke passed: ${PATHS.home}`)
  } finally {
    process.env.HOME = originalHome
    process.env.USERPROFILE = originalUserProfile
    process.env.DATABASE_URL = originalDatabaseUrl
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
