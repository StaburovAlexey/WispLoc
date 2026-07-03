import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { PATHS } from '@wisploc/shared'
import { loadConfig, saveConfig } from '../config'

export type WhisperModelKey = 'tiny' | 'base' | 'small'

export interface WhisperModelDefinition {
  key: WhisperModelKey
  label: string
  fileName: string
  description: string
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
  },
  {
    key: 'base',
    label: 'Base multilingual',
    fileName: 'ggml-base.bin',
    description: 'Default balanced option for speed and quality.',
  },
  {
    key: 'small',
    label: 'Small multilingual',
    fileName: 'ggml-small.bin',
    description: 'Better quality, slower on weak devices.',
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

  if (!model.installed) {
    await downloadFile(
      `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${model.fileName}`,
      model.path,
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

async function downloadFile(url: string, destination: string): Promise<void> {
  await fsp.mkdir(path.dirname(destination), { recursive: true })

  const tempPath = `${destination}.part`
  const existingBytes = await getFileSize(tempPath)
  const headers: Record<string, string> = {}
  if (existingBytes > 0) {
    headers.Range = `bytes=${existingBytes}-`
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
}

async function getFileSize(filePath: string): Promise<number> {
  try {
    const stat = await fsp.stat(filePath)
    return stat.isFile() ? stat.size : 0
  } catch {
    return 0
  }
}

function fileExists(filePath: string): boolean {
  try {
    return fs.statSync(filePath).isFile()
  } catch {
    return false
  }
}
