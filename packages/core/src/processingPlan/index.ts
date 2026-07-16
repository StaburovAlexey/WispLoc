import fs from 'node:fs'
import type { ProcessingPlan, ProcessingStage } from '@wisploc/shared'
import { getPrisma } from '../database'
import { getMediaRecordRaw } from '../media'

const ORDER: ProcessingStage[] = [
  'transcription',
  'normalization',
  'fact-extraction',
  'fact-deduplication',
  'tasks',
  'summary',
  'term-discovery',
]

export async function buildProcessingPlan(mediaFileId: string, requestedStages: ProcessingStage[]): Promise<ProcessingPlan> {
  const prisma = getPrisma()
  const [media, transcriptCount, factCount, mergedFactCount, summaryCount, taskCount, termCount] = await Promise.all([
    getMediaRecordRaw(mediaFileId),
    prisma.transcriptSegment.count({ where: { mediaFileId } }),
    prisma.atomicFactRecord.count({ where: { mediaFileId, validationStatus: 'valid', processingJob: { status: { in: ['DONE', 'DONE_WITH_WARNINGS'] } } } }),
    prisma.mergedFactRecord.count({ where: { mediaFileId, processingJob: { status: { in: ['DONE', 'DONE_WITH_WARNINGS'] } } } }),
    prisma.summary.count({ where: { mediaFileId, kind: 'final' } }),
    prisma.extractedTask.count({ where: { mediaFileId } }),
    prisma.termSuggestion.count({ where: { mediaFileId } }),
  ])
  if (!media) throw new Error('Media not found')

  const artifacts = {
    transcript: transcriptCount > 0,
    facts: factCount > 0,
    mergedFacts: mergedFactCount > 0,
    summary: summaryCount > 0,
    tasks: taskCount > 0,
    terms: termCount > 0,
  }
  const resolved = resolveProcessingStages(requestedStages, artifacts)

  if (resolved.executionStages.includes('transcription') && !fs.existsSync(media.sourcePath)) {
    throw new Error('The original file is unavailable; transcription cannot be run again')
  }

  return { requestedStages: [...new Set(requestedStages)], ...resolved, artifacts }
}

export function resolveProcessingStages(
  requestedStages: ProcessingStage[],
  artifacts: ProcessingPlan['artifacts'],
): Pick<ProcessingPlan, 'executionStages' | 'autoAddedStages'> {
  const selected = new Set(requestedStages)
  const autoAdded = new Set<ProcessingStage>()
  const add = (stage: ProcessingStage) => {
    if (selected.has(stage)) return
    selected.add(stage)
    autoAdded.add(stage)
  }

  const ensureTranscript = () => {
    if (!artifacts.transcript && !selected.has('transcription')) add('transcription')
  }
  const ensureFacts = () => {
    if (artifacts.facts || selected.has('fact-extraction')) return
    add('fact-extraction')
    ensureTranscript()
  }
  const ensureMergedFacts = () => {
    if (artifacts.mergedFacts || selected.has('fact-deduplication')) return
    add('fact-deduplication')
    ensureFacts()
  }

  if (selected.has('normalization') || selected.has('fact-extraction') || selected.has('term-discovery')) ensureTranscript()
  if (selected.has('fact-deduplication')) ensureFacts()
  if (selected.has('summary') || selected.has('tasks')) ensureMergedFacts()

  return {
    executionStages: ORDER.filter((stage) => selected.has(stage)),
    autoAddedStages: ORDER.filter((stage) => autoAdded.has(stage)),
  }
}

export async function invalidateAfterTranscription(mediaFileId: string): Promise<void> {
  const prisma = getPrisma()
  const replaceableTaskIds = await findReplaceableTaskIds(mediaFileId)
  await prisma.$transaction([
    prisma.atomicFactRecord.deleteMany({ where: { mediaFileId } }),
    prisma.mergedFactRecord.deleteMany({ where: { mediaFileId } }),
    prisma.summaryBatchCheckpoint.deleteMany({ where: { mediaFileId } }),
    prisma.summary.deleteMany({ where: { mediaFileId, pipelineVersion: 'evidence-v2' } }),
    prisma.extractedTask.deleteMany({ where: { id: { in: replaceableTaskIds } } }),
    prisma.termSuggestion.deleteMany({ where: { mediaFileId, status: 'PROPOSED' } }),
  ])
}

export async function invalidateAfterFactExtraction(mediaFileId: string, processingJobId: string): Promise<void> {
  const prisma = getPrisma()
  const replaceableTaskIds = await findReplaceableTaskIds(mediaFileId)
  void processingJobId
  await prisma.$transaction([
    prisma.extractedTask.deleteMany({ where: { id: { in: replaceableTaskIds } } }),
  ])
}

export async function invalidateAfterFactDeduplication(mediaFileId: string, processingJobId: string): Promise<void> {
  const prisma = getPrisma()
  const replaceableTaskIds = await findReplaceableTaskIds(mediaFileId)
  void processingJobId
  await prisma.$transaction([
    prisma.extractedTask.deleteMany({ where: { id: { in: replaceableTaskIds } } }),
  ])
}

async function findReplaceableTaskIds(mediaFileId: string): Promise<string[]> {
  const prisma = getPrisma()
  const candidates = await prisma.extractedTask.findMany({
    where: { mediaFileId, pipelineVersion: 'evidence-v2', status: 'DRAFT', externalTasks: { none: {} } },
    select: { id: true, title: true, description: true, generatedTitle: true, generatedDescription: true },
  })
  return candidates.filter((task) => (
    task.generatedTitle !== null
    && task.generatedDescription !== null
    && task.title === task.generatedTitle
    && task.description === task.generatedDescription
  )).map((task) => task.id)
}
