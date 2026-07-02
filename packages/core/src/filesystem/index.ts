import fs from 'node:fs'
import { PATHS } from '@wisploc/shared'

export function ensureDirectories(): void {
  const dirs = [
    PATHS.home,
    PATHS.bin,
    PATHS.models,
    PATHS.whisper,
    PATHS.data,
    PATHS.uploads,
    PATHS.chunks,
    PATHS.transcripts,
    PATHS.summaries,
    PATHS.exports,
    PATHS.logs,
  ]

  for (const dir of dirs) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

export function dirExists(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory()
  } catch {
    return false
  }
}

export function fileExists(p: string): boolean {
  try {
    return fs.statSync(p).isFile()
  } catch {
    return false
  }
}
