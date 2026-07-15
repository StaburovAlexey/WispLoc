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
import type { RetrievalContext } from '../knowledge'
import { createUserCorrection } from '../knowledge/repository'

const prisma = getPrisma()

export interface ArtifactMetadata {
  artifactGenerationId?: string
  inputHash?: string
  dictionaryHash?: string
  retrieval?: RetrievalContext
}

export async function loadEvidenceSegments(mediaFileId: string): Promise<EvidenceTranscriptSegment[]> {
  const segments = await prisma.transcriptSegment.findMany({ where: { mediaFileId }, orderBy: [{ startSec: 'asc' }, { endSec: 'asc' }, { sequence: 'asc' }] })
  return segments.map((segment) => ({
    id: segment.id,
    mediaFileId: segment.mediaFileId,
    startSec: segment.startSec,
    endSec: segment.endSec,
    originalText: segment.text,
    normalizedText: undefined,
    speaker: segment.speaker ?? undefined,
    sequence: segment.sequence,
  }))
}

export async function saveNormalizedSegment(input: {
  mediaFileId: string
  processingJobId: string
  segmentId: string
  normalizedText: string
  replacements: unknown[]
  dictionaryHash: string
}): Promise<void> {
  await prisma.normalizedTranscriptSegment.upsert({
    where: { processingJobId_segmentId: { processingJobId: input.processingJobId, segmentId: input.segmentId } },
    create: {
      mediaFileId: input.mediaFileId,
      processingJobId: input.processingJobId,
      segmentId: input.segmentId,
      normalizedText: input.normalizedText,
      replacementsJson: JSON.stringify(input.replacements),
      dictionaryHash: input.dictionaryHash,
      normalizationPromptVersion: 'normalization-v1',
    },
    update: {
      normalizedText: input.normalizedText,
      replacementsJson: JSON.stringify(input.replacements),
      dictionaryHash: input.dictionaryHash,
      normalizationPromptVersion: 'normalization-v1',
    },
  })
}

export async function persistTranscriptChunks(jobId: string, chunks: TranscriptChunk[], metadata: ArtifactMetadata = {}): Promise<void> {
  for (const chunk of chunks) {
    const inputHash = hashInput(JSON.stringify(chunk))
    await prisma.evidenceTranscriptChunk.upsert({
      where: { processingJobId_index: { processingJobId: jobId, index: chunk.index } },
      create: {
        mediaFileId: chunk.mediaFileId, processingJobId: jobId, index: chunk.index,
        startSec: chunk.startSec, endSec: chunk.endSec, segmentIdsJson: JSON.stringify(chunk.segmentIds),
        originalText: chunk.originalText, normalizedText: chunk.normalizedText, inputHash,
        artifactGenerationId: metadata.artifactGenerationId, dictionaryHash: metadata.dictionaryHash,
      },
      update: {
        startSec: chunk.startSec, endSec: chunk.endSec, segmentIdsJson: JSON.stringify(chunk.segmentIds),
        originalText: chunk.originalText, normalizedText: chunk.normalizedText, inputHash,
        artifactGenerationId: metadata.artifactGenerationId, dictionaryHash: metadata.dictionaryHash,
      },
    })
  }
}

export async function clearFactsForChunk(jobId: string, chunkIndex: number): Promise<void> {
  await prisma.atomicFactRecord.deleteMany({ where: { processingJobId: jobId, chunkIndex } })
}

export async function persistValidatedFacts(
  jobId: string,
  facts: ValidatedFact[],
  modelName: string,
  promptVersion: string,
  repairUsedIds: Set<string> = new Set(),
  metadata: ArtifactMetadata = {},
): Promise<void> {
  for (const fact of facts) {
    await prisma.atomicFactRecord.upsert({
      where: { id: fact.id },
      create: {
        id: fact.id, mediaFileId: fact.mediaFileId, processingJobId: jobId, chunkIndex: fact.chunkIndex,
        type: fact.type, text: fact.text, evidenceQuote: fact.evidenceQuote, startSec: fact.startSec, endSec: fact.endSec,
        speaker: fact.speaker ?? null, explicit: fact.explicit, validationStatus: fact.validationStatus,
        validationErrorsJson: JSON.stringify(fact.validationErrors), promptVersion, modelName, repairUsed: repairUsedIds.has(fact.id),
        schemaVersion: 'atomic-fact-v2',
        artifactGenerationId: metadata.artifactGenerationId, inputHash: metadata.inputHash,
        dictionaryHash: metadata.dictionaryHash, retrievalVersion: metadata.retrieval?.retrievalVersion,
        retrievalManifestJson: metadata.retrieval ? JSON.stringify(retrievalManifest(metadata.retrieval)) : null,
      },
      update: {
        validationStatus: fact.validationStatus, validationErrorsJson: JSON.stringify(fact.validationErrors),
        startSec: fact.startSec, endSec: fact.endSec, repairUsed: repairUsedIds.has(fact.id),
        schemaVersion: 'atomic-fact-v2',
        artifactGenerationId: metadata.artifactGenerationId, inputHash: metadata.inputHash,
        dictionaryHash: metadata.dictionaryHash, retrievalVersion: metadata.retrieval?.retrievalVersion,
        retrievalManifestJson: metadata.retrieval ? JSON.stringify(retrievalManifest(metadata.retrieval)) : null,
      },
    })
  }
}

export async function replaceMergedFacts(jobId: string, facts: MergedFact[], modelName: string, promptVersion: string, metadata: ArtifactMetadata = {}): Promise<void> {
  await prisma.mergedFactRecord.deleteMany({ where: { processingJobId: jobId } })
  if (facts.length === 0) return
  await prisma.mergedFactRecord.createMany({ data: facts.map((fact) => ({
    id: fact.id, mediaFileId: fact.mediaFileId, processingJobId: jobId, type: fact.type, text: fact.text,
    evidenceJson: JSON.stringify(fact.evidence), sourceFactIdsJson: JSON.stringify(fact.sourceFactIds),
    artifactGenerationId: metadata.artifactGenerationId, inputHash: metadata.inputHash,
    modelName, promptVersion, dictionaryHash: metadata.dictionaryHash,
    retrievalVersion: metadata.retrieval?.retrievalVersion,
    retrievalManifestJson: metadata.retrieval ? JSON.stringify(retrievalManifest(metadata.retrieval)) : null,
  })) })
}

export async function loadLatestMergedFacts(mediaFileId: string): Promise<MergedFact[]> {
  const latest = await prisma.mergedFactRecord.findFirst({
    where: { mediaFileId, processingJob: { status: { in: ['DONE', 'DONE_WITH_WARNINGS'] } } },
    orderBy: { createdAt: 'desc' },
  })
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
  processingJobId: string
  artifactGenerationId?: string
  batchIndex: number
  inputHash: string
  summary: EvidenceSummaryBatch
  modelName: string
  promptVersion: string
  dictionaryHash?: string
  retrieval?: RetrievalContext
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
        processingJobId: input.processingJobId,
        artifactGenerationId: input.artifactGenerationId,
        dictionaryHash: input.dictionaryHash,
        retrievalVersion: input.retrieval?.retrievalVersion,
        retrievalManifestJson: input.retrieval ? JSON.stringify(retrievalManifest(input.retrieval)) : null,
      },
      update: {
        summaryJson: JSON.stringify(input.summary),
        modelName: input.modelName,
        promptVersion: input.promptVersion,
        processingJobId: input.processingJobId,
        artifactGenerationId: input.artifactGenerationId,
        dictionaryHash: input.dictionaryHash,
        retrievalVersion: input.retrieval?.retrievalVersion,
        retrievalManifestJson: input.retrieval ? JSON.stringify(retrievalManifest(input.retrieval)) : null,
      },
    }),
  ])
}

export async function loadFactChunkCheckpoint(
  mediaFileId: string,
  chunkIndex: number,
  inputHash: string,
): Promise<ValidatedFact[] | null> {
  const record = await prisma.factChunkCheckpoint.findUnique({
    where: { mediaFileId_chunkIndex_inputHash: { mediaFileId, chunkIndex, inputHash } },
  })
  if (!record) return null
  try {
    const parsed: unknown = JSON.parse(record.factsJson)
    return Array.isArray(parsed) ? parsed as ValidatedFact[] : null
  } catch {
    await prisma.factChunkCheckpoint.delete({ where: { id: record.id } })
    return null
  }
}

export async function saveFactChunkCheckpoint(input: {
  mediaFileId: string
  chunkIndex: number
  inputHash: string
  facts: ValidatedFact[]
  modelName: string
  promptVersion: string
  dictionaryHash?: string
  retrieval?: RetrievalContext
}): Promise<void> {
  await prisma.factChunkCheckpoint.upsert({
    where: { mediaFileId_chunkIndex_inputHash: {
      mediaFileId: input.mediaFileId,
      chunkIndex: input.chunkIndex,
      inputHash: input.inputHash,
    } },
    create: {
      mediaFileId: input.mediaFileId,
      chunkIndex: input.chunkIndex,
      inputHash: input.inputHash,
      factsJson: JSON.stringify(input.facts),
      modelName: input.modelName,
      promptVersion: input.promptVersion,
      schemaVersion: 'atomic-fact-v2',
      dictionaryHash: input.dictionaryHash,
      retrievalVersion: input.retrieval?.retrievalVersion,
      retrievalManifestJson: input.retrieval ? JSON.stringify(retrievalManifest(input.retrieval)) : null,
    },
    update: {
      factsJson: JSON.stringify(input.facts),
      modelName: input.modelName,
      promptVersion: input.promptVersion,
      schemaVersion: 'atomic-fact-v2',
      dictionaryHash: input.dictionaryHash,
      retrievalVersion: input.retrieval?.retrievalVersion,
      retrievalManifestJson: input.retrieval ? JSON.stringify(retrievalManifest(input.retrieval)) : null,
    },
  })
}

export async function deleteSummaryBatchCheckpoints(mediaFileId: string): Promise<void> {
  await prisma.summaryBatchCheckpoint.deleteMany({ where: { mediaFileId } })
}

export async function pruneSummaryBatchCheckpoints(mediaFileId: string, inputHashes: string[]): Promise<void> {
  // Checkpoints are generation history. Incompatible hashes are ignored by
  // lookup and removed only by explicit maintenance cleanup.
  void mediaFileId
  void inputHashes
}

export async function replaceTaskCandidates(
  jobId: string,
  tasks: Array<TaskCandidate & { mergedCandidateIds: string[] }>,
  modelName: string,
  promptVersion: string,
  metadata: ArtifactMetadata = {},
): Promise<void> {
  await prisma.taskCandidateRecord.deleteMany({ where: { processingJobId: jobId } })
  if (tasks.length === 0) return
  await prisma.taskCandidateRecord.createMany({ data: tasks.map((task) => ({
    id: task.id, mediaFileId: task.mediaFileId, processingJobId: jobId, title: task.title,
    description: task.description ?? null, assignee: task.assignee ?? null, dueDate: task.dueDate ?? null,
    priority: task.priority ?? null, sourceFactIdsJson: JSON.stringify(task.sourceFactIds), evidenceJson: JSON.stringify(task.evidence),
    explicitAction: task.explicitAction, explicitAssignee: task.explicitAssignee, explicitDueDate: task.explicitDueDate,
    mergedCandidateIdsJson: JSON.stringify(task.mergedCandidateIds),
    artifactGenerationId: metadata.artifactGenerationId, inputHash: metadata.inputHash,
    modelName, promptVersion, dictionaryHash: metadata.dictionaryHash,
    retrievalVersion: metadata.retrieval?.retrievalVersion,
    retrievalManifestJson: metadata.retrieval ? JSON.stringify(retrievalManifest(metadata.retrieval)) : null,
  })) })
}

export async function replaceEvidenceResults(input: {
  mediaFileId: string
  jobId: string
  summary: EvidenceFinalSummary
  tasks: DraftTask[]
  modelName: string
  promptVersion: string
  metadata?: ArtifactMetadata
}): Promise<void> {
  await replaceEvidenceSummary(input)
  await replaceEvidenceTasks(input)
}

export async function replaceEvidenceSummary(input: Omit<Parameters<typeof replaceEvidenceResults>[0], 'tasks'> & { tasks?: DraftTask[] }): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.summary.create({ data: {
      mediaFileId: input.mediaFileId, kind: 'final', shortSummary: input.summary.title,
      detailedSummary: input.summary.summary, keyPointsJson: JSON.stringify(input.summary.keyPoints.map((item) => item.text)),
      decisionsJson: JSON.stringify(input.summary.decisions.map((item) => item.text)),
      risksJson: JSON.stringify(input.summary.problems.map((item) => item.text)),
      openQuestionsJson: JSON.stringify(input.summary.openQuestions.map((item) => item.text)),
      actionItemsJson: null, modelName: input.modelName, pipelineVersion: 'evidence-v2',
      promptVersion: input.promptVersion, sourceItemsJson: JSON.stringify(input.summary),
      problemsJson: JSON.stringify(input.summary.problems), proposalsJson: JSON.stringify(input.summary.proposals),
      processingJobId: input.jobId, artifactGenerationId: input.metadata?.artifactGenerationId,
      inputHash: input.metadata?.inputHash, dictionaryHash: input.metadata?.dictionaryHash,
      retrievalVersion: input.metadata?.retrieval?.retrievalVersion,
      retrievalManifestJson: input.metadata?.retrieval ? JSON.stringify(retrievalManifest(input.metadata.retrieval)) : null,
    } })
    await tx.processingJob.update({ where: { id: input.jobId }, data: { modelName: input.modelName, promptVersion: input.promptVersion } })
  })
}

export async function replaceEvidenceTasks(input: Pick<Parameters<typeof replaceEvidenceResults>[0], 'mediaFileId' | 'jobId' | 'tasks' | 'modelName' | 'promptVersion' | 'metadata'>): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const draftCandidates = await tx.extractedTask.findMany({
      where: {
        mediaFileId: input.mediaFileId,
        pipelineVersion: 'evidence-v2',
        status: 'DRAFT',
        externalTasks: { none: {} },
      },
      select: { id: true, title: true, description: true, generatedTitle: true, generatedDescription: true },
    })
    const replaceableIds = draftCandidates.filter((task) => (
      task.generatedTitle !== null
      && task.generatedDescription !== null
      && task.title === task.generatedTitle
      && task.description === task.generatedDescription
    )).map((task) => task.id)
    await tx.extractedTask.deleteMany({
      where: { id: { in: replaceableIds } },
    })
    for (const task of input.tasks) {
      const evidence = task.evidence[0]
      await tx.extractedTask.create({ data: {
        mediaFileId: input.mediaFileId, processingJobId: input.jobId, title: task.title, description: task.description ?? '',
        sourceTimecode: evidence ? formatTime(evidence.startSec) : null,
        sourceChunkIndex: evidence?.chunkIndex ?? null, priority: task.priority ?? null,
        assigneeHint: task.assignee ?? null, dueDateHint: task.dueDate ?? null, confidence: task.confidence,
        confidenceBreakdownJson: JSON.stringify({
          quoteValidated: task.evidence.length > 0,
          timecodeValidated: task.evidence.every((item) => item.endSec >= item.startSec),
          explicitAction: task.explicitAction,
          explicitAssignee: task.explicitAssignee,
          explicitDueDate: task.explicitDueDate,
          multipleEvidenceItems: task.evidence.length > 1,
          segmentMatch: true,
        }),
        status: 'DRAFT', pipelineVersion: 'evidence-v2', modelName: input.modelName, promptVersion: input.promptVersion,
        sourceFactIdsJson: JSON.stringify(task.sourceFactIds), evidenceJson: JSON.stringify(task.evidence),
        mergedCandidateIdsJson: JSON.stringify(task.mergedCandidateIds), generatedTitle: task.title,
        generatedDescription: task.description ?? '',
        artifactGenerationId: input.metadata?.artifactGenerationId, inputHash: input.metadata?.inputHash,
        dictionaryHash: input.metadata?.dictionaryHash,
        retrievalVersion: input.metadata?.retrieval?.retrievalVersion,
        retrievalManifestJson: input.metadata?.retrieval ? JSON.stringify(retrievalManifest(input.metadata.retrieval)) : null,
      } })
    }
    await tx.processingJob.update({ where: { id: input.jobId }, data: { modelName: input.modelName, promptVersion: input.promptVersion } })
  })
}

export async function updatePipelineStages(jobId: string, stages: Record<string, string>): Promise<void> {
  await prisma.processingJob.update({ where: { id: jobId }, data: { stagesJson: JSON.stringify(stages) } })
}

export async function finishRunningPipelineStages(jobId: string, status: 'failed' | 'cancelled'): Promise<void> {
  const job = await prisma.processingJob.findUnique({ where: { id: jobId }, select: { stagesJson: true } })
  if (!job?.stagesJson) return
  try {
    const stages = JSON.parse(job.stagesJson) as Record<string, string>
    for (const [stage, current] of Object.entries(stages)) {
      if (current === 'running') stages[stage] = status
    }
    await updatePipelineStages(jobId, stages)
  } catch {
    // A malformed historical value must not hide the original processing error.
  }
}

export async function startArtifactGeneration(input: {
  mediaFileId: string
  processingJobId: string
  stage: string
  inputHash: string
  pipelineVersion: string
  modelName?: string
  promptVersion?: string
  schemaVersion: string
  dictionaryHash?: string
  retrieval?: RetrievalContext
}): Promise<string> {
  const record = await prisma.artifactGeneration.create({ data: {
    mediaFileId: input.mediaFileId,
    processingJobId: input.processingJobId,
    stage: input.stage,
    inputHash: input.inputHash,
    status: 'running',
    pipelineVersion: input.pipelineVersion,
    modelName: input.modelName,
    promptVersion: input.promptVersion,
    schemaVersion: input.schemaVersion,
    dictionaryHash: input.dictionaryHash,
    retrievalVersion: input.retrieval?.retrievalVersion,
    retrievalManifestJson: input.retrieval ? JSON.stringify(retrievalManifest(input.retrieval)) : null,
  } })
  return record.id
}

export async function finishArtifactGeneration(id: string, status: 'completed' | 'failed' | 'cancelled'): Promise<void> {
  await prisma.artifactGeneration.update({
    where: { id },
    data: { status, completedAt: new Date() },
  })
}

export async function finishRunningArtifactGenerations(processingJobId: string, status: 'failed' | 'cancelled'): Promise<void> {
  await prisma.artifactGeneration.updateMany({
    where: { processingJobId, status: 'running' },
    data: { status, completedAt: new Date() },
  })
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

export async function setTermSuggestionStatus(
  id: string,
  status: 'ACCEPTED' | 'REJECTED',
  corrected?: { canonical: string; aliases: string[] },
): Promise<void> {
  const suggestion = await prisma.termSuggestion.findUnique({ where: { id } })
  if (!suggestion) throw new Error('Term suggestion not found')
  await prisma.termSuggestion.update({ where: { id }, data: { status } })
  await createUserCorrection({
    mediaFileId: suggestion.mediaFileId,
    processingJobId: suggestion.processingJobId,
    stage: 'term-discovery',
    sourceInput: JSON.stringify({ observedForm: suggestion.observedForm, examples: parseExamples(suggestion.examplesJson) }),
    generatedOutputJson: JSON.stringify({
      canonical: suggestion.proposedCanonical,
      aliases: parseStringArray(suggestion.aliasesJson),
    }),
    correctedOutputJson: status === 'REJECTED' ? JSON.stringify({ suggestions: [] }) : JSON.stringify(corrected ?? {
      canonical: suggestion.proposedCanonical,
      aliases: parseStringArray(suggestion.aliasesJson),
    }),
    evidenceJson: suggestion.examplesJson,
  })
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
    prisma.atomicFactRecord.findFirst({ where: { mediaFileId, processingJob: { status: { in: ['DONE', 'DONE_WITH_WARNINGS'] } } }, orderBy: { createdAt: 'desc' } }),
    prisma.mergedFactRecord.findFirst({ where: { mediaFileId, processingJob: { status: { in: ['DONE', 'DONE_WITH_WARNINGS'] } } }, orderBy: { createdAt: 'desc' } }),
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
      schemaVersion: fact.schemaVersion,
      inputHash: fact.inputHash,
      dictionaryHash: fact.dictionaryHash,
      retrievalVersion: fact.retrievalVersion,
      retrievalManifest: parseRetrievalManifest(fact.retrievalManifestJson),
    })),
    merged: merged.map((fact) => ({
      id: fact.id,
      type: fact.type,
      text: fact.text,
      evidence: parseEvidence(fact.evidenceJson),
      sourceFactIds: parseStringArray(fact.sourceFactIdsJson),
      modelName: fact.modelName,
      promptVersion: fact.promptVersion,
      schemaVersion: fact.schemaVersion,
      inputHash: fact.inputHash,
      dictionaryHash: fact.dictionaryHash,
      retrievalVersion: fact.retrievalVersion,
      retrievalManifest: parseRetrievalManifest(fact.retrievalManifestJson),
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

function parseRetrievalManifest(value: string | null): ReturnType<typeof retrievalManifest> | null {
  if (!value) return null
  try {
    const parsed: unknown = JSON.parse(value)
    if (!parsed || typeof parsed !== 'object') return null
    const manifest = parsed as Record<string, unknown>
    return {
      retrievalVersion: typeof manifest.retrievalVersion === 'string' ? manifest.retrievalVersion : '',
      manifestHash: typeof manifest.manifestHash === 'string' ? manifest.manifestHash : '',
      ruleIds: Array.isArray(manifest.ruleIds) ? manifest.ruleIds.filter((item): item is string => typeof item === 'string') : [],
      exampleIds: Array.isArray(manifest.exampleIds) ? manifest.exampleIds.filter((item): item is string => typeof item === 'string') : [],
      glossaryEntryIds: Array.isArray(manifest.glossaryEntryIds) ? manifest.glossaryEntryIds.filter((item): item is string => typeof item === 'string') : [],
      estimatedPromptTokens: typeof manifest.estimatedPromptTokens === 'number' ? manifest.estimatedPromptTokens : 0,
    }
  } catch {
    return null
  }
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

function retrievalManifest(context: RetrievalContext) {
  return {
    retrievalVersion: context.retrievalVersion,
    manifestHash: context.manifestHash,
    ruleIds: context.ruleIds,
    exampleIds: context.exampleIds,
    glossaryEntryIds: context.glossaryEntryIds,
    estimatedPromptTokens: context.estimatedPromptTokens,
  }
}
