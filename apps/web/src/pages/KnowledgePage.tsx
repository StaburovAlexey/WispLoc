import { useCallback, useEffect, useState } from 'react'
import { Alert, Button, Card, CardBody, Chip, Spinner, Tab, Tabs } from '@heroui/react'
import { PageShell } from './PageShell'
import { useI18n } from '../shared/i18n'

interface Rule { id: string; stage: string; language: string; title: string; content: string; version: string }
interface Example { id: string; stage: string; language: string; inputText: string; expectedOutputJson: string; labels: string[]; quality: string; source: string; enabled: boolean }
interface Correction { id: string; stage: string; sourceInput: string; generatedOutputJson: string; correctedOutputJson: string; reviewStatus: string; createdAt: string }

export function KnowledgePage() {
  const { t } = useI18n()
  const [rules, setRules] = useState<Rule[]>([])
  const [examples, setExamples] = useState<Example[]>([])
  const [corrections, setCorrections] = useState<Correction[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    const [rulesResponse, examplesResponse, correctionsResponse] = await Promise.all([
      fetch('/api/knowledge/rules'),
      fetch('/api/knowledge/examples?review=true'),
      fetch('/api/knowledge/corrections'),
    ])
    if (rulesResponse.ok) setRules(await rulesResponse.json())
    if (examplesResponse.ok) setExamples(await examplesResponse.json())
    if (correctionsResponse.ok) setCorrections(await correctionsResponse.json())
    setLoading(false)
  }, [])

  useEffect(() => { void load() }, [load])

  const review = async (id: string, status: 'accepted' | 'rejected') => {
    await fetch(`/api/knowledge/corrections/${id}/review`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }),
    })
    await load()
  }

  const toggleExample = async (example: Example) => {
    await fetch(`/api/knowledge/examples/${encodeURIComponent(example.id)}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: !example.enabled }),
    })
    await load()
  }

  return (
    <PageShell title={t('knowledge.title')} subtitle={t('knowledge.subtitle')} eyebrow="Local RAG" width="xl">
      <Alert color="primary" variant="flat" title={t('knowledge.localOnly')} description={t('knowledge.localOnlyDescription')} />
      {loading ? <div className="flex min-h-48 items-center justify-center"><Spinner size="lg" /></div> : (
        <Tabs aria-label={t('knowledge.title')} variant="underlined">
          <Tab key="rules" title={`${t('knowledge.rules')} (${rules.length})`}>
            <div className="grid grid-cols-2 gap-3 pt-4">{rules.map((rule) => (
              <Card key={rule.id} radius="sm"><CardBody className="gap-2 p-4">
                <div className="flex justify-between gap-3"><div className="flex gap-2"><Chip size="sm" variant="flat">{rule.stage}</Chip><Chip size="sm" variant="flat">{rule.language}</Chip></div><span className="text-tiny text-default-400">{rule.version}</span></div>
                <p className="text-small text-default-600">{rule.content}</p>
              </CardBody></Card>
            ))}</div>
          </Tab>
          <Tab key="examples" title={`${t('knowledge.examples')} (${examples.length})`}>
            <div className="grid gap-3 pt-4">{examples.map((example) => (
              <Card key={example.id} radius="sm"><CardBody className="gap-2 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2"><Chip size="sm" color="primary" variant="flat">{example.stage}</Chip><Chip size="sm" variant="flat">{example.language}</Chip><Chip size="sm" variant="flat">{example.quality}</Chip><Chip size="sm" variant="flat">{example.source}</Chip>{!example.enabled && <Chip size="sm" color="danger" variant="flat">{t('knowledge.disabled')}</Chip>}</div>
                  {!example.id.startsWith('builtin:') && <Button size="sm" color={example.enabled ? 'danger' : 'success'} variant="flat" onPress={() => toggleExample(example)}>{t(example.enabled ? 'knowledge.disable' : 'knowledge.enable')}</Button>}
                </div>
                <p className="text-small">{example.inputText}</p>
                <pre className="overflow-auto whitespace-pre-wrap rounded-small bg-content1 p-3 text-tiny text-default-500">{formatJson(example.expectedOutputJson)}</pre>
                <div className="flex gap-1">{example.labels.map((label) => <Chip key={label} size="sm" variant="bordered">{label}</Chip>)}</div>
              </CardBody></Card>
            ))}</div>
          </Tab>
          <Tab key="corrections" title={`${t('knowledge.corrections')} (${corrections.length})`}>
            <div className="grid gap-3 pt-4">
              {corrections.length === 0 && <Alert variant="flat" title={t('knowledge.noCorrections')} />}
              {corrections.map((correction) => (
                <Card key={correction.id} radius="sm"><CardBody className="gap-3 p-4">
                  <div className="flex items-center justify-between"><Chip size="sm" variant="flat">{correction.stage}</Chip><Chip size="sm" color={correction.reviewStatus === 'accepted' ? 'success' : correction.reviewStatus === 'rejected' ? 'danger' : 'warning'} variant="flat">{correction.reviewStatus}</Chip></div>
                  <p className="text-small text-default-600">{correction.sourceInput}</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div><p className="mb-1 text-tiny text-default-400">{t('knowledge.generated')}</p><pre className="overflow-auto whitespace-pre-wrap rounded-small bg-content1 p-3 text-tiny">{formatJson(correction.generatedOutputJson)}</pre></div>
                    <div><p className="mb-1 text-tiny text-default-400">{t('knowledge.corrected')}</p><pre className="overflow-auto whitespace-pre-wrap rounded-small bg-content1 p-3 text-tiny">{formatJson(correction.correctedOutputJson)}</pre></div>
                  </div>
                  {correction.reviewStatus === 'pending' && <div className="flex gap-2"><Button size="sm" color="success" variant="flat" onPress={() => review(correction.id, 'accepted')}>{t('knowledge.accept')}</Button><Button size="sm" color="danger" variant="flat" onPress={() => review(correction.id, 'rejected')}>{t('knowledge.reject')}</Button></div>}
                </CardBody></Card>
              ))}
            </div>
          </Tab>
        </Tabs>
      )}
    </PageShell>
  )
}

function formatJson(value: string): string {
  try {
    return JSON.stringify(JSON.parse(value), null, 2)
  } catch {
    return value
  }
}
