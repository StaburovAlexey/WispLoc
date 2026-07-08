import type { FastifyInstance } from 'fastify'
import { cancelSetup, runFullSetup, loadConfig, getPrisma } from '@wisploc/core'
import type { SetupEvent, SetupStatusDto, SetupStep, SetupStepStatusDto } from '@wisploc/shared'

const prisma = getPrisma()
let setupPromise: Promise<void> | null = null

// In-memory store for active SSE clients
const sseClients = new Set<(event: SetupEvent) => void>()

export async function setupRoutes(app: FastifyInstance) {
  // GET /api/setup/status
  app.get('/status', async (_req, reply) => {
    const config = loadConfig()
    let setupState = await getOrCreateSetupState().catch(() => null)
    const setupIsComplete = config.setupCompleted || setupState?.setupCompleted === true
    if (setupState?.status === 'RUNNING' && !setupPromise) {
      if (setupIsComplete) {
        setupState = await prisma.setupState.update({
          where: { id: setupState.id },
          data: {
            status: 'COMPLETED',
            currentStep: null,
            progress: 100,
            errorMessage: '',
            setupCompleted: true,
          },
        })
      } else {
        setupPromise = startSetupRun({ resume: true })
        setupState = await getOrCreateSetupState().catch(() => setupState)
      }
    }
    const currentStep = setupState?.currentStep as SetupStep | null

    const steps: SetupStepStatusDto[] = [
      { step: 'storage', status: stepStatus(setupState?.status, currentStep, 'storage', 'completed') },
      { step: 'database', status: stepStatus(setupState?.status, currentStep, 'database', 'completed') },
      {
        step: 'ffmpeg',
        status: stepStatus(setupState?.status, currentStep, 'ffmpeg', setupState?.ffmpegStatus === 'ok' ? 'completed' : 'pending'),
      },
      {
        step: 'whisper-cli',
        status: stepStatus(setupState?.status, currentStep, 'whisper-cli', setupState?.whisperStatus === 'ok' ? 'completed' : 'pending'),
      },
      {
        step: 'whisper-model',
        status: stepStatus(setupState?.status, currentStep, 'whisper-model', setupState?.modelStatus === 'ok' ? 'completed' : 'pending'),
      },
      {
        step: 'ollama',
        status: stepStatus(setupState?.status, currentStep, 'ollama', setupState?.ollamaStatus === 'ok' ? 'completed' : 'pending'),
      },
      {
        step: 'llm-model',
        status: stepStatus(setupState?.status, currentStep, 'llm-model', setupState?.llmStatus === 'ok' ? 'completed' : 'pending'),
      },
      { step: 'config', status: stepStatus(setupState?.status, currentStep, 'config', setupState?.setupCompleted ? 'completed' : 'pending') },
      { step: 'doctor', status: stepStatus(setupState?.status, currentStep, 'doctor', setupState?.setupCompleted ? 'completed' : 'pending') },
    ]

    const dto: SetupStatusDto = {
      setupCompleted: config.setupCompleted || setupState?.setupCompleted === true,
      status: normalizeSetupStatus(setupState?.status),
      currentStep,
      progress: setupState?.progress ?? 0,
      ffmpegStatus: setupState?.ffmpegStatus ?? 'missing',
      whisperStatus: setupState?.whisperStatus ?? 'missing',
      modelStatus: setupState?.modelStatus ?? 'missing',
      ollamaStatus: setupState?.ollamaStatus ?? 'missing',
      llmStatus: setupState?.llmStatus ?? 'missing',
      errorMessage: setupState?.errorMessage ?? null,
      logs: parseLog(setupState?.logJson),
      steps,
    }

    return dto
  })

  // POST /api/setup/install-all
  app.post('/install-all', async (_req, reply) => {
    const state = await getOrCreateSetupState()
    if (state.status === 'RUNNING' || setupPromise) {
      return reply.status(409).send({ message: 'Setup is already running' })
    }

    setupPromise = startSetupRun({ resume: false })

    return { message: 'Setup started' }
  })

  app.post('/retry', async (_req, reply) => {
    const state = await getOrCreateSetupState()
    if (state.status === 'RUNNING' || setupPromise) {
      return reply.status(409).send({ message: 'Setup is already running' })
    }

    setupPromise = startSetupRun({ resume: false })

    return { message: 'Setup retry started' }
  })

  app.post('/cancel', async () => {
    cancelSetup()
    await prisma.setupState.updateMany({
      data: { status: 'CANCELLED', errorMessage: 'Setup cancelled' },
    })
    return { ok: true }
  })

  // GET /api/setup/events — SSE stream
  app.get('/events', async (req, reply) => {
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    })

    const send = (event: SetupEvent) => {
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`)
    }

    sseClients.add(send)

    req.raw.on('close', () => {
      sseClients.delete(send)
    })

    // Keep connection alive
    const keepAlive = setInterval(() => {
      reply.raw.write(': keepalive\n\n')
    }, 15_000)

    req.raw.on('close', () => {
      clearInterval(keepAlive)
    })
  })
}

function startSetupRun({ resume }: { resume: boolean }): Promise<void> {
  let stateWriteQueue = Promise.resolve()
  const emit = (event: SetupEvent) => {
    const publicEvent = toPublicSetupEvent(event)
    broadcastSetupEvent(publicEvent)
    stateWriteQueue = stateWriteQueue.then(() => updateSetupState(publicEvent)).catch((err) => {
      console.error('Failed to persist setup event:', err)
    })
  }

  return getOrCreateSetupState()
    .then(async (state) => {
      const logs = resume
        ? [...parseLog(state.logJson), '[setup] resumed after page/server reload'].slice(-300)
        : []

      return prisma.setupState.update({
        where: { id: state.id },
        data: {
          status: 'RUNNING',
          setupCompleted: false,
          currentStep: resume ? state.currentStep : null,
          progress: resume ? state.progress : 0,
          errorMessage: null,
          logJson: JSON.stringify(logs),
        },
      })
    })
    .then(async () => {
      await runFullSetup(emit)
      await stateWriteQueue
    })
    .catch(async (err) => {
      console.error('Setup failed:', err)
      await stateWriteQueue
      const state = await getOrCreateSetupState()
      await prisma.setupState.update({
        where: { id: state.id },
        data: {
          status: 'FAILED',
          errorMessage: friendlySetupError(err.message ?? String(err)),
        },
      })
    })
    .finally(() => {
      setupPromise = null
    })
}

function broadcastSetupEvent(event: SetupEvent): void {
  for (const client of sseClients) {
    try {
      client(event)
    } catch {}
  }
}

function toPublicSetupEvent(event: SetupEvent): SetupEvent {
  if (event.type === 'step-failed') {
    return { ...event, error: friendlySetupError(event.error) }
  }
  if (event.type === 'setup-failed') {
    return { ...event, error: friendlySetupError(event.error) }
  }
  return event
}

function friendlySetupError(message: string): string {
  const lower = message.toLowerCase()

  if (lower.includes('checksum mismatch')) {
    return 'Downloaded file did not match the expected version. Retry setup; if it repeats, update WispLoc.'
  }
  if (lower.includes('download failed') || lower.includes('enotfound') || lower.includes('etimedout') || lower.includes('network')) {
    return 'Download failed. Check the internet connection and retry setup.'
  }
  if (lower.includes('auto-install is supported only on linux and windows')) {
    return 'Automatic installation is supported only on Linux and Windows.'
  }
  if (lower.includes('ollama')) {
    return 'Ollama setup failed. Restart WispLoc or retry setup.'
  }
  if (lower.includes('whisper')) {
    return 'whisper.cpp setup failed. Retry setup or reinstall runtime dependencies from Settings.'
  }
  if (lower.includes('ffmpeg')) {
    return 'FFmpeg setup failed. Retry setup or reinstall runtime dependencies from Settings.'
  }
  if (lower.includes('prisma') || lower.includes('sqlite') || lower.includes('database')) {
    return 'Local database setup failed. Check write access to the WispLoc data directory and retry.'
  }

  return 'Setup failed. Check setup diagnostics logs for technical details.'
}

async function updateSetupState(event: SetupEvent) {
  const state = await getOrCreateSetupState()

  const updates: Record<string, string | boolean | number | null> = {}
  const logs = [...parseLog(state.logJson), formatSetupEvent(event)].slice(-300)
  updates.logJson = JSON.stringify(logs)

  if (event.type === 'step-started') {
    updates.status = 'RUNNING'
    updates.currentStep = event.step
  } else if (event.type === 'step-progress') {
    updates.status = 'RUNNING'
    updates.currentStep = event.step
    updates.progress = event.progress
  } else if (event.type === 'step-completed') {
    updates.status = 'RUNNING'
    updates.currentStep = event.step
    updates.progress = 100
    switch (event.step) {
      case 'ffmpeg':
        updates.ffmpegStatus = 'ok'
        break
      case 'whisper-cli':
        updates.whisperStatus = 'ok'
        break
      case 'whisper-model':
        updates.modelStatus = 'ok'
        break
      case 'ollama':
        updates.ollamaStatus = 'ok'
        break
      case 'llm-model':
        updates.llmStatus = 'ok'
        break
    }
  } else if (event.type === 'step-failed') {
    updates.status = 'FAILED'
    updates.currentStep = event.step
    updates.errorMessage = event.error
    switch (event.step) {
      case 'ffmpeg':
        updates.ffmpegStatus = 'missing'
        break
      case 'whisper-cli':
        updates.whisperStatus = 'missing'
        break
      case 'whisper-model':
        updates.modelStatus = 'missing'
        break
      case 'ollama':
        updates.ollamaStatus = 'missing'
        break
      case 'llm-model':
        updates.llmStatus = 'missing'
        break
    }
  } else if (event.type === 'setup-completed') {
    updates.status = 'COMPLETED'
    updates.currentStep = null
    updates.progress = 100
    updates.errorMessage = ''
    updates.setupCompleted = true
  } else if (event.type === 'setup-failed') {
    updates.status = 'FAILED'
    updates.errorMessage = event.error
    updates.setupCompleted = false
  }

  if (Object.keys(updates).length > 0) {
    await prisma.setupState.update({
      where: { id: state.id },
      data: updates,
    })
  }
}

async function getOrCreateSetupState() {
  const state = await prisma.setupState.findFirst()
  if (state) return state
  return prisma.setupState.create({ data: {} })
}

function parseLog(raw?: string | null): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((line) => typeof line === 'string') : []
  } catch {
    return []
  }
}

function formatSetupEvent(event: SetupEvent): string {
  switch (event.type) {
    case 'step-started':
      return `[${event.step}] ${event.message}`
    case 'step-progress':
      return `[${event.step}] ${event.progress}% ${event.message ?? ''}`.trim()
    case 'step-completed':
      return `[${event.step}] ${event.message}`
    case 'step-failed':
      return `[${event.step}] failed: ${event.error}`
    case 'setup-failed':
      return `[setup] failed: ${event.error}`
    case 'setup-completed':
      return '[setup] completed'
  }
}

function normalizeSetupStatus(status?: string | null): SetupStatusDto['status'] {
  if (status === 'RUNNING' || status === 'COMPLETED' || status === 'FAILED' || status === 'CANCELLED') {
    return status
  }
  return 'IDLE'
}

function stepStatus(
  setupStatus: string | undefined,
  currentStep: SetupStep | null,
  step: SetupStep,
  fallback: SetupStepStatusDto['status'],
): SetupStepStatusDto['status'] {
  if (setupStatus === 'RUNNING' && currentStep === step) return 'running'
  if (setupStatus === 'FAILED' && currentStep === step) return 'failed'
  if (setupStatus === 'CANCELLED' && currentStep === step) return 'failed'
  return fallback
}
