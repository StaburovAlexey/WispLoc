import type { ChunkSummary, FinalSummary } from '@wisploc/shared'
import { getPrisma } from '../database'

const prisma = getPrisma()

/** Save a chunk-level summary. */
export async function saveChunkSummary(
  mediaFileId: string,
  summary: ChunkSummary,
): Promise<string> {
  const record = await prisma.summary.create({
    data: {
      mediaFileId,
      kind: 'chunk',
      shortSummary: summary.summary,
      keyPointsJson: JSON.stringify(summary.keyPoints),
      decisionsJson: JSON.stringify(summary.decisions),
      risksJson: JSON.stringify(summary.risks),
      openQuestionsJson: JSON.stringify(summary.openQuestions),
      actionItemsJson: JSON.stringify(summary.actionItems),
      modelName: 'qwen3:4b',
    },
  })
  return record.id
}

/** Save the final consolidated summary. */
export async function saveFinalSummary(
  mediaFileId: string,
  summary: FinalSummary,
): Promise<string> {
  const record = await prisma.summary.create({
    data: {
      mediaFileId,
      kind: 'final',
      shortSummary: summary.shortSummary,
      detailedSummary: summary.detailedSummary,
      keyPointsJson: JSON.stringify(summary.keyPoints),
      decisionsJson: JSON.stringify(summary.decisions),
      risksJson: JSON.stringify(summary.risks),
      openQuestionsJson: JSON.stringify(summary.openQuestions),
      actionItemsJson: JSON.stringify(summary.actionItems),
      modelName: 'qwen3:4b',
    },
  })
  return record.id
}

/** Get the latest final summary for a media file. */
export async function getLatestSummary(mediaFileId: string) {
  const record = await prisma.summary.findFirst({
    where: { mediaFileId, kind: 'final' },
    orderBy: { createdAt: 'desc' },
  })
  if (!record) return null
  return summaryRecordToDto(record)
}

/** Get all chunk summaries for a media file. */
export async function getChunkSummaries(mediaFileId: string) {
  const records = await prisma.summary.findMany({
    where: { mediaFileId, kind: 'chunk' },
    orderBy: { createdAt: 'asc' },
  })
  return records.map(summaryRecordToDto)
}

/** Delete all summaries for a media file. */
export async function deleteSummaries(mediaFileId: string) {
  await prisma.summary.deleteMany({ where: { mediaFileId } })
}

// ── internal ───────────────────────────────────────────
function parseJsonSafe(s: string | null): any {
  if (!s) return null
  try { return JSON.parse(s) } catch { return null }
}

function summaryRecordToDto(record: any) {
  return {
    id: record.id,
    kind: record.kind,
    shortSummary: record.shortSummary,
    detailedSummary: record.detailedSummary,
    keyPoints: parseJsonSafe(record.keyPointsJson) ?? [],
    decisions: parseJsonSafe(record.decisionsJson) ?? [],
    risks: parseJsonSafe(record.risksJson) ?? [],
    openQuestions: parseJsonSafe(record.openQuestionsJson) ?? [],
    actionItems: parseJsonSafe(record.actionItemsJson) ?? [],
    modelName: record.modelName,
    createdAt: record.createdAt.toISOString(),
  }
}
