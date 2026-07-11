import { createHash } from 'node:crypto'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { PATHS } from '@wisploc/shared'
import { loadConfig, saveConfig } from '../config'

export type WhisperModelKey = 'tiny' | 'base' | 'small'

const DOWNLOAD_RETRY_DELAYS_MS = [750, 2_000, 5_000]

export interface WhisperModelDefinition {
  key: WhisperModelKey
  label: string
  fileName: string
  description: string
  sha256: string
  installed: boolean
  selected: boolean
  path: string
}

const WHISPER_MODEL_DEFINITIONS: Array<Omit<WhisperModelDefinition, 'installed' | 'selected' | 'path'>> = [
  {
    key: 'tiny',
    label: 'Tiny multilingual',
    fileName: 'ggml-tiny.bin',
    description: 'Fastest option for weak CPUs. Lower accuracy.',
    sha256: 'be07e048e1e599ad46341c8d2a135645097a538221678b7acdd1b1919c6e1b21',
  },
  {
    key: 'base',
    label: 'Base multilingual',
    fileName: 'ggml-base.bin',
    description: 'Default balanced option for speed and quality.',
    sha256: '60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe',
  },
  {
    key: 'small',
    label: 'Small multilingual',
    fileName: 'ggml-small.bin',
    description: 'Better quality, slower on weak devices.',
    sha256: '1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b',
  },
]

export function listWhisperModels(): WhisperModelDefinition[] {
  const config = loadConfig()

  return WHISPER_MODEL_DEFINITIONS.map((model) => {
    const modelPath = path.join(PATHS.whisper, model.fileName)
    return {
      ...model,
      path: modelPath,
      installed: fileExists(modelPath),
      selected: path.resolve(config.whisperModelPath) === path.resolve(modelPath),
    }
  })
}

export function getWhisperModelByKey(key: string): WhisperModelDefinition | null {
  return listWhisperModels().find((model) => model.key === key) ?? null
}

export async function installWhisperModel(key: string): Promise<WhisperModelDefinition> {
  const model = getWhisperModelByKey(key)
  if (!model) {
    throw new Error(`Unsupported Whisper model: ${key}`)
  }

  if (model.installed && await sha256File(model.path) !== model.sha256.toLowerCase()) {
    await fsp.rm(model.path, { force: true })
    model.installed = false
  }

  if (!model.installed) {
    await downloadFile(
      `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${model.fileName}`,
      model.path,
      model.sha256,
    )
  }

  return getWhisperModelByKey(key) ?? model
}

export function selectWhisperModel(key: string): WhisperModelDefinition {
  const model = getWhisperModelByKey(key)
  if (!model) {
    throw new Error(`Unsupported Whisper model: ${key}`)
  }
  if (!model.installed) {
    throw new Error(`${model.fileName} is not installed`)
  }

  const config = loadConfig()
  config.whisperModelPath = model.path
  saveConfig(config)

  return getWhisperModelByKey(key) ?? { ...model, selected: true }
}

async function downloadFile(url: string, destination: string, sha256: string): Promise<void> {
  await fsp.mkdir(path.dirname(destination), { recursive: true })

  const tempPath = `${destination}.part`
  const existingBytes = await getFileSize(tempPath)
  const headers: Record<string, string> = {}
  if (existingBytes > 0) {
    headers.Range = `bytes=${existingBytes}-`
  }

  await assertDownloadSourceReachable(url)

  let response = await fetchWithRetry(url, { headers })
  let append = existingBytes > 0 && response.status === 206

  if (existingBytes > 0 && response.status === 200) {
    await fsp.rm(tempPath, { force: true })
    response = await fetchWithRetry(url)
    append = false
  }

  if (!response.ok || !response.body) {
    throw new Error(`Download failed: ${url} returned HTTP ${response.status}`)
  }

  const file = fs.createWriteStream(tempPath, { flags: append ? 'a' : 'w' })
  try {
    for await (const chunk of response.body as any as AsyncIterable<Uint8Array>) {
      if (!file.write(chunk)) {
        await new Promise<void>((resolve) => {
          file.once('drain', () => resolve())
        })
      }
    }
  } finally {
    await new Promise<void>((resolve, reject) => {
      file.end((err?: Error | null) => (err ? reject(err) : resolve()))
    })
  }

  await fsp.rename(tempPath, destination)

  const actual = await sha256File(destination)
  if (actual !== sha256.toLowerCase()) {
    await fsp.rm(destination, { force: true })
    throw new Error(`Checksum mismatch for ${path.basename(destination)}: expected ${sha256}, got ${actual}`)
  }
}

async function getFileSize(filePath: string): Promise<number> {
  try {
    const stat = await fsp.stat(filePath)
    return stat.isFile() ? stat.size : 0
  } catch {
    return 0
  }
}

async function assertDownloadSourceReachable(url: string): Promise<void> {
  const response = await fetchWithRetry(url, { method: 'HEAD', redirect: 'follow' })

  if (response.ok) return
  response.body?.cancel().catch(() => {})

  if (response.status !== 405 && response.status !== 501) {
    throw new Error(`Download source is not reachable: ${url} returned HTTP ${response.status}`)
  }

  const rangeResponse = await fetchWithRetry(url, {
    headers: { Range: 'bytes=0-0' },
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function sha256File(filePath: string): Promise<string> {
  const hash = createHash('sha256')
  const stream = fs.createReadStream(filePath)

  for await (const chunk of stream) {
    hash.update(chunk)
  }

  return hash.digest('hex')
}

function fileExists(filePath: string): boolean {
  try {
    return fs.statSync(filePath).isFile()
  } catch {
    return false
  }
}
