import type { FastifyInstance } from 'fastify'
import fs from 'node:fs'
import { loadConfig, getPrisma, checkSetupBinary } from '@wisploc/core'
import { PATHS } from '@wisploc/shared'

const prisma = getPrisma()

export async function healthRoutes(app: FastifyInstance) {
  // Shallow health check
  app.get('/health', async (_req, reply) => {
    return { status: 'ok', timestamp: new Date().toISOString() }
  })

  // Deep doctor check
  app.get('/doctor', async (_req, reply) => {
    const config = loadConfig()
    const checks: Record<string, { status: string; detail?: string }> = {}

    // Config
    checks.config = { status: 'ok', detail: PATHS.config }

    // SQLite / Prisma
    try {
      await prisma.$queryRaw`SELECT 1`
      checks.database = { status: 'ok' }
    } catch (err: any) {
      checks.database = { status: 'error', detail: err.message }
    }

    checks.filesystem = canWrite(PATHS.data)
      ? { status: 'ok', detail: PATHS.data }
      : { status: 'error', detail: `Cannot write to ${PATHS.data}` }

    checks.ffmpeg = (await checkSetupBinary('ffmpeg', ['-version'], config.ffmpegPath))
      ? { status: 'ok', detail: config.ffmpegPath }
      : { status: 'error', detail: 'ffmpeg not found' }

    checks.whisperCli = (await checkSetupBinary('whisper-cli', ['--help'], config.whisperBinPath))
      ? { status: 'ok', detail: config.whisperBinPath }
      : { status: 'error', detail: 'whisper-cli not found' }

    checks.whisperModel = fileExists(config.whisperModelPath)
      ? { status: 'ok', detail: config.whisperModelPath }
      : { status: 'error', detail: 'ggml-base.bin not found' }

    checks.ollama = (await checkSetupBinary('ollama', ['list'], 'ollama'))
      ? { status: 'ok', detail: config.ollamaHost }
      : { status: 'error', detail: 'ollama not installed or not running' }

    return {
      status: Object.values(checks).every((check) => check.status === 'ok') ? 'ok' : 'error',
      checks,
      config: {
        appHost: config.appHost,
        appPort: config.appPort,
        dataDir: config.dataDir,
        setupCompleted: config.setupCompleted,
      },
    }
  })
}

function fileExists(filePath: string): boolean {
  try {
    return fs.statSync(filePath).isFile()
  } catch {
    return false
  }
}

function canWrite(dirPath: string): boolean {
  try {
    fs.mkdirSync(dirPath, { recursive: true })
    fs.accessSync(dirPath, fs.constants.W_OK)
    return true
  } catch {
    return false
  }
}
