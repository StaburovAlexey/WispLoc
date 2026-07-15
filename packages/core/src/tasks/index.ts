import type { ExtractedActionItem } from '@wisploc/shared'
import { getPrisma } from '../database'
import { createUserCorrection } from '../knowledge/repository'

const prisma = getPrisma()

/** Persist extracted action items as DRAFT tasks. */
export async function saveExtractedTasks(
  mediaFileId: string,
  items: ExtractedActionItem[],
): Promise<number> {
  let count = 0
  for (const item of items) {
    await prisma.extractedTask.create({
      data: {
        mediaFileId,
        title: item.title,
        description: item.description,
        sourceTimecode: item.sourceTimecode ?? null,
        sourceChunkIndex: item.sourceChunkIndex ?? null,
        priority: item.priority ?? null,
        labelsJson: item.labels ? JSON.stringify(item.labels) : null,
        assigneeHint: item.assigneeHint ?? null,
        dueDateHint: item.dueDateHint ?? null,
        confidence: item.confidence ?? null,
        status: 'DRAFT',
      },
    })
    count++
  }
  return count
}

/** List draft tasks for a media file. */
export async function listTasks(mediaFileId: string) {
  const records = await prisma.extractedTask.findMany({
    where: { mediaFileId },
    orderBy: { createdAt: 'asc' },
    include: { externalTasks: true },
  })
  return records.map(toDto)
}

/** Get a single task. */
export async function getTask(id: string) {
  const record = await prisma.extractedTask.findUnique({ where: { id }, include: { externalTasks: true } })
  return record ? toDto(record) : null
}

/** Update a task (editable fields). */
export async function updateTask(
  id: string,
  updates: {
    title?: string
    description?: string
    priority?: string
    labels?: string[]
    assigneeHint?: string
    dueDateHint?: string
  },
) {
  const previous = await prisma.extractedTask.findUnique({ where: { id } })
  if (!previous) throw new Error('Task not found')
  const data: any = {}
  if (updates.title !== undefined) data.title = updates.title
  if (updates.description !== undefined) data.description = updates.description
  if (updates.priority !== undefined) data.priority = updates.priority
  if (updates.labels !== undefined) data.labelsJson = JSON.stringify(updates.labels)
  if (updates.assigneeHint !== undefined) data.assigneeHint = updates.assigneeHint
  if (updates.dueDateHint !== undefined) data.dueDateHint = updates.dueDateHint

  const record = await prisma.extractedTask.update({
    where: { id },
    data,
  })
  await captureTaskCorrection(previous, record)
  return toDto(record)
}

/** Approve a task (mark as APPROVED). */
export async function approveTask(id: string) {
  const previous = await prisma.extractedTask.findUnique({ where: { id } })
  if (!previous) throw new Error('Task not found')
  const record = await prisma.extractedTask.update({
    where: { id },
    data: { status: 'APPROVED' },
  })
  await captureTaskCorrection(previous, record)
  return record
}

/** Reject a task (mark as REJECTED). */
export async function rejectTask(id: string) {
  const previous = await prisma.extractedTask.findUnique({ where: { id } })
  if (!previous) throw new Error('Task not found')
  const record = await prisma.extractedTask.update({
    where: { id },
    data: { status: 'REJECTED' },
  })
  await captureTaskCorrection(previous, record)
  return record
}

/** Delete all tasks for a media file. */
export async function deleteTasks(mediaFileId: string) {
  await prisma.extractedTask.deleteMany({ where: { mediaFileId } })
}

// ── internal ───────────────────────────────────────────
function toDto(record: any) {
  return {
    id: record.id,
    mediaFileId: record.mediaFileId,
    title: record.title,
    description: record.description,
    sourceTimecode: record.sourceTimecode,
    sourceChunkIndex: record.sourceChunkIndex,
    priority: record.priority,
    labels: record.labelsJson ? JSON.parse(record.labelsJson) : [],
    assigneeHint: record.assigneeHint,
    dueDateHint: record.dueDateHint,
    confidence: record.confidence,
    confidenceBreakdown: parseObject(record.confidenceBreakdownJson),
    status: record.status,
    pipelineVersion: record.pipelineVersion ?? 'legacy-v1',
    sourceFactIds: parseArray(record.sourceFactIdsJson),
    evidence: parseArray(record.evidenceJson),
    mergedCandidateIds: parseArray(record.mergedCandidateIdsJson),
    generatedTitle: record.generatedTitle,
    generatedDescription: record.generatedDescription,
    processingJobId: record.processingJobId,
    externalTasks: Array.isArray(record.externalTasks) ? record.externalTasks.map((external: any) => ({
      id: external.id,
      provider: external.provider,
      externalUrl: external.externalUrl,
      status: external.status,
      createdAt: external.createdAt.toISOString(),
    })) : [],
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  }
}

function parseArray(value: string | null | undefined): unknown[] {
  if (!value) return []
  try {
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function parseObject(value: string | null | undefined): Record<string, boolean> {
  if (!value) return {}
  try {
    const parsed: unknown = JSON.parse(value)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, boolean] => typeof entry[1] === 'boolean'))
  } catch {
    return {}
  }
}

async function captureTaskCorrection(previous: any, current: any): Promise<void> {
  if (!current.processingJobId || current.pipelineVersion !== 'evidence-v2') return
  const generated = {
    title: previous.generatedTitle ?? previous.title,
    description: previous.generatedDescription ?? previous.description,
    assignee: previous.assigneeHint,
    dueDate: previous.dueDateHint,
    priority: previous.priority,
    status: previous.status,
  }
  const corrected = current.status === 'REJECTED' ? { tasks: [] } : {
    title: current.title,
    description: current.description,
    assignee: current.assigneeHint,
    dueDate: current.dueDateHint,
    priority: current.priority,
    status: current.status,
  }
  if (JSON.stringify(generated) === JSON.stringify(corrected)) return
  await createUserCorrection({
    mediaFileId: current.mediaFileId,
    processingJobId: current.processingJobId,
    stage: 'task-extraction',
    sourceInput: JSON.stringify({ sourceFactIds: parseArray(current.sourceFactIdsJson), evidence: parseArray(current.evidenceJson) }),
    generatedOutputJson: JSON.stringify(generated),
    correctedOutputJson: JSON.stringify(corrected),
    evidenceJson: current.evidenceJson ?? '[]',
  })
}
