import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { execa } from 'execa'
import { PATHS } from '@wisploc/shared'
import { loadConfig, reloadConfig, saveConfig } from '../config'
import { getPrisma } from '../database'
import { listLocalOllamaModels } from '../ollama/models'
import { stopManagedOllama } from '../ollama/runtime'
import { listWhisperModels } from '../whisper/models'
import { createLogger } from '../logger'

const prisma = getPrisma()
const maintenanceLog = createLogger('maintenance', 'maintenance.log')

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
  maintenanceLog.info('delete runtime dependencies started')

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
    `${PATHS.home}/ollama`,
    `${PATHS.home}/ollama-install.sh`,
    ...whisperModelPaths,
  ]) {
    await removePath(target, deleted, skipped)
  }

  await removeAllLocalOllamaModels(deleted, skipped)
  await resetSetupState()

  const config = loadConfig()
  config.setupCompleted = false
  saveConfig(config)

  maintenanceLog.info('delete runtime dependencies completed', {
    deletedCount: deleted.length,
    skippedCount: skipped.length,
  })
  return { ok: true, deleted, skipped }
}

export async function clearTemporaryFiles(): Promise<MaintenanceResult> {
  await assertNoActiveJobs()
  maintenanceLog.info('clear temporary files started')
  const deleted: string[] = []
  const skipped: string[] = []
  await removePath(PATHS.chunks, deleted, skipped)
  await removePath(PATHS.exports, deleted, skipped)
  await fs.mkdir(PATHS.chunks, { recursive: true })
  await fs.mkdir(PATHS.exports, { recursive: true })
  maintenanceLog.info('clear temporary files completed', {
    deletedCount: deleted.length,
    skippedCount: skipped.length,
  })
  return { ok: true, deleted, skipped }
}

export async function clearProcessedResults(): Promise<MaintenanceResult> {
  await assertNoActiveJobs()
  maintenanceLog.info('clear processed results started')
  const deleted: string[] = []
  const skipped: string[] = []
  await removePath(PATHS.transcripts, deleted, skipped)
  await removePath(PATHS.summaries, deleted, skipped)
  await removePath(PATHS.chunks, deleted, skipped)
  await fs.mkdir(PATHS.transcripts, { recursive: true })
  await fs.mkdir(PATHS.summaries, { recursive: true })
  await fs.mkdir(PATHS.chunks, { recursive: true })

  await prisma.createdExternalTask.deleteMany()
  await prisma.userCorrectionRecord.deleteMany()
  await prisma.artifactGeneration.deleteMany()
  await prisma.normalizedTranscriptSegment.deleteMany()
  await prisma.factChunkCheckpoint.deleteMany()
  await prisma.termSuggestion.deleteMany()
  await prisma.taskCandidateRecord.deleteMany()
  await prisma.summaryBatchCheckpoint.deleteMany()
  await prisma.mergedFactRecord.deleteMany()
  await prisma.atomicFactRecord.deleteMany()
  await prisma.evidenceTranscriptChunk.deleteMany()
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

  maintenanceLog.info('clear processed results completed', {
    deletedCount: deleted.length,
    skippedCount: skipped.length,
  })
  return { ok: true, deleted, skipped }
}

export async function resetAllLocalData(options: { removeDependencies?: boolean } = {}): Promise<MaintenanceResult> {
  await assertNoActiveJobs()
  stopManagedOllama()
  maintenanceLog.warn('reset all local data started')

  const deleted: string[] = []
  const skipped: string[] = []

  await prisma.createdExternalTask.deleteMany()
  await prisma.userCorrectionRecord.deleteMany()
  await prisma.knowledgeExample.deleteMany()
  await prisma.artifactGeneration.deleteMany()
  await prisma.normalizedTranscriptSegment.deleteMany()
  await prisma.factChunkCheckpoint.deleteMany()
  await prisma.termSuggestion.deleteMany()
  await prisma.taskCandidateRecord.deleteMany()
  await prisma.summaryBatchCheckpoint.deleteMany()
  await prisma.mergedFactRecord.deleteMany()
  await prisma.atomicFactRecord.deleteMany()
  await prisma.evidenceTranscriptChunk.deleteMany()
  await prisma.dictionaryEntry.deleteMany()
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

  if (options.removeDependencies !== false) {
    await removeAllLocalOllamaModels(deleted, skipped)
  } else {
    skipped.push('runtime dependencies: retained')
  }

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
    `${PATHS.home}/lib`,
    `${PATHS.home}/ollama`,
    `${PATHS.home}/ollama-install.sh`,
    `${PATHS.home}/wisploc.pid`,
    `${PATHS.home}/ollama.pid`,
  ]) {
    await removePath(target, deleted, skipped)
  }
  reloadConfig()

  maintenanceLog.warn('reset all local data completed', {
    deletedCount: deleted.length,
    skippedCount: skipped.length,
  })
  return { ok: true, deleted, skipped }
}

async function assertNoActiveJobs(): Promise<void> {
  const count = await prisma.processingJob.count({
    where: { status: { in: ['PENDING', 'PROCESSING'] } },
  })
  if (count > 0) {
    maintenanceLog.warn('maintenance blocked by active jobs', { activeJobs: count })
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
    maintenanceLog.info('path removed', { target })
  } catch (err) {
    skipped.push(target)
    maintenanceLog.warn('path removal skipped', { target, error: err })
  }
}

async function removeAllLocalOllamaModels(deleted: string[], skipped: string[]): Promise<void> {
  const config = loadConfig()
  const canManageLocalModel = config.ollamaHost === 'http://127.0.0.1:11434'
  if (!canManageLocalModel) {
    skipped.push('ollama models: non-local ollamaHost')
    maintenanceLog.warn('ollama model cleanup skipped for non-local host', { ollamaHost: config.ollamaHost })
    return
  }

  const command = `${PATHS.bin}/${process.platform === 'win32' ? 'ollama.exe' : 'ollama'}`
  let models: string[]
  try {
    models = (await listLocalOllamaModels()).map((model) => model.name)
  } catch (err) {
    skipped.push('ollama models: list failed')
    maintenanceLog.warn('ollama model list failed during cleanup', { error: err })
    await removeLocalOllamaModelStorage(deleted, skipped)
    return
  }

  if (models.length === 0) {
    skipped.push('ollama models: none installed')
    maintenanceLog.info('ollama model cleanup found no installed models')
    await removeLocalOllamaModelStorage(deleted, skipped)
    return
  }

  for (const model of models) {
    try {
      await execa(command, ['rm', model], { timeout: 120_000 })
      deleted.push(`ollama model ${model}`)
      maintenanceLog.info('ollama model removed', { model })
    } catch (err) {
      skipped.push(`ollama model ${model}`)
      maintenanceLog.warn('ollama model removal failed', { model, error: err })
    }
  }

  await removeLocalOllamaModelStorage(deleted, skipped)
}

async function removeLocalOllamaModelStorage(deleted: string[], skipped: string[]): Promise<void> {
  const ollamaHome = process.env.OLLAMA_MODELS
    ? path.dirname(process.env.OLLAMA_MODELS)
    : path.join(os.homedir(), '.ollama')

  for (const target of [
    process.env.OLLAMA_MODELS ?? path.join(ollamaHome, 'models'),
    path.join(ollamaHome, 'cache'),
  ]) {
    await removePath(target, deleted, skipped)
  }
}
