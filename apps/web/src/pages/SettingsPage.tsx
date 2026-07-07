import { useCallback, useEffect, useState } from 'react'
import { Alert, Button, Card, CardBody, CardHeader, Divider, Input, Select, SelectItem, Switch } from '@heroui/react'
import { LoadingPage, PageShell } from './PageShell'

interface SettingsData {
  language: string
  summaryLanguage: string
  cleanChunks: boolean
  deleteOriginalAfterProcessing: boolean
  ollamaHost: string
}

interface WhisperModel {
  key: string
  label: string
  fileName: string
  description: string
  installed: boolean
  selected: boolean
  path: string
}

type MaintenanceAction = {
  key: 'delete-dependencies' | 'clear-temp' | 'clear-results' | 'reset-all'
  title: string
  description: string
  endpoint: string
  confirmation?: 'DELETE'
}

const MAINTENANCE_ACTIONS: MaintenanceAction[] = [
  {
    key: 'delete-dependencies',
    title: 'Delete runtime dependencies',
    description: 'Removes FFmpeg, whisper-cli, all Whisper models, local Ollama runtime, and all local Ollama models when possible. Setup will need to run again.',
    endpoint: '/api/maintenance/delete-dependencies',
  },
  {
    key: 'clear-temp',
    title: 'Clear temporary files',
    description: 'Removes generated WAV chunks and exports. Transcripts, summaries, uploads, and database records stay intact.',
    endpoint: '/api/maintenance/clear-temp',
  },
  {
    key: 'clear-results',
    title: 'Clear processed results',
    description: 'Removes chunks, transcripts, summaries, tasks, and jobs from the database. Uploaded originals stay intact.',
    endpoint: '/api/maintenance/clear-results',
  },
  {
    key: 'reset-all',
    title: 'Delete all local app data',
    description: 'Removes uploads, generated data, integrations, setup state, config, binaries, Whisper models, and all local Ollama models. Requires DELETE confirmation.',
    endpoint: '/api/maintenance/reset-all',
    confirmation: 'DELETE',
  },
]

export function SettingsPage() {
  const [form, setForm] = useState<SettingsData | null>(null)
  const [whisperModels, setWhisperModels] = useState<WhisperModel[]>([])
  const [loadingWhisperModels, setLoadingWhisperModels] = useState(false)
  const [installingWhisperModel, setInstallingWhisperModel] = useState<string | null>(null)
  const [whisperModelError, setWhisperModelError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [maintenanceAction, setMaintenanceAction] = useState<MaintenanceAction | null>(null)
  const [maintenanceConfirmation, setMaintenanceConfirmation] = useState('')
  const [maintenanceRunning, setMaintenanceRunning] = useState(false)
  const [maintenanceResult, setMaintenanceResult] = useState<string | null>(null)
  const [maintenanceError, setMaintenanceError] = useState<string | null>(null)

  const loadSettings = useCallback(async () => {
    try {
      const res = await fetch('/api/settings')
      setForm(await res.json())
    } catch {}
  }, [])

  const loadWhisperModels = useCallback(async () => {
    setLoadingWhisperModels(true)
    setWhisperModelError(null)

    try {
      const res = await fetch('/api/settings/whisper-models')
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? 'Failed to load Whisper models')
      setWhisperModels(body)
    } catch (err: any) {
      setWhisperModelError(err.message ?? 'Failed to load Whisper models')
    } finally {
      setLoadingWhisperModels(false)
    }
  }, [])

  useEffect(() => {
    loadSettings()
    loadWhisperModels()
  }, [loadSettings, loadWhisperModels])

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

  const runMaintenance = async () => {
    if (!maintenanceAction) return
    if (maintenanceAction.confirmation && maintenanceConfirmation !== maintenanceAction.confirmation) return

    setMaintenanceRunning(true)
    setMaintenanceResult(null)
    setMaintenanceError(null)

    try {
      const response = await fetch(maintenanceAction.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmation: maintenanceConfirmation }),
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error ?? 'Maintenance failed')
      setMaintenanceResult(`${maintenanceAction.title} completed. Deleted: ${body.deleted?.length ?? 0}. Skipped: ${body.skipped?.length ?? 0}.`)
      setMaintenanceAction(null)
      setMaintenanceConfirmation('')
      loadSettings()
    } catch (err: any) {
      setMaintenanceError(err.message ?? 'Maintenance failed')
    } finally {
      setMaintenanceRunning(false)
    }
  }

  const selectInstalledWhisperModel = async (modelKey: string) => {
    setWhisperModelError(null)

    try {
      const response = await fetch(`/api/settings/whisper-models/${modelKey}/select`, { method: 'POST' })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error ?? 'Failed to select Whisper model')
      setWhisperModels((models) => models.map((model) => ({ ...model, selected: model.key === body.key })))
      loadSettings()
    } catch (err: any) {
      setWhisperModelError(err.message ?? 'Failed to select Whisper model')
    }
  }

  const installSelectedWhisperModel = async (modelKey: string) => {
    setInstallingWhisperModel(modelKey)
    setWhisperModelError(null)

    try {
      const response = await fetch(`/api/settings/whisper-models/${modelKey}/install`, { method: 'POST' })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error ?? 'Failed to install Whisper model')
      setWhisperModels((models) => models.map((model) => model.key === body.key ? body : model))
      await selectInstalledWhisperModel(modelKey)
    } catch (err: any) {
      setWhisperModelError(err.message ?? 'Failed to install Whisper model')
    } finally {
      setInstallingWhisperModel(null)
      loadWhisperModels()
    }
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
            label="Transcription language"
            radius="sm"
            selectedKeys={[form.language]}
            onSelectionChange={(keys) => setForm({ ...form, language: String(Array.from(keys)[0] ?? 'ru') })}
          >
            <SelectItem key="ru">Russian (ru)</SelectItem>
            <SelectItem key="en">English (en)</SelectItem>
          </Select>

          <Select
            label="Summary and tasks language"
            radius="sm"
            selectedKeys={[form.summaryLanguage]}
            onSelectionChange={(keys) => setForm({ ...form, summaryLanguage: String(Array.from(keys)[0] ?? 'ru') })}
          >
            <SelectItem key="ru">Russian (ru)</SelectItem>
            <SelectItem key="en">English (en)</SelectItem>
          </Select>

          <Input
            label="Ollama host"
            radius="sm"
            value={form.ollamaHost}
            onValueChange={(value) => setForm({ ...form, ollamaHost: value })}
          />

          <div className="col-span-2 rounded-small bg-content1 p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <p className="font-medium">Transcription model</p>
                <p className="text-small text-default-500">Multilingual Whisper models only. Missing models are installed on demand.</p>
              </div>
              <Button
                radius="sm"
                variant="flat"
                isLoading={loadingWhisperModels}
                onPress={loadWhisperModels}
              >
                Refresh
              </Button>
            </div>

            {whisperModelError && (
              <Alert
                color="danger"
                variant="flat"
                title="Whisper model error"
                description={whisperModelError}
                className="mb-3"
              />
            )}

            <div className="grid grid-cols-3 gap-3">
              {whisperModels.map((model) => (
                <Card
                  key={model.key}
                  radius="sm"
                  className={model.selected ? 'border border-primary bg-content2' : 'border border-default-100 bg-content2'}
                >
                  <CardBody className="gap-3 p-4">
                    <div>
                      <p className="font-medium">{model.label}</p>
                      <p className="text-small text-default-500">{model.fileName}</p>
                    </div>
                    <p className="min-h-10 text-small text-default-500">{model.description}</p>
                    <Alert
                      color={model.installed ? 'success' : 'warning'}
                      variant="flat"
                      title={model.installed ? (model.selected ? 'Selected' : 'Installed') : 'Not installed'}
                    />
                    {model.installed ? (
                      <Button
                        color={model.selected ? 'primary' : 'default'}
                        variant={model.selected ? 'solid' : 'flat'}
                        radius="sm"
                        isDisabled={model.selected}
                        onPress={() => selectInstalledWhisperModel(model.key)}
                      >
                        {model.selected ? 'Selected' : 'Use this model'}
                      </Button>
                    ) : (
                      <Button
                        color="primary"
                        radius="sm"
                        isLoading={installingWhisperModel === model.key}
                        isDisabled={installingWhisperModel !== null}
                        onPress={() => installSelectedWhisperModel(model.key)}
                      >
                        Install model
                      </Button>
                    )}
                  </CardBody>
                </Card>
              ))}
            </div>
          </div>

          <div className="col-span-2 rounded-small bg-content1 p-4">
            <Switch
              color="primary"
              isSelected={form.cleanChunks}
              onValueChange={(cleanChunks) => setForm({ ...form, cleanChunks })}
            >
              Clean temporary WAV chunks after successful processing
            </Switch>
          </div>

          <div className="col-span-2 rounded-small bg-content1 p-4">
            <Switch
              color="danger"
              isSelected={form.deleteOriginalAfterProcessing}
              onValueChange={(deleteOriginalAfterProcessing) => setForm({ ...form, deleteOriginalAfterProcessing })}
            >
              Delete original uploaded file after successful processing
            </Switch>
          </div>
        </CardBody>
      </Card>

      <Card radius="sm" className="border border-danger-200 bg-content2">
        <CardHeader className="flex flex-col items-start gap-1 p-6">
          <h2 className="font-semibold">Maintenance</h2>
          <p className="text-small text-default-500">Cleanup actions are blocked while jobs are pending or processing.</p>
        </CardHeader>
        <Divider />
        <CardBody className="gap-4 p-6">
          {maintenanceResult && <Alert color="success" variant="flat" title="Maintenance completed" description={maintenanceResult} />}
          {maintenanceError && <Alert color="danger" variant="flat" title="Maintenance failed" description={maintenanceError} />}

          <div className="grid gap-3">
            {MAINTENANCE_ACTIONS.map((action) => (
              <div key={action.key} className="flex items-center justify-between gap-4 rounded-small bg-content1 p-4">
                <div className="space-y-1">
                  <p className="font-medium">{action.title}</p>
                  <p className="text-small text-default-500">{action.description}</p>
                </div>
                <Button color="danger" variant="flat" radius="sm" onPress={() => {
                  setMaintenanceAction(action)
                  setMaintenanceConfirmation('')
                  setMaintenanceError(null)
                  setMaintenanceResult(null)
                }}>
                  Run
                </Button>
              </div>
            ))}
          </div>

          {maintenanceAction && (
            <Card radius="sm" className="border border-danger bg-content1">
              <CardBody className="gap-4 p-5">
                <Alert
                  color="danger"
                  variant="flat"
                  title={maintenanceAction.title}
                  description={maintenanceAction.description}
                />
                {maintenanceAction.confirmation && (
                  <Input
                    label="Type DELETE to confirm"
                    radius="sm"
                    value={maintenanceConfirmation}
                    onValueChange={setMaintenanceConfirmation}
                  />
                )}
                <div className="flex gap-2">
                  <Button
                    color="danger"
                    radius="sm"
                    isLoading={maintenanceRunning}
                    isDisabled={!!maintenanceAction.confirmation && maintenanceConfirmation !== maintenanceAction.confirmation}
                    onPress={runMaintenance}
                  >
                    Confirm
                  </Button>
                  <Button variant="flat" radius="sm" onPress={() => setMaintenanceAction(null)}>
                    Cancel
                  </Button>
                </div>
              </CardBody>
            </Card>
          )}
        </CardBody>
      </Card>
    </PageShell>
  )
}
