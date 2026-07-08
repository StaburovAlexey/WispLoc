import Fastify from 'fastify'
import cors from '@fastify/cors'
import fastifyStatic from '@fastify/static'
import fastifyMultipart from '@fastify/multipart'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { setupRoutes } from './routes/setup'
import { healthRoutes } from './routes/health'
import { mediaRoutes } from './routes/media'
import { jobsRoutes } from './routes/jobs'
import { transcriptRoutes } from './routes/transcript'
import { summaryRoutes } from './routes/summary'
import { tasksRoutes } from './routes/tasks'
import { integrationRoutes } from './routes/integrations'
import { settingsRoutes } from './routes/settings'
import { maintenanceRoutes } from './routes/maintenance'
import { loadConfig } from '@wisploc/core'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
type CorsOrigin = string | boolean | RegExp | Array<string | boolean | RegExp>

/** Resolve the web build directory relative to the monorepo root. */
function findWebDist(): string | null {
  const candidates = [
    path.resolve(__dirname, '../../web/dist'),
    path.resolve(__dirname, '../../../apps/web/dist'),
    path.resolve(process.cwd(), 'apps/web/dist'),
  ]
  for (const dir of candidates) {
    if (fs.existsSync(dir) && fs.existsSync(path.join(dir, 'index.html'))) {
      return dir
    }
  }
  return null
}

export async function createServer() {
  const config = loadConfig()
  const app = Fastify({
    logger: { level: 'info' },
  })

  // CORS
  await app.register(cors, {
    origin: buildAllowedOrigins(config.appHost, config.appPort),
    credentials: true,
  })

  // Multipart — for file uploads
  await app.register(fastifyMultipart, {
    limits: {
      fileSize: 10 * 1024 * 1024 * 1024, // 10 GB max
    },
  })

  // Routes
  await app.register(setupRoutes, { prefix: '/api/setup' })
  await app.register(healthRoutes, { prefix: '/api' })
  await app.register(mediaRoutes, { prefix: '/api/media' })
  await app.register(jobsRoutes, { prefix: '/api/jobs' })
  await app.register(transcriptRoutes) // paths are fully qualified
  await app.register(summaryRoutes)   // paths are fully qualified
  await app.register(tasksRoutes)     // paths are fully qualified
  await app.register(integrationRoutes) // paths are fully qualified
  await app.register(settingsRoutes)   // paths are fully qualified
  await app.register(maintenanceRoutes) // paths are fully qualified

  // Serve the React web build (production)
  const webDist = findWebDist()
  if (webDist) {
    await app.register(fastifyStatic, {
      root: webDist,
      prefix: '/',
    })

    app.setNotFoundHandler(async (req, reply) => {
      if (req.url.startsWith('/api/')) {
        return reply.status(404).send({ error: 'Not found' })
      }
      return reply.sendFile('index.html')
    })
  }

  return app
}

function buildAllowedOrigins(host: string, port: number) {
  const allowed = new Set([
    `http://${host}:${port}`,
    `http://127.0.0.1:${port}`,
    `http://localhost:${port}`,
    'http://127.0.0.1:5173',
    'http://localhost:5173',
  ])

  return (origin: string | undefined, callback: (err: Error | null, origin: CorsOrigin) => void) => {
    if (!origin || allowed.has(origin)) {
      callback(null, true)
      return
    }

    callback(null, false)
  }
}
