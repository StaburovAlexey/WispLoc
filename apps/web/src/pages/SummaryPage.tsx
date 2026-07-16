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
  problems: Array<string | { text?: string }>
  proposals: Array<string | { text?: string }>
  actionItems: Array<{ title: string; description: string; priority?: string; confidence: number }>
  modelName: string
  pipelineVersion: 'legacy-v1' | 'evidence-v2'
  evidenceSummary: EvidenceSummary | null
  createdAt: string
}

interface EvidenceSummaryItem { text: string; sourceFactIds: string[] }
interface EvidenceSummary {
  keyPoints: EvidenceSummaryItem[]
  decisions: EvidenceSummaryItem[]
  problems: EvidenceSummaryItem[]
  openQuestions: EvidenceSummaryItem[]
  proposals: EvidenceSummaryItem[]
}
interface FactEvidenceRecord {
  id: string
  evidence: Array<{ quote: string; startSec: number; endSec: number; chunkIndex: number }>
}

export function SummaryPage() {
  const { t } = useI18n()
  const { id } = useParams<{ id: string }>()
  const [summary, setSummary] = useState<SummaryData | null>(null)
  const [loading, setLoading] = useState(true)
  const [factEvidence, setFactEvidence] = useState<Record<string, FactEvidenceRecord['evidence']>>({})

  const loadSummary = useCallback(async () => {
    if (!id) return
    setLoading(true)
    try {
      const res = await fetch(`/api/media/${id}/summary`)
      if (res.ok) {
        const data: SummaryData = await res.json()
        setSummary(data)
        const factIds = data.evidenceSummary
          ? [...new Set(Object.values(data.evidenceSummary).flatMap((items: EvidenceSummaryItem[]) => items.flatMap((item: EvidenceSummaryItem) => item.sourceFactIds)))]
          : []
        if (factIds.length > 0) {
          const evidenceResponse = await fetch(`/api/media/${id}/summary/evidence`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ factIds }),
          })
          if (evidenceResponse.ok) {
            const records: FactEvidenceRecord[] = await evidenceResponse.json()
            setFactEvidence(Object.fromEntries(records.map((record) => [record.id, record.evidence])))
          }
        }
      }
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
        {summary.evidenceSummary ? <>
          <EvidenceListSection title={t('summary.keyPoints')} items={summary.evidenceSummary.keyPoints} color="primary" evidence={factEvidence} />
          <EvidenceListSection title={t('summary.decisions')} items={summary.evidenceSummary.decisions} color="success" evidence={factEvidence} />
          <EvidenceListSection title={t('summary.problems')} items={summary.evidenceSummary.problems} color="warning" evidence={factEvidence} />
          <EvidenceListSection title={t('summary.openQuestions')} items={summary.evidenceSummary.openQuestions} color="secondary" evidence={factEvidence} />
          <EvidenceListSection title={t('summary.proposals')} items={summary.evidenceSummary.proposals} color="primary" evidence={factEvidence} />
        </> : <>
          <ListSection title={t('summary.keyPoints')} items={summary.keyPoints} color="primary" />
          <ListSection title={t('summary.decisions')} items={summary.decisions} color="success" />
          <ListSection title={t('summary.risks')} items={summary.risks} color="warning" />
          <ListSection title={t('summary.openQuestions')} items={summary.openQuestions} color="secondary" />
        </>}
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

function EvidenceListSection({ title, items, color, evidence }: {
  title: string
  items: EvidenceSummaryItem[]
  color: 'primary' | 'success' | 'warning' | 'secondary'
  evidence: Record<string, FactEvidenceRecord['evidence']>
}) {
  const { t } = useI18n()
  const { id: mediaId } = useParams<{ id: string }>()
  const [openIndex, setOpenIndex] = useState<number | null>(null)
  return (
    <Card radius="sm" className="border border-default-100 bg-content2">
      <CardBody className="gap-3 p-5">
        <div className="flex items-center justify-between"><h2 className="font-semibold">{title}</h2><Chip size="sm" color={color} variant="flat" radius="sm">{items.length}</Chip></div>
        {items.length === 0 ? <p className="text-small text-default-500">{t('common.noItems')}</p> : items.map((item, index) => {
          const sources = item.sourceFactIds.flatMap((factId) => evidence[factId] ?? [])
          const opened = openIndex === index
          return (
            <div key={`${item.text}-${index}`} className="rounded-small bg-content1 p-3">
              <button type="button" className="flex w-full items-center justify-between gap-3 text-left text-small" onClick={() => setOpenIndex(opened ? null : index)}>
                <span>{item.text}</span><span className="text-primary">{opened ? t('summary.hideEvidence') : t('summary.showEvidence')}</span>
              </button>
              {opened && <div className="mt-3 grid gap-2 border-t border-divider pt-3">{sources.map((source, sourceIndex) => (
                <div key={`${source.startSec}-${sourceIndex}`} className="text-small text-default-500">
                  <button type="button" className="mr-2 font-mono text-primary" onClick={() => { window.location.href = `/media/${mediaId}/transcript?at=${source.startSec}` }}>{formatEvidenceTime(source.startSec)}</button>
                  {source.quote}
                </div>
              ))}</div>}
            </div>
          )
        })}
      </CardBody>
    </Card>
  )
}

function priorityColor(priority: string): 'default' | 'warning' | 'danger' {
  if (priority === 'high') return 'danger'
  if (priority === 'medium') return 'warning'
  return 'default'
}

function formatEvidenceTime(seconds: number): string {
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`
}
