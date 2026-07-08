import { execa } from 'execa'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { SetupEvent, SetupStep } from '@wisploc/shared'
import { PATHS, DEFAULTS } from '@wisploc/shared'
import { ensureDirectories, fileExists } from '../filesystem'
import { getDatabaseUrl, loadConfig, saveConfig } from '../config'
import { writeManagedOllamaPid } from '../ollama/runtime'
import { ensureDatabaseEnv, getPrisma } from '../database'
import { installWhisperModel } from '../whisper/models'
import { createLogger } from '../logger'

export type SetupEventEmitter = (event: SetupEvent) => void
let cancelRequested = false
const setupLog = createLogger('setup', 'setup.log')

const SETUP_STEPS: SetupStep[] = [
  'storage',
  'database',
  'ffmpeg',
  'whisper-cli',
  'whisper-model',
  'ollama',
  'llm-model',
  'config',
  'doctor',
]

type ToolchainAsset = {
  archiveName: string
  url: string
  sha256?: string
  checksumUrl?: string
  headers?: Record<string, string>
}

const BTBN_FFMPEG_CHECKSUMS_URL = 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/checksums.sha256'
const DOWNLOAD_RETRY_DELAYS_MS = [750, 2_000, 5_000]

const TOOLCHAIN_ASSETS = {
  ffmpeg: {
    linux: {
      x64: {
        archiveName: 'ffmpeg-n7.1-latest-linux64-gpl-7.1.tar.xz',
        url: 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-n7.1-latest-linux64-gpl-7.1.tar.xz',
        checksumUrl: BTBN_FFMPEG_CHECKSUMS_URL,
      },
      arm64: {
        archiveName: 'ffmpeg-n7.1-latest-linuxarm64-gpl-7.1.tar.xz',
        url: 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-n7.1-latest-linuxarm64-gpl-7.1.tar.xz',
        checksumUrl: BTBN_FFMPEG_CHECKSUMS_URL,
      },
    },
    win32: {
      x64: {
        archiveName: 'ffmpeg-n7.1-latest-win64-gpl-7.1.zip',
        url: 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-n7.1-latest-win64-gpl-7.1.zip',
        checksumUrl: BTBN_FFMPEG_CHECKSUMS_URL,
      },
      arm64: {
        archiveName: 'ffmpeg-n7.1-latest-winarm64-gpl-7.1.zip',
        url: 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-n7.1-latest-winarm64-gpl-7.1.zip',
        checksumUrl: BTBN_FFMPEG_CHECKSUMS_URL,
      },
    },
  },
  whisperCli: {
    linux: {
      x64: {
        archiveName: 'whisper-bin-ubuntu-x64-v1.9.1.tar.gz',
        url: 'https://github.com/ggml-org/whisper.cpp/releases/download/v1.9.1/whisper-bin-ubuntu-x64.tar.gz',
        sha256: 'f3bf3b4369a99b54665b0f19b88483b30de27f25963b0414235dea03198515c5',
      },
      arm64: {
        archiveName: 'whisper-bin-ubuntu-arm64-v1.9.1.tar.gz',
        url: 'https://github.com/ggml-org/whisper.cpp/releases/download/v1.9.1/whisper-bin-ubuntu-arm64.tar.gz',
        sha256: 'e0b66cd551ff6f2a28fabe3c6e89691eea037bb76833493abb9a71ca788994b3',
      },
    },
    win32: {
      x64: {
        archiveName: 'whisper-bin-x64-v1.9.1.zip',
        url: 'https://github.com/ggml-org/whisper.cpp/releases/download/v1.9.1/whisper-bin-x64.zip',
        sha256: '7d8be46ecd31828e1eb7a2ecdd0d6b314feafd82163038ab6092594b0a063539',
      },
      ia32: {
        archiveName: 'whisper-bin-Win32-v1.9.1.zip',
        url: 'https://github.com/ggml-org/whisper.cpp/releases/download/v1.9.1/whisper-bin-Win32.zip',
        sha256: 'be1ea26c9665f1165a2f3afb64f24476c09ba7da479c844bf33ef2870d47c954',
      },
    },
  },
  ollama: {
    linux: {
      x64: {
        archiveName: 'ollama-linux-amd64-v0.31.1.tar.zst',
        url: 'https://github.com/ollama/ollama/releases/download/v0.31.1/ollama-linux-amd64.tar.zst',
        sha256: 'd297381efc136451f6fabb9dd644a67f70fe51c16815a0c4a95ff0e327a3afb4',
      },
      arm64: {
        archiveName: 'ollama-linux-arm64-v0.31.1.tar.zst',
        url: 'https://github.com/ollama/ollama/releases/download/v0.31.1/ollama-linux-arm64.tar.zst',
        sha256: '47c82a67e59e060a735d1cb50a2acf020126a3a4be3f6847d5b58b7dd59620b6',
      },
    },
    win32: {
      x64: {
        archiveName: 'ollama-windows-amd64-v0.31.1.zip',
        url: 'https://github.com/ollama/ollama/releases/download/v0.31.1/ollama-windows-amd64.zip',
        sha256: '9ecf5a631561c7dff3a143925f11e2008327be738a7279fcf0c5462b9c422700',
      },
      arm64: {
        archiveName: 'ollama-windows-arm64-v0.31.1.zip',
        url: 'https://github.com/ollama/ollama/releases/download/v0.31.1/ollama-windows-arm64.zip',
        sha256: 'f529ac520435fba895f652922ef0dc7f1be1b951bcea5eaf360701c06d3f5e82',
      },
    },
  },
} as const

export async function runFullSetup(emit: SetupEventEmitter): Promise<void> {
  const config = loadConfig()
  cancelRequested = false
  let failed = false
  let lastError = ''
  setupLog.info('setup started', { steps: SETUP_STEPS })

  for (const step of SETUP_STEPS) {
    if (cancelRequested) {
      setupLog.warn('setup cancelled', { step })
      emit({ type: 'step-failed', step, error: 'Setup cancelled', recoverable: true })
      failed = true
      break
    }
    emit({ type: 'step-started', step, message: `Running ${step}…` })
    setupLog.info('setup step started', { step })
    try {
      await runSetupStep(step, emit)
      emit({ type: 'step-completed', step, message: `${step} OK` })
      setupLog.info('setup step completed', { step })
    } catch (err: any) {
      failed = true
      lastError = err.message ?? String(err)
      setupLog.error('setup step failed', { step, error: err })
      emit({
        type: 'step-failed',
        step,
        error: err.message ?? String(err),
        recoverable: true,
      })
      break
    }
  }

  config.setupCompleted = !failed
  saveConfig(config)
  if (!failed) {
    emit({ type: 'setup-completed' })
    setupLog.info('setup completed')
  } else {
    emit({ type: 'setup-failed', error: lastError || 'Setup failed' })
    setupLog.error('setup failed', { errorMessage: lastError || 'Setup failed' })
  }
}

export function cancelSetup(): void {
  cancelRequested = true
  setupLog.warn('setup cancel requested')
}

async function runSetupStep(step: SetupStep, emit: SetupEventEmitter): Promise<void> {
  const config = loadConfig()
  switch (step) {
    case 'storage':
      ensureDirectories()
      break

    case 'database':
      await ensureDatabase()
      break

    case 'ffmpeg':
      await ensureFfmpeg(emit, step)
      break

    case 'whisper-cli':
      await ensureWhisperCli(emit, step)
      break

    case 'whisper-model':
      await ensureWhisperModel(emit, step)
      break

    case 'ollama':
      await ensureOllama(emit, step)
      break

    case 'llm-model':
      try {
        const ollamaBin = resolveLocalBinary('ollama')
        const model = config.llmModel || DEFAULTS.llmModel
        const { stdout } = await execa(ollamaBin, ['list'], { timeout: 10_000 })
        if (!stdout.includes(model)) {
          await pullOllamaModel(ollamaBin, model, config.ollamaHost, step, emit)
          emit({ type: 'step-progress', step, progress: 100, message: `${model} pulled` })
        }
      } catch (err: any) {
        throw new Error(`Failed to pull LLM model: ${err.message ?? String(err)}`)
      }
      break

    case 'config':
      saveConfig({
        ...loadConfig(),
        ffmpegPath: resolveLocalBinary('ffmpeg'),
        whisperBinPath: resolveLocalBinary('whisper-cli'),
      })
      break

    case 'doctor':
      // Deep check — just a summary that everything passed
      break
  }
}

async function pullOllamaModel(
  ollamaBin: string,
  model: string,
  ollamaHost: string,
  step: SetupStep,
  emit: SetupEventEmitter,
): Promise<void> {
  let lastMessage = `Pulling ${model}…`
  let lastBytes = 0
  let lastProgress = 50
  const startedAt = Date.now()
  const emitHeartbeat = async () => {
    const bytes = await getOllamaPartialDownloadBytes()
    lastBytes = Math.max(lastBytes, bytes)
    emit({
      type: 'step-progress',
      step,
      progress: lastProgress,
      downloadedBytes: lastBytes || undefined,
      message: lastBytes > 0
        ? `${lastMessage} Downloaded ${formatBytes(lastBytes)} so far.`
        : `${lastMessage} Still waiting for Ollama registry…`,
    })
  }

  emit({ type: 'step-progress', step, progress: lastProgress, message: lastMessage })
  setupLog.info('ollama model pull started', { model, ollamaHost })
  const heartbeat = setInterval(() => {
    void emitHeartbeat()
  }, 15_000)
  let lastOutputEmitAt = 0

  try {
    const subprocess = execa(ollamaBin, ['pull', model], {
      env: { OLLAMA_HOST: ollamaHost },
      timeout: 1_800_000,
      stdout: 'pipe',
      stderr: 'pipe',
    })

    const handleOutput = (chunk: Buffer) => {
      const text = chunk.toString('utf8').replace(/\s+/g, ' ').trim()
      if (!text) return
      lastMessage = summarizeOllamaPullOutput(text)
      lastProgress = parseOllamaPullProgress(lastMessage) ?? lastProgress
      const now = Date.now()
      if (now - lastOutputEmitAt < 5_000) return
      lastOutputEmitAt = now
      emit({ type: 'step-progress', step, progress: lastProgress, message: lastMessage })
    }

    subprocess.stdout?.on('data', handleOutput)
    subprocess.stderr?.on('data', handleOutput)
    await subprocess
    const elapsedSeconds = Math.max(1, Math.round((Date.now() - startedAt) / 1000))
    setupLog.info('ollama model pull completed', { model, elapsedSeconds, downloadedBytes: lastBytes })
    emit({
      type: 'step-progress',
      step,
      progress: Math.max(lastProgress, 95),
      downloadedBytes: lastBytes || undefined,
      message: `Finished Ollama pull command after ${elapsedSeconds}s`,
    })
  } finally {
    clearInterval(heartbeat)
  }
}

async function ensureWhisperModel(emit: SetupEventEmitter, step: SetupStep): Promise<void> {
  const modelPath = path.join(PATHS.whisper, DEFAULTS.whisperModel)
  if (fileExists(modelPath)) {
    setupLog.info('whisper model already installed', { modelPath })
    return
  }

  emit({ type: 'step-progress', step, progress: 1, message: 'Downloading ggml-base.bin…' })
  setupLog.info('whisper model install started', { model: 'base', modelPath })
  await installWhisperModel('base')
  setupLog.info('whisper model install completed', { model: 'base', modelPath })
  emit({ type: 'step-progress', step, progress: 100, message: 'ggml-base.bin downloaded' })
}

async function ensureFfmpeg(emit: SetupEventEmitter, step: SetupStep): Promise<void> {
  const ffmpegBin = resolveLocalBinary('ffmpeg')
  if (await binaryWorks(ffmpegBin, ['-version'])) {
    setupLog.info('ffmpeg already installed', { command: ffmpegBin })
    return
  }
  if (await binaryWorks('ffmpeg', ['-version'])) {
    setupLog.info('ffmpeg available on PATH')
    return
  }

  const asset = getToolchainAsset(TOOLCHAIN_ASSETS.ffmpeg, 'FFmpeg')

  const archivePath = path.join(PATHS.home, asset.archiveName)
  const extractDir = path.join(PATHS.home, path.basename(asset.archiveName, path.extname(asset.archiveName)))
  const sha256 = await resolveAssetSha256(asset)

  emit({ type: 'step-progress', step, progress: 5, message: 'Downloading FFmpeg static build…' })
  setupLog.info('ffmpeg install started', { archiveName: asset.archiveName, platform: process.platform, arch: os.arch(), checksumSource: asset.checksumUrl ? 'remote' : 'static' })
  await downloadFile(asset.url, archivePath, step, emit, { headers: asset.headers, sha256 })

  await fsp.rm(extractDir, { recursive: true, force: true })
  await fsp.mkdir(extractDir, { recursive: true })
  emit({ type: 'step-progress', step, progress: 85, message: 'Extracting FFmpeg…' })
  await extractArchive(archivePath, extractDir)

  const ffmpegPath = findFile(extractDir, binaryFileName('ffmpeg'))
  const ffprobePath = findFile(extractDir, binaryFileName('ffprobe'))
  if (!ffmpegPath || !ffprobePath) throw new Error('FFmpeg archive did not contain ffmpeg/ffprobe binaries')

  await fsp.mkdir(PATHS.bin, { recursive: true })
  await fsp.copyFile(ffmpegPath, resolveLocalBinary('ffmpeg'))
  await fsp.copyFile(ffprobePath, resolveLocalBinary('ffprobe'))
  await chmodExecutable(resolveLocalBinary('ffmpeg'))
  await chmodExecutable(resolveLocalBinary('ffprobe'))
  await fsp.rm(archivePath, { force: true })
  await fsp.rm(extractDir, { recursive: true, force: true })

  if (!(await binaryWorks(resolveLocalBinary('ffmpeg'), ['-version']))) {
    throw new Error('Installed FFmpeg binary failed verification')
  }
  setupLog.info('ffmpeg install completed', { ffmpegPath: resolveLocalBinary('ffmpeg'), ffprobePath: resolveLocalBinary('ffprobe') })
}

async function ensureWhisperCli(emit: SetupEventEmitter, step: SetupStep): Promise<void> {
  const whisperBin = resolveLocalBinary('whisper-cli')
  await ensureKnownWhisperLibraryAliases()
  if (await binaryWorks(whisperBin, ['--help'], 10_000, runtimeBinaryEnv())) {
    setupLog.info('whisper-cli already installed', { command: whisperBin })
    return
  }
  if (await binaryWorks('whisper-cli', ['--help'])) {
    setupLog.info('whisper-cli available on PATH')
    return
  }

  const asset = getToolchainAsset(TOOLCHAIN_ASSETS.whisperCli, 'whisper-cli')
  const archivePath = path.join(PATHS.home, asset.archiveName)
  const extractDir = path.join(PATHS.home, 'whisper-cli')

  emit({ type: 'step-progress', step, progress: 10, message: 'Downloading whisper-cli…' })
  setupLog.info('whisper-cli install started', { archiveName: asset.archiveName, platform: process.platform, arch: os.arch() })
  await downloadFile(asset.url, archivePath, step, emit, { sha256: asset.sha256 })

  await fsp.rm(extractDir, { recursive: true, force: true })
  await fsp.mkdir(extractDir, { recursive: true })
  emit({ type: 'step-progress', step, progress: 85, message: 'Extracting whisper-cli…' })
  await extractArchive(archivePath, extractDir)

  const whisperPath = findFile(extractDir, binaryFileName('whisper-cli'))
  if (!whisperPath) throw new Error('whisper.cpp archive did not contain whisper-cli')

  await fsp.mkdir(PATHS.bin, { recursive: true })
  await fsp.copyFile(whisperPath, whisperBin)
  await copyWhisperRuntimeLibraries(extractDir)
  await chmodExecutable(whisperBin)
  await fsp.rm(archivePath, { force: true })
  await fsp.rm(extractDir, { recursive: true, force: true })

  if (!(await binaryWorks(whisperBin, ['--help'], 10_000, runtimeBinaryEnv()))) {
    throw new Error('Installed whisper-cli binary failed verification')
  }
  setupLog.info('whisper-cli install completed', { whisperBin })
}

async function ensureOllama(emit: SetupEventEmitter, step: SetupStep): Promise<void> {
  const ollamaBin = resolveLocalBinary('ollama')
  if (await ensureOllamaServer(ollamaBin)) {
    setupLog.info('ollama already installed', { command: ollamaBin })
    return
  }
  if (await ensureOllamaServer('ollama')) {
    setupLog.info('ollama available on PATH')
    return
  }

  if (process.platform === 'linux') {
    const asset = getToolchainAsset(TOOLCHAIN_ASSETS.ollama, 'Ollama')
    const archivePath = path.join(PATHS.home, asset.archiveName)
    const extractDir = path.join(PATHS.home, 'ollama')
    emit({ type: 'step-progress', step, progress: 10, message: 'Downloading Ollama…' })
    setupLog.info('ollama install started', { archiveName: asset.archiveName, platform: process.platform, arch: os.arch() })
    await downloadFile(asset.url, archivePath, step, emit, { sha256: asset.sha256 })
    await fsp.rm(extractDir, { recursive: true, force: true })
    await fsp.mkdir(extractDir, { recursive: true })
    emit({ type: 'step-progress', step, progress: 85, message: 'Extracting Ollama…' })
    await extractArchive(archivePath, extractDir)
    const downloadedOllama = findFile(extractDir, binaryFileName('ollama'))
    if (!downloadedOllama) throw new Error('Ollama archive did not contain ollama binary')
    await fsp.mkdir(PATHS.bin, { recursive: true })
    await fsp.copyFile(downloadedOllama, ollamaBin)
    await copyOllamaRuntimeLibraries(extractDir)
    await chmodExecutable(ollamaBin)
    await fsp.rm(archivePath, { force: true })
  } else if (process.platform === 'win32') {
    const asset = getToolchainAsset(TOOLCHAIN_ASSETS.ollama, 'Ollama')
    const archivePath = path.join(PATHS.home, asset.archiveName)
    const extractDir = path.join(PATHS.home, 'ollama')
    emit({ type: 'step-progress', step, progress: 10, message: 'Downloading Ollama…' })
    setupLog.info('ollama install started', { archiveName: asset.archiveName, platform: process.platform, arch: os.arch() })
    await downloadFile(asset.url, archivePath, step, emit, { sha256: asset.sha256 })
    await fsp.rm(extractDir, { recursive: true, force: true })
    await fsp.mkdir(extractDir, { recursive: true })
    emit({ type: 'step-progress', step, progress: 85, message: 'Extracting Ollama…' })
    await extractArchive(archivePath, extractDir)
    const downloadedOllama = findFile(extractDir, binaryFileName('ollama'))
    if (!downloadedOllama) throw new Error('Ollama archive did not contain ollama.exe')
    await fsp.mkdir(PATHS.bin, { recursive: true })
    await fsp.copyFile(downloadedOllama, ollamaBin)
    await copyOllamaRuntimeLibraries(extractDir)
    await chmodExecutable(ollamaBin)
    await fsp.rm(archivePath, { force: true })
    await fsp.rm(extractDir, { recursive: true, force: true })
  } else {
    throw unsupportedPlatformError('Ollama')
  }

  if (!(await ensureOllamaServer(ollamaBin))) {
    throw new Error('Ollama installed, but the service is not reachable at 127.0.0.1:11434')
  }
  setupLog.info('ollama install completed', { ollamaBin })
}

async function ensureOllamaServer(command: string): Promise<boolean> {
  if (!(await binaryWorks(command, ['--version'], 10_000))) return false
  if (await binaryWorks(command, ['list'], 10_000)) return true

  try {
    const child = execa(command, ['serve'], { detached: true, stdio: 'ignore' })
    writeManagedOllamaPid(child.pid)
    setupLog.info('ollama server started', { command, pid: child.pid })
    child.unref()
    await sleep(3000)
  } catch (err) {
    setupLog.warn('ollama server start failed', { command, error: err })
  }

  return binaryWorks(command, ['list'], 10_000)
}

async function copyOllamaRuntimeLibraries(extractDir: string): Promise<void> {
  const sourceDir = findDirectory(extractDir, (dirPath) => path.basename(dirPath) === 'ollama' && path.basename(path.dirname(dirPath)) === 'lib')
  if (!sourceDir) return

  const destinationDir = path.join(PATHS.home, 'lib', 'ollama')
  await fsp.rm(destinationDir, { recursive: true, force: true })
  await fsp.mkdir(path.dirname(destinationDir), { recursive: true })
  await fsp.cp(sourceDir, destinationDir, { recursive: true })

  for (const filePath of findFiles(destinationDir, () => true)) {
    await chmodExecutable(filePath)
  }
}

async function binaryWorks(
  command: string,
  args: string[],
  timeout = 10_000,
  env?: NodeJS.ProcessEnv,
): Promise<boolean> {
  try {
    await execa(command, args, { timeout, env })
    return true
  } catch {
    return false
  }
}

async function downloadFile(
  url: string,
  destination: string,
  step: SetupStep,
  emit: SetupEventEmitter,
  options: { headers?: Record<string, string>; sha256?: string } = {},
): Promise<void> {
  await fsp.mkdir(path.dirname(destination), { recursive: true })
  const tempPath = `${destination}.part`
  const existingBytes = await getFileSize(tempPath)
  setupLog.info('download started', {
    fileName: path.basename(destination),
    destination,
    resumedBytes: existingBytes,
  })
  const headers: Record<string, string> = { ...options.headers }
  if (existingBytes > 0) {
    headers.Range = `bytes=${existingBytes}-`
    emit({
      type: 'step-progress',
      step,
      progress: 1,
      downloadedBytes: existingBytes,
      message: `Resuming ${path.basename(destination)}…`,
    })
  }

  await assertDownloadSourceReachable(url, options.headers)

  let response = await fetchWithRetry(url, { headers })
  let append = existingBytes > 0 && response.status === 206

  if (existingBytes > 0 && response.status === 200) {
    await fsp.rm(tempPath, { force: true })
    response = await fetchWithRetry(url, { headers: options.headers })
    append = false
  }

  if (!response.ok || !response.body) {
    throw new Error(`Download failed: ${url} returned HTTP ${response.status}`)
  }

  const contentLength = Number(response.headers.get('content-length') ?? 0)
  const totalBytes = append ? existingBytes + contentLength : contentLength
  let downloadedBytes = append ? existingBytes : 0
  const file = fs.createWriteStream(tempPath, { flags: append ? 'a' : 'w' })

  try {
    for await (const chunk of response.body as any as AsyncIterable<Uint8Array>) {
      downloadedBytes += chunk.length
      if (!file.write(chunk)) {
        await new Promise<void>((resolve) => {
          file.once('drain', () => resolve())
        })
      }
      if (totalBytes > 0) {
        emit({
          type: 'step-progress',
          step,
          progress: Math.min(80, Math.max(1, Math.round((downloadedBytes / totalBytes) * 80))),
          downloadedBytes,
          totalBytes,
          message: `Downloading ${path.basename(destination)}…`,
        })
      }
    }
  } finally {
    await new Promise<void>((resolve, reject) => {
      file.end((err?: Error | null) => (err ? reject(err) : resolve()))
    })
  }

  await fsp.rename(tempPath, destination)

  if (options.sha256) {
    const actual = await sha256File(destination)
    if (actual !== options.sha256.toLowerCase()) {
      await fsp.rm(destination, { force: true })
      setupLog.error('download checksum failed', { fileName: path.basename(destination), destination, actual })
      throw new Error(`Checksum mismatch for ${path.basename(destination)}: expected ${options.sha256}, got ${actual}`)
    }
  }
  setupLog.info('download completed', {
    fileName: path.basename(destination),
    destination,
    downloadedBytes,
  })
}

async function getFileSize(filePath: string): Promise<number> {
  try {
    const stat = await fsp.stat(filePath)
    return stat.isFile() ? stat.size : 0
  } catch {
    return 0
  }
}

async function getOllamaPartialDownloadBytes(): Promise<number> {
  const blobsDir = path.join(os.homedir(), '.ollama', 'models', 'blobs')
  try {
    const entries = await fsp.readdir(blobsDir, { withFileTypes: true })
    let total = 0
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.includes('-partial')) continue
      total += await getFileSize(path.join(blobsDir, entry.name))
    }
    return total
  } catch {
    return 0
  }
}

function summarizeOllamaPullOutput(value: string): string {
  const normalized = value
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!normalized) return `Pulling ${DEFAULTS.llmModel}…`
  return normalized.length > 180 ? `${normalized.slice(0, 179)}…` : normalized
}

function parseOllamaPullProgress(value: string): number | null {
  const match = value.match(/(\d{1,3})%/)
  if (!match) return null
  const percentage = Number(match[1])
  if (!Number.isFinite(percentage)) return null
  return Math.min(99, Math.max(1, percentage))
}

function getToolchainAsset<T extends Partial<Record<NodeJS.Platform, Partial<Record<string, ToolchainAsset>>>>>(
  assets: T,
  component: string,
): ToolchainAsset {
  const platformAssets = assets[process.platform]
  if (!platformAssets) throw unsupportedPlatformError(component)

  const asset = platformAssets[os.arch()]
  if (!asset) throw new Error(`${component} auto-install is not supported for architecture ${os.arch()}`)

  return asset
}

async function resolveAssetSha256(asset: ToolchainAsset): Promise<string> {
  if (asset.sha256) return asset.sha256
  if (!asset.checksumUrl) throw new Error(`Missing checksum for ${asset.archiveName}`)

  setupLog.info('resolving remote checksum', { archiveName: asset.archiveName, checksumUrl: asset.checksumUrl })
  const response = await fetchWithRetry(asset.checksumUrl)
  if (!response.ok) {
    throw new Error(`Failed to resolve checksum for ${asset.archiveName}: HTTP ${response.status}`)
  }

  const checksums = await response.text()
  for (const line of checksums.split('\n')) {
    const [sha256, fileName] = line.trim().split(/\s+/)
    if (fileName === asset.archiveName && /^[a-f0-9]{64}$/i.test(sha256)) {
      setupLog.info('remote checksum resolved', { archiveName: asset.archiveName })
      return sha256
    }
  }

  throw new Error(`Checksum file did not contain ${asset.archiveName}`)
}

async function assertDownloadSourceReachable(url: string, headers?: Record<string, string>): Promise<void> {
  const response = await fetchWithRetry(url, {
    method: 'HEAD',
    headers,
    redirect: 'follow',
  })

  if (response.ok) return
  response.body?.cancel().catch(() => {})

  if (response.status !== 405 && response.status !== 501) {
    throw new Error(`Download source is not reachable: ${url} returned HTTP ${response.status}`)
  }

  const rangeResponse = await fetchWithRetry(url, {
    headers: { ...headers, Range: 'bytes=0-0' },
    redirect: 'follow',
  })
  rangeResponse.body?.cancel().catch(() => {})

  if (!rangeResponse.ok) {
    throw new Error(`Download source is not reachable: ${url} returned HTTP ${rangeResponse.status}`)
  }
}

async function fetchWithRetry(url: string, init?: RequestInit): Promise<Response> {
  let lastError: unknown = null

  for (let attempt = 0; attempt <= DOWNLOAD_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      const response = await fetch(url, init)
      if (response.ok || !isRetryableStatus(response.status) || attempt === DOWNLOAD_RETRY_DELAYS_MS.length) {
        return response
      }
      response.body?.cancel().catch(() => {})
      lastError = new Error(`HTTP ${response.status}`)
    } catch (err) {
      lastError = err
      if (attempt === DOWNLOAD_RETRY_DELAYS_MS.length) break
    }

    await sleep(DOWNLOAD_RETRY_DELAYS_MS[attempt])
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500
}

async function sha256File(filePath: string): Promise<string> {
  const hash = createHash('sha256')
  const stream = fs.createReadStream(filePath)

  for await (const chunk of stream) {
    hash.update(chunk)
  }

  return hash.digest('hex')
}

function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`
}

async function extractArchive(archivePath: string, extractDir: string): Promise<void> {
  await execa('tar', ['-xf', archivePath, '-C', extractDir], { timeout: 120_000 })
}

function resolveLocalBinary(name: string): string {
  return path.join(PATHS.bin, binaryFileName(name))
}

function binaryFileName(name: string): string {
  return process.platform === 'win32' ? `${name}.exe` : name
}

async function chmodExecutable(filePath: string): Promise<void> {
  if (process.platform !== 'win32') {
    await fsp.chmod(filePath, 0o755)
  }
}

function unsupportedPlatformError(component: string): Error {
  return new Error(`${component} auto-install is supported only on Linux and Windows`)
}

function findFile(root: string, fileName: string): string | null {
  const entries = fs.readdirSync(root, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = path.join(root, entry.name)
    if (entry.isFile() && entry.name === fileName) return fullPath
    if (entry.isDirectory()) {
      const nested = findFile(fullPath, fileName)
      if (nested) return nested
    }
  }
  return null
}

function findDirectory(root: string, predicate: (dirPath: string) => boolean): string | null {
  const entries = fs.readdirSync(root, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = path.join(root, entry.name)
    if (!entry.isDirectory()) continue
    if (predicate(fullPath)) return fullPath
    const nested = findDirectory(fullPath, predicate)
    if (nested) return nested
  }
  return null
}

function findFiles(root: string, predicate: (fileName: string) => boolean): string[] {
  const matches: string[] = []
  const entries = fs.readdirSync(root, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = path.join(root, entry.name)
    if (entry.isFile() && predicate(entry.name)) {
      matches.push(fullPath)
    } else if (entry.isDirectory()) {
      matches.push(...findFiles(fullPath, predicate))
    }
  }
  return matches
}

async function copyWhisperRuntimeLibraries(extractDir: string): Promise<void> {
  const libraries = findFiles(extractDir, (fileName) =>
    fileName.endsWith('.dll') ||
    fileName.endsWith('.so') ||
    fileName.includes('.so.'),
  )

  for (const library of libraries) {
    const destination = path.join(PATHS.bin, path.basename(library))
    await fsp.copyFile(library, destination)
    await chmodExecutable(destination)
  }

  await ensureKnownWhisperLibraryAliases()
}

async function ensureKnownWhisperLibraryAliases(): Promise<void> {
  await ensureLibraryAlias('libwhisper.so.1.9.1', 'libwhisper.so.1')
  await ensureLibraryAlias('libggml.so.0.15.1', 'libggml.so.0')
  await ensureLibraryAlias('libggml-base.so.0.15.1', 'libggml-base.so.0')
}

async function ensureLibraryAlias(sourceName: string, aliasName: string): Promise<void> {
  if (process.platform === 'win32') return

  const sourcePath = path.join(PATHS.bin, sourceName)
  const aliasPath = path.join(PATHS.bin, aliasName)
  if (!fs.existsSync(sourcePath) || fs.existsSync(aliasPath)) return

  try {
    await fsp.symlink(sourceName, aliasPath)
  } catch {
    await fsp.copyFile(sourcePath, aliasPath)
    await chmodExecutable(aliasPath)
  }
}

function runtimeBinaryEnv(): NodeJS.ProcessEnv {
  const libraryPath = process.env.LD_LIBRARY_PATH
    ? `${PATHS.bin}${path.delimiter}${process.env.LD_LIBRARY_PATH}`
    : PATHS.bin
  const executablePath = process.env.PATH
    ? `${PATHS.bin}${path.delimiter}${process.env.PATH}`
    : PATHS.bin

  return {
    LD_LIBRARY_PATH: libraryPath,
    PATH: executablePath,
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function checkSetupBinary(
  name: string,
  args: string[],
  fallbackPath: string,
): Promise<boolean> {
  try {
    await execa(fallbackPath, args, { timeout: 10_000 })
    return true
  } catch {
    try {
      await execa(name, args, { timeout: 10_000 })
      return true
    } catch {
      return false
    }
  }
}

async function ensureDatabase(): Promise<void> {
  ensureDirectories()
  ensureDatabaseEnv()

  const schemaPath = findPrismaSchema()
  if (schemaPath) {
    await execa('npx', ['prisma', 'db', 'push', '--schema', schemaPath, '--skip-generate'], {
      env: { DATABASE_URL: getDatabaseUrl() },
      timeout: 120_000,
    })
  }

  await getPrisma().$queryRaw`SELECT 1`
}

function findPrismaSchema(): string | null {
  const candidates = [
    path.resolve(process.cwd(), 'prisma/schema.prisma'),
    path.resolve(process.cwd(), '../../prisma/schema.prisma'),
    path.resolve(process.cwd(), '../../../prisma/schema.prisma'),
  ]
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null
}
