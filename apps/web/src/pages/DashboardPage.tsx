import { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, Card, CardBody, Chip, Progress, Spinner } from '@heroui/react'
import { PageShell } from './PageShell'
import { friendlyError } from '../shared/errors'
import { useI18n, type Language } from '../shared/i18n'

interface JobItem {
  id: string
  mediaFileId: string | null
  type: string
  status: 'PENDING' | 'PROCESSING' | 'DONE' | 'FAILED' | 'CANCELLED'
  progress: number
  currentStep: string | null
  errorMessage: string | null
  startedAt: string | null
  finishedAt: string | null
  durationMs: number | null
  createdAt: string
  updatedAt: string
}

export function DashboardPage() {
  const { t, language } = useI18n()
  const [jobs, setJobs] = useState<JobItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())

  const loadJobs = useCallback(async () => {
    try {
      const response = await fetch('/api/jobs')
      if (!response.ok) throw new Error(`Jobs request failed: ${response.status}`)
      setJobs(await response.json())
      setError(null)
    } catch (err: any) {
      setError(friendlyError(err.message, t('dashboard.loadFailed'), language))
    } finally {
      setLoading(false)
    }
  }, [language, t])

  useEffect(() => {
    loadJobs()
    const id = window.setInterval(loadJobs, 20_000)
    return () => window.clearInterval(id)
  }, [loadJobs])

  const activeJobs = useMemo(() => jobs.filter((job) => job.status === 'PENDING' || job.status === 'PROCESSING'), [jobs])
  const visibleJobs = activeJobs.length > 0 ? activeJobs : jobs.slice(0, 8)

  useEffect(() => {
    if (activeJobs.length === 0) return
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [activeJobs.length])

  return (
    <PageShell
      title={t('dashboard.title')}
      subtitle={t('dashboard.subtitle')}
      eyebrow={t('dashboard.eyebrow')}
      actions={loading ? <Spinner size="sm" color="primary" /> : <Chip color={activeJobs.length > 0 ? 'primary' : 'default'} variant="flat" radius="sm">{t('dashboard.active', { count: activeJobs.length })}</Chip>}
      width="xl"
    >
      {error && <Alert color="danger" variant="flat" title={t('dashboard.error')} description={error} />}

      {visibleJobs.length === 0 ? (
        <Alert
          color="default"
          variant="flat"
          title={t('dashboard.noActive')}
          description={t('dashboard.noActiveDescription')}
        />
      ) : (
        <div className="grid gap-3">
          {visibleJobs.map((job) => (
            <JobRow key={job.id} job={job} now={now} />
          ))}
        </div>
      )}
    </PageShell>
  )
}

function JobRow({ job, now }: { job: JobItem; now: number }) {
  const { t, language } = useI18n()
  const active = job.status === 'PENDING' || job.status === 'PROCESSING'

  return (
    <Card radius="sm" className="border border-default-100 bg-content2">
      <CardBody className="gap-4 p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 space-y-1">
            <div className="flex items-center gap-2">
              {active && <Spinner size="sm" color="primary" />}
              <h2 className="font-semibold">{formatStep(job.currentStep, job.status, t)}</h2>
            </div>
            <p className="text-small text-default-500">
              {job.type} job · {job.mediaFileId ? job.mediaFileId.slice(0, 8) : t('dashboard.noMedia')} · {t('dashboard.updated', { time: new Date(job.updatedAt).toLocaleTimeString() })}
            </p>
            <p className="text-small text-default-500">
              {formatJobDuration(job, now, t, language)}
            </p>
          </div>
          <Chip color={statusColor(job.status)} variant="flat" radius="sm">
            {statusLabel(job.status, t)}
          </Chip>
        </div>

        <Progress
          aria-label={`${job.status} progress`}
          value={job.progress}
          color={job.status === 'FAILED' ? 'danger' : job.status === 'DONE' ? 'success' : 'primary'}
          radius="sm"
          isStriped={active}
          isIndeterminate={job.status === 'PENDING'}
        />

        <div className="flex items-center justify-between text-small text-default-500">
          <span>{job.progress}%</span>
          <span className="font-mono">{job.id.slice(0, 8)}</span>
        </div>

        {job.errorMessage && (
          <Alert color="danger" variant="flat" title={t('dashboard.actionFailed')} description={friendlyError(job.errorMessage, t('dashboard.processingFailed'), language)} />
        )}
      </CardBody>
    </Card>
  )
}

type TFunction = ReturnType<typeof useI18n>['t']

function formatStep(step: string | null, status: JobItem['status'], t: TFunction): string {
  if (!step) return status === 'PENDING' ? t('dashboard.waitingQueue') : t('dashboard.processing')
  return step.replace(/_/g, ' ')
}

function statusColor(status: JobItem['status']): 'default' | 'primary' | 'success' | 'danger' | 'warning' {
  if (status === 'DONE') return 'success'
  if (status === 'FAILED') return 'danger'
  if (status === 'CANCELLED') return 'default'
  if (status === 'PENDING') return 'warning'
  return 'primary'
}

function formatJobDuration(job: JobItem, now: number, t: TFunction, language: Language): string {
  const active = job.status === 'PENDING' || job.status === 'PROCESSING'
  if (active) {
    const startedAt = job.startedAt ?? job.createdAt
    return t('dashboard.runningFor', { duration: formatDuration(now - new Date(startedAt).getTime(), language) })
  }

  if (job.durationMs !== null) {
    const duration = formatDuration(job.durationMs, language)
    if (job.status === 'DONE') return t('dashboard.completedAfter', { duration })
    if (job.status === 'FAILED') return t('dashboard.failedAfter', { duration })
    return t('dashboard.cancelledAfter', { duration })
  }

  return t('dashboard.durationUnavailable')
}

function formatDuration(ms: number, language: Language): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  const units = language === 'ru' ? { h: 'ч', m: 'м', s: 'с' } : { h: 'h', m: 'm', s: 's' }
  if (hours > 0) return `${hours}${units.h} ${minutes}${units.m} ${seconds}${units.s}`
  if (minutes > 0) return `${minutes}${units.m} ${seconds}${units.s}`
  return `${seconds}${units.s}`
}

function statusLabel(status: JobItem['status'], t: TFunction): string {
  if (status === 'DONE') return t('status.done')
  if (status === 'FAILED') return t('status.failed')
  if (status === 'CANCELLED') return t('status.cancelled')
  if (status === 'PENDING') return t('status.pending')
  return t('status.processing')
}
