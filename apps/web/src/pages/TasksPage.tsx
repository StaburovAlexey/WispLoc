import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Alert, Button, Card, CardBody, Chip, Input, Select, SelectItem, Textarea } from '@heroui/react'
import { BackButton, EmptyState, LoadingPage, PageShell } from './PageShell'
import { FIELD_PROPS, TEXT_FIELD_PROPS } from '../shared/formControls'
import { useI18n } from '../shared/i18n'

interface TaskData {
  id: string
  mediaFileId: string
  title: string
  description: string
  sourceTimecode: string | null
  sourceChunkIndex: number | null
  priority: string | null
  labels: string[]
  assigneeHint: string | null
  dueDateHint: string | null
  confidence: number | null
  confidenceBreakdown: Record<string, boolean>
  status: string
  pipelineVersion: 'legacy-v1' | 'evidence-v2'
  sourceFactIds: string[]
  evidence: Array<{ quote: string; startSec: number; endSec: number; chunkIndex: number }>
  mergedCandidateIds: string[]
  generatedTitle: string | null
  generatedDescription: string | null
  externalTasks: Array<{ id: string; provider: string; externalUrl: string; status: string }>
  createdAt: string
}

interface IntegrationItem {
  id: string
  provider: string
  displayName: string
}

interface TargetItem {
  id: string
  externalId: string
  key: string | null
  name: string
  type: string
}

export function TasksPage() {
  const { t, language } = useI18n()
  const { id } = useParams<{ id: string }>()
  const [tasks, setTasks] = useState<TaskData[]>([])
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<Partial<TaskData>>({})
  const [loading, setLoading] = useState(true)
  const [createTaskId, setCreateTaskId] = useState<string | null>(null)
  const [integrations, setIntegrations] = useState<IntegrationItem[]>([])
  const [targets, setTargets] = useState<TargetItem[]>([])
  const [selectedIntId, setSelectedIntId] = useState('')
  const [selectedTargetId, setSelectedTargetId] = useState('')
  const [creating, setCreating] = useState(false)
  const [createResult, setCreateResult] = useState<Record<string, { url?: string; error?: string }>>({})

  const loadTasks = useCallback(async () => {
    if (!id) return
    setLoading(true)
    try {
      const res = await fetch(`/api/media/${id}/tasks`)
      setTasks(await res.json())
    } catch {}
    setLoading(false)
  }, [id])

  const loadIntegrations = useCallback(async () => {
    try {
      const res = await fetch('/api/integrations')
      setIntegrations(await res.json())
    } catch {}
  }, [])

  const loadTargets = useCallback(async (integrationId: string) => {
    try {
      const res = await fetch(`/api/integrations/${integrationId}/targets`)
      setTargets(await res.json())
    } catch {
      setTargets([])
    }
  }, [])

  useEffect(() => { loadTasks(); loadIntegrations() }, [loadTasks, loadIntegrations])

  const handleApprove = async (taskId: string) => {
    await fetch(`/api/tasks/${taskId}/approve`, { method: 'POST' })
    loadTasks()
  }

  const handleReject = async (taskId: string) => {
    await fetch(`/api/tasks/${taskId}/reject`, { method: 'POST' })
    loadTasks()
  }

  const startEdit = (task: TaskData) => {
    setEditingId(task.id)
    setEditForm({
      title: task.title,
      description: task.description,
      priority: task.priority,
      labels: task.labels,
      assigneeHint: task.assigneeHint,
      dueDateHint: task.dueDateHint,
    })
  }

  const saveEdit = async () => {
    if (!editingId) return
    await fetch(`/api/tasks/${editingId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(editForm),
    })
    setEditingId(null)
    loadTasks()
  }

  const openCreateExternal = async (taskId: string) => {
    setCreateTaskId(taskId)
    setSelectedIntId('')
    setSelectedTargetId('')
    if (integrations.length > 0) {
      setSelectedIntId(integrations[0].id)
      await loadTargets(integrations[0].id)
    }
  }

  const handleCreateExternal = async () => {
    if (!createTaskId || !selectedIntId || !selectedTargetId) return
    setCreating(true)
    try {
      const res = await fetch(`/api/tasks/${createTaskId}/create-external`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ integrationId: selectedIntId, targetId: selectedTargetId }),
      })
      const data = await res.json()
      setCreateResult((prev) => ({
        ...prev,
        [createTaskId]: data.success ? { url: data.externalUrl } : { error: data.error },
      }))
    } catch {
      setCreateResult((prev) => ({ ...prev, [createTaskId]: { error: t('tasks.networkError') } }))
    }
    setCreating(false)
    setCreateTaskId(null)
  }

  if (loading) return <LoadingPage label={t('tasks.title')} />

  return (
    <PageShell
      title={t('tasks.title')}
      subtitle={t('tasks.subtitle', { count: tasks.length })}
      eyebrow={t('tasks.eyebrow')}
      actions={<BackButton />}
      width="xl"
    >
      {createTaskId && (
        <Alert
          color="warning"
          variant="flat"
          title={t('tasks.externalWarningTitle')}
          description={t('tasks.externalWarningDescription')}
        />
      )}

      {createTaskId && (
        <Card radius="sm" className="border border-default-100 bg-content2">
          <CardBody className="gap-4 p-6">
            <div className="grid grid-cols-2 gap-4">
                <Select
                {...FIELD_PROPS}
                label={t('tasks.integration')}
                selectedKeys={new Set(selectedIntId ? [selectedIntId] : [])}
                renderValue={() => {
                  const selected = integrations.find((integration) => integration.id === selectedIntId)
                  return selected ? `${selected.displayName} (${selected.provider})` : ''
                }}
                onSelectionChange={async (keys) => {
                  const value = String(Array.from(keys)[0] ?? '')
                  setSelectedIntId(value)
                  setSelectedTargetId('')
                  if (value) await loadTargets(value)
                }}
              >
                {integrations.map((integration) => (
                  <SelectItem key={integration.id}>{integration.displayName} ({integration.provider})</SelectItem>
                ))}
              </Select>

                <Select
                  {...FIELD_PROPS}
                  label={t('tasks.target')}
                selectedKeys={new Set(selectedTargetId ? [selectedTargetId] : [])}
                renderValue={() => {
                  const selected = targets.find((target) => target.id === selectedTargetId)
                  return selected ? `${selected.name}${selected.key ? ` (${selected.key})` : ''}` : ''
                }}
                onSelectionChange={(keys) => setSelectedTargetId(String(Array.from(keys)[0] ?? ''))}
              >
                {targets.map((target) => (
                  <SelectItem key={target.id}>{target.name} {target.key ? `(${target.key})` : ''}</SelectItem>
                ))}
              </Select>
            </div>
            <div className="flex gap-2">
              <Button color="primary" radius="sm" isLoading={creating} onPress={handleCreateExternal} isDisabled={!selectedIntId || !selectedTargetId}>
                {t('tasks.createExternalTask')}
              </Button>
              <Button variant="flat" radius="sm" onPress={() => setCreateTaskId(null)}>{t('common.cancel')}</Button>
            </div>
          </CardBody>
        </Card>
      )}

      {tasks.length === 0 ? (
        <EmptyState title={t('tasks.noExtracted')} description={t('tasks.noExtractedDescription')} />
      ) : (
        <div className="grid gap-3">
          {tasks.map((task) => {
            const editing = editingId === task.id
            const result = createResult[task.id]

            return (
              <Card key={task.id} radius="sm" className="border border-default-100 bg-content2">
                <CardBody className="gap-4 p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      {editing ? (
                        <div className="grid gap-3">
                          <Input
                            {...TEXT_FIELD_PROPS}
                            label={t('tasks.titleField')}
                            value={editForm.title ?? ''}
                            onValueChange={(title) => setEditForm({ ...editForm, title })}
                          />
                          <Textarea
                            {...TEXT_FIELD_PROPS}
                            label={t('tasks.descriptionField')}
                            minRows={3}
                            value={editForm.description ?? ''}
                            onValueChange={(description) => setEditForm({ ...editForm, description })}
                          />
                          <div className="grid grid-cols-3 gap-3">
                            <Select
                              {...FIELD_PROPS}
                              label={t('tasks.priority')}
                              selectedKeys={editForm.priority ? [editForm.priority] : []}
                              onSelectionChange={(keys) => setEditForm({ ...editForm, priority: String(Array.from(keys)[0] ?? '') })}
                            >
                              <SelectItem key="low">{t('priority.low')}</SelectItem>
                              <SelectItem key="medium">{t('priority.medium')}</SelectItem>
                              <SelectItem key="high">{t('priority.high')}</SelectItem>
                            </Select>
                            <Input
                              {...TEXT_FIELD_PROPS}
                              label={t('tasks.labels')}
                              value={(editForm.labels ?? []).join(', ')}
                              onValueChange={(value) => setEditForm({ ...editForm, labels: value.split(',').map((item) => item.trim()).filter(Boolean) })}
                            />
                            <Input
                              {...TEXT_FIELD_PROPS}
                              label={t('tasks.assignee')}
                              value={editForm.assigneeHint ?? ''}
                              onValueChange={(assigneeHint) => setEditForm({ ...editForm, assigneeHint })}
                            />
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          <h2 className="font-semibold">{task.title}</h2>
                          <p className="text-small leading-6 text-default-500">{task.description}</p>
                          {(task.generatedTitle && task.generatedTitle !== task.title) || (task.generatedDescription && task.generatedDescription !== task.description) ? (
                            <Alert color="primary" variant="flat" title={t('tasks.reviewedValues')} description={`${task.generatedTitle ?? ''} — ${task.generatedDescription ?? ''}`} />
                          ) : null}
                          <div className="flex flex-wrap gap-2">
                            <Chip size="sm" color={statusColor(task.status)} variant="flat" radius="sm">{taskStatusLabel(task.status, t)}</Chip>
                            {task.priority && <Chip size="sm" color={priorityColor(task.priority)} variant="flat" radius="sm">{priorityLabel(task.priority, t)}</Chip>}
                            {task.confidence !== null && <Chip size="sm" variant="flat" radius="sm">{t('tasks.confidence', { value: (task.confidence * 100).toFixed(0) })}</Chip>}
                            {task.sourceTimecode && <Chip size="sm" variant="flat" radius="sm">{task.sourceTimecode}</Chip>}
                            {task.labels.map((label) => <Chip key={label} size="sm" variant="flat" radius="sm">{label}</Chip>)}
                            <Chip size="sm" variant="flat" radius="sm">{t('tasks.generatedAt')}: {new Date(task.createdAt).toLocaleString(language)}</Chip>
                            {(task.status !== 'DRAFT' || task.externalTasks.length > 0 || task.generatedTitle !== task.title || task.generatedDescription !== task.description) && (
                              <Chip size="sm" color="success" variant="flat" radius="sm">{t('tasks.preservedReview')}</Chip>
                            )}
                          </div>
                          {task.sourceFactIds.length > 0 && (
                            <div className="flex flex-wrap items-center gap-2 text-tiny text-default-400">
                              <span>{t('tasks.sourceFacts')}:</span>
                              {task.sourceFactIds.map((factId) => <Chip key={factId} size="sm" variant="dot">{shortId(factId)}</Chip>)}
                            </div>
                          )}
                          {Object.keys(task.confidenceBreakdown).length > 0 && (
                            <div className="flex flex-wrap items-center gap-2 text-tiny text-default-400">
                              <span>{t('tasks.confidenceBreakdown')}:</span>
                              {Object.entries(task.confidenceBreakdown).map(([key, passed]) => (
                                <Chip key={key} size="sm" color={passed ? 'success' : 'default'} variant="flat">
                                  {t(`tasks.confidence.${key}` as Parameters<typeof t>[0])}
                                </Chip>
                              ))}
                            </div>
                          )}
                          {task.evidence?.length > 0 && (
                            <div className="grid gap-2 pt-2">
                              {task.evidence.map((evidence, index) => (
                                <div key={`${evidence.chunkIndex}-${evidence.startSec}-${index}`} className="rounded-small bg-content1 p-3 text-small">
                                  <span className="mr-2 font-mono text-primary">{formatEvidenceTime(evidence.startSec)}</span>
                                  <span className="text-default-600">{evidence.quote}</span>
                                </div>
                              ))}
                            </div>
                          )}
                          {task.externalTasks?.map((external) => (
                            <Button key={external.id} as="a" href={external.externalUrl} target="_blank" size="sm" variant="flat" radius="sm">
                              {external.provider}: {external.status}
                            </Button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  {result?.url && <Alert color="success" variant="flat" title={t('tasks.created')} description={result.url} />}
                  {result?.error && <Alert color="danger" variant="flat" title={t('tasks.failed')} description={result.error} />}

                  <div className="flex flex-wrap gap-2">
                    {editing ? (
                      <>
                        <Button size="sm" color="primary" radius="sm" onPress={saveEdit}>{t('common.save')}</Button>
                        <Button size="sm" variant="flat" radius="sm" onPress={() => setEditingId(null)}>{t('common.cancel')}</Button>
                      </>
                    ) : (
                      <>
                        <Button size="sm" variant="flat" radius="sm" onPress={() => startEdit(task)}>{t('common.edit')}</Button>
                        {task.status === 'DRAFT' && (
                          <>
                            <Button size="sm" color="success" variant="flat" radius="sm" onPress={() => handleApprove(task.id)}>{t('tasks.approve')}</Button>
                            <Button size="sm" color="danger" variant="flat" radius="sm" onPress={() => handleReject(task.id)}>{t('tasks.reject')}</Button>
                          </>
                        )}
                        {task.status === 'APPROVED' && (
                          <Button size="sm" color="primary" radius="sm" onPress={() => openCreateExternal(task.id)}>{t('tasks.createExternal')}</Button>
                        )}
                      </>
                    )}
                  </div>
                </CardBody>
              </Card>
            )
          })}
        </div>
      )}
    </PageShell>
  )
}

function statusColor(status: string): 'default' | 'success' | 'danger' | 'warning' {
  if (status === 'APPROVED') return 'success'
  if (status === 'REJECTED') return 'danger'
  return 'default'
}

function priorityColor(priority: string): 'default' | 'warning' | 'danger' {
  if (priority === 'high') return 'danger'
  if (priority === 'medium') return 'warning'
  return 'default'
}

function priorityLabel(priority: string, t: ReturnType<typeof useI18n>['t']): string {
  if (priority === 'high') return t('priority.high')
  if (priority === 'medium') return t('priority.medium')
  if (priority === 'low') return t('priority.low')
  return priority
}

function taskStatusLabel(status: string, t: ReturnType<typeof useI18n>['t']): string {
  if (status === 'DRAFT') return t('taskStatus.draft')
  if (status === 'APPROVED') return t('taskStatus.approved')
  if (status === 'REJECTED') return t('taskStatus.rejected')
  return status
}

function formatEvidenceTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60)
  const remainder = Math.floor(seconds % 60)
  return `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
}

function shortId(value: string): string {
  return value.length > 20 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value
}
