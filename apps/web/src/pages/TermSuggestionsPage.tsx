import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Button, Card, CardBody, Chip } from '@heroui/react'
import type { TermSuggestion } from '@wisploc/shared'
import { BackButton, EmptyState, LoadingPage, PageShell } from './PageShell'
import { useI18n } from '../shared/i18n'

export function TermSuggestionsPage() {
  const { t } = useI18n()
  const { id } = useParams<{ id: string }>()
  const [suggestions, setSuggestions] = useState<TermSuggestion[]>([])
  const [loading, setLoading] = useState(true)
  const load = useCallback(async () => {
    if (!id) return
    const response = await fetch(`/api/media/${id}/terms`)
    if (response.ok) setSuggestions(await response.json())
    setLoading(false)
  }, [id])
  useEffect(() => { load() }, [load])
  if (loading) return <LoadingPage label={t('terms.title')} />
  return (
    <PageShell title={t('terms.title')} subtitle={t('terms.subtitle')} eyebrow={t('dictionary.title')} actions={<BackButton />} width="xl">
      {suggestions.length === 0 ? <EmptyState title={t('terms.empty')} description={t('terms.emptyDescription')} /> : suggestions.map((suggestion) => (
        <Card key={suggestion.id} radius="sm" className="border border-default-100 bg-content2">
          <CardBody className="gap-4 p-5">
            <div className="flex items-center justify-between gap-4">
              <div><p className="text-small text-default-500">{suggestion.observedForm}</p><h2 className="font-semibold">{suggestion.proposedCanonical}</h2></div>
              <Chip variant="flat" radius="sm">{t('terms.occurrences', { count: suggestion.occurrenceCount })}</Chip>
            </div>
            <div className="flex flex-wrap gap-2">{suggestion.aliases.map((alias) => <Chip key={alias} size="sm" variant="flat" radius="sm">{alias}</Chip>)}</div>
            <div className="grid gap-2">{suggestion.examples.map((example, index) => (
              <div key={`${example.startSec}-${index}`} className="rounded-small bg-content1 p-3 text-small">
                <span className="mr-2 font-mono text-primary">{formatTime(example.startSec)}</span>{example.quote}
              </div>
            ))}</div>
            {suggestion.status === 'PROPOSED' && <div className="flex gap-2">
              <Button size="sm" color="primary" radius="sm" onPress={async () => { await fetch(`/api/terms/${suggestion.id}/accept`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ canonical: suggestion.proposedCanonical, aliases: [suggestion.observedForm, ...suggestion.aliases] }) }); load() }}>{t('terms.add')}</Button>
              <Button size="sm" variant="flat" radius="sm" onPress={async () => { await fetch(`/api/terms/${suggestion.id}/reject`, { method: 'POST' }); load() }}>{t('terms.ignore')}</Button>
            </div>}
          </CardBody>
        </Card>
      ))}
    </PageShell>
  )
}

function formatTime(seconds: number): string {
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`
}

