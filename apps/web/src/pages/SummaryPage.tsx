import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Alert, Button, Card, CardBody, Chip } from '@heroui/react'
import { BackButton, EmptyState, LoadingPage, PageShell } from './PageShell'
import { useI18n } from '../shared/i18n'

interface SummaryData {
  id: string
  kind: string
  shortSummary: string | null
  detailedSummary: string | null
  keyPoints: string[]
  decisions: string[]
  risks: string[]
  openQuestions: string[]
  actionItems: Array<{ title: string; description: string; priority?: string; confidence: number }>
  modelName: string
  createdAt: string
}

export function SummaryPage() {
  const { t } = useI18n()
  const { id } = useParams<{ id: string }>()
  const [summary, setSummary] = useState<SummaryData | null>(null)
  const [loading, setLoading] = useState(true)

  const loadSummary = useCallback(async () => {
    if (!id) return
    setLoading(true)
    try {
      const res = await fetch(`/api/media/${id}/summary`)
      if (res.ok) setSummary(await res.json())
    } catch {}
    setLoading(false)
  }, [id])

  useEffect(() => { loadSummary() }, [loadSummary])

  const handleExport = (format: 'md' | 'json') => {
    if (id) window.open(`/api/media/${id}/export/summary.${format}`, '_blank')
  }

  if (loading) return <LoadingPage label={t('summary.title')} />

  if (!summary) {
    return (
      <PageShell title={t('summary.title')} subtitle={t('summary.noAvailable')} eyebrow={t('media.title')} actions={<BackButton />} width="lg">
        <EmptyState title={t('summary.noSummary')} description={t('summary.processFirst')} />
      </PageShell>
    )
  }

  return (
    <PageShell
      title={t('summary.title')}
      subtitle={t('summary.generatedBy', { model: summary.modelName, date: new Date(summary.createdAt).toLocaleString() })}
      eyebrow={t('media.title')}
      actions={
        <div className="flex gap-2">
          <BackButton />
          <Button size="sm" variant="flat" radius="sm" onPress={() => handleExport('md')}>{t('summary.exportMd')}</Button>
          <Button size="sm" variant="flat" radius="sm" onPress={() => handleExport('json')}>{t('summary.exportJson')}</Button>
        </div>
      }
      width="xl"
    >
      {summary.shortSummary && <Alert color="primary" variant="flat" title={t('summary.short')} description={summary.shortSummary} />}

      {summary.detailedSummary && (
        <Section title={t('summary.detailed')}>
          <p className="whitespace-pre-wrap text-small leading-7 text-default-600">{summary.detailedSummary}</p>
        </Section>
      )}

      <div className="grid grid-cols-2 gap-4">
        <ListSection title={t('summary.keyPoints')} items={summary.keyPoints} color="primary" />
        <ListSection title={t('summary.decisions')} items={summary.decisions} color="success" />
        <ListSection title={t('summary.risks')} items={summary.risks} color="warning" />
        <ListSection title={t('summary.openQuestions')} items={summary.openQuestions} color="secondary" />
      </div>

      {summary.actionItems?.length > 0 && (
        <Section title={t('summary.actionItems')}>
          <div className="grid gap-3">
            {summary.actionItems.map((item, index) => (
              <Card key={`${item.title}-${index}`} radius="sm" className="border border-default-100 bg-content1">
                <CardBody className="gap-2 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-semibold">{item.title}</p>
                    {item.priority && <Chip size="sm" color={priorityColor(item.priority)} variant="flat" radius="sm">{item.priority}</Chip>}
                  </div>
                  <p className="text-small text-default-500">{item.description}</p>
                  <Chip size="sm" variant="flat" radius="sm">{t('summary.confidence', { value: (item.confidence * 100).toFixed(0) })}</Chip>
                </CardBody>
              </Card>
            ))}
          </div>
          <Button color="primary" variant="flat" radius="sm" onPress={() => (window.location.href = `/media/${id}/tasks`)}>
            {t('summary.viewTasks')}
          </Button>
        </Section>
      )}

    </PageShell>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card radius="sm" className="border border-default-100 bg-content2">
      <CardBody className="gap-4 p-5">
        <h2 className="font-semibold">{title}</h2>
        {children}
      </CardBody>
    </Card>
  )
}

function ListSection({ title, items, color }: { title: string; items?: string[]; color: 'primary' | 'success' | 'warning' | 'secondary' }) {
  const { t } = useI18n()

  return (
    <Card radius="sm" className="border border-default-100 bg-content2">
      <CardBody className="gap-3 p-5">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">{title}</h2>
          <Chip size="sm" color={color} variant="flat" radius="sm">{items?.length ?? 0}</Chip>
        </div>
        {items?.length ? (
          <div className="grid gap-2">
            {items.map((item, index) => <p key={`${item}-${index}`} className="rounded-small bg-content1 p-3 text-small text-default-600">{item}</p>)}
          </div>
        ) : (
          <p className="text-small text-default-500">{t('common.noItems')}</p>
        )}
      </CardBody>
    </Card>
  )
}

function priorityColor(priority: string): 'default' | 'warning' | 'danger' {
  if (priority === 'high') return 'danger'
  if (priority === 'medium') return 'warning'
  return 'default'
}
