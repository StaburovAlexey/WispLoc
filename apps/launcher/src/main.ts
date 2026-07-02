#!/usr/bin/env node
/**
 * WispLoc Launcher — starts the API server and opens the web UI.
 *
 * Usage: wisploc start
 */
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

async function main() {
  const args = process.argv.slice(2)
  const command = args[0] || 'start'

  if (command !== 'start') {
    console.log('Usage: wisploc start')
    console.log('')
    console.log('Commands:')
    console.log('  start    Start the WispLoc local server')
    process.exit(0)
  }

  console.log('Starting WispLoc…')

  // Start the API server
  try {
    // Dynamically import the API server
    const { createServer } = await import('@wisploc/api')
    const app = await createServer()
    const { startWorker } = await import('@wisploc/worker')

    const { loadConfig } = await import('@wisploc/core')
    const config = loadConfig()

    await app.listen({ host: config.appHost, port: config.appPort })
    await startWorker()
    console.log(`WispLoc is running at http://${config.appHost}:${config.appPort}`)

    // Try to open browser
    try {
      const { default: open } = await import('open')
      await open(`http://${config.appHost}:${config.appPort}`)
    } catch {
      console.log(`Open http://${config.appHost}:${config.appPort} in your browser`)
    }
  } catch (err: any) {
    console.error('Failed to start WispLoc:', err.message)
    process.exit(1)
  }
}

main()
