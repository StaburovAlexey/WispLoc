#!/usr/bin/env node
/**
 * WispLoc Launcher — starts the API server and opens the web UI.
 *
 * Usage: wisploc start
 */
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const WISPLOC_HOME = path.join(os.homedir(), '.wisploc')
const PID_FILE = path.join(WISPLOC_HOME, 'wisploc.pid')

async function main() {
  const args = process.argv.slice(2)
  const command = args[0] || 'start'

  if (!['start', 'status', 'stop'].includes(command)) {
    console.log('Usage: wisploc <command>')
    console.log('')
    console.log('Commands:')
    console.log('  start    Start the WispLoc local server')
    console.log('  status   Show whether WispLoc is running')
    console.log('  stop     Stop the running WispLoc server')
    process.exit(0)
  }

  if (command === 'status') {
    const pid = readPid()
    if (pid && isProcessRunning(pid)) {
      console.log(`WispLoc is running (pid ${pid})`)
      process.exit(0)
    }
    removePidFile()
    console.log('WispLoc is not running')
    process.exit(1)
  }

  if (command === 'stop') {
    const pid = readPid()
    if (!pid || !isProcessRunning(pid)) {
      removePidFile()
      await stopManagedOllamaIfAvailable()
      console.log('WispLoc is not running')
      process.exit(0)
    }

    process.kill(pid, 'SIGTERM')
    removePidFile()
    await stopManagedOllamaIfAvailable()
    console.log(`Stopped WispLoc (pid ${pid})`)
    process.exit(0)
  }

  const existingPid = readPid()
  if (existingPid && isProcessRunning(existingPid)) {
    console.log(`WispLoc is already running (pid ${existingPid})`)
    process.exit(0)
  }

  console.log('Starting WispLoc…')
  writePidFile(process.pid)

  // Start the API server
  try {
    // Dynamically import the API server
    const { createServer } = await import('@wisploc/api')
    const app = await createServer()
    const { startWorker } = await import('@wisploc/worker')

    const { loadConfig } = await import('@wisploc/core')
    const config = loadConfig()

    await app.listen({ host: config.appHost, port: config.appPort })
    void startWorker()
    console.log(`WispLoc is running at http://${config.appHost}:${config.appPort}`)

    // Try to open browser
    try {
      const { default: open } = await import('open')
      await open(`http://${config.appHost}:${config.appPort}`)
    } catch {
      console.log(`Open http://${config.appHost}:${config.appPort} in your browser`)
    }

    const shutdown = async () => {
      removePidFile()
      await stopManagedOllamaIfAvailable()
      await app.close()
      process.exit(0)
    }

    process.once('SIGINT', shutdown)
    process.once('SIGTERM', shutdown)
  } catch (err: any) {
    removePidFile()
    console.error('Failed to start WispLoc:', err.message)
    process.exit(1)
  }
}

function readPid(): number | null {
  try {
    const value = fs.readFileSync(PID_FILE, 'utf-8').trim()
    const pid = Number(value)
    return Number.isInteger(pid) && pid > 0 ? pid : null
  } catch {
    return null
  }
}

function writePidFile(pid: number): void {
  fs.mkdirSync(WISPLOC_HOME, { recursive: true })
  fs.writeFileSync(PID_FILE, String(pid), 'utf-8')
}

function removePidFile(): void {
  try {
    fs.rmSync(PID_FILE, { force: true })
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

async function stopManagedOllamaIfAvailable(): Promise<void> {
  try {
    const { stopManagedOllama } = await import('@wisploc/core')
    stopManagedOllama()
  } catch {}
}

main()
