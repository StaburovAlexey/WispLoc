import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const host = '127.0.0.1'
const port = Number(process.env.WISPLOC_E2E_PORT ?? 3140)
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'wisploc-e2e-home-'))

process.env.HOME = home
delete process.env.USERPROFILE
process.env.DATABASE_URL = `file:${path.join(home, '.wisploc/data/wisploc.db')}`

const configDir = path.join(home, '.wisploc')
fs.mkdirSync(configDir, { recursive: true })
fs.writeFileSync(
  path.join(configDir, 'config.json'),
  JSON.stringify(
    {
      appHost: host,
      appPort: port,
      ollamaHost: 'http://127.0.0.1:11434',
      llmModel: 'qwen3:4b',
      language: 'ru',
      summaryLanguage: 'ru',
      chunkMinutes: 5,
      cleanChunks: true,
      deleteOriginalAfterProcessing: false,
      setupCompleted: false,
    },
    null,
    2,
  ),
)

void main()

async function main(): Promise<void> {
  const { createServer } = await import('../apps/api/src/server')
  const app = await createServer({ logger: false })
  await app.listen({ host, port })

  const shutdown = async () => {
    await app.close()
    fs.rmSync(home, { recursive: true, force: true })
    process.exit(0)
  }

  process.once('SIGINT', shutdown)
  process.once('SIGTERM', shutdown)
}
