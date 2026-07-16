import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Card, CardBody, Chip, Input, Tab, Tabs } from '@heroui/react'
import { BackButton, EmptyState, LoadingPage, PageShell } from './PageShell'
import { TEXT_FIELD_PROPS } from '../shared/formControls'
import { useI18n } from '../shared/i18n'

interface AtomicFact {
  id: string
  type: string
  text: string
  evidenceQuote: string
  startSec: number
  endSec: number
  chunkIndex: number
  speaker: string | null
  explicit: boolean
  validationStatus: string
  validationErrors: string[]
  repairUsed: boolean
  modelName: string
  promptVersion: string
}

interface MergedFact {
  id: string
  type: string
  text: string
  evidence: Array<{ quote: string; startSec: number; endSec: number; chunkIndex?: number }>
  sourceFactIds: string[]
}

interface FactsData { atomic: AtomicFact[]; merged: MergedFact[] }

export function FactsPage() {
  const { t } = useI18n()
  const { id } = useParams<{ id: string }>()
  const [data, setData] = useState<FactsData | null>(null)
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)

  const loadFacts = useCallback(async () => {
    if (!id) return
    setLoading(true)
    try {
      const response = await fetch(`/api/media/${id}/facts`)
      if (response.ok) setData(await response.json())
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => { loadFacts() }, [loadFacts])

  const normalizedQuery = query.trim().toLocaleLowerCase()
  const atomic = useMemo(() => (data?.atomic ?? []).filter((fact) => matches(normalizedQuery, fact.type, fact.text, fact.evidenceQuote)), [data, normalizedQuery])
  const merged = useMemo(() => (data?.merged ?? []).filter((fact) => matches(normalizedQuery, fact.type, fact.text, ...fact.evidence.map((item) => item.quote))), [data, normalizedQuery])

  if (loading) return <LoadingPage label={t('facts.title')} />
  if (!data || data.atomic.length + data.merged.length === 0) {
    return <PageShell title={t('facts.title')} subtitle={t('facts.subtitle')} eyebrow={t('media.title')} actions={<BackButton />}><EmptyState title={t('facts.empty')} description={t('facts.emptyDescription')} /></PageShell>
  }

  return (
    <PageShell title={t('facts.title')} subtitle={t('facts.subtitle')} eyebrow={t('media.title')} actions={<BackButton />} width="xl">
      <Input {...TEXT_FIELD_PROPS} value={query} onValueChange={setQuery} label={t('facts.search')} />
      <Tabs aria-label={t('facts.title')} color="primary" variant="underlined">
        <Tab key="atomic" title={t('facts.atomicTab', { count: data.atomic.length })}>
          <div className="grid gap-3 pt-3">
            {atomic.length === 0 ? <EmptyState title={t('facts.noMatches')} description={t('facts.changeSearch')} /> : atomic.map((fact) => <AtomicFactCard key={fact.id} fact={fact} />)}
          </div>
        </Tab>
        <Tab key="merged" title={t('facts.mergedTab', { count: data.merged.length })}>
          <div className="grid gap-3 pt-3">
            {merged.length === 0 ? <EmptyState title={t('facts.noMatches')} description={t('facts.changeSearch')} /> : merged.map((fact) => <MergedFactCard key={fact.id} fact={fact} />)}
          </div>
        </Tab>
      </Tabs>
    </PageShell>
  )
}

function AtomicFactCard({ fact }: { fact: AtomicFact }) {
  const { t } = useI18n()
  return (
    <Card radius="sm" className="border border-default-100 bg-content2">
      <CardBody className="gap-3 p-4">
        <div className="flex items-start justify-between gap-4">
          <p className="font-medium">{fact.text}</p>
          <div className="flex shrink-0 gap-2">
            <Chip size="sm" variant="flat">{factTypeLabel(fact.type, t)}</Chip>
            <Chip size="sm" color={fact.validationStatus === 'valid' ? 'success' : 'warning'} variant="flat">
              {fact.validationStatus === 'valid' ? t('facts.valid') : t('facts.invalid')}
            </Chip>
            {fact.repairUsed && <Chip size="sm" color="warning" variant="flat">{t('facts.repaired')}</Chip>}
          </div>
        </div>
        <blockquote className="border-l-2 border-primary pl-3 text-small text-default-500">{fact.evidenceQuote}</blockquote>
        <p className="text-tiny text-default-400">{formatTime(fact.startSec)}–{formatTime(fact.endSec)} · {t('facts.chunk', { index: fact.chunkIndex + 1 })} · {fact.modelName} · {fact.promptVersion}</p>
      </CardBody>
    </Card>
  )
}

function MergedFactCard({ fact }: { fact: MergedFact }) {
  const { t } = useI18n()
  return (
    <Card radius="sm" className="border border-default-100 bg-content2">
      <CardBody className="gap-3 p-4">
        <div className="flex items-start justify-between gap-4">
          <p className="font-medium">{fact.text}</p>
          <div className="flex shrink-0 gap-2"><Chip size="sm" variant="flat">{factTypeLabel(fact.type, t)}</Chip><Chip size="sm" color="primary" variant="flat">{t('facts.sources', { count: fact.sourceFactIds.length })}</Chip></div>
        </div>
        <div className="grid gap-2">
          {fact.evidence.map((evidence, index) => (
            <div key={`${fact.id}-${index}`} className="border-l-2 border-primary pl-3 text-small text-default-500">
              <p>{evidence.quote}</p>
              <p className="mt-1 text-tiny text-default-400">
                {formatTime(evidence.startSec)}–{formatTime(evidence.endSec)}
                {typeof evidence.chunkIndex === 'number' && ` · ${t('facts.chunk', { index: evidence.chunkIndex + 1 })}`}
              </p>
            </div>
          ))}
        </div>
      </CardBody>
    </Card>
  )
}

function matches(query: string, ...values: string[]): boolean {
  return !query || values.some((value) => value.toLocaleLowerCase().includes(query))
}

function factTypeLabel(type: string, t: ReturnType<typeof useI18n>['t']): string {
  const labels = {
    statement: 'facts.type.statement',
    decision: 'facts.type.decision',
    problem: 'facts.type.problem',
    requirement: 'facts.type.requirement',
    proposal: 'facts.type.proposal',
    question: 'facts.type.question',
    task_candidate: 'facts.type.task_candidate',
  } as const
  return type in labels ? t(labels[type as keyof typeof labels]) : type
}

function formatTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60)
  const remaining = Math.floor(seconds % 60)
  return `${minutes}:${String(remaining).padStart(2, '0')}`
}
