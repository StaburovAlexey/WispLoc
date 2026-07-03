import { useCallback, useEffect, useState } from 'react'
import { Alert, Button, Card, CardBody, Input, Select, SelectItem, Switch } from '@heroui/react'
import { BackButton, LoadingPage, PageShell } from './PageShell'

interface SettingsData {
  language: string
  chunkMinutes: number
  cleanChunks: boolean
  ollamaHost: string
  llmModel: string
}

export function SettingsPage() {
  const [form, setForm] = useState<SettingsData | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const loadSettings = useCallback(async () => {
    try {
      const res = await fetch('/api/settings')
      setForm(await res.json())
    } catch {}
  }, [])

  useEffect(() => { loadSettings() }, [loadSettings])

  const handleSave = async () => {
    if (!form) return
    setSaving(true)
    await fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  if (!form) return <LoadingPage label="Settings" />

  return (
    <PageShell
      title="Settings"
      subtitle="Local processing defaults"
      eyebrow="Preferences"
      actions={<Button color="primary" radius="sm" isLoading={saving} onPress={handleSave}>{saved ? 'Saved' : 'Save settings'}</Button>}
      width="lg"
    >
      {saved && <Alert color="success" variant="flat" title="Settings saved" description="New processing jobs will use the updated defaults." />}

      <Card radius="sm" className="border border-default-100 bg-content2">
        <CardBody className="grid grid-cols-2 gap-4 p-6">
          <Select
            label="Language"
            radius="sm"
            selectedKeys={[form.language]}
            onSelectionChange={(keys) => setForm({ ...form, language: String(Array.from(keys)[0] ?? 'ru') })}
          >
            <SelectItem key="ru">Russian (ru)</SelectItem>
            <SelectItem key="en">English (en)</SelectItem>
            <SelectItem key="auto">Auto-detect</SelectItem>
          </Select>

          <Select
            label="Chunk size"
            radius="sm"
            selectedKeys={[String(form.chunkMinutes)]}
            onSelectionChange={(keys) => setForm({ ...form, chunkMinutes: Number(Array.from(keys)[0] ?? 5) })}
          >
            <SelectItem key="3">3 minutes</SelectItem>
            <SelectItem key="5">5 minutes (default)</SelectItem>
            <SelectItem key="10">10 minutes</SelectItem>
            <SelectItem key="15">15 minutes</SelectItem>
          </Select>

          <Input
            label="Ollama host"
            radius="sm"
            value={form.ollamaHost}
            onValueChange={(value) => setForm({ ...form, ollamaHost: value })}
          />

          <Input
            label="LLM model"
            radius="sm"
            value={form.llmModel}
            onValueChange={(value) => setForm({ ...form, llmModel: value })}
          />

          <div className="col-span-2 rounded-small bg-content1 p-4">
            <Switch
              color="primary"
              isSelected={form.cleanChunks}
              onValueChange={(cleanChunks) => setForm({ ...form, cleanChunks })}
            >
              Clean temporary WAV chunks after successful processing
            </Switch>
          </div>
        </CardBody>
      </Card>

      <BackButton />
    </PageShell>
  )
}
