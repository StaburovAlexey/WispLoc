import fs from 'node:fs/promises'
import { execa } from 'execa'
import { PATHS } from '@wisploc/shared'
import { loadConfig, reloadConfig, saveConfig } from '../config'
import { getPrisma } from '../database'
import { listLocalOllamaModels } from '../ollama/models'
import { stopManagedOllama } from '../ollama/runtime'
import { listWhisperModels } from '../whisper/models'

const prisma = getPrisma()

export type MaintenanceResult = {
  ok: true
  deleted: string[]
  skipped: string[]
}

export async function getMaintenanceStatus() {
  const activeJobs = await prisma.processingJob.count({
    where: { status: { in: ['PENDING', 'PROCESSING'] } },
  })
  return {
    activeJobs,
    blocked: activeJobs > 0,
  }
}

export async function deleteRuntimeDependencies(): Promise<MaintenanceResult> {
  await assertNoActiveJobs()
  stopManagedOllama()

  const deleted: string[] = []
  const skipped: string[] = []
  const whisperModelPaths = listWhisperModels().map((model) => model.path)
  for (const target of [
    `${PATHS.bin}/ffmpeg`,
    `${PATHS.bin}/ffprobe`,
    `${PATHS.bin}/whisper-cli`,
    `${PATHS.bin}/ollama`,
    `${PATHS.bin}/ffmpeg.exe`,
    `${PATHS.bin}/ffprobe.exe`,
    `${PATHS.bin}/whisper-cli.exe`,
    `${PATHS.bin}/ollama.exe`,
    `${PATHS.home}/lib/ollama`,
    ...whisperModelPaths,
  ]) {
    await removePath(target, deleted, skipped)
  }

  await removeAllLocalOllamaModels(deleted, skipped)
  await resetSetupState()

  const config = loadConfig()
  config.setupCompleted = false
  saveConfig(config)

  return { ok: true, deleted, skipped }
}

export async function clearTemporaryFiles(): Promise<MaintenanceResult> {
  await assertNoActiveJobs()
  const deleted: string[] = []
  const skipped: string[] = []
  await removePath(PATHS.chunks, deleted, skipped)
  await removePath(PATHS.exports, deleted, skipped)
  await fs.mkdir(PATHS.chunks, { recursive: true })
  await fs.mkdir(PATHS.exports, { recursive: true })
  return { ok: true, deleted, skipped }
}

export async function clearProcessedResults(): Promise<MaintenanceResult> {
  await assertNoActiveJobs()
  const deleted: string[] = []
  const skipped: string[] = []
  await removePath(PATHS.transcripts, deleted, skipped)
  await removePath(PATHS.summaries, deleted, skipped)
  await removePath(PATHS.chunks, deleted, skipped)
  await fs.mkdir(PATHS.transcripts, { recursive: true })
  await fs.mkdir(PATHS.summaries, { recursive: true })
  await fs.mkdir(PATHS.chunks, { recursive: true })

  await prisma.createdExternalTask.deleteMany()
  await prisma.extractedTask.deleteMany()
  await prisma.summary.deleteMany()
  await prisma.transcriptSegment.deleteMany()
  await prisma.mediaChunk.deleteMany()
  await prisma.processingJob.deleteMany()
  await prisma.mediaFile.updateMany({
    data: {
      status: 'UPLOADED',
      durationSec: null,
      errorMessage: null,
    },
  })

  return { ok: true, deleted, skipped }
}

export async function resetAllLocalData(): Promise<MaintenanceResult> {
  await assertNoActiveJobs()
  stopManagedOllama()

  const deleted: string[] = []
  const skipped: string[] = []

  await prisma.createdExternalTask.deleteMany()
  await prisma.extractedTask.deleteMany()
  await prisma.integrationTarget.deleteMany()
  await prisma.integrationAccount.deleteMany()
  await prisma.summary.deleteMany()
  await prisma.transcriptSegment.deleteMany()
  await prisma.mediaChunk.deleteMany()
  await prisma.processingJob.deleteMany()
  await prisma.mediaFile.deleteMany()
  await prisma.setupState.deleteMany()
  await prisma.appSetting.deleteMany()

  await removeAllLocalOllamaModels(deleted, skipped)

  for (const target of [
    PATHS.bin,
    PATHS.models,
    PATHS.uploads,
    PATHS.chunks,
    PATHS.transcripts,
    PATHS.summaries,
    PATHS.exports,
    PATHS.logs,
    PATHS.config,
    `${PATHS.home}/lib/ollama`,
    `${PATHS.home}/wisploc.pid`,
    `${PATHS.home}/ollama.pid`,
  ]) {
    await removePath(target, deleted, skipped)
  }
  reloadConfig()

  return { ok: true, deleted, skipped }
}

async function assertNoActiveJobs(): Promise<void> {
  const count = await prisma.processingJob.count({
    where: { status: { in: ['PENDING', 'PROCESSING'] } },
  })
  if (count > 0) {
    throw new Error('Maintenance is blocked while jobs are pending or processing')
  }
}

async function resetSetupState(): Promise<void> {
  await prisma.setupState.updateMany({
    data: {
      setupCompleted: false,
      status: 'IDLE',
      currentStep: null,
      progress: 0,
      ffmpegStatus: 'missing',
      whisperStatus: 'missing',
      modelStatus: 'missing',
      ollamaStatus: 'missing',
      llmStatus: 'missing',
      errorMessage: null,
    },
  })
}

async function removePath(target: string, deleted: string[], skipped: string[]): Promise<void> {
  try {
    await fs.rm(target, { recursive: true, force: true })
    deleted.push(target)
  } catch {
    skipped.push(target)
  }
}

async function removeAllLocalOllamaModels(deleted: string[], skipped: string[]): Promise<void> {
  const config = loadConfig()
  const canManageLocalModel = config.ollamaHost === 'http://127.0.0.1:11434'
  if (!canManageLocalModel) {
    skipped.push('ollama models: non-local ollamaHost')
    return
  }

  const command = `${PATHS.bin}/${process.platform === 'win32' ? 'ollama.exe' : 'ollama'}`
  let models: string[] = []
  try {
    models = (await listLocalOllamaModels()).map((model) => model.name)
  } catch {
    skipped.push('ollama models: list failed')
    return
  }

  if (models.length === 0) {
    skipped.push('ollama models: none installed')
    return
  }

  for (const model of models) {
    try {
      await execa(command, ['rm', model], { timeout: 120_000 })
      deleted.push(`ollama model ${model}`)
    } catch {
      skipped.push(`ollama model ${model}`)
    }
  }
}
