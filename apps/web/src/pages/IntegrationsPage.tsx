import { useCallback, useEffect, useState } from 'react'
import { Alert, Button, Card, CardBody, Chip, Input, Select, SelectItem, Spinner } from '@heroui/react'
import { EmptyState, LoadingPage, PageShell } from './PageShell'

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

const PROVIDER_FIELDS: Record<string, Array<{ key: keyof IntegrationForm; label: string; placeholder: string; type?: string }>> = {
  'yandex-tracker': [
    { key: 'displayName', label: 'Name', placeholder: 'My Yandex Tracker' },
    { key: 'token', label: 'OAuth Token', placeholder: 'y0_...', type: 'password' },
    { key: 'organizationId', label: 'Organization ID', placeholder: 'abc123' },
  ],
  github: [
    { key: 'displayName', label: 'Name', placeholder: 'My GitHub' },
    { key: 'token', label: 'Personal Access Token', placeholder: 'ghp_...', type: 'password' },
  ],
  gitlab: [
    { key: 'displayName', label: 'Name', placeholder: 'My GitLab' },
    { key: 'baseUrl', label: 'Base URL', placeholder: 'https://gitlab.com' },
    { key: 'token', label: 'Personal Access Token', placeholder: 'glpat-...', type: 'password' },
  ],
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

  if (loading) return <LoadingPage label="Integrations" />

  return (
    <PageShell
      title="Integrations"
      subtitle="Connect approved tasks to external trackers"
      eyebrow="Connected mode"
      actions={
        <Button color="primary" radius="sm" onPress={() => { setShowAdd(true); setEditingId(null); setForm(emptyForm) }}>
          Add integration
        </Button>
      }
      width="xl"
    >
      <Alert
        color="warning"
        variant="flat"
        title="External services receive selected task data"
        description="Only reviewed task title, description, and metadata should be sent. Full transcripts are not sent by default."
      />

      {showAdd && (
        <Card radius="sm" className="border border-default-100 bg-content2">
          <CardBody className="gap-4 p-6">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">{editingId ? 'Edit integration' : 'New integration'}</h2>
              <Chip color="primary" variant="flat" radius="sm">{PROVIDER_LABELS[form.provider]}</Chip>
            </div>

            <Select
              label="Provider"
              radius="sm"
              isDisabled={!!editingId}
              selectedKeys={[form.provider]}
              onSelectionChange={(keys) => setForm({ ...form, provider: String(Array.from(keys)[0] ?? 'github') })}
            >
              {Object.entries(PROVIDER_LABELS).map(([key, label]) => <SelectItem key={key}>{label}</SelectItem>)}
            </Select>

            <div className="grid grid-cols-2 gap-4">
              {(PROVIDER_FIELDS[form.provider] ?? []).map((field) => (
                <Input
                  key={field.key}
                  label={field.label}
                  placeholder={field.placeholder}
                  type={field.type ?? 'text'}
                  radius="sm"
                  value={form[field.key] ?? ''}
                  onValueChange={(value) => setForm({ ...form, [field.key]: value })}
                />
              ))}
            </div>

            <div className="flex gap-2">
              <Button color="primary" radius="sm" onPress={handleSave}>{editingId ? 'Update' : 'Save'}</Button>
              <Button variant="flat" radius="sm" onPress={() => { setShowAdd(false); setEditingId(null) }}>Cancel</Button>
            </div>
          </CardBody>
        </Card>
      )}

      {integrations.length === 0 ? (
        <EmptyState title="No integrations configured" description="Add Yandex Tracker, GitHub, or GitLab to create reviewed tasks externally." />
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
                      {integration.isEnabled ? 'enabled' : 'disabled'}
                    </Chip>
                    {testResult[integration.id] !== undefined && (
                      <Chip color={testResult[integration.id] ? 'success' : 'danger'} variant="flat" radius="sm">
                        {testResult[integration.id] ? 'connected' : 'failed'}
                      </Chip>
                    )}
                  </div>
                </div>

                <div className="flex gap-2">
                  <Button size="sm" variant="flat" radius="sm" onPress={() => startEdit(integration)}>Edit</Button>
                  <Button size="sm" variant="flat" radius="sm" isLoading={testing === integration.id} onPress={() => handleTest(integration.id)}>Test</Button>
                  <Button size="sm" variant="flat" radius="sm" isLoading={refreshing === integration.id} onPress={() => handleRefreshTargets(integration.id)}>Refresh targets</Button>
                  <Button size="sm" color="danger" variant="flat" radius="sm" onPress={() => handleDelete(integration.id)}>Delete</Button>
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
