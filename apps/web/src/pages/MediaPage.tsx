import { useCallback, useEffect, useState } from 'react'
import { Accordion, AccordionItem, Alert, Button, Card, CardBody, Chip, Progress, Spinner, Switch } from '@heroui/react'
import type { JobProgressEvent, MediaFileDto, ProcessingPlan, ProcessingStage } from '@wisploc/shared'
import { EmptyState, PageShell } from './PageShell'
import { friendlyError } from '../shared/errors'
import { useI18n, type TranslationKey } from '../shared/i18n'

interface ProcessingOptions {
  stages: ProcessingStage[]
  useDictionary: boolean
}

const PROCESSING_STAGES: ProcessingStage[] = [
  'transcription', 'normalization', 'fact-extraction', 'fact-deduplication', 'summary', 'tasks', 'term-discovery',
]

export function MediaPage() {
  const { t, language } = useI18n()
  const [files, setFiles] = useState<MediaFileDto[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [activeJobId, setActiveJobId] = useState<string | null>(null)
  const [activeMediaId, setActiveMediaId] = useState<string | null>(null)
  const [jobProgress, setJobProgress] = useState(0)
  const [jobStep, setJobStep] = useState<string | null>(null)
  const [jobStartedAt, setJobStartedAt] = useState<number | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [cancelling, setCancelling] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [processingOptions, setProcessingOptions] = useState<Record<string, ProcessingOptions>>({})
  const [processingPlans, setProcessingPlans] = useState<Record<string, ProcessingPlan>>({})

  const loadFiles = useCallback(async () => {
    try {
      const res = await fetch('/api/media')
      const mediaFiles: MediaFileDto[] = await res.json()
      setFiles(mediaFiles)
      const jobLists = await Promise.all(mediaFiles.map(async (file) => {
        const jobsResponse = await fetch(`/api/jobs?mediaFileId=${encodeURIComponent(file.id)}`)
        const jobs = jobsResponse.ok ? await jobsResponse.json() as Array<{ id: string; status: string; progress: number; currentStep: string | null; startedAt: string | null; requestedStages: ProcessingStage[]; useDictionary: boolean }> : []
        return { mediaId: file.id, jobs }
      }))
      const activeEntry = jobLists
        .flatMap(({ mediaId, jobs }) => jobs.map((job) => ({ mediaId, job })))
        .find(({ job }) => job.status === 'PENDING' || job.status === 'PROCESSING')
      const activeJob = activeEntry?.job
      setActiveMediaId(activeEntry?.mediaId ?? null)
      setActiveJobId(activeJob?.id ?? null)
      setJobProgress(activeJob?.progress ?? 0)
      setJobStep(activeJob?.currentStep ?? null)
      setJobStartedAt(activeJob?.startedAt ? new Date(activeJob.startedAt).getTime() : null)
      const settingsResponse = await fetch('/api/settings')
      const settings = settingsResponse.ok ? await settingsResponse.json() : {}
      setProcessingOptions((current) => Object.fromEntries(mediaFiles.map((file) => [
        file.id,
        current[file.id] ?? (() => {
          const active = jobLists.find((entry) => entry.mediaId === file.id)?.jobs.find((job) => job.status === 'PENDING' || job.status === 'PROCESSING')
          return active
            ? { stages: active.requestedStages, useDictionary: active.useDictionary }
            : defaultProcessingOptions(Boolean(settings.useDictionaryByDefault), Boolean(settings.discoverTermsByDefault), file.status !== 'DONE')
        })(),
      ])))
    } catch {} finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadFiles() }, [loadFiles])

  useEffect(() => {
    if (!activeJobId) return
    const es = new EventSource(`/api/jobs/${activeJobId}/events`)
    es.onmessage = (e) => {
      try {
        const evt: JobProgressEvent = JSON.parse(e.data)
        setJobProgress(evt.progress)
        setJobStep(evt.currentStep ?? null)
        if (evt.status === 'DONE' || evt.status === 'FAILED' || evt.status === 'CANCELLED') {
          setActiveJobId(null)
          setActiveMediaId(null)
          setJobStartedAt(null)
          loadFiles()
          if (evt.status === 'FAILED') setError(friendlyError(evt.error, t('media.processingFailed'), language))
        }
      } catch {}
    }
    return () => es.close()
  }, [activeJobId, language, loadFiles, t])

  useEffect(() => {
    if (!activeJobId) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [activeJobId])

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setUploading(true)
    setUploadProgress(0)
    setError(null)

    const formData = new FormData()
    formData.append('file', file)

    try {
      const xhr = new XMLHttpRequest()
      xhr.upload.onprogress = (evt) => {
        if (evt.lengthComputable) setUploadProgress(Math.round((evt.loaded / evt.total) * 100))
      }
      await new Promise<void>((resolve, reject) => {
        xhr.open('POST', '/api/media/upload')
        xhr.onload = () => xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload failed: ${xhr.status}`))
        xhr.onerror = () => reject(new Error('Upload failed'))
        xhr.send(formData)
      })
      setUploading(false)
      setUploadProgress(0)
      loadFiles()
    } catch (err: any) {
      setError(friendlyError(err.message, t('media.uploadFailed'), language))
      setUploading(false)
    }
  }

  const handleProcess = async (id: string) => {
    setError(null)
    try {
      const options = processingOptions[id] ?? defaultProcessingOptions()
      const res = await fetch(`/api/media/${id}/process`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(options),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(typeof data.error === 'string' ? data.error : t('media.startProcessingFailed'))
      setActiveJobId(data.jobId)
      setActiveMediaId(id)
      setCancelling(false)
      setJobStartedAt(Date.now())
      setJobProgress(0)
      setJobStep(null)
    } catch (err: any) {
      setError(friendlyError(err.message, t('media.startProcessingFailed'), language))
    }
  }

  const updateStageSelection = async (mediaId: string, stage: ProcessingStage, selected: boolean) => {
    const current = processingOptions[mediaId] ?? defaultProcessingOptions()
    const stages = selected ? [...new Set([...current.stages, stage])] : current.stages.filter((item) => item !== stage)
    if (stages.length === 0) return
    const next = { stages, useDictionary: stage === 'normalization' ? selected : current.useDictionary }
    setProcessingOptions((options) => ({ ...options, [mediaId]: next }))
    try {
      const response = await fetch(`/api/media/${mediaId}/process-plan`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(next),
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error ?? t('media.planFailed'))
      setProcessingPlans((plans) => ({ ...plans, [mediaId]: body }))
    } catch (err: any) {
      setProcessingOptions((options) => ({ ...options, [mediaId]: current }))
      setError(friendlyError(err.message, t('media.planFailed'), language))
    }
  }

  const handleCancel = async () => {
    if (!activeJobId || cancelling) return
    setCancelling(true)
    try {
      const response = await fetch(`/api/jobs/${activeJobId}/cancel`, { method: 'POST' })
      if (!response.ok) throw new Error(`Cancel failed: ${response.status}`)
    } catch (err: any) {
      setCancelling(false)
      setError(friendlyError(err.message, t('media.cancelProcessingFailed'), language))
    }
  }

  const handleDelete = async (id: string) => {
    await fetch(`/api/media/${id}`, { method: 'DELETE' })
    loadFiles()
  }

  return (
    <PageShell title={t('media.title')} subtitle={t('media.subtitle')} eyebrow={t('media.eyebrow')} width="xl">
      {error && <Alert color="danger" variant="flat" title={t('media.error')} description={error} />}

      <Card radius="sm" className="border border-default-100 bg-content2">
        <CardBody className="gap-4 p-6">
          <label className="block cursor-pointer rounded-small border border-dashed border-default-300 bg-content1 p-8 text-center data-[disabled=true]:cursor-not-allowed">
            <input type="file" accept="audio/*,video/*" onChange={handleUpload} disabled={uploading} className="hidden" />
            {uploading ? (
              <div className="space-y-3">
                <div className="flex items-center justify-center gap-2">
                  <Spinner size="sm" color="primary" />
                  <span className="font-medium">{t('media.uploading', { progress: uploadProgress })}</span>
                </div>
                <Progress value={uploadProgress} color="primary" radius="sm" />
              </div>
            ) : (
              <div className="space-y-1">
                <p className="font-semibold">{t('media.uploadCta')}</p>
                <p className="text-small text-default-500">{t('media.supported')}</p>
              </div>
            )}
          </label>
        </CardBody>
      </Card>

      {loading ? (
        <Card radius="sm" className="border border-default-100 bg-content2">
          <CardBody className="flex min-h-48 items-center justify-center p-6">
            <Spinner size="lg" color="primary" />
          </CardBody>
        </Card>
      ) : files.length === 0 ? (
        <EmptyState title={t('media.noFiles')} description={t('media.noFilesDescription')} />
      ) : (
        <div className="grid gap-3">
          {files.map((file) => (
            <Card key={file.id} radius="sm" className="border border-default-100 bg-content2">
              <CardBody className="gap-4 p-4">
                {(() => {
                  const processing = isActiveStatus(file.status) || (activeJobId !== null && activeMediaId === file.id)
                  return (
                    <>
                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0">
                  <p className="truncate font-semibold">{file.originalName}</p>
                  <p className="text-small text-default-500">
                    {formatSize(file.sizeBytes)} · {formatDuration(file.durationSec)}
                  </p>
                  </div>
                  <Chip color={statusColor(file.status)} variant="flat" radius="sm">{mediaStatusLabel(file.status, t)}</Chip>
                </div>
                {activeJobId && activeMediaId === file.id && (
                  <Alert
                    color="primary"
                    variant="flat"
                    title={t('media.processingTitle', { progress: jobProgress })}
                    description={`${jobStep?.replace(/_/g, ' ') ?? t('media.startingJob')} · ${t('media.elapsed', { duration: formatElapsed(jobStartedAt, now) })}`}
                    icon={<Spinner size="sm" color="primary" />}
                    endContent={(
                      <div className="flex items-center gap-3">
                        <Progress aria-label={t('media.progressAria')} value={jobProgress} color="primary" radius="sm" className="w-48" />
                        <Button size="sm" color="danger" variant="flat" radius="sm" isLoading={cancelling} onPress={handleCancel}>
                          {t('media.cancelProcessing')}
                        </Button>
                      </div>
                    )}
                  />
                )}
                <Accordion variant="splitted" className="px-0">
                  <AccordionItem
                    key="processing-stages"
                    aria-label={t('media.processingStages')}
                    title={t('media.processingStages')}
                    subtitle={t('media.processingStagesDescription')}
                  >
                    <div className="grid grid-cols-2 gap-3 pb-3">
                      {PROCESSING_STAGES.map((stage) => {
                        const options = processingOptions[file.id] ?? defaultProcessingOptions()
                        const plan = processingPlans[file.id]
                        const autoAdded = plan?.autoAddedStages.includes(stage) ?? false
                        const selected = plan?.executionStages.includes(stage) ?? options.stages.includes(stage)
                        const active = activeJobId !== null && activeMediaId === file.id && isCurrentStage(stage, jobStep)
                        return (
                          <div key={stage} className="flex min-h-12 items-center justify-between gap-3 rounded-small bg-content1 px-3 py-2">
                            <Switch
                              size="sm"
                              isSelected={selected}
                              isDisabled={processing || autoAdded}
                              onValueChange={(value) => updateStageSelection(file.id, stage, value)}
                            >
                              {t(`media.stage.${stage}` as TranslationKey)}
                            </Switch>
                            <div className="flex items-center gap-2">
                              {autoAdded && <Chip size="sm" variant="flat">{t('media.requiredStage')}</Chip>}
                              {active && <Spinner size="sm" color="primary" />}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </AccordionItem>
                </Accordion>
                <div className="flex items-center justify-end gap-4">
                  <div className="flex items-center gap-2">
                    <Button size="sm" variant="flat" radius="sm" onPress={() => (window.location.href = `/media/${file.id}`)}>{t('media.open')}</Button>
                    <Button size="sm" color="primary" variant="flat" radius="sm" isDisabled={processing} onPress={() => handleProcess(file.id)}>{t('media.process')}</Button>
                    <Button size="sm" color="danger" variant="flat" radius="sm" isDisabled={processing} onPress={() => handleDelete(file.id)}>{t('common.delete')}</Button>
                  </div>
                </div>
                    </>
                  )
                })()}
              </CardBody>
            </Card>
          ))}
        </div>
      )}
    </PageShell>
  )
}

function defaultProcessingOptions(useDictionary = false, discoverTerms = false, includeTranscription = true): ProcessingOptions {
  return {
    stages: [
      ...(includeTranscription ? ['transcription' as const] : []),
      ...(useDictionary ? ['normalization' as const] : []),
      'fact-extraction',
      'fact-deduplication',
      'summary',
      'tasks',
      ...(discoverTerms ? ['term-discovery' as const] : []),
    ],
    useDictionary,
  }
}

function isCurrentStage(stage: ProcessingStage, currentStep: string | null): boolean {
  if (!currentStep) return false
  if (stage === 'transcription') return currentStep === 'transcription' || currentStep.startsWith('transcribing_') || currentStep === 'extracting_audio'
  if (stage === 'normalization') return currentStep === 'normalization'
  if (stage === 'fact-extraction') return currentStep.startsWith('extracting_facts_')
  if (stage === 'fact-deduplication') return currentStep === 'fact_deduplication'
  if (stage === 'summary') return currentStep === 'summary' || currentStep === 'evidence_summary'
  if (stage === 'tasks') return currentStep === 'tasks' || currentStep.startsWith('extracting_tasks')
  return currentStep === 'term_discovery'
}

function isActiveStatus(status: string): boolean {
  return ['EXTRACTING_AUDIO', 'TRANSCRIBING', 'SUMMARIZING', 'EXTRACTING_TASKS'].includes(status)
}

function mediaStatusLabel(status: string, t: ReturnType<typeof useI18n>['t']): string {
  if (status === 'UPLOADED') return t('mediaStatus.uploaded')
  if (status === 'EXTRACTING_AUDIO') return t('mediaStatus.extractingAudio')
  if (status === 'TRANSCRIBING') return t('mediaStatus.transcribing')
  if (status === 'SUMMARIZING') return t('mediaStatus.summarizing')
  if (status === 'EXTRACTING_TASKS') return t('mediaStatus.extractingTasks')
  if (status === 'DONE') return t('status.done')
  if (status === 'FAILED') return t('status.failed')
  if (status === 'CANCELLED') return t('status.cancelled')
  return status
}

function formatSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

function formatDuration(sec: number | null) {
  if (!sec) return '—'
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

function formatElapsed(startedAt: number | null, now: number): string {
  if (!startedAt) return '—'
  const totalSeconds = Math.max(0, Math.floor((now - startedAt) / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

function statusColor(status: string): 'default' | 'primary' | 'success' | 'danger' | 'warning' {
  if (status === 'DONE') return 'success'
  if (status === 'FAILED') return 'danger'
  if (status === 'CANCELLED') return 'default'
  if (status === 'UPLOADED') return 'default'
  return 'primary'
}
