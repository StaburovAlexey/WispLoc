import fs from 'node:fs'
import { PATHS } from '@wisploc/shared'

const OLLAMA_PID_FILE = `${PATHS.home}/ollama.pid`

export function writeManagedOllamaPid(pid: number | undefined): void {
  if (!pid) return
  fs.mkdirSync(PATHS.home, { recursive: true })
  fs.writeFileSync(OLLAMA_PID_FILE, String(pid), 'utf-8')
}

export function stopManagedOllama(): void {
  const pid = readManagedOllamaPid()
  if (!pid) {
    removeManagedOllamaPid()
    return
  }

  if (isProcessRunning(pid)) {
    try {
      process.kill(pid, 'SIGTERM')
    } catch {}
  }

  removeManagedOllamaPid()
}

function readManagedOllamaPid(): number | null {
  try {
    const value = fs.readFileSync(OLLAMA_PID_FILE, 'utf-8').trim()
    const pid = Number(value)
    return Number.isInteger(pid) && pid > 0 ? pid : null
  } catch {
    return null
  }
}

function removeManagedOllamaPid(): void {
  try {
    fs.rmSync(OLLAMA_PID_FILE, { force: true })
  } catch {}
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}
