import fs from 'node:fs'
import type { ProcessingPlan, ProcessingStage } from '@wisploc/shared'
import { getPrisma } from '../database'
import { getMediaRecordRaw } from '../media'

const ORDER: ProcessingStage[] = [
  'transcription',
  'normalization',
  'fact-extraction',
  'fact-deduplication',
  'summary',
  'tasks',
  'term-discovery',
]

export async function buildProcessingPlan(mediaFileId: string, requestedStages: ProcessingStage[]): Promise<ProcessingPlan> {
  const prisma = getPrisma()
  const [media, transcriptCount, factCount, mergedFactCount, summaryCount, taskCount, termCount] = await Promise.all([
    getMediaRecordRaw(mediaFileId),
    prisma.transcriptSegment.count({ where: { mediaFileId } }),
    prisma.atomicFactRecord.count({ where: { mediaFileId, validationStatus: 'valid' } }),
    prisma.mergedFactRecord.count({ where: { mediaFileId } }),
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
  await prisma.$transaction([
    prisma.atomicFactRecord.deleteMany({ where: { mediaFileId } }),
    prisma.mergedFactRecord.deleteMany({ where: { mediaFileId } }),
    prisma.summaryBatchCheckpoint.deleteMany({ where: { mediaFileId } }),
    prisma.summary.deleteMany({ where: { mediaFileId, pipelineVersion: 'evidence-v2' } }),
    prisma.extractedTask.deleteMany({ where: { mediaFileId, pipelineVersion: 'evidence-v2' } }),
    prisma.termSuggestion.deleteMany({ where: { mediaFileId, status: 'PROPOSED' } }),
  ])
}

export async function invalidateAfterFactExtraction(mediaFileId: string, processingJobId: string): Promise<void> {
  const prisma = getPrisma()
  await prisma.$transaction([
    prisma.atomicFactRecord.deleteMany({ where: { mediaFileId, processingJobId: { not: processingJobId } } }),
    prisma.mergedFactRecord.deleteMany({ where: { mediaFileId } }),
    prisma.summaryBatchCheckpoint.deleteMany({ where: { mediaFileId } }),
    prisma.summary.deleteMany({ where: { mediaFileId, pipelineVersion: 'evidence-v2' } }),
    prisma.extractedTask.deleteMany({ where: { mediaFileId, pipelineVersion: 'evidence-v2' } }),
  ])
}

export async function invalidateAfterFactDeduplication(mediaFileId: string, processingJobId: string): Promise<void> {
  const prisma = getPrisma()
  await prisma.$transaction([
    prisma.mergedFactRecord.deleteMany({ where: { mediaFileId, processingJobId: { not: processingJobId } } }),
    prisma.summaryBatchCheckpoint.deleteMany({ where: { mediaFileId } }),
    prisma.summary.deleteMany({ where: { mediaFileId, pipelineVersion: 'evidence-v2' } }),
    prisma.extractedTask.deleteMany({ where: { mediaFileId, pipelineVersion: 'evidence-v2' } }),
  ])
}
