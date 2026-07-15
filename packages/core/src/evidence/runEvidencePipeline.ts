import type { DraftTask, EvidenceFinalSummary, ProcessingStageStatus, ValidatedFact } from '@wisploc/shared'
import { loadConfig } from '../config'
import { invalidateAfterFactDeduplication, invalidateAfterFactExtraction } from '../processingPlan'
import { listActiveDictionaryEntries } from '../dictionary'
import { createLogger } from '../logger'
import { getJob, updateJobProgress } from '../jobs'
import { calculateTaskConfidence } from './confidence'
import { createTranscriptChunks } from './chunkTranscript'
import { deduplicateFacts, deduplicateTasks, semanticDeduplicateFacts } from './deduplicate'
import { discoverTermSuggestions, extractAtomicFacts, extractTasksFromFacts, generateEvidenceSummary, repairAtomicFact } from './generate'
import { normalizeTerms } from './normalizeTerms'
import { PROMPT_VERSIONS } from './promptVersions'
import {
  loadEvidenceSegments,
  clearFactsForChunk,
  loadLatestMergedFacts,
  loadValidFactsForChunk,
  persistTranscriptChunks,
  persistValidatedFacts,
  replaceEvidenceSummary,
  replaceEvidenceTasks,
  replaceMergedFacts,
  replaceTaskCandidates,
  replaceTermSuggestions,
  saveNormalizedSegment,
  updatePipelineStages,
} from './repository'
import { validateFacts } from './validateFacts'

const evidenceLog = createLogger('evidence-pipeline', 'worker.log')

export async function runEvidenceAnalysis(mediaFileId: string, jobId: string): Promise<void> {
  const controller = new AbortController()
  const poll = setInterval(() => {
    getJob(jobId)
      .then((current) => {
        if (current?.status === 'CANCELLED' && !controller.signal.aborted) {
          controller.abort(new Error('Job cancelled'))
        }
      })
      .catch((error) => evidenceLog.warn('cancellation status check failed', { jobId, error }))
  }, 500)
  poll.unref()

  try {
    await runEvidenceAnalysisWithSignal(mediaFileId, jobId, controller.signal)
  } catch (error) {
    if (controller.signal.aborted) throw new Error('Job cancelled')
    throw error
  } finally {
    clearInterval(poll)
  }
}

async function runEvidenceAnalysisWithSignal(mediaFileId: string, jobId: string, signal: AbortSignal): Promise<void> {
  const job = await getJob(jobId)
  if (!job) throw new Error(`Processing job ${jobId} not found`)
  const config = loadConfig()
  const requested = new Set(job.requestedStages)
  const stages: Record<string, ProcessingStageStatus> = {
    normalization: requested.has('normalization') ? 'pending' : 'skipped',
    fact_extraction: requested.has('fact-extraction') ? 'pending' : 'skipped',
    fact_deduplication: requested.has('fact-deduplication') ? 'pending' : 'skipped',
    summary: requested.has('summary') ? 'pending' : 'skipped',
    tasks: requested.has('tasks') ? 'pending' : 'skipped',
    term_discovery: requested.has('term-discovery') ? 'pending' : 'skipped',
  }
  const setStage = async (stage: string, status: ProcessingStageStatus) => {
    stages[stage] = status
    await updatePipelineStages(jobId, stages)
  }

  evidenceLog.info('evidence analysis started', {
    mediaFileId, jobId, pipelineVersion: job.pipelineVersion, modelName: config.llmModel,
    useDictionary: job.useDictionary, discoverTerms: job.discoverTerms,
  })
  signal.throwIfAborted()
  let segments = await loadEvidenceSegments(mediaFileId)
  if (segments.length === 0) throw new Error('Evidence pipeline requires persisted transcript segments')
  if (segments.some((segment) => segment.startSec < 0 || segment.endSec <= segment.startSec)) {
    throw new Error('Persisted transcript contains invalid or zeroed timestamp ranges')
  }

  if (requested.has('normalization')) {
    await updateJobProgress(jobId, { progress: 81, currentStep: 'normalization' })
    await setStage('normalization', 'running')
  }
  if (requested.has('normalization') && job.useDictionary) {
    const entries = await listActiveDictionaryEntries()
    for (const segment of segments) {
      signal.throwIfAborted()
      const result = normalizeTerms(segment.originalText, entries)
      await saveNormalizedSegment(segment.id, result.normalizedText, result.replacements)
    }
    segments = await loadEvidenceSegments(mediaFileId)
  } else if (requested.has('normalization')) {
    segments = segments.map((segment) => ({ ...segment, normalizedText: segment.originalText }))
  }
  if (requested.has('normalization')) await setStage('normalization', 'completed')

  const chunks = createTranscriptChunks(mediaFileId, segments)
  await persistTranscriptChunks(jobId, chunks)

  const validFacts: ValidatedFact[] = []
  if (requested.has('fact-extraction')) await setStage('fact_extraction', 'running')
  for (const chunk of chunks) {
    signal.throwIfAborted()
    if (!requested.has('fact-extraction')) {
      const restored = await loadValidFactsForChunk(mediaFileId, jobId, chunk.index)
      validFacts.push(...restored)
      continue
    }
    await clearFactsForChunk(jobId, chunk.index)
    await updateJobProgress(jobId, {
      progress: 82 + Math.round((chunk.index / Math.max(1, chunks.length)) * 7),
      currentStep: `extracting_facts_${chunk.index + 1}_of_${chunks.length}`,
    })
    const facts = await extractAtomicFacts({ mediaFileId, chunk, signal })
    const chunkSegments = segments.filter((segment) => chunk.segmentIds.includes(segment.id))
    const validation = validateFacts(facts, chunk.index, chunkSegments)
    const repairedFacts: ValidatedFact[] = []
    const repairUsedIds = new Set<string>()
    for (const invalidFact of validation.invalidFacts) {
      try {
        signal.throwIfAborted()
        const repaired = await repairAtomicFact({ fact: invalidFact, chunk, errors: invalidFact.validationErrors, signal })
        const repairedValidation = validateFacts([repaired], chunk.index, chunkSegments)
        repairUsedIds.add(invalidFact.id)
        repairedFacts.push(...repairedValidation.validFacts, ...repairedValidation.invalidFacts)
      } catch (error) {
        evidenceLog.warn('targeted fact repair failed', { mediaFileId, jobId, chunkIndex: chunk.index, factId: invalidFact.id, error })
        repairedFacts.push(invalidFact)
      }
    }
    const allValidated = [...validation.validFacts, ...repairedFacts]
    await persistValidatedFacts(jobId, allValidated, config.llmModel, PROMPT_VERSIONS.factExtraction, repairUsedIds)
    validFacts.push(...allValidated.filter((fact) => fact.validationStatus === 'valid'))
    evidenceLog.info('fact chunk processed', {
      mediaFileId, jobId, chunkIndex: chunk.index, factCount: facts.length,
      validFactCount: validation.validFacts.length, invalidFactCount: validation.invalidFacts.length,
    })
  }
  if (requested.has('fact-extraction')) {
    await invalidateAfterFactExtraction(mediaFileId, jobId)
    await setStage('fact_extraction', 'completed')
  }

  let mergedFacts = await loadLatestMergedFacts(mediaFileId)
  if (requested.has('fact-deduplication')) {
    await updateJobProgress(jobId, { progress: 90, currentStep: 'fact_deduplication' })
    await setStage('fact_deduplication', 'running')
    signal.throwIfAborted()
    const initiallyMergedFacts = deduplicateFacts(validFacts)
    mergedFacts = config.deduplicationLevel === 'fast'
      ? initiallyMergedFacts
      : await semanticDeduplicateFacts(initiallyMergedFacts, signal, config.deduplicationLevel === 'precise' ? 0.45 : 0.55)
    await replaceMergedFacts(jobId, mergedFacts)
    await invalidateAfterFactDeduplication(mediaFileId, jobId)
    await setStage('fact_deduplication', 'completed')
  }

  let drafts: DraftTask[] = []
  if (requested.has('tasks')) {
    await updateJobProgress(jobId, { progress: 92, currentStep: 'tasks' })
    await setStage('tasks', 'running')
    signal.throwIfAborted()
    const candidates = await extractTasksFromFacts(mediaFileId, mergedFacts, signal)
    const deduplicated = deduplicateTasks(candidates)
    await replaceTaskCandidates(jobId, deduplicated)
    drafts = deduplicated.map((task) => ({
    ...task,
    confidence: calculateTaskConfidence({
      quoteValidated: task.evidence.length > 0, timecodeValidated: task.evidence.every((item) => item.endSec >= item.startSec),
      explicitAction: task.explicitAction, explicitAssignee: task.explicitAssignee,
      explicitDueDate: task.explicitDueDate, multipleEvidenceItems: task.evidence.length > 1, segmentMatch: true,
    }),
    status: 'DRAFT',
    }))
    await setStage('tasks', 'completed')
  }

  let summary: EvidenceFinalSummary | null = null
  if (requested.has('summary')) {
    await updateJobProgress(jobId, { progress: 95, currentStep: 'summary' })
    await setStage('summary', 'running')
    summary = mergedFacts.length > 0 ? await generateEvidenceSummary(mediaFileId, mergedFacts, drafts, signal) : emptySummary()
    await setStage('summary', 'completed')
  }

  if (requested.has('term-discovery')) {
    await updateJobProgress(jobId, { progress: 97, currentStep: 'term_discovery' })
    await setStage('term_discovery', 'running')
    signal.throwIfAborted()
    const suggestions = await discoverTermSuggestions(mediaFileId, segments, signal)
    await replaceTermSuggestions(jobId, mediaFileId, suggestions)
    await setStage('term_discovery', 'completed')
  }

  signal.throwIfAborted()
  if (summary) await replaceEvidenceSummary({ mediaFileId, jobId, summary, tasks: requested.has('tasks') ? drafts : undefined, modelName: config.llmModel, promptVersion: PROMPT_VERSIONS.finalSummary })
  if (requested.has('tasks')) await replaceEvidenceTasks({ mediaFileId, jobId, tasks: drafts, modelName: config.llmModel, promptVersion: PROMPT_VERSIONS.taskExtraction })
  evidenceLog.info('evidence analysis completed', {
    mediaFileId, jobId, factCount: validFacts.length, mergedFactCount: mergedFacts.length,
    taskCount: drafts.length, useDictionary: job.useDictionary, discoverTerms: job.discoverTerms,
  })
}

function emptySummary(): EvidenceFinalSummary {
  return { title: 'Содержательной речи не обнаружено', summary: 'Подтверждённые факты отсутствуют.', keyPoints: [], decisions: [], problems: [], openQuestions: [], proposals: [] }
}
