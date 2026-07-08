import { useCallback, useEffect, useState } from 'react'
import { Alert, Button, Card, CardBody, Chip, Input, Select, SelectItem, Spinner } from '@heroui/react'
import { EmptyState, LoadingPage, PageShell } from './PageShell'
import { FIELD_PROPS, TEXT_FIELD_PROPS } from '../shared/formControls'
import { useI18n } from '../shared/i18n'

interface IntegrationData {
  id: string
  provider: string
  displayName: string
  baseUrl: string | null
  authType: string
  isEnabled: boolean
  createdAt: string
}

const PROVIDER_LABELS: Record<string, string> = {
  'yandex-tracker': 'Yandex Tracker',
  github: 'GitHub',
  gitlab: 'GitLab',
}

interface IntegrationForm {
  provider: string
  displayName: string
  baseUrl: string
  token: string
  organizationId: string
}

const emptyForm: IntegrationForm = {
  provider: 'github',
  displayName: '',
  baseUrl: '',
  token: '',
  organizationId: '',
}

export function IntegrationsPage() {
  const { t } = useI18n()
  const [integrations, setIntegrations] = useState<IntegrationData[]>([])
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState<IntegrationForm>(emptyForm)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [testing, setTesting] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<Record<string, boolean>>({})
  const [refreshing, setRefreshing] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const loadIntegrations = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/integrations')
      setIntegrations(await res.json())
    } catch {}
    setLoading(false)
  }, [])

  useEffect(() => { loadIntegrations() }, [loadIntegrations])

  const handleSave = async () => {
    const url = editingId ? `/api/integrations/${editingId}` : '/api/integrations'
    await fetch(url, {
      method: editingId ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })
    setShowAdd(false)
    setEditingId(null)
    setForm(emptyForm)
    loadIntegrations()
  }

  const handleDelete = async (id: string) => {
    await fetch(`/api/integrations/${id}`, { method: 'DELETE' })
    loadIntegrations()
  }

  const handleTest = async (id: string) => {
    setTesting(id)
    try {
      const res = await fetch(`/api/integrations/${id}/test`, { method: 'POST' })
      const data = await res.json()
      setTestResult((prev) => ({ ...prev, [id]: data.ok }))
    } catch {
      setTestResult((prev) => ({ ...prev, [id]: false }))
    }
    setTesting(null)
  }

  const handleRefreshTargets = async (id: string) => {
    setRefreshing(id)
    await fetch(`/api/integrations/${id}/refresh-targets`, { method: 'POST' })
    setRefreshing(null)
  }

  const startEdit = (integration: IntegrationData) => {
    setEditingId(integration.id)
    setForm({
      provider: integration.provider,
      displayName: integration.displayName,
      baseUrl: integration.baseUrl ?? '',
      token: '',
      organizationId: '',
    })
    setShowAdd(true)
  }

  const providerFields = getProviderFields(t)

  if (loading) return <LoadingPage label={t('integrations.title')} />

  return (
    <PageShell
      title={t('integrations.title')}
      subtitle={t('integrations.subtitle')}
      eyebrow={t('integrations.eyebrow')}
      actions={
        <Button color="primary" radius="sm" onPress={() => { setShowAdd(true); setEditingId(null); setForm(emptyForm) }}>
          {t('integrations.add')}
        </Button>
      }
      width="xl"
    >
      <Alert
        color="warning"
        variant="flat"
        title={t('integrations.warningTitle')}
        description={t('integrations.warningDescription')}
      />

      {showAdd && (
        <Card radius="sm" className="border border-default-100 bg-content2">
          <CardBody className="gap-4 p-6">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">{editingId ? t('integrations.edit') : t('integrations.new')}</h2>
              <Chip color="primary" variant="flat" radius="sm">{PROVIDER_LABELS[form.provider]}</Chip>
            </div>

              <Select
                {...FIELD_PROPS}
                label={t('integrations.provider')}
              isDisabled={!!editingId}
              selectedKeys={[form.provider]}
              onSelectionChange={(keys) => setForm({ ...form, provider: String(Array.from(keys)[0] ?? 'github') })}
            >
              {Object.entries(PROVIDER_LABELS).map(([key, label]) => <SelectItem key={key}>{label}</SelectItem>)}
            </Select>

            <div className="grid grid-cols-2 gap-4">
              {(providerFields[form.provider] ?? []).map((field) => (
                <Input
                  {...TEXT_FIELD_PROPS}
                  key={field.key}
                  label={field.label}
                  placeholder={field.placeholder}
                  type={field.type ?? 'text'}
                  value={form[field.key] ?? ''}
                  onValueChange={(value) => setForm({ ...form, [field.key]: value })}
                />
              ))}
            </div>

            <div className="flex gap-2">
              <Button color="primary" radius="sm" onPress={handleSave}>{editingId ? t('common.update') : t('common.save')}</Button>
              <Button variant="flat" radius="sm" onPress={() => { setShowAdd(false); setEditingId(null) }}>{t('common.cancel')}</Button>
            </div>
          </CardBody>
        </Card>
      )}

      {integrations.length === 0 ? (
        <EmptyState title={t('integrations.noConfigured')} description={t('integrations.noConfiguredDescription')} />
      ) : (
        <div className="grid gap-3">
          {integrations.map((integration) => (
            <Card key={integration.id} radius="sm" className="border border-default-100 bg-content2">
              <CardBody className="gap-4 p-5">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 className="font-semibold">{integration.displayName || PROVIDER_LABELS[integration.provider] || integration.provider}</h2>
                    <p className="text-small text-default-500">
                      {PROVIDER_LABELS[integration.provider] || integration.provider}
                      {integration.baseUrl ? ` · ${integration.baseUrl}` : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Chip color={integration.isEnabled ? 'success' : 'default'} variant="flat" radius="sm">
                      {integration.isEnabled ? t('common.enabled') : t('common.disabled')}
                    </Chip>
                    {testResult[integration.id] !== undefined && (
                      <Chip color={testResult[integration.id] ? 'success' : 'danger'} variant="flat" radius="sm">
                        {testResult[integration.id] ? t('common.connected') : t('common.failed')}
                      </Chip>
                    )}
                  </div>
                </div>

                <div className="flex gap-2">
                  <Button size="sm" variant="flat" radius="sm" onPress={() => startEdit(integration)}>{t('common.edit')}</Button>
                  <Button size="sm" variant="flat" radius="sm" isLoading={testing === integration.id} onPress={() => handleTest(integration.id)}>{t('common.test')}</Button>
                  <Button size="sm" variant="flat" radius="sm" isLoading={refreshing === integration.id} onPress={() => handleRefreshTargets(integration.id)}>{t('integrations.refreshTargets')}</Button>
                  <Button size="sm" color="danger" variant="flat" radius="sm" onPress={() => handleDelete(integration.id)}>{t('common.delete')}</Button>
                  {(testing === integration.id || refreshing === integration.id) && <Spinner size="sm" color="primary" />}
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      )}
    </PageShell>
  )
}

function getProviderFields(t: ReturnType<typeof useI18n>['t']): Record<string, Array<{ key: keyof IntegrationForm; label: string; placeholder: string; type?: string }>> {
  return {
    'yandex-tracker': [
      { key: 'displayName', label: t('integrations.name'), placeholder: 'My Yandex Tracker' },
      { key: 'token', label: t('integrations.oauthToken'), placeholder: 'y0_...', type: 'password' },
      { key: 'organizationId', label: t('integrations.organizationId'), placeholder: 'abc123' },
    ],
    github: [
      { key: 'displayName', label: t('integrations.name'), placeholder: 'My GitHub' },
      { key: 'token', label: t('integrations.personalAccessToken'), placeholder: 'ghp_...', type: 'password' },
    ],
    gitlab: [
      { key: 'displayName', label: t('integrations.name'), placeholder: 'My GitLab' },
      { key: 'baseUrl', label: t('integrations.baseUrl'), placeholder: 'https://gitlab.com' },
      { key: 'token', label: t('integrations.personalAccessToken'), placeholder: 'glpat-...', type: 'password' },
    ],
  }
}
