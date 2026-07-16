import type { ExtractedActionItem } from '@wisploc/shared'
import { getPrisma } from '../database'

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
  })
  return records.map(toDto)
}

/** Get a single task. */
export async function getTask(id: string) {
  const record = await prisma.extractedTask.findUnique({ where: { id } })
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
  return toDto(record)
}

/** Approve a task (mark as APPROVED). */
export async function approveTask(id: string) {
  return prisma.extractedTask.update({
    where: { id },
    data: { status: 'APPROVED' },
  })
}

/** Reject a task (mark as REJECTED). */
export async function rejectTask(id: string) {
  return prisma.extractedTask.update({
    where: { id },
    data: { status: 'REJECTED' },
  })
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
    status: record.status,
    pipelineVersion: record.pipelineVersion ?? 'legacy-v1',
    sourceFactIds: parseArray(record.sourceFactIdsJson),
    evidence: parseArray(record.evidenceJson),
    mergedCandidateIds: parseArray(record.mergedCandidateIdsJson),
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
