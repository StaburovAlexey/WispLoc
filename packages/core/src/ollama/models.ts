import fs from 'node:fs'
import path from 'node:path'
import { execa } from 'execa'
import { PATHS } from '@wisploc/shared'

export interface LocalOllamaModel {
  name: string
  id: string
  size: string
  modified: string
}

export async function listLocalOllamaModels(): Promise<LocalOllamaModel[]> {
  const binaryName = process.platform === 'win32' ? 'ollama.exe' : 'ollama'
  const localOllamaPath = path.join(PATHS.bin, binaryName)
  const ollamaCommand = fs.existsSync(localOllamaPath) ? localOllamaPath : binaryName

  const { stdout } = await execa(ollamaCommand, ['list'], {
    timeout: 10_000,
  })

  return stdout
    .split('\n')
    .slice(1)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split(/\s{2,}/)
      return {
        name: parts[0] ?? line.split(/\s+/)[0],
        id: parts[1] ?? '',
        size: parts[2] ?? '',
        modified: parts.slice(3).join(' ') || '',
      }
    })
    .filter((model) => model.name)
}
