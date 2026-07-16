import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Alert, Button, Card, CardBody, Chip } from '@heroui/react'
import type { MediaFileDto } from '@wisploc/shared'
import { BackButton, EmptyState, LoadingPage, PageShell } from './PageShell'
import { friendlyError } from '../shared/errors'
import { useI18n } from '../shared/i18n'

export function MediaDetailPage() {
  const { t, language } = useI18n()
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [media, setMedia] = useState<MediaFileDto | null>(null)
  const [loading, setLoading] = useState(true)
  const [termCount, setTermCount] = useState(0)

  const loadMedia = useCallback(async () => {
    if (!id) return
    try {
      const res = await fetch(`/api/media/${id}`)
      if (res.ok) setMedia(await res.json())
      const termsResponse = await fetch(`/api/media/${id}/terms`)
      if (termsResponse.ok) setTermCount((await termsResponse.json()).length)
    } catch {}
    setLoading(false)
  }, [id])

  useEffect(() => { loadMedia() }, [loadMedia])

  if (loading) return <LoadingPage label={t('media.title')} />

  if (!media) {
    return (
      <PageShell title={t('media.notFound')} subtitle={t('media.unavailable')} eyebrow={t('media.title')} actions={<BackButton />}>
        <EmptyState title={t('media.missing')} description={t('media.missingDescription')} />
      </PageShell>
    )
  }

  return (
    <PageShell
      title={media.originalName}
      subtitle={`${formatSize(media.sizeBytes)} · ${formatDuration(media.durationSec, t)}`}
      eyebrow={t('media.detail')}
      actions={<Chip color={statusColor(media.status)} variant="flat" radius="sm">{mediaStatusLabel(media.status, t)}</Chip>}
      width="xl"
    >
      {media.errorMessage && (
        <Alert
          color="danger"
          variant="flat"
          title={t('media.processingError')}
          description={friendlyError(media.errorMessage, t('media.processingFailed'), language)}
        />
      )}

      <div className="grid grid-cols-4 gap-4">
        <ActionCard title={t('transcript.title')} desc={t('media.transcriptCardDescription')} onClick={() => navigate(`/media/${id}/transcript`)} />
        <ActionCard title={t('facts.title')} desc={t('facts.cardDescription')} onClick={() => navigate(`/media/${id}/facts`)} />
        <ActionCard title={t('summary.title')} desc={t('media.summaryCardDescription')} onClick={() => navigate(`/media/${id}/summary`)} />
        <ActionCard title={t('tasks.title')} desc={t('media.tasksCardDescription')} onClick={() => navigate(`/media/${id}/tasks`)} />
        {termCount > 0 && <ActionCard title={t('terms.title')} desc={t('terms.found', { count: termCount })} onClick={() => navigate(`/media/${id}/terms`)} />}
      </div>

      <div className="flex justify-between">
        <BackButton />
        <Button variant="flat" radius="sm" onPress={() => navigate('/media')}>{t('media.library')}</Button>
      </div>
    </PageShell>
  )
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

function ActionCard({ title, desc, onClick }: { title: string; desc: string; onClick: () => void }) {
  return (
    <Card isPressable radius="sm" className="border border-default-100 bg-content2" onPress={onClick}>
      <CardBody className="items-start gap-2 p-5">
        <h2 className="font-semibold">{title}</h2>
        <p className="text-small text-default-500">{desc}</p>
      </CardBody>
    </Card>
  )
}

function formatSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

function formatDuration(sec: number | null, t: ReturnType<typeof useI18n>['t']) {
  if (!sec) return t('common.durationUnknown')
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

function statusColor(status: string): 'default' | 'primary' | 'success' | 'danger' | 'warning' {
  if (status === 'DONE') return 'success'
  if (status === 'FAILED') return 'danger'
  if (status === 'CANCELLED') return 'default'
  if (status === 'UPLOADED') return 'default'
  return 'primary'
}
