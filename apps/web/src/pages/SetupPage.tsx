import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Alert,
  Button,
  Card,
  CardBody,
  CardHeader,
  Chip,
  Divider,
  Progress,
  Snippet,
  Spinner,
} from '@heroui/react'
import type { SetupEvent, SetupStatusDto, SetupStep } from '@wisploc/shared'
import { AppTopBar } from './PageShell'
import { friendlyError } from '../shared/errors'
import { useI18n, type TranslationKey } from '../shared/i18n'

interface StepState {
  step: SetupStep
  status: 'pending' | 'running' | 'completed' | 'failed'
  message?: string
  error?: string
}

const STEP_LABEL_KEYS: Record<SetupStep, TranslationKey> = {
  storage: 'setup.step.storage',
  database: 'setup.step.database',
  ffmpeg: 'setup.step.ffmpeg',
  'whisper-cli': 'setup.step.whisperCli',
  'whisper-model': 'setup.step.whisperModel',
  ollama: 'setup.step.ollama',
  'llm-model': 'setup.step.llmModel',
  config: 'setup.step.config',
  doctor: 'setup.step.doctor',
}

const STEP_DESCRIPTION_KEYS: Record<SetupStep, TranslationKey> = {
  storage: 'setup.desc.storage',
  database: 'setup.desc.database',
  ffmpeg: 'setup.desc.ffmpeg',
  'whisper-cli': 'setup.desc.whisperCli',
  'whisper-model': 'setup.desc.whisperModel',
  ollama: 'setup.desc.ollama',
  'llm-model': 'setup.desc.llmModel',
  config: 'setup.desc.config',
  doctor: 'setup.desc.doctor',
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
  const { t, language } = useI18n()
  const [installing, setInstalling] = useState(false)
  const [steps, setSteps] = useState<StepState[]>(DEFAULT_STEPS)
  const [complete, setComplete] = useState(false)
  const [setupError, setSetupError] = useState<string | null>(null)
  const [logs, setLogs] = useState<string[]>([])
  const [setupProgress, setSetupProgress] = useState(0)
  const logScrollRef = useRef<HTMLDivElement | null>(null)

  const applySetupStatus = useCallback((dto: SetupStatusDto) => {
    setComplete(dto.setupCompleted)
    setInstalling(dto.status === 'RUNNING')
    setSetupError(dto.status === 'FAILED' ? friendlyError(dto.errorMessage, t('setup.failedFallback'), language) : null)
    setLogs(dto.logs ?? [])
    setSetupProgress(dto.progress ?? 0)
    setSteps((prev) =>
      prev.map((step) => {
        const mapped = dto.steps.find((item) => item.step === step.step)
        return mapped ? { ...step, status: mapped.status, error: mapped.error, message: mapped.message } : step
      }),
    )
  }, [language, t])

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
        setSteps((prev) => updateStep(prev, event.step, { status: 'failed', error: friendlyError(event.error, t('setup.stepFailedFallback'), language) }))
        break
      case 'setup-failed':
        setSetupError(friendlyError(event.error, t('setup.failedFallback'), language))
        setInstalling(false)
        break
      case 'setup-completed':
        setSetupError(null)
        setComplete(true)
        setInstalling(false)
        break
    }
  }, [language, t])

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
        setSetupError(body?.message ?? t('setup.startFailed'))
      }
    }
  }

  const visibleLogs = logs.slice(-80)
  const lastVisibleLog = visibleLogs.at(-1)
  const completedCount = steps.filter((step) => step.status === 'completed').length
  const stepProgress = Math.round((completedCount / steps.length) * 100)
  const progress = complete ? 100 : installing ? Math.max(stepProgress, setupProgress) : stepProgress
  const activeStep = steps.find((step) => step.status === 'running')
  const setupErrorSummary = setupError ? summarizeText(setupError, 240) : null

  useEffect(() => {
    const logElement = logScrollRef.current
    if (!logElement) return
    logElement.scrollTop = logElement.scrollHeight
  }, [visibleLogs.length, lastVisibleLog])

  if (complete) {
    return (
      <main data-theme="dark" className="dark min-h-screen bg-background text-foreground">
        <AppTopBar />
        <div className="px-4 py-8 lg:px-8">
          <Card radius="sm" className="mx-auto mt-16 max-w-xl">
            <CardBody className="items-start gap-5 p-8">
              <Chip color="success" variant="flat" size="lg">{t('setup.ready')}</Chip>
              <div>
                <h1 className="text-4xl font-bold">WispLoc</h1>
                <p className="text-default-500">{t('setup.readyDescription')}</p>
              </div>
              <Button color="primary" size="lg" radius="sm" onPress={() => (window.location.href = '/dashboard')}>
                {t('setup.openDashboard')}
              </Button>
            </CardBody>
          </Card>
        </div>
      </main>
    )
  }

  return (
    <main data-theme="dark" className="dark min-h-screen bg-background text-foreground">
      <AppTopBar />
      <div className="mx-auto grid w-full max-w-7xl gap-6 px-4 py-6 lg:h-[calc(100vh-96px)] lg:max-h-[calc(100vh-96px)] lg:grid-cols-[minmax(0,740px)_400px] lg:px-8">
        <Card radius="sm" className="overflow-hidden">
          <CardHeader className="flex flex-row items-start justify-between p-6">
            <div className="space-y-2">
              <Chip variant="flat" color="primary" radius="sm">{t('setup.eyebrow')}</Chip>
              <div>
                <h1 className="text-4xl font-bold">WispLoc</h1>
                <p className="text-default-500">{t('setup.subtitle')}</p>
              </div>
            </div>
            <StatusChip installing={installing} setupError={setupError} />
          </CardHeader>
          <Divider />
          <CardBody className="flex flex-col gap-6 p-6">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-medium">{t('setup.progress')}</span>
                <span className="text-small text-default-500">{progress}%</span>
              </div>
              <Progress
                aria-label={t('setup.progressAria')}
                value={progress}
                color={setupError ? 'danger' : 'primary'}
                radius="sm"
                isStriped={installing}
                isIndeterminate={installing && progress === 0}
              />
              <div className="flex min-h-6 items-center gap-2 text-small text-default-500">
                {installing && <Spinner size="sm" color="primary" />}
                <span>{activeStep ? t(STEP_LABEL_KEYS[activeStep.step]) : t('setup.waiting')}</span>
              </div>
            </div>

            {setupError && (
              <Alert
                color="danger"
                variant="flat"
                title={t('setup.errorTitle')}
                description={setupErrorSummary}
              />
            )}

            <div className="grid gap-2 pr-1">
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
              {installing ? t('setup.installing') : t('setup.installAll')}
            </Button>
          </CardBody>
        </Card>

        <div className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] gap-6 overflow-hidden">
          <Card radius="sm" className="overflow-hidden">
            <CardHeader className="flex flex-col items-start p-4 pb-3">
              <h2 className="font-semibold">{t('setup.runtime')}</h2>
              <p className="text-small text-default-500">{t('setup.runtimeSubtitle')}</p>
            </CardHeader>
            <Divider />
            <CardBody className="flex flex-col gap-2 p-4">
              <RuntimeItem label={t('setup.storage')} value="~/.wisploc/" />
              <RuntimeItem label={t('setup.binaries')} value="~/.wisploc/bin" />
              <RuntimeItem label={t('setup.models')} value="~/.wisploc/models" />
              <RuntimeItem label={t('setup.database')} value="~/.wisploc/data/wisploc.db" />
            </CardBody>
          </Card>

          <Card radius="sm" className="flex min-h-0 flex-col overflow-hidden">
            <CardHeader className="flex flex-row items-center justify-between p-5">
              <div>
                <h2 className="font-semibold">{t('setup.log')}</h2>
                <p className="text-small text-default-500">{t('setup.logSubtitle')}</p>
              </div>
              {installing && <Spinner size="sm" color="primary" />}
            </CardHeader>
            <Divider />
            <CardBody className="min-h-0 flex-1 p-0">
              <div ref={logScrollRef} className="h-80 overflow-y-auto p-4 lg:h-full">
                {visibleLogs.length > 0 ? (
                  visibleLogs.map((line, index) => (
                    <p key={`${line}-${index}`} className="break-words font-mono text-small text-default-600">
                      {line}
                    </p>
                  ))
                ) : (
                  <p className="text-small text-default-500">{t('setup.noEvents')}</p>
                )}
              </div>
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
  const { t } = useI18n()

  return (
    <Alert
      className="overflow-hidden"
      color={stepColor(step.status)}
      variant="flat"
      title={t(STEP_LABEL_KEYS[step.step])}
      description={getStepDescription(step, t)}
      icon={step.status === 'running' ? <Spinner size="sm" color="primary" /> : undefined}
      endContent={<StepChip status={step.status} />}
    />
  )
}

function getStepDescription(step: StepState, t: ReturnType<typeof useI18n>['t']): string {
  if (step.status === 'failed' && step.error) return summarizeText(step.error, 160)
  if (step.status === 'running') return t('setup.installingStep', { step: t(STEP_LABEL_KEYS[step.step]) })
  return t(STEP_DESCRIPTION_KEYS[step.step])
}

function StepChip({ status }: { status: StepState['status'] }) {
  const { t } = useI18n()

  return (
    <Chip size="sm" color={stepColor(status)} variant="flat" radius="sm">
      {stepStatusLabel(status, t)}
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
  const { t } = useI18n()

  if (installing) {
    return (
      <Chip color="primary" variant="flat" radius="sm" startContent={<Spinner size="sm" color="primary" />}>
        {t('common.running')}
      </Chip>
    )
  }

  if (setupError) {
    return <Chip color="danger" variant="flat" radius="sm">{t('common.failed')}</Chip>
  }

  return <Chip color="default" variant="flat" radius="sm">{t('setup.notInstalled')}</Chip>
}

function RuntimeItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1 lg:grid-cols-[96px_minmax(0,1fr)] lg:items-center">
      <p className="text-tiny text-default-500">{label}</p>
      <Snippet hideSymbol variant="flat" radius="sm" size="sm" className="min-w-0">
        {value}
      </Snippet>
    </div>
  )
}

function stepStatusLabel(status: StepState['status'], t: ReturnType<typeof useI18n>['t']): string {
  if (status === 'completed') return t('status.completed')
  if (status === 'failed') return t('status.failed')
  if (status === 'running') return t('status.running')
  return t('status.pending')
}
