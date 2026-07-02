import { useCallback, useEffect, useState } from 'react'
import {
  Alert,
  Button,
  Card,
  CardBody,
  CardHeader,
  Chip,
  Divider,
  Progress,
  ScrollShadow,
  Snippet,
  Spinner,
} from '@heroui/react'
import type { SetupEvent, SetupStatusDto, SetupStep } from '@wisploc/shared'

interface StepState {
  step: SetupStep
  status: 'pending' | 'running' | 'completed' | 'failed'
  message?: string
  error?: string
}

const STEP_LABELS: Record<SetupStep, string> = {
  storage: 'Storage',
  database: 'SQLite',
  ffmpeg: 'FFmpeg',
  'whisper-cli': 'whisper.cpp',
  'whisper-model': 'Whisper model',
  ollama: 'Ollama',
  'llm-model': 'qwen3:4b',
  config: 'Config',
  doctor: 'Doctor',
}

const STEP_DESCRIPTIONS: Record<SetupStep, string> = {
  storage: '~/.wisploc runtime directories',
  database: 'Local SQLite database and Prisma schema',
  ffmpeg: 'Local media probe and chunk extraction binary',
  'whisper-cli': 'Local whisper.cpp command-line binary',
  'whisper-model': 'Multilingual ggml-base.bin model',
  ollama: 'Local LLM runtime service',
  'llm-model': 'qwen3:4b model pulled into Ollama',
  config: 'Validated local config paths',
  doctor: 'Final dependency health check',
}

const DEFAULT_STEPS: StepState[] = [
  { step: 'storage', status: 'pending' },
  { step: 'database', status: 'pending' },
  { step: 'ffmpeg', status: 'pending' },
  { step: 'whisper-cli', status: 'pending' },
  { step: 'whisper-model', status: 'pending' },
  { step: 'ollama', status: 'pending' },
  { step: 'llm-model', status: 'pending' },
  { step: 'config', status: 'pending' },
  { step: 'doctor', status: 'pending' },
]

export function SetupPage() {
  const [installing, setInstalling] = useState(false)
  const [steps, setSteps] = useState<StepState[]>(DEFAULT_STEPS)
  const [complete, setComplete] = useState(false)
  const [setupError, setSetupError] = useState<string | null>(null)
  const [logs, setLogs] = useState<string[]>([])
  const [setupProgress, setSetupProgress] = useState(0)

  const applySetupStatus = useCallback((dto: SetupStatusDto) => {
    setComplete(dto.setupCompleted)
    setInstalling(dto.status === 'RUNNING')
    setSetupError(dto.status === 'FAILED' ? dto.errorMessage ?? 'Setup failed' : null)
    setLogs(dto.logs ?? [])
    setSetupProgress(dto.progress ?? 0)
    setSteps((prev) =>
      prev.map((step) => {
        const mapped = dto.steps.find((item) => item.step === step.step)
        return mapped ? { ...step, status: mapped.status, error: mapped.error, message: mapped.message } : step
      }),
    )
  }, [])

  const fetchSetupStatus = useCallback(() => {
    fetch('/api/setup/status')
      .then((response) => response.json())
      .then((dto: SetupStatusDto) => applySetupStatus(dto))
      .catch(() => {})
  }, [applySetupStatus])

  useEffect(() => {
    fetchSetupStatus()
  }, [fetchSetupStatus])

  useEffect(() => {
    if (!installing) return
    const id = window.setInterval(fetchSetupStatus, 2000)
    return () => window.clearInterval(id)
  }, [installing, fetchSetupStatus])

  useEffect(() => {
    const source = new EventSource('/api/setup/events')
    source.onmessage = (message) => {
      try {
        handleSetupEvent(JSON.parse(message.data) as SetupEvent)
      } catch {}
    }
    return () => source.close()
  }, [])

  const handleSetupEvent = useCallback((event: SetupEvent) => {
    setLogs((prev) => [...prev.slice(-80), formatSetupEvent(event)])

    switch (event.type) {
      case 'step-started':
        setSetupError(null)
        setSteps((prev) => updateStep(prev, event.step, { status: 'running', message: event.message }))
        break
      case 'step-progress':
        setSetupProgress(event.progress)
        setSteps((prev) => updateStep(prev, event.step, { status: 'running' }))
        break
      case 'step-completed':
        setSteps((prev) => updateStep(prev, event.step, { status: 'completed', message: event.message }))
        break
      case 'step-failed':
        setSteps((prev) => updateStep(prev, event.step, { status: 'failed', error: event.error }))
        break
      case 'setup-failed':
        setSetupError(event.error)
        setInstalling(false)
        break
      case 'setup-completed':
        setSetupError(null)
        setComplete(true)
        setInstalling(false)
        break
    }
  }, [])

  const startSetup = async () => {
    setInstalling(true)
    setSetupError(null)
    setLogs([])
    setSteps(DEFAULT_STEPS)

    const response = await fetch('/api/setup/install-all', { method: 'POST' })
    if (!response.ok) {
      const body = await response.json().catch(() => null)
      if (response.status === 409) {
        setInstalling(true)
        setSetupError(null)
      } else {
        setInstalling(false)
        setSetupError(body?.message ?? 'Failed to start setup')
      }
    }
  }

  const visibleLogs = logs.slice(-80)
  const completedCount = steps.filter((step) => step.status === 'completed').length
  const stepProgress = Math.round((completedCount / steps.length) * 100)
  const progress = complete ? 100 : installing ? Math.max(stepProgress, setupProgress) : stepProgress
  const activeStep = steps.find((step) => step.status === 'running')
  const setupErrorSummary = setupError ? summarizeText(setupError, 240) : null

  if (complete) {
    return (
      <main data-theme="dark" className="dark min-h-screen bg-background text-foreground p-8">
        <Card radius="sm" className="mx-auto mt-24 max-w-xl">
          <CardBody className="items-start gap-5 p-8">
            <Chip color="success" variant="flat" size="lg">Ready</Chip>
            <div>
              <h1 className="text-4xl font-bold">WispLoc</h1>
              <p className="text-default-500">All local processing components are installed.</p>
            </div>
            <Button color="primary" size="lg" radius="sm" onPress={() => (window.location.href = '/dashboard')}>
              Open Dashboard
            </Button>
          </CardBody>
        </Card>
      </main>
    )
  }

  return (
    <main data-theme="dark" className="dark min-h-screen min-w-[1180px] bg-background text-foreground p-8">
      <div className="mx-auto grid w-[1180px] grid-cols-[740px_400px] gap-6">
        <Card radius="sm" className="overflow-hidden">
          <CardHeader className="flex flex-row items-start justify-between p-6">
            <div className="space-y-2">
              <Chip variant="flat" color="primary" radius="sm">Local setup</Chip>
              <div>
                <h1 className="text-4xl font-bold">WispLoc</h1>
                <p className="text-default-500">Desktop installer for local audio/video processing.</p>
              </div>
            </div>
            <StatusChip installing={installing} setupError={setupError} />
          </CardHeader>
          <Divider />
          <CardBody className="flex flex-col gap-6 p-6">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-medium">Install progress</span>
                <span className="text-small text-default-500">{progress}%</span>
              </div>
              <Progress
                aria-label="Setup progress"
                value={progress}
                color={setupError ? 'danger' : 'primary'}
                radius="sm"
                isStriped={installing}
                isIndeterminate={installing && progress === 0}
              />
              <div className="flex min-h-6 items-center gap-2 text-small text-default-500">
                {installing && <Spinner size="sm" color="primary" />}
                <span>{activeStep ? STEP_LABELS[activeStep.step] : 'Waiting for install command'}</span>
              </div>
            </div>

            {setupError && (
              <Alert
                color="danger"
                variant="flat"
                title="Setup failed"
                description={setupErrorSummary}
              />
            )}

            <div className="grid max-h-[520px] gap-2 overflow-y-auto pr-1">
              {steps.map((step) => (
                <StepRow key={step.step} step={step} />
              ))}
            </div>

            <Button
              color="primary"
              size="lg"
              radius="sm"
              onPress={startSetup}
              isDisabled={installing}
              isLoading={installing}
              spinner={<Spinner size="sm" color="white" />}
            >
              {installing ? 'Installing components' : 'Install all required components'}
            </Button>
          </CardBody>
        </Card>

        <div className="grid grid-rows-[auto_1fr] gap-6">
          <Card radius="sm" className="overflow-hidden">
            <CardHeader className="flex flex-col items-start p-5">
              <h2 className="font-semibold">Runtime</h2>
              <p className="text-small text-default-500">Local filesystem targets</p>
            </CardHeader>
            <Divider />
            <CardBody className="flex flex-col gap-3 p-5">
              <RuntimeItem label="Storage" value="~/.wisploc/" />
              <RuntimeItem label="Binaries" value="~/.wisploc/bin" />
              <RuntimeItem label="Models" value="~/.wisploc/models" />
              <RuntimeItem label="Database" value="~/.wisploc/data/wisploc.db" />
            </CardBody>
          </Card>

          <Card radius="sm" className="min-h-0 overflow-hidden">
            <CardHeader className="flex flex-row items-center justify-between p-5">
              <div>
                <h2 className="font-semibold">Setup log</h2>
                <p className="text-small text-default-500">Persists after page reload</p>
              </div>
              {installing && <Spinner size="sm" color="primary" />}
            </CardHeader>
            <Divider />
            <CardBody className="p-0">
              <ScrollShadow className="h-[420px] overflow-y-auto p-4">
                {visibleLogs.length > 0 ? (
                  visibleLogs.map((line, index) => (
                    <p key={`${line}-${index}`} className="break-words font-mono text-small text-default-600">
                      {line}
                    </p>
                  ))
                ) : (
                  <p className="text-small text-default-500">No setup events yet.</p>
                )}
              </ScrollShadow>
            </CardBody>
          </Card>
        </div>
      </div>
    </main>
  )
}

function updateStep(steps: StepState[], step: SetupStep, patch: Partial<StepState>): StepState[] {
  return steps.map((item) => (item.step === step ? { ...item, ...patch } : item))
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

function summarizeText(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (normalized.length <= maxLength) return normalized
  return `${normalized.slice(0, maxLength - 1)}…`
}

function StepRow({ step }: { step: StepState }) {
  return (
    <Alert
      className="overflow-hidden"
      color={stepColor(step.status)}
      variant="flat"
      title={STEP_LABELS[step.step]}
      description={getStepDescription(step)}
      icon={step.status === 'running' ? <Spinner size="sm" color="primary" /> : undefined}
      endContent={<StepChip status={step.status} />}
    />
  )
}

function getStepDescription(step: StepState): string {
  if (step.status === 'failed' && step.error) return summarizeText(step.error, 160)
  if (step.status === 'running') return `Installing ${STEP_LABELS[step.step]}`
  return STEP_DESCRIPTIONS[step.step]
}

function StepChip({ status }: { status: StepState['status'] }) {
  return (
    <Chip size="sm" color={stepColor(status)} variant="flat" radius="sm">
      {status}
    </Chip>
  )
}

function stepColor(status: StepState['status']) {
  if (status === 'completed') return 'success'
  if (status === 'failed') return 'danger'
  if (status === 'running') return 'primary'
  return 'default'
}

function StatusChip({ installing, setupError }: { installing: boolean; setupError: string | null }) {
  if (installing) {
    return (
      <Chip color="primary" variant="flat" radius="sm" startContent={<Spinner size="sm" color="primary" />}>
        Running
      </Chip>
    )
  }

  if (setupError) {
    return <Chip color="danger" variant="flat" radius="sm">Failed</Chip>
  }

  return <Chip color="default" variant="flat" radius="sm">Not installed</Chip>
}

function RuntimeItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <p className="text-small text-default-500">{label}</p>
      <Snippet hideSymbol variant="flat" radius="sm" size="sm">
        {value}
      </Snippet>
    </div>
  )
}
