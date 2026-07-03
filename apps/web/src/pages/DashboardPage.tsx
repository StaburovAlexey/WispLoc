import { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, Card, CardBody, Chip, Progress, Spinner } from '@heroui/react'
import { PageShell } from './PageShell'

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
  const [jobs, setJobs] = useState<JobItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadJobs = useCallback(async () => {
    try {
      const response = await fetch('/api/jobs')
      if (!response.ok) throw new Error(`Jobs request failed: ${response.status}`)
      setJobs(await response.json())
      setError(null)
    } catch (err: any) {
      setError(err.message ?? 'Failed to load jobs')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadJobs()
    const id = window.setInterval(loadJobs, 1500)
    return () => window.clearInterval(id)
  }, [loadJobs])

  const activeJobs = useMemo(() => jobs.filter((job) => job.status === 'PENDING' || job.status === 'PROCESSING'), [jobs])
  const visibleJobs = activeJobs.length > 0 ? activeJobs : jobs.slice(0, 8)

  return (
    <PageShell
      title="Dashboard"
      subtitle="Live local processing activity"
      eyebrow="Realtime"
      actions={loading ? <Spinner size="sm" color="primary" /> : <Chip color={activeJobs.length > 0 ? 'primary' : 'default'} variant="flat" radius="sm">{activeJobs.length} active</Chip>}
      width="xl"
    >
      {error && <Alert color="danger" variant="flat" title="Dashboard error" description={error} />}

      {visibleJobs.length === 0 ? (
        <Alert
          color="default"
          variant="flat"
          title="No active actions"
          description="Processing operations will appear here as soon as media jobs start."
        />
      ) : (
        <div className="grid gap-3">
          {visibleJobs.map((job) => (
            <JobRow key={job.id} job={job} />
          ))}
        </div>
      )}
    </PageShell>
  )
}

function JobRow({ job }: { job: JobItem }) {
  const active = job.status === 'PENDING' || job.status === 'PROCESSING'

  return (
    <Card radius="sm" className="border border-default-100 bg-content2">
      <CardBody className="gap-4 p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 space-y-1">
            <div className="flex items-center gap-2">
              {active && <Spinner size="sm" color="primary" />}
              <h2 className="font-semibold">{formatStep(job.currentStep, job.status)}</h2>
            </div>
            <p className="text-small text-default-500">
              {job.type} job · {job.mediaFileId ? job.mediaFileId.slice(0, 8) : 'no media'} · updated {new Date(job.updatedAt).toLocaleTimeString()}
            </p>
            <p className="text-small text-default-500">
              {formatJobDuration(job)}
            </p>
          </div>
          <Chip color={statusColor(job.status)} variant="flat" radius="sm">
            {job.status}
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
          <Alert color="danger" variant="flat" title="Action failed" description={job.errorMessage} />
        )}
      </CardBody>
    </Card>
  )
}

function formatStep(step: string | null, status: JobItem['status']): string {
  if (!step) return status === 'PENDING' ? 'Waiting in queue' : 'Processing'
  return step.replace(/_/g, ' ')
}

function statusColor(status: JobItem['status']): 'default' | 'primary' | 'success' | 'danger' | 'warning' {
  if (status === 'DONE') return 'success'
  if (status === 'FAILED') return 'danger'
  if (status === 'CANCELLED') return 'default'
  if (status === 'PENDING') return 'warning'
  return 'primary'
}

function formatJobDuration(job: JobItem): string {
  const active = job.status === 'PENDING' || job.status === 'PROCESSING'
  if (active) {
    const startedAt = job.startedAt ?? job.createdAt
    return `Running for ${formatDuration(Date.now() - new Date(startedAt).getTime())}`
  }

  if (job.durationMs !== null) {
    const label = job.status === 'DONE' ? 'Completed' : job.status === 'FAILED' ? 'Failed' : 'Cancelled'
    return `${label} after ${formatDuration(job.durationMs)}`
  }

  return 'Duration unavailable'
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`
  if (minutes > 0) return `${minutes}m ${seconds}s`
  return `${seconds}s`
}
