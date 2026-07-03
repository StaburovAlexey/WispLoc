import { execa } from 'execa'
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

export type SetupEventEmitter = (event: SetupEvent) => void
let cancelRequested = false

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

export async function runFullSetup(emit: SetupEventEmitter): Promise<void> {
  const config = loadConfig()
  cancelRequested = false
  let failed = false
  let lastError = ''

  for (const step of SETUP_STEPS) {
    if (cancelRequested) {
      emit({ type: 'step-failed', step, error: 'Setup cancelled', recoverable: true })
      failed = true
      break
    }
    emit({ type: 'step-started', step, message: `Running ${step}…` })
    try {
      await runSetupStep(step, emit)
      emit({ type: 'step-completed', step, message: `${step} OK` })
    } catch (err: any) {
      failed = true
      lastError = err.message ?? String(err)
      emit({
        type: 'step-failed',
        step,
        error: err.message ?? String(err),
        recoverable: true,
      })
    }
  }

  config.setupCompleted = !failed
  saveConfig(config)
  if (!failed) {
    emit({ type: 'setup-completed' })
  } else {
    emit({ type: 'setup-failed', error: lastError || 'Setup failed' })
  }
}

export function cancelSetup(): void {
  cancelRequested = true
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
        const { stdout } = await execa(ollamaBin, ['list'], { timeout: 10_000 })
        if (!stdout.includes(DEFAULTS.llmModel)) {
          await pullOllamaModel(ollamaBin, DEFAULTS.llmModel, config.ollamaHost, step, emit)
          emit({ type: 'step-progress', step, progress: 100, message: `${DEFAULTS.llmModel} pulled` })
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
  if (fileExists(modelPath)) return

  emit({ type: 'step-progress', step, progress: 1, message: 'Downloading ggml-base.bin…' })
  await installWhisperModel('base')
  emit({ type: 'step-progress', step, progress: 100, message: 'ggml-base.bin downloaded' })
}

async function ensureFfmpeg(emit: SetupEventEmitter, step: SetupStep): Promise<void> {
  const ffmpegBin = resolveLocalBinary('ffmpeg')
  if (await binaryWorks(ffmpegBin, ['-version'])) return
  if (await binaryWorks('ffmpeg', ['-version'])) return

  const arch = os.arch()
  const platform = process.platform
  let archiveName: string
  let url: string
  if (platform === 'linux') {
    const asset = arch === 'x64' ? 'amd64' : arch === 'arm64' ? 'arm64' : null
    if (!asset) throw new Error(`FFmpeg auto-install is not supported for architecture ${arch}`)
    archiveName = `ffmpeg-${asset}.tar.xz`
    url = `https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-${asset}-static.tar.xz`
  } else if (platform === 'win32') {
    const asset = arch === 'x64' ? 'win64' : arch === 'arm64' ? 'winarm64' : null
    if (!asset) throw new Error(`FFmpeg auto-install is not supported for architecture ${arch}`)
    archiveName = `ffmpeg-${asset}.zip`
    url = `https://github.com/BtbN/FFmpeg-Builds/releases/latest/download/ffmpeg-master-latest-${asset}-gpl.zip`
  } else {
    throw unsupportedPlatformError('FFmpeg')
  }

  const archivePath = path.join(PATHS.home, archiveName)
  const extractDir = path.join(PATHS.home, path.basename(archiveName, path.extname(archiveName)))

  emit({ type: 'step-progress', step, progress: 5, message: 'Downloading FFmpeg static build…' })
  await downloadFile(url, archivePath, step, emit)

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
}

async function ensureWhisperCli(emit: SetupEventEmitter, step: SetupStep): Promise<void> {
  const whisperBin = resolveLocalBinary('whisper-cli')
  await ensureKnownWhisperLibraryAliases()
  if (await binaryWorks(whisperBin, ['--help'], 10_000, runtimeBinaryEnv())) return
  if (await binaryWorks('whisper-cli', ['--help'])) return

  const arch = os.arch()
  const assetName = getWhisperAssetName(arch)
  if (!assetName) throw new Error(`whisper-cli auto-install is not supported for architecture ${arch}`)

  emit({ type: 'step-progress', step, progress: 5, message: 'Resolving latest whisper.cpp release…' })
  const releaseResponse = await fetch('https://api.github.com/repos/ggml-org/whisper.cpp/releases/latest', {
    headers: { Accept: 'application/vnd.github+json' },
  })
  if (!releaseResponse.ok) {
    throw new Error(`Failed to resolve whisper.cpp release: HTTP ${releaseResponse.status}`)
  }
  const release = (await releaseResponse.json()) as {
    assets?: Array<{ name: string; browser_download_url: string }>
  }
  const asset = release.assets?.find((item) => item.name === assetName)
  if (!asset) throw new Error(`Latest whisper.cpp release does not contain ${assetName}`)

  const archivePath = path.join(PATHS.home, assetName)
  const extractDir = path.join(PATHS.home, 'whisper-cli')

  emit({ type: 'step-progress', step, progress: 10, message: 'Downloading whisper-cli…' })
  await downloadFile(asset.browser_download_url, archivePath, step, emit)

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
}

async function ensureOllama(emit: SetupEventEmitter, step: SetupStep): Promise<void> {
  const ollamaBin = resolveLocalBinary('ollama')
  if (await ensureOllamaServer(ollamaBin)) return
  if (await ensureOllamaServer('ollama')) return

  if (process.platform === 'linux') {
    const asset = os.arch() === 'arm64' ? 'ollama-linux-arm64.tar.zst' : 'ollama-linux-amd64.tar.zst'
    const archivePath = path.join(PATHS.home, asset)
    const extractDir = path.join(PATHS.home, 'ollama')
    const url = `https://github.com/ollama/ollama/releases/latest/download/${asset}`
    emit({ type: 'step-progress', step, progress: 10, message: 'Downloading Ollama…' })
    await downloadFile(url, archivePath, step, emit)
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
    const asset = os.arch() === 'arm64' ? 'ollama-windows-arm64.zip' : 'ollama-windows-amd64.zip'
    const archivePath = path.join(PATHS.home, asset)
    const extractDir = path.join(PATHS.home, 'ollama')
    const url = `https://github.com/ollama/ollama/releases/latest/download/${asset}`
    emit({ type: 'step-progress', step, progress: 10, message: 'Downloading Ollama…' })
    await downloadFile(url, archivePath, step, emit)
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
}

async function ensureOllamaServer(command: string): Promise<boolean> {
  if (!(await binaryWorks(command, ['--version'], 10_000))) return false
  if (await binaryWorks(command, ['list'], 10_000)) return true

  try {
    const child = execa(command, ['serve'], { detached: true, stdio: 'ignore' })
    writeManagedOllamaPid(child.pid)
    child.unref()
    await sleep(3000)
  } catch {}

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
): Promise<void> {
  await fsp.mkdir(path.dirname(destination), { recursive: true })
  const tempPath = `${destination}.part`
  const existingBytes = await getFileSize(tempPath)
  const headers: Record<string, string> = {}
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

  let response = await fetch(url, { headers })
  let append = existingBytes > 0 && response.status === 206

  if (existingBytes > 0 && response.status === 200) {
    await fsp.rm(tempPath, { force: true })
    response = await fetch(url)
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

function getWhisperAssetName(arch: string): string | null {
  if (process.platform === 'linux') {
    if (arch === 'x64') return 'whisper-bin-ubuntu-x64.tar.gz'
    if (arch === 'arm64') return 'whisper-bin-ubuntu-arm64.tar.gz'
  }
  if (process.platform === 'win32') {
    if (arch === 'x64') return 'whisper-bin-x64.zip'
    if (arch === 'ia32') return 'whisper-bin-Win32.zip'
  }
  return null
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
