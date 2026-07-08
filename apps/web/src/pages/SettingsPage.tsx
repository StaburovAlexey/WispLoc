import { useCallback, useEffect, useState } from 'react'
import { Alert, Button, Card, CardBody, CardHeader, Divider, Input, Select, SelectItem, Switch } from '@heroui/react'
import { LoadingPage, PageShell } from './PageShell'
import { friendlyError } from '../shared/errors'
import { FIELD_PROPS, TEXT_FIELD_PROPS } from '../shared/formControls'
import { useI18n, type TranslationKey } from '../shared/i18n'

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
  titleKey: TranslationKey
  descriptionKey: TranslationKey
  endpoint: string
  confirmation?: 'DELETE'
}

const MAINTENANCE_ACTIONS: MaintenanceAction[] = [
  {
    key: 'delete-dependencies',
    titleKey: 'settings.deleteDepsTitle',
    descriptionKey: 'settings.deleteDepsDescription',
    endpoint: '/api/maintenance/delete-dependencies',
  },
  {
    key: 'clear-temp',
    titleKey: 'settings.clearTempTitle',
    descriptionKey: 'settings.clearTempDescription',
    endpoint: '/api/maintenance/clear-temp',
  },
  {
    key: 'clear-results',
    titleKey: 'settings.clearResultsTitle',
    descriptionKey: 'settings.clearResultsDescription',
    endpoint: '/api/maintenance/clear-results',
  },
  {
    key: 'reset-all',
    titleKey: 'settings.resetAllTitle',
    descriptionKey: 'settings.resetAllDescription',
    endpoint: '/api/maintenance/reset-all',
    confirmation: 'DELETE',
  },
]

export function SettingsPage() {
  const { t, language } = useI18n()
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
      setWhisperModelError(friendlyError(err.message, t('settings.loadWhisperModelsFailed'), language))
    } finally {
      setLoadingWhisperModels(false)
    }
  }, [language, t])

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
      setMaintenanceResult(t('settings.maintenanceResult', {
        title: t(maintenanceAction.titleKey),
        deleted: body.deleted?.length ?? 0,
        skipped: body.skipped?.length ?? 0,
      }))
      setMaintenanceAction(null)
      setMaintenanceConfirmation('')
      loadSettings()
    } catch (err: any) {
      setMaintenanceError(friendlyError(err.message, t('settings.maintenanceFailed'), language))
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
      setWhisperModelError(friendlyError(err.message, t('settings.selectWhisperModelFailed'), language))
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
      setWhisperModelError(friendlyError(err.message, t('settings.installWhisperModelFailed'), language))
    } finally {
      setInstallingWhisperModel(null)
      loadWhisperModels()
    }
  }

  if (!form) return <LoadingPage label={t('settings.title')} />

  return (
    <PageShell
      title={t('settings.title')}
      subtitle={t('settings.subtitle')}
      eyebrow={t('settings.eyebrow')}
      actions={<Button color="primary" radius="sm" isLoading={saving} onPress={handleSave}>{saved ? t('common.saved') : t('settings.save')}</Button>}
      width="lg"
    >
      {saved && <Alert color="success" variant="flat" title={t('settings.savedTitle')} description={t('settings.savedDescription')} />}

      <Card radius="sm" className="border border-default-100 bg-content2">
        <CardBody className="grid grid-cols-2 gap-4 p-6">
          <Select
            {...FIELD_PROPS}
            label={t('settings.transcriptionLanguage')}
            selectedKeys={[form.language]}
            onSelectionChange={(keys) => setForm({ ...form, language: String(Array.from(keys)[0] ?? 'ru') })}
          >
            <SelectItem key="ru">{t('settings.russian')}</SelectItem>
            <SelectItem key="en">{t('settings.english')}</SelectItem>
          </Select>

          <Select
            {...FIELD_PROPS}
            label={t('settings.summaryLanguage')}
            selectedKeys={[form.summaryLanguage]}
            onSelectionChange={(keys) => setForm({ ...form, summaryLanguage: String(Array.from(keys)[0] ?? 'ru') })}
          >
            <SelectItem key="ru">{t('settings.russian')}</SelectItem>
            <SelectItem key="en">{t('settings.english')}</SelectItem>
          </Select>

          <Input
            {...TEXT_FIELD_PROPS}
            label={t('settings.ollamaHost')}
            value={form.ollamaHost}
            onValueChange={(value) => setForm({ ...form, ollamaHost: value })}
          />

          <div className="col-span-2 rounded-small bg-content1 p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <p className="font-medium">{t('settings.transcriptionModel')}</p>
                <p className="text-small text-default-500">{t('settings.transcriptionModelDescription')}</p>
              </div>
              <Button
                radius="sm"
                variant="flat"
                isLoading={loadingWhisperModels}
                onPress={loadWhisperModels}
              >
                {t('common.refresh')}
              </Button>
            </div>

            {whisperModelError && (
              <Alert
                color="danger"
                variant="flat"
                title={t('settings.whisperModelError')}
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
                      title={model.installed ? (model.selected ? t('common.selected') : t('common.installed')) : t('common.notInstalled')}
                    />
                    {model.installed ? (
                      <Button
                        color={model.selected ? 'primary' : 'default'}
                        variant={model.selected ? 'solid' : 'flat'}
                        radius="sm"
                        isDisabled={model.selected}
                        onPress={() => selectInstalledWhisperModel(model.key)}
                      >
                        {model.selected ? t('common.selected') : t('settings.useThisModel')}
                      </Button>
                    ) : (
                      <Button
                        color="primary"
                        radius="sm"
                        isLoading={installingWhisperModel === model.key}
                        isDisabled={installingWhisperModel !== null}
                        onPress={() => installSelectedWhisperModel(model.key)}
                      >
                        {t('settings.installModel')}
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
              {t('settings.cleanChunks')}
            </Switch>
          </div>

          <div className="col-span-2 rounded-small bg-content1 p-4">
            <Switch
              color="danger"
              isSelected={form.deleteOriginalAfterProcessing}
              onValueChange={(deleteOriginalAfterProcessing) => setForm({ ...form, deleteOriginalAfterProcessing })}
            >
              {t('settings.deleteOriginal')}
            </Switch>
          </div>
        </CardBody>
      </Card>

      <Card radius="sm" className="border border-danger-200 bg-content2">
        <CardHeader className="flex flex-col items-start gap-1 p-6">
          <h2 className="font-semibold">{t('settings.maintenance')}</h2>
          <p className="text-small text-default-500">{t('settings.maintenanceDescription')}</p>
        </CardHeader>
        <Divider />
        <CardBody className="gap-4 p-6">
          {maintenanceResult && <Alert color="success" variant="flat" title={t('settings.maintenanceCompleted')} description={maintenanceResult} />}
          {maintenanceError && <Alert color="danger" variant="flat" title={t('settings.maintenanceFailed')} description={maintenanceError} />}

          <div className="grid gap-3">
            {MAINTENANCE_ACTIONS.map((action) => (
              <div key={action.key} className="flex items-center justify-between gap-4 rounded-small bg-content1 p-4">
                <div className="space-y-1">
                  <p className="font-medium">{t(action.titleKey)}</p>
                  <p className="text-small text-default-500">{t(action.descriptionKey)}</p>
                </div>
                <Button className="w-28 shrink-0" color="danger" variant="flat" radius="sm" onPress={() => {
                  setMaintenanceAction(action)
                  setMaintenanceConfirmation('')
                  setMaintenanceError(null)
                  setMaintenanceResult(null)
                }}>
                  {t('common.run')}
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
                  title={t(maintenanceAction.titleKey)}
                  description={t(maintenanceAction.descriptionKey)}
                />
                {maintenanceAction.confirmation && (
                  <Input
                    {...TEXT_FIELD_PROPS}
                    label={t('settings.confirmDelete')}
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
                    {t('common.confirm')}
                  </Button>
                  <Button variant="flat" radius="sm" onPress={() => setMaintenanceAction(null)}>
                    {t('common.cancel')}
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
