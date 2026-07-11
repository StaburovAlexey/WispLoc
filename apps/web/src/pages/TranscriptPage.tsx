import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Button, Card, CardBody, Chip, Input } from '@heroui/react'
import { BackButton, EmptyState, LoadingPage, PageShell } from './PageShell'
import { TEXT_FIELD_PROPS } from '../shared/formControls'
import { useI18n } from '../shared/i18n'

interface TranscriptSegment {
  id: string
  startSec: number
  endSec: number
  text: string
  speaker: string | null
}

export function TranscriptPage() {
  const { t } = useI18n()
  const { id } = useParams<{ id: string }>()
  const [text, setText] = useState('')
  const [segments, setSegments] = useState<TranscriptSegment[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [copied, setCopied] = useState(false)

  const loadTranscript = useCallback(async () => {
    if (!id) return
    setLoading(true)
    try {
      const res = await fetch(`/api/media/${id}/transcript`)
      const data = await res.json()
      setText(data.text ?? '')
      setSegments(data.segments ?? [])
    } catch {}
    setLoading(false)
  }, [id])

  useEffect(() => { loadTranscript() }, [loadTranscript])

  const filteredSegments = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    if (!query) return segments
    return segments.filter((segment) => segment.text.toLowerCase().includes(query))
  }, [searchQuery, segments])

  const handleCopy = async () => {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleExport = (format: 'txt' | 'json') => {
    if (id) window.open(`/api/media/${id}/export/transcript.${format}`, '_blank')
  }

  if (loading) return <LoadingPage label={t('transcript.title')} />

  return (
    <PageShell
      title={t('transcript.title')}
      subtitle={t('transcript.subtitle', { segments: segments.length, characters: text.length.toLocaleString() })}
      eyebrow={t('media.title')}
      actions={
        <div className="flex flex-col items-end gap-2">
          <BackButton />
          <div className="flex gap-2">
            <Button size="sm" variant="flat" radius="sm" onPress={handleCopy}>{copied ? t('transcript.copied') : t('transcript.copy')}</Button>
            <Button size="sm" variant="flat" radius="sm" onPress={() => handleExport('txt')}>{t('transcript.exportTxt')}</Button>
            <Button size="sm" variant="flat" radius="sm" onPress={() => handleExport('json')}>{t('transcript.exportJson')}</Button>
          </div>
        </div>
      }
      width="xl"
    >
      <Input
        {...TEXT_FIELD_PROPS}
        aria-label={t('transcript.search')}
        value={searchQuery}
        onValueChange={setSearchQuery}
        placeholder={t('transcript.search')}
      />

      <Card radius="sm" className="border border-default-100 bg-content2">
        <CardBody className="p-0">
          <div className="p-4">
            {filteredSegments.length === 0 ? (
              <EmptyState title={t('transcript.noData')} description={searchQuery ? t('transcript.noMatches') : t('transcript.processFirst')} />
            ) : (
              <div className="grid gap-2">
                {filteredSegments.map((segment) => (
                  <div key={segment.id} className="grid grid-cols-[84px_1fr] gap-4 rounded-small bg-content1 p-3">
                    <Chip size="sm" variant="flat" radius="sm" className="font-mono">{formatTime(segment.startSec)}</Chip>
                    <p className="text-small leading-6 text-foreground">{segment.text}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </CardBody>
      </Card>
    </PageShell>
  )
}

function formatTime(sec: number) {
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}
