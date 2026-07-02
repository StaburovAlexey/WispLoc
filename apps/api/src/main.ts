import { createServer } from './server'
import { loadConfig } from '@wisploc/core'

async function main() {
  const config = loadConfig()

  const app = await createServer()

  try {
    await app.listen({ host: config.appHost, port: config.appPort })
    console.log(`WispLoc API running at http://${config.appHost}:${config.appPort}`)
  } catch (err) {
    app.log.error(err)
    process.exit(1)
  }
}

main()
