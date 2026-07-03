import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Alert, Button, Card, CardBody, Chip } from '@heroui/react'
import type { MediaFileDto } from '@wisploc/shared'
import { BackButton, EmptyState, LoadingPage, PageShell } from './PageShell'

export function MediaDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [media, setMedia] = useState<MediaFileDto | null>(null)
  const [loading, setLoading] = useState(true)

  const loadMedia = useCallback(async () => {
    if (!id) return
    try {
      const res = await fetch(`/api/media/${id}`)
      if (res.ok) setMedia(await res.json())
    } catch {}
    setLoading(false)
  }, [id])

  useEffect(() => { loadMedia() }, [loadMedia])

  if (loading) return <LoadingPage label="Media" />

  if (!media) {
    return (
      <PageShell title="Media not found" subtitle="The local media record is unavailable" eyebrow="Media" actions={<BackButton />}>
        <EmptyState title="Missing media" description="Open the media library and select another file." />
      </PageShell>
    )
  }

  return (
    <PageShell
      title={media.originalName}
      subtitle={`${formatSize(media.sizeBytes)} · ${formatDuration(media.durationSec)}`}
      eyebrow="Media detail"
      actions={<Chip color={statusColor(media.status)} variant="flat" radius="sm">{media.status}</Chip>}
      width="xl"
    >
      {media.errorMessage && <Alert color="danger" variant="flat" title="Processing error" description={media.errorMessage} />}

      <div className="grid grid-cols-3 gap-4">
        <ActionCard title="Transcript" desc="Full transcript, search, copy, and export." onClick={() => navigate(`/media/${id}/transcript`)} />
        <ActionCard title="Summary" desc="Short summary, key points, decisions, risks, and questions." onClick={() => navigate(`/media/${id}/summary`)} />
        <ActionCard title="Tasks" desc="Review extracted action items before external creation." onClick={() => navigate(`/media/${id}/tasks`)} />
      </div>

      <div className="flex justify-between">
        <BackButton />
        <Button variant="flat" radius="sm" onPress={() => navigate('/media')}>Media library</Button>
      </div>
    </PageShell>
  )
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

function formatDuration(sec: number | null) {
  if (!sec) return 'duration unknown'
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
