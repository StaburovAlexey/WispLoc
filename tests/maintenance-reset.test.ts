import { execFile } from 'node:child_process'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it, vi } from 'vitest'

const execFileAsync = promisify(execFile)
const originalHome = process.env.HOME
const originalUserProfile = process.env.USERPROFILE
const originalDatabaseUrl = process.env.DATABASE_URL
const originalOllamaModels = process.env.OLLAMA_MODELS

afterEach(() => {
  process.env.HOME = originalHome
  process.env.USERPROFILE = originalUserProfile
  process.env.DATABASE_URL = originalDatabaseUrl
  process.env.OLLAMA_MODELS = originalOllamaModels
  vi.resetModules()
})

describe('maintenance reset', () => {
  it('removes legacy Ollama runtime and local Ollama model storage', async () => {
    const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'wisploc-maintenance-'))
    const databaseUrl = `file:${path.join(home, '.wisploc/data/wisploc.db')}`
    process.env.HOME = home
    delete process.env.USERPROFILE
    process.env.DATABASE_URL = databaseUrl
    process.env.OLLAMA_MODELS = path.join(home, '.ollama/models')
    vi.resetModules()

    await execFileAsync('pnpm', ['db:push'], {
      cwd: path.resolve(__dirname, '..'),
      env: { ...process.env, DATABASE_URL: databaseUrl },
      timeout: 120_000,
    })

    const legacyOllamaBin = path.join(home, '.wisploc/ollama/bin')
    const legacyOllamaLib = path.join(home, '.wisploc/ollama/lib/ollama')
    const installScript = path.join(home, '.wisploc/ollama-install.sh')
    const ollamaModels = path.join(home, '.ollama/models/blobs')
    const ollamaCache = path.join(home, '.ollama/cache')
    const uploadPath = path.join(home, '.wisploc/data/uploads/source.webm')

    await fsp.mkdir(legacyOllamaBin, { recursive: true })
    await fsp.mkdir(legacyOllamaLib, { recursive: true })
    await fsp.mkdir(ollamaModels, { recursive: true })
    await fsp.mkdir(ollamaCache, { recursive: true })
    await fsp.mkdir(path.dirname(uploadPath), { recursive: true })
    await fsp.writeFile(path.join(legacyOllamaBin, 'ollama'), 'binary')
    await fsp.writeFile(path.join(legacyOllamaLib, 'llama-server'), 'binary')
    await fsp.writeFile(installScript, '#!/bin/sh')
    await fsp.writeFile(path.join(ollamaModels, 'sha256-test'), 'model')
    await fsp.writeFile(path.join(ollamaCache, 'model-recommendations.json'), '{}')
    await fsp.writeFile(uploadPath, 'media')

    const { getPrisma } = await import('../packages/core/src/database/index')
    const { resetAllLocalData } = await import('../packages/core/src/maintenance/index')
    const prisma = getPrisma()

    try {
      await prisma.mediaFile.create({
        data: {
          originalName: 'source.webm',
          mimeType: 'video/webm',
          sizeBytes: 5,
          sourcePath: uploadPath,
          status: 'UPLOADED',
        },
      })

      const result = await resetAllLocalData()

      expect(result.ok).toBe(true)
      expect(fs.existsSync(path.join(home, '.wisploc/ollama'))).toBe(false)
      expect(fs.existsSync(installScript)).toBe(false)
      expect(fs.existsSync(path.join(home, '.ollama/models'))).toBe(false)
      expect(fs.existsSync(ollamaCache)).toBe(false)
      expect(fs.existsSync(uploadPath)).toBe(false)
      expect(await prisma.mediaFile.count()).toBe(0)
    } finally {
      await prisma.$disconnect()
    }
  })
})
