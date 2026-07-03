import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Alert, Button, Card, CardBody, Chip, Input, Select, SelectItem, Textarea } from '@heroui/react'
import { BackButton, EmptyState, LoadingPage, PageShell } from './PageShell'

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
  status: string
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
      setCreateResult((prev) => ({ ...prev, [createTaskId]: { error: 'Network error' } }))
    }
    setCreating(false)
    setCreateTaskId(null)
  }

  if (loading) return <LoadingPage label="Tasks" />

  return (
    <PageShell
      title="Tasks"
      subtitle={`${tasks.length} extracted tasks · Review before creating externally`}
      eyebrow="Review first"
      actions={<BackButton />}
      width="xl"
    >
      {createTaskId && (
        <Alert
          color="warning"
          variant="flat"
          title="These selected tasks will be sent to the external service"
          description="Only the task title, description, and metadata will be sent. Full transcript data is not included."
        />
      )}

      {createTaskId && (
        <Card radius="sm" className="border border-default-100 bg-content2">
          <CardBody className="gap-4 p-6">
            <div className="grid grid-cols-2 gap-4">
              <Select
                label="Integration"
                radius="sm"
                selectedKeys={selectedIntId ? [selectedIntId] : []}
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
                label="Target"
                radius="sm"
                selectedKeys={selectedTargetId ? [selectedTargetId] : []}
                onSelectionChange={(keys) => setSelectedTargetId(String(Array.from(keys)[0] ?? ''))}
              >
                {targets.map((target) => (
                  <SelectItem key={target.id}>{target.name} {target.key ? `(${target.key})` : ''}</SelectItem>
                ))}
              </Select>
            </div>
            <div className="flex gap-2">
              <Button color="primary" radius="sm" isLoading={creating} onPress={handleCreateExternal} isDisabled={!selectedIntId || !selectedTargetId}>
                Create external task
              </Button>
              <Button variant="flat" radius="sm" onPress={() => setCreateTaskId(null)}>Cancel</Button>
            </div>
          </CardBody>
        </Card>
      )}

      {tasks.length === 0 ? (
        <EmptyState title="No extracted tasks" description="Process the media file and generate a summary first." />
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
                            label="Title"
                            radius="sm"
                            value={editForm.title ?? ''}
                            onValueChange={(title) => setEditForm({ ...editForm, title })}
                          />
                          <Textarea
                            label="Description"
                            radius="sm"
                            minRows={3}
                            value={editForm.description ?? ''}
                            onValueChange={(description) => setEditForm({ ...editForm, description })}
                          />
                          <div className="grid grid-cols-3 gap-3">
                            <Select
                              label="Priority"
                              radius="sm"
                              selectedKeys={editForm.priority ? [editForm.priority] : []}
                              onSelectionChange={(keys) => setEditForm({ ...editForm, priority: String(Array.from(keys)[0] ?? '') })}
                            >
                              <SelectItem key="low">low</SelectItem>
                              <SelectItem key="medium">medium</SelectItem>
                              <SelectItem key="high">high</SelectItem>
                            </Select>
                            <Input
                              label="Labels"
                              radius="sm"
                              value={(editForm.labels ?? []).join(', ')}
                              onValueChange={(value) => setEditForm({ ...editForm, labels: value.split(',').map((item) => item.trim()).filter(Boolean) })}
                            />
                            <Input
                              label="Assignee"
                              radius="sm"
                              value={editForm.assigneeHint ?? ''}
                              onValueChange={(assigneeHint) => setEditForm({ ...editForm, assigneeHint })}
                            />
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          <h2 className="font-semibold">{task.title}</h2>
                          <p className="text-small leading-6 text-default-500">{task.description}</p>
                          <div className="flex flex-wrap gap-2">
                            <Chip size="sm" color={statusColor(task.status)} variant="flat" radius="sm">{task.status}</Chip>
                            {task.priority && <Chip size="sm" color={priorityColor(task.priority)} variant="flat" radius="sm">{task.priority}</Chip>}
                            {task.confidence !== null && <Chip size="sm" variant="flat" radius="sm">confidence {(task.confidence * 100).toFixed(0)}%</Chip>}
                            {task.sourceTimecode && <Chip size="sm" variant="flat" radius="sm">{task.sourceTimecode}</Chip>}
                            {task.labels.map((label) => <Chip key={label} size="sm" variant="flat" radius="sm">{label}</Chip>)}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {result?.url && <Alert color="success" variant="flat" title="External task created" description={result.url} />}
                  {result?.error && <Alert color="danger" variant="flat" title="External task failed" description={result.error} />}

                  <div className="flex flex-wrap gap-2">
                    {editing ? (
                      <>
                        <Button size="sm" color="primary" radius="sm" onPress={saveEdit}>Save</Button>
                        <Button size="sm" variant="flat" radius="sm" onPress={() => setEditingId(null)}>Cancel</Button>
                      </>
                    ) : (
                      <>
                        <Button size="sm" variant="flat" radius="sm" onPress={() => startEdit(task)}>Edit</Button>
                        {task.status === 'DRAFT' && (
                          <>
                            <Button size="sm" color="success" variant="flat" radius="sm" onPress={() => handleApprove(task.id)}>Approve</Button>
                            <Button size="sm" color="danger" variant="flat" radius="sm" onPress={() => handleReject(task.id)}>Reject</Button>
                          </>
                        )}
                        {task.status === 'APPROVED' && (
                          <Button size="sm" color="primary" radius="sm" onPress={() => openCreateExternal(task.id)}>Create external</Button>
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
