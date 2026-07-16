import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, Card, CardBody, Chip, Input, Switch } from '@heroui/react'
import type { DictionaryEntry } from '@wisploc/shared'
import { EmptyState, LoadingPage, PageShell } from './PageShell'
import { TEXT_FIELD_PROPS } from '../shared/formControls'
import { useI18n } from '../shared/i18n'

interface DictionaryForm {
  canonical: string
  aliases: string
}

const emptyForm: DictionaryForm = { canonical: '', aliases: '' }

export function DictionaryPage() {
  const { t } = useI18n()
  const [entries, setEntries] = useState<DictionaryEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState<DictionaryForm>(emptyForm)

  const loadEntries = useCallback(async () => {
    setLoading(true)
    const response = await fetch('/api/dictionary')
    if (response.ok) setEntries(await response.json())
    setLoading(false)
  }, [])

  useEffect(() => { loadEntries() }, [loadEntries])

  const visibleEntries = useMemo(() => {
    const query = search.trim().toLocaleLowerCase()
    if (!query) return entries
    return entries.filter((entry) => [entry.canonical, ...entry.aliases].some((value) => value.toLocaleLowerCase().includes(query)))
  }, [entries, search])

  const save = async () => {
    const response = await fetch(editingId ? `/api/dictionary/${editingId}` : '/api/dictionary', {
      method: editingId ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        canonical: form.canonical,
        aliases: form.aliases.split(',').map((value) => value.trim()).filter(Boolean),
      }),
    })
    if (!response.ok) return
    setAdding(false)
    setEditingId(null)
    setForm(emptyForm)
    loadEntries()
  }

  const startEdit = (entry: DictionaryEntry) => {
    setEditingId(entry.id)
    setAdding(false)
    setForm({ canonical: entry.canonical, aliases: entry.aliases.join(', ') })
  }

  if (loading) return <LoadingPage label={t('dictionary.title')} />

  return (
    <PageShell
      title={t('dictionary.title')}
      subtitle={t('dictionary.subtitle')}
      eyebrow={t('dictionary.eyebrow')}
      actions={<Button color="primary" radius="sm" onPress={() => { setAdding(true); setEditingId(null); setForm(emptyForm) }}>{t('dictionary.add')}</Button>}
      width="xl"
    >
      <Input {...TEXT_FIELD_PROPS} label={t('dictionary.search')} value={search} onValueChange={setSearch} />

      {adding && <DictionaryEditor form={form} setForm={setForm} onSave={save} onCancel={() => setAdding(false)} />}

      {visibleEntries.length === 0 ? (
        <EmptyState title={t('dictionary.empty')} description={t('dictionary.emptyDescription')} />
      ) : visibleEntries.map((entry) => (
        <Card key={entry.id} radius="sm" className="border border-default-100 bg-content2">
          <CardBody className="gap-4 p-5">
            {editingId === entry.id ? (
              <DictionaryEditor form={form} setForm={setForm} onSave={save} onCancel={() => setEditingId(null)} />
            ) : (
              <>
                <div className="flex items-center justify-between gap-4">
                  <h2 className="font-semibold">{entry.canonical}</h2>
                  <Chip color={entry.status === 'ACTIVE' ? 'success' : 'default'} variant="flat" radius="sm">
                    {entry.status === 'ACTIVE' ? t('common.enabled') : t('common.disabled')}
                  </Chip>
                </div>
                <div className="flex flex-wrap gap-2">
                  {entry.aliases.map((alias) => <Chip key={alias} size="sm" variant="flat" radius="sm">{alias}</Chip>)}
                </div>
                <p className="text-small text-default-500">{t('dictionary.usageCount', { count: entry.usageCount })}</p>
                <div className="flex items-center gap-3">
                  <Button size="sm" variant="flat" radius="sm" onPress={() => startEdit(entry)}>{t('common.edit')}</Button>
                  <Switch
                    size="sm"
                    isSelected={entry.status === 'ACTIVE'}
                    onValueChange={async (enabled) => {
                      await fetch(`/api/dictionary/${entry.id}/status`, {
                        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled }),
                      })
                      loadEntries()
                    }}
                  >{entry.status === 'ACTIVE' ? t('dictionary.active') : t('dictionary.disabled')}</Switch>
                </div>
              </>
            )}
          </CardBody>
        </Card>
      ))}
    </PageShell>
  )
}

function DictionaryEditor({
  form, setForm, onSave, onCancel,
}: {
  form: DictionaryForm
  setForm: (form: DictionaryForm) => void
  onSave: () => void
  onCancel: () => void
}) {
  const { t } = useI18n()
  return (
    <Card radius="sm" className="border border-default-100 bg-content1">
      <CardBody className="grid grid-cols-2 gap-4 p-5">
        <Input {...TEXT_FIELD_PROPS} label={t('dictionary.canonical')} value={form.canonical} onValueChange={(canonical) => setForm({ ...form, canonical })} />
        <Input {...TEXT_FIELD_PROPS} label={t('dictionary.aliases')} value={form.aliases} onValueChange={(aliases) => setForm({ ...form, aliases })} />
        <div className="col-span-2 flex gap-2">
          <Button color="primary" radius="sm" isDisabled={!form.canonical.trim()} onPress={onSave}>{t('common.save')}</Button>
          <Button variant="flat" radius="sm" onPress={onCancel}>{t('common.cancel')}</Button>
        </div>
      </CardBody>
    </Card>
  )
}

