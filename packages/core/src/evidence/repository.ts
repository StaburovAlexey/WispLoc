import { createHash } from 'node:crypto'
import type {
  DraftTask,
  EvidenceFinalSummary,
  EvidenceSummaryBatch,
  EvidenceTranscriptSegment,
  MergedFact,
  TaskCandidate,
  TranscriptChunk,
  ValidatedFact,
  TermSuggestion,
} from '@wisploc/shared'
import { evidenceSummaryBatchSchema } from '@wisploc/shared'
import { getPrisma } from '../database'

const prisma = getPrisma()

export async function loadEvidenceSegments(mediaFileId: string): Promise<EvidenceTranscriptSegment[]> {
  const segments = await prisma.transcriptSegment.findMany({ where: { mediaFileId }, orderBy: [{ sequence: 'asc' }, { startSec: 'asc' }] })
  return segments.map((segment) => ({
    id: segment.id,
    mediaFileId: segment.mediaFileId,
    startSec: segment.startSec,
    endSec: segment.endSec,
    originalText: segment.text,
    normalizedText: segment.normalizedText ?? undefined,
    speaker: segment.speaker ?? undefined,
    sequence: segment.sequence,
  }))
}

export async function saveNormalizedSegment(id: string, normalizedText: string, replacements: unknown[]): Promise<void> {
  await prisma.transcriptSegment.update({ where: { id }, data: { normalizedText, replacementsJson: JSON.stringify(replacements) } })
}

export async function persistTranscriptChunks(jobId: string, chunks: TranscriptChunk[]): Promise<void> {
  for (const chunk of chunks) {
    const inputHash = hashInput(JSON.stringify(chunk))
    await prisma.evidenceTranscriptChunk.upsert({
      where: { processingJobId_index: { processingJobId: jobId, index: chunk.index } },
      create: {
        mediaFileId: chunk.mediaFileId, processingJobId: jobId, index: chunk.index,
        startSec: chunk.startSec, endSec: chunk.endSec, segmentIdsJson: JSON.stringify(chunk.segmentIds),
        originalText: chunk.originalText, normalizedText: chunk.normalizedText, inputHash,
      },
      update: {
        startSec: chunk.startSec, endSec: chunk.endSec, segmentIdsJson: JSON.stringify(chunk.segmentIds),
        originalText: chunk.originalText, normalizedText: chunk.normalizedText, inputHash,
      },
    })
  }
}

export async function loadValidFactsForChunk(mediaFileId: string, jobId: string, chunkIndex: number): Promise<ValidatedFact[]> {
  const latestRecord = await prisma.atomicFactRecord.findFirst({
    where: { mediaFileId, chunkIndex, validationStatus: 'valid' },
    orderBy: { createdAt: 'desc' },
  })
  if (!latestRecord) return []

  // Facts belong to the media; the job is only the attempt that produced them.
  // Reuse the latest completed chunk across newly created retry jobs.
  const records = await prisma.atomicFactRecord.findMany({
    where: { processingJobId: latestRecord.processingJobId, chunkIndex, validationStatus: 'valid' },
  })
  return records.map((record) => ({
    id: record.id, mediaFileId: record.mediaFileId, chunkIndex: record.chunkIndex,
    type: record.type as ValidatedFact['type'], text: record.text, evidenceQuote: record.evidenceQuote,
    startSec: record.startSec, endSec: record.endSec, speaker: record.speaker ?? undefined,
    explicit: record.explicit, validationStatus: 'valid', validationErrors: parseStringArray(record.validationErrorsJson),
  }))
}

export async function clearFactsForChunk(jobId: string, chunkIndex: number): Promise<void> {
  await prisma.atomicFactRecord.deleteMany({ where: { processingJobId: jobId, chunkIndex } })
}

export async function persistValidatedFacts(jobId: string, facts: ValidatedFact[], modelName: string, promptVersion: string, repairUsedIds: Set<string> = new Set()): Promise<void> {
  for (const fact of facts) {
    await prisma.atomicFactRecord.upsert({
      where: { id: fact.id },
      create: {
        id: fact.id, mediaFileId: fact.mediaFileId, processingJobId: jobId, chunkIndex: fact.chunkIndex,
        type: fact.type, text: fact.text, evidenceQuote: fact.evidenceQuote, startSec: fact.startSec, endSec: fact.endSec,
        speaker: fact.speaker ?? null, explicit: fact.explicit, validationStatus: fact.validationStatus,
        validationErrorsJson: JSON.stringify(fact.validationErrors), promptVersion, modelName, repairUsed: repairUsedIds.has(fact.id),
      },
      update: {
        validationStatus: fact.validationStatus, validationErrorsJson: JSON.stringify(fact.validationErrors),
        startSec: fact.startSec, endSec: fact.endSec, repairUsed: repairUsedIds.has(fact.id),
      },
    })
  }
}

export async function replaceMergedFacts(jobId: string, facts: MergedFact[]): Promise<void> {
  await prisma.mergedFactRecord.deleteMany({ where: { processingJobId: jobId } })
  if (facts.length === 0) return
  await prisma.mergedFactRecord.createMany({ data: facts.map((fact) => ({
    id: fact.id, mediaFileId: fact.mediaFileId, processingJobId: jobId, type: fact.type, text: fact.text,
    evidenceJson: JSON.stringify(fact.evidence), sourceFactIdsJson: JSON.stringify(fact.sourceFactIds),
  })) })
}

export async function loadLatestMergedFacts(mediaFileId: string): Promise<MergedFact[]> {
  const latest = await prisma.mergedFactRecord.findFirst({ where: { mediaFileId }, orderBy: { createdAt: 'desc' } })
  if (!latest) return []
  const records = await prisma.mergedFactRecord.findMany({ where: { mediaFileId, processingJobId: latest.processingJobId } })
  return records.map((record) => ({
    id: record.id,
    mediaFileId: record.mediaFileId,
    type: record.type as MergedFact['type'],
    text: record.text,
    evidence: parseEvidence(record.evidenceJson),
    sourceFactIds: parseStringArray(record.sourceFactIdsJson),
  }))
}

export async function loadSummaryBatchCheckpoint(
  mediaFileId: string,
  batchIndex: number,
  inputHash: string,
): Promise<EvidenceSummaryBatch | null> {
  const record = await prisma.summaryBatchCheckpoint.findUnique({
    where: { mediaFileId_batchIndex_inputHash: { mediaFileId, batchIndex, inputHash } },
  })
  if (!record) return null
  try {
    return evidenceSummaryBatchSchema.parse(JSON.parse(record.summaryJson))
  } catch {
    await prisma.summaryBatchCheckpoint.delete({ where: { id: record.id } })
    return null
  }
}

export async function saveSummaryBatchCheckpoint(input: {
  mediaFileId: string
  batchIndex: number
  inputHash: string
  summary: EvidenceSummaryBatch
  modelName: string
  promptVersion: string
}): Promise<void> {
  await prisma.$transaction([
    prisma.summaryBatchCheckpoint.deleteMany({
      where: { mediaFileId: input.mediaFileId, batchIndex: input.batchIndex, inputHash: { not: input.inputHash } },
    }),
    prisma.summaryBatchCheckpoint.upsert({
      where: {
        mediaFileId_batchIndex_inputHash: {
          mediaFileId: input.mediaFileId,
          batchIndex: input.batchIndex,
          inputHash: input.inputHash,
        },
      },
      create: {
        mediaFileId: input.mediaFileId,
        batchIndex: input.batchIndex,
        inputHash: input.inputHash,
        summaryJson: JSON.stringify(input.summary),
        modelName: input.modelName,
        promptVersion: input.promptVersion,
      },
      update: {
        summaryJson: JSON.stringify(input.summary),
        modelName: input.modelName,
        promptVersion: input.promptVersion,
      },
    }),
  ])
}

export async function deleteSummaryBatchCheckpoints(mediaFileId: string): Promise<void> {
  await prisma.summaryBatchCheckpoint.deleteMany({ where: { mediaFileId } })
}

export async function pruneSummaryBatchCheckpoints(mediaFileId: string, inputHashes: string[]): Promise<void> {
  await prisma.summaryBatchCheckpoint.deleteMany({
    where: { mediaFileId, inputHash: { notIn: inputHashes } },
  })
}

export async function replaceTaskCandidates(jobId: string, tasks: Array<TaskCandidate & { mergedCandidateIds: string[] }>): Promise<void> {
  await prisma.taskCandidateRecord.deleteMany({ where: { processingJobId: jobId } })
  if (tasks.length === 0) return
  await prisma.taskCandidateRecord.createMany({ data: tasks.map((task) => ({
    id: task.id, mediaFileId: task.mediaFileId, processingJobId: jobId, title: task.title,
    description: task.description ?? null, assignee: task.assignee ?? null, dueDate: task.dueDate ?? null,
    priority: task.priority ?? null, sourceFactIdsJson: JSON.stringify(task.sourceFactIds), evidenceJson: JSON.stringify(task.evidence),
    explicitAction: task.explicitAction, explicitAssignee: task.explicitAssignee, explicitDueDate: task.explicitDueDate,
    mergedCandidateIdsJson: JSON.stringify(task.mergedCandidateIds),
  })) })
}

export async function replaceEvidenceResults(input: {
  mediaFileId: string
  jobId: string
  summary: EvidenceFinalSummary
  tasks: DraftTask[]
  modelName: string
  promptVersion: string
}): Promise<void> {
  await replaceEvidenceSummary(input)
  await replaceEvidenceTasks(input)
}

export async function replaceEvidenceSummary(input: Omit<Parameters<typeof replaceEvidenceResults>[0], 'tasks'> & { tasks?: DraftTask[] }): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.summary.deleteMany({ where: { mediaFileId: input.mediaFileId, pipelineVersion: 'evidence-v2', kind: 'final' } })
    await tx.summary.create({ data: {
      mediaFileId: input.mediaFileId, kind: 'final', shortSummary: input.summary.title,
      detailedSummary: input.summary.summary, keyPointsJson: JSON.stringify(input.summary.keyPoints.map((item) => item.text)),
      decisionsJson: JSON.stringify(input.summary.decisions.map((item) => item.text)),
      risksJson: JSON.stringify(input.summary.problems.map((item) => item.text)),
      openQuestionsJson: JSON.stringify(input.summary.openQuestions.map((item) => item.text)),
      actionItemsJson: JSON.stringify(input.tasks ?? []), modelName: input.modelName, pipelineVersion: 'evidence-v2',
      promptVersion: input.promptVersion, sourceItemsJson: JSON.stringify(input.summary),
      problemsJson: JSON.stringify(input.summary.problems), proposalsJson: JSON.stringify(input.summary.proposals),
    } })
    await tx.processingJob.update({ where: { id: input.jobId }, data: { modelName: input.modelName, promptVersion: input.promptVersion } })
  })
}

export async function replaceEvidenceTasks(input: Pick<Parameters<typeof replaceEvidenceResults>[0], 'mediaFileId' | 'jobId' | 'tasks' | 'modelName' | 'promptVersion'>): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.extractedTask.deleteMany({ where: { mediaFileId: input.mediaFileId, pipelineVersion: 'evidence-v2' } })
    for (const task of input.tasks) {
      const evidence = task.evidence[0]
      await tx.extractedTask.create({ data: {
        mediaFileId: input.mediaFileId, title: task.title, description: task.description ?? '',
        sourceTimecode: evidence ? formatTime(evidence.startSec) : null,
        sourceChunkIndex: evidence?.chunkIndex ?? null, priority: task.priority ?? null,
        assigneeHint: task.assignee ?? null, dueDateHint: task.dueDate ?? null, confidence: task.confidence,
        status: 'DRAFT', pipelineVersion: 'evidence-v2', modelName: input.modelName, promptVersion: input.promptVersion,
        sourceFactIdsJson: JSON.stringify(task.sourceFactIds), evidenceJson: JSON.stringify(task.evidence),
        mergedCandidateIdsJson: JSON.stringify(task.mergedCandidateIds), generatedTitle: task.title,
        generatedDescription: task.description ?? '',
      } })
    }
    await tx.processingJob.update({ where: { id: input.jobId }, data: { modelName: input.modelName, promptVersion: input.promptVersion } })
  })
}

export async function updatePipelineStages(jobId: string, stages: Record<string, string>): Promise<void> {
  await prisma.processingJob.update({ where: { id: jobId }, data: { stagesJson: JSON.stringify(stages) } })
}

export async function replaceTermSuggestions(jobId: string, mediaFileId: string, suggestions: Array<{
  observedForm: string
  proposedCanonical: string
  aliases: string[]
  examples: Array<{ quote: string; startSec: number; endSec: number }>
}>): Promise<void> {
  await prisma.termSuggestion.deleteMany({ where: { processingJobId: jobId, status: 'PROPOSED' } })
  for (const suggestion of suggestions) {
    await prisma.termSuggestion.create({ data: {
      mediaFileId, processingJobId: jobId, observedForm: suggestion.observedForm,
      proposedCanonical: suggestion.proposedCanonical, aliasesJson: JSON.stringify(suggestion.aliases),
      occurrenceCount: suggestion.examples.length, examplesJson: JSON.stringify(suggestion.examples), status: 'PROPOSED',
    } })
  }
}

export async function listTermSuggestions(mediaFileId: string): Promise<TermSuggestion[]> {
  const records = await prisma.termSuggestion.findMany({ where: { mediaFileId }, orderBy: { createdAt: 'desc' } })
  return records.map((record) => ({
    id: record.id, mediaFileId: record.mediaFileId, observedForm: record.observedForm,
    proposedCanonical: record.proposedCanonical, aliases: parseStringArray(record.aliasesJson),
    occurrenceCount: record.occurrenceCount, examples: parseExamples(record.examplesJson),
    status: record.status === 'ACCEPTED' ? 'ACCEPTED' : record.status === 'REJECTED' ? 'REJECTED' : 'PROPOSED',
    createdAt: record.createdAt.toISOString(),
  }))
}

export async function setTermSuggestionStatus(id: string, status: 'ACCEPTED' | 'REJECTED'): Promise<void> {
  await prisma.termSuggestion.update({ where: { id }, data: { status } })
}

export async function getTermSuggestion(id: string): Promise<TermSuggestion | null> {
  const record = await prisma.termSuggestion.findUnique({ where: { id } })
  if (!record) return null
  return {
    id: record.id, mediaFileId: record.mediaFileId, observedForm: record.observedForm,
    proposedCanonical: record.proposedCanonical, aliases: parseStringArray(record.aliasesJson),
    occurrenceCount: record.occurrenceCount, examples: parseExamples(record.examplesJson),
    status: record.status === 'ACCEPTED' ? 'ACCEPTED' : record.status === 'REJECTED' ? 'REJECTED' : 'PROPOSED',
    createdAt: record.createdAt.toISOString(),
  }
}

export async function getSummaryFactEvidence(mediaFileId: string, factIds: string[]) {
  if (factIds.length === 0) return []
  const records = await prisma.mergedFactRecord.findMany({
    where: { mediaFileId, id: { in: [...new Set(factIds)] } },
  })
  return records.map((record) => ({
    id: record.id,
    type: record.type,
    text: record.text,
    evidence: parseExamples(record.evidenceJson).map((item, index) => ({ ...item, chunkIndex: parseEvidenceChunkIndex(record.evidenceJson, index) })),
  }))
}

export async function listEvidenceFacts(mediaFileId: string) {
  const [latestAtomic, latestMerged] = await Promise.all([
    prisma.atomicFactRecord.findFirst({ where: { mediaFileId }, orderBy: { createdAt: 'desc' } }),
    prisma.mergedFactRecord.findFirst({ where: { mediaFileId }, orderBy: { createdAt: 'desc' } }),
  ])
  const [atomic, merged] = await Promise.all([
    latestAtomic ? prisma.atomicFactRecord.findMany({
      where: { mediaFileId, processingJobId: latestAtomic.processingJobId },
      orderBy: [{ chunkIndex: 'asc' }, { startSec: 'asc' }],
    }) : [],
    latestMerged ? prisma.mergedFactRecord.findMany({
      where: { mediaFileId, processingJobId: latestMerged.processingJobId },
      orderBy: { createdAt: 'asc' },
    }) : [],
  ])
  return {
    atomic: atomic.map((fact) => ({
      id: fact.id,
      type: fact.type,
      text: fact.text,
      evidenceQuote: fact.evidenceQuote,
      startSec: fact.startSec,
      endSec: fact.endSec,
      chunkIndex: fact.chunkIndex,
      speaker: fact.speaker,
      explicit: fact.explicit,
      validationStatus: fact.validationStatus,
      validationErrors: parseStringArray(fact.validationErrorsJson),
      repairUsed: fact.repairUsed,
      modelName: fact.modelName,
      promptVersion: fact.promptVersion,
    })),
    merged: merged.map((fact) => ({
      id: fact.id,
      type: fact.type,
      text: fact.text,
      evidence: parseEvidence(fact.evidenceJson),
      sourceFactIds: parseStringArray(fact.sourceFactIdsJson),
    })),
  }
}

export function hashInput(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function parseStringArray(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch { return [] }
}

function parseExamples(value: string): Array<{ quote: string; startSec: number; endSec: number }> {
  try {
    const parsed: unknown = JSON.parse(value)
    if (!Array.isArray(parsed)) return []
    return parsed.flatMap((item) => {
      if (!item || typeof item !== 'object') return []
      const object = item as Record<string, unknown>
      return typeof object.quote === 'string' && typeof object.startSec === 'number' && typeof object.endSec === 'number'
        ? [{ quote: object.quote, startSec: object.startSec, endSec: object.endSec }]
        : []
    })
  } catch { return [] }
}

function parseEvidence(value: string): MergedFact['evidence'] {
  try {
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed) ? parsed as MergedFact['evidence'] : []
  } catch { return [] }
}

function parseEvidenceChunkIndex(value: string, index: number): number {
  try {
    const parsed: unknown = JSON.parse(value)
    if (!Array.isArray(parsed)) return 0
    const item = parsed[index]
    return item && typeof item === 'object' && typeof (item as Record<string, unknown>).chunkIndex === 'number'
      ? (item as { chunkIndex: number }).chunkIndex
      : 0
  } catch { return 0 }
}

function formatTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60)
  const remaining = Math.floor(seconds % 60)
  return `${String(minutes).padStart(2, '0')}:${String(remaining).padStart(2, '0')}`
}
