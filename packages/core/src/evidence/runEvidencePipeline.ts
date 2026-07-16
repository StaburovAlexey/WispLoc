import type { DraftTask, EvidenceFinalSummary, ProcessingStageStatus, ValidatedFact } from '@wisploc/shared'
import { loadConfig } from '../config'
import { invalidateAfterFactDeduplication, invalidateAfterFactExtraction } from '../processingPlan'
import { calculateDictionaryHash, listActiveDictionaryEntries } from '../dictionary'
import { createLogger } from '../logger'
import { buildRetrievalContext } from '../knowledge'
import type { RetrievalContext } from '../knowledge'
import { getJob, setJobQualityWarnings, updateJobProgress } from '../jobs'
import { calculateTaskConfidence } from './confidence'
import { createTranscriptChunks } from './chunkTranscript'
import { deduplicateFacts, deduplicateTasks, semanticDeduplicateFacts } from './deduplicate'
import { discoverTermSuggestions, extractAtomicFacts, extractTasksFromFacts, generateEvidenceSummary, hasExplicitActionCue } from './generate'
import { evaluateEvidenceQuality, isSubstantiveFact } from './quality'
import { normalizeTerms } from './normalizeTerms'
import { PROMPT_VERSIONS } from './promptVersions'
import {
  loadEvidenceSegments,
  clearFactsForChunk,
  loadLatestMergedFacts,
  loadFactChunkCheckpoint,
  saveFactChunkCheckpoint,
  hashInput,
  persistTranscriptChunks,
  persistValidatedFacts,
  replaceEvidenceSummary,
  replaceEvidenceTasks,
  replaceMergedFacts,
  replaceTaskCandidates,
  replaceTermSuggestions,
  saveNormalizedSegment,
  updatePipelineStages,
  startArtifactGeneration,
  finishArtifactGeneration,
  finishRunningArtifactGenerations,
  finishRunningPipelineStages,
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
    const terminalStatus = controller.signal.aborted ? 'cancelled' : 'failed'
    await Promise.all([
      finishRunningArtifactGenerations(jobId, terminalStatus),
      finishRunningPipelineStages(jobId, terminalStatus),
    ])
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
  let dictionaryHash: string | undefined
  let dictionaryEntries: Awaited<ReturnType<typeof listActiveDictionaryEntries>> = []
  const requested = new Set(job.requestedStages)
  const stages: Record<string, ProcessingStageStatus> = {
    transcription: job.stageStates.transcription ?? (requested.has('transcription') ? 'completed' : 'skipped'),
    normalization: requested.has('normalization') ? 'pending' : 'skipped',
    fact_extraction: requested.has('fact-extraction') ? 'pending' : 'skipped',
    fact_deduplication: requested.has('fact-deduplication') ? 'pending' : 'skipped',
    summary: requested.has('summary') ? 'pending' : 'skipped',
    tasks: requested.has('tasks') ? 'pending' : 'skipped',
    term_discovery: requested.has('term-discovery') ? 'pending' : 'skipped',
  }
  const artifactGenerationIds = new Map<string, string>()
  const setStage = async (stage: string, status: ProcessingStageStatus) => {
    stages[stage] = status
    await updatePipelineStages(jobId, stages)
    if (status === 'running' && !artifactGenerationIds.has(stage)) {
      artifactGenerationIds.set(stage, await startArtifactGeneration({
        mediaFileId,
        processingJobId: jobId,
        stage,
        inputHash: hashInput(JSON.stringify({ mediaFileId, stage, modelName: config.llmModel, pipelineVersion: job.pipelineVersion, dictionaryHash })),
        pipelineVersion: job.pipelineVersion,
        modelName: config.llmModel,
        promptVersion: promptVersionForStage(stage),
        schemaVersion: schemaVersionForStage(stage),
        dictionaryHash,
      }))
    }
    if (status === 'completed' || status === 'reused') {
      const generationId = artifactGenerationIds.get(stage)
      if (generationId) await finishArtifactGeneration(generationId, 'completed')
    }
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

  if (requested.has('normalization') && job.useDictionary) {
    dictionaryEntries = await listActiveDictionaryEntries()
    dictionaryHash = calculateDictionaryHash(dictionaryEntries)
  }
  if (requested.has('normalization')) {
    await updateJobProgress(jobId, { progress: 81, currentStep: 'normalization' })
    await setStage('normalization', 'running')
  }
  if (requested.has('normalization') && job.useDictionary) {
    if (!dictionaryHash) throw new Error('Dictionary hash was not prepared for normalization')
    const normalizedBySegment = new Map<string, string>()
    for (const segment of segments) {
      signal.throwIfAborted()
      const result = normalizeTerms(segment.originalText, dictionaryEntries)
      normalizedBySegment.set(segment.id, result.normalizedText)
      await saveNormalizedSegment({
        mediaFileId,
        processingJobId: jobId,
        segmentId: segment.id,
        normalizedText: result.normalizedText,
        replacements: result.replacements,
        dictionaryHash,
      })
    }
    segments = segments.map((segment) => ({
      ...segment,
      normalizedText: normalizedBySegment.get(segment.id) ?? segment.originalText,
    }))
  } else if (requested.has('normalization')) {
    segments = segments.map((segment) => ({ ...segment, normalizedText: segment.originalText }))
  } else {
    segments = segments.map((segment) => ({ ...segment, normalizedText: segment.originalText }))
  }
  if (requested.has('normalization')) await setStage('normalization', 'completed')

  const chunks = createTranscriptChunks(mediaFileId, segments)
  await persistTranscriptChunks(jobId, chunks, {
    artifactGenerationId: artifactGenerationIds.get('normalization'), dictionaryHash,
  })

  const validFacts: ValidatedFact[] = []
  const allValidatedFacts: ValidatedFact[] = []
  let reusedFactChunks = 0
  const prepareFactChunk = async (chunk: (typeof chunks)[number]) => {
    const retrieval = await buildRetrievalContext({
      stage: 'fact-extraction',
      language: config.summaryLanguage.toLowerCase().startsWith('en') ? 'en' : 'ru',
      text: chunk.originalText,
      maxExamples: 3,
    }, `${mediaFileId}:facts:${chunk.index}`)
    const inputHash = hashInput(JSON.stringify({
      chunk: {
        startSec: chunk.startSec,
        endSec: chunk.endSec,
        segmentIds: chunk.segmentIds,
        originalText: chunk.originalText,
        normalizedText: chunk.normalizedText,
      },
      modelName: config.llmModel,
      promptVersion: PROMPT_VERSIONS.factExtraction,
      schemaVersion: 'atomic-fact-v2',
      dictionaryHash,
      retrievalVersion: retrieval.retrievalVersion,
      retrievalManifestHash: retrieval.manifestHash,
    }))
    return { retrieval, inputHash }
  }
  if (requested.has('fact-extraction')) await setStage('fact_extraction', 'running')
  if (!requested.has('fact-extraction') && requested.has('fact-deduplication')) {
    for (const chunk of chunks) {
      const prepared = await prepareFactChunk(chunk)
      const checkpoint = await loadFactChunkCheckpoint(mediaFileId, chunk.index, prepared.inputHash)
      if (!checkpoint) throw new Error(`No compatible fact checkpoint is available for chunk ${chunk.index + 1}; rerun fact extraction`)
      allValidatedFacts.push(...checkpoint)
      validFacts.push(...checkpoint.filter((fact) => fact.validationStatus === 'valid'))
    }
  }
  for (const chunk of chunks) {
    signal.throwIfAborted()
    if (!requested.has('fact-extraction')) {
      continue
    }
    const { retrieval, inputHash: factInputHash } = await prepareFactChunk(chunk)
    const checkpoint = await loadFactChunkCheckpoint(mediaFileId, chunk.index, factInputHash)
    if (checkpoint) {
      reusedFactChunks += 1
      await persistValidatedFacts(jobId, checkpoint, config.llmModel, PROMPT_VERSIONS.factExtraction, new Set(), {
        artifactGenerationId: artifactGenerationIds.get('fact_extraction'), inputHash: factInputHash, dictionaryHash, retrieval,
      })
      allValidatedFacts.push(...checkpoint)
      validFacts.push(...checkpoint.filter((fact) => fact.validationStatus === 'valid'))
      evidenceLog.info('fact chunk checkpoint reused', { mediaFileId, jobId, chunkIndex: chunk.index, factInputHash })
      continue
    }
    await clearFactsForChunk(jobId, chunk.index)
    await updateJobProgress(jobId, {
      progress: 82 + Math.round((chunk.index / Math.max(1, chunks.length)) * 7),
      currentStep: `extracting_facts_${chunk.index + 1}_of_${chunks.length}`,
    })
    const chunkSegments = segments.filter((segment) => chunk.segmentIds.includes(segment.id))
    const facts = await extractAtomicFacts({ mediaFileId, chunk, segments: chunkSegments, signal, retrieval })
    const validation = validateFacts(facts, chunk.index, chunkSegments)
    const allValidated = [...validation.validFacts, ...validation.invalidFacts]
    await persistValidatedFacts(jobId, allValidated, config.llmModel, PROMPT_VERSIONS.factExtraction, new Set(), {
      artifactGenerationId: artifactGenerationIds.get('fact_extraction'), inputHash: factInputHash, dictionaryHash, retrieval,
    })
    await saveFactChunkCheckpoint({
      mediaFileId,
      chunkIndex: chunk.index,
      inputHash: factInputHash,
      facts: allValidated,
      modelName: config.llmModel,
      promptVersion: PROMPT_VERSIONS.factExtraction,
      dictionaryHash,
      retrieval,
    })
    allValidatedFacts.push(...allValidated)
    validFacts.push(...allValidated.filter((fact) => fact.validationStatus === 'valid'))
    evidenceLog.info('fact chunk processed', {
      mediaFileId, jobId, chunkIndex: chunk.index, factCount: facts.length,
      validFactCount: validation.validFacts.length, invalidFactCount: validation.invalidFacts.length,
    })
  }
  if (requested.has('fact-extraction')) {
    await invalidateAfterFactExtraction(mediaFileId, jobId)
    await setStage('fact_extraction', reusedFactChunks === chunks.length ? 'reused' : 'completed')
  }

  let mergedFacts = await loadLatestMergedFacts(mediaFileId)
  if (requested.has('fact-deduplication')) {
    await updateJobProgress(jobId, { progress: 90, currentStep: 'fact_deduplication' })
    await setStage('fact_deduplication', 'running')
    signal.throwIfAborted()
    const initiallyMergedFacts = deduplicateFacts(validFacts).filter(isSubstantiveFact)
    const dedupeRetrieval = await buildRetrievalContext({
      stage: 'fact-deduplication',
      language: config.summaryLanguage.toLowerCase().startsWith('en') ? 'en' : 'ru',
      text: JSON.stringify(initiallyMergedFacts.map(({ type, text }) => ({ type, text }))),
      maxExamples: 2,
    }, `${mediaFileId}:dedupe`)
    mergedFacts = config.deduplicationLevel === 'fast'
      ? initiallyMergedFacts
      : await semanticDeduplicateFacts(
        initiallyMergedFacts,
        signal,
        config.deduplicationLevel === 'precise' ? 0.45 : 0.55,
        config.maxSemanticDedupeComparisons,
      )
    const dedupeInputHash = hashInput(JSON.stringify({
      sourceFactIds: validFacts.map((fact) => fact.id),
      deduplicationLevel: config.deduplicationLevel,
      promptVersion: PROMPT_VERSIONS.factDeduplication,
      retrievalManifestHash: dedupeRetrieval.manifestHash,
    }))
    await replaceMergedFacts(jobId, mergedFacts, config.llmModel, PROMPT_VERSIONS.factDeduplication, {
      artifactGenerationId: artifactGenerationIds.get('fact_deduplication'), inputHash: dedupeInputHash,
      dictionaryHash, retrieval: dedupeRetrieval,
    })
    await invalidateAfterFactDeduplication(mediaFileId, jobId)
    await setStage('fact_deduplication', 'completed')
  }
  mergedFacts = mergedFacts.filter(isSubstantiveFact)

  let drafts: DraftTask[] = []
  let taskRetrieval: RetrievalContext | undefined
  let taskInputHash: string | undefined
  if (requested.has('tasks')) {
    await updateJobProgress(jobId, { progress: 92, currentStep: 'tasks' })
    await setStage('tasks', 'running')
    signal.throwIfAborted()
    const explicitTaskFacts = mergedFacts.filter(hasExplicitActionCue)
    taskRetrieval = await buildRetrievalContext({
      stage: 'task-extraction',
      language: config.summaryLanguage.toLowerCase().startsWith('en') ? 'en' : 'ru',
      text: JSON.stringify((explicitTaskFacts.length > 0 ? explicitTaskFacts : mergedFacts).map(({ type, text }) => ({ type, text }))),
      labels: explicitTaskFacts.length > 0 ? ['explicit-task'] : [],
      maxExamples: 0,
    }, `${mediaFileId}:tasks`)
    taskInputHash = hashInput(JSON.stringify({
      mergedFactIds: mergedFacts.map((fact) => fact.id),
      promptVersion: PROMPT_VERSIONS.taskExtraction,
      modelName: config.llmModel,
      retrievalManifestHash: taskRetrieval.manifestHash,
    }))
    const candidates = await extractTasksFromFacts(mediaFileId, mergedFacts, signal, taskRetrieval)
    const deduplicated = deduplicateTasks(candidates)
    await replaceTaskCandidates(jobId, deduplicated, config.llmModel, PROMPT_VERSIONS.taskExtraction, {
      artifactGenerationId: artifactGenerationIds.get('tasks'), inputHash: taskInputHash, dictionaryHash, retrieval: taskRetrieval,
    })
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
  let summaryRetrieval: RetrievalContext | undefined
  let summaryInputHash: string | undefined
  if (requested.has('summary')) {
    await updateJobProgress(jobId, { progress: 95, currentStep: 'summary' })
    await setStage('summary', 'running')
    if (mergedFacts.length > 0) {
      const generation = await generateEvidenceSummary(mediaFileId, jobId, mergedFacts, drafts, signal, {
        artifactGenerationId: artifactGenerationIds.get('summary'), dictionaryHash,
      })
      summary = generation.summary
      summaryRetrieval = generation.retrieval
      summaryInputHash = hashInput(JSON.stringify({
        mergedFactIds: mergedFacts.map((fact) => fact.id),
        taskIds: drafts.map((task) => task.id),
        promptVersion: PROMPT_VERSIONS.finalSummary,
        modelName: config.llmModel,
        retrievalManifestHash: summaryRetrieval.manifestHash,
      }))
    } else {
      summary = emptySummary(config.summaryLanguage)
      summaryInputHash = hashInput(JSON.stringify({ mergedFacts: [], language: config.summaryLanguage }))
    }
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
  if (summary) await replaceEvidenceSummary({
    mediaFileId, jobId, summary, tasks: requested.has('tasks') ? drafts : undefined,
    modelName: config.llmModel, promptVersion: PROMPT_VERSIONS.finalSummary,
    metadata: { artifactGenerationId: artifactGenerationIds.get('summary'), inputHash: summaryInputHash, dictionaryHash, retrieval: summaryRetrieval },
  })
  if (requested.has('tasks')) await replaceEvidenceTasks({
    mediaFileId, jobId, tasks: drafts, modelName: config.llmModel, promptVersion: PROMPT_VERSIONS.taskExtraction,
    metadata: { artifactGenerationId: artifactGenerationIds.get('tasks'), inputHash: taskInputHash, dictionaryHash, retrieval: taskRetrieval },
  })
  const qualityWarnings = evaluateEvidenceQuality({
    segments,
    totalFactCount: allValidatedFacts.length || validFacts.length,
    validFactCount: validFacts.length,
    mergedFacts,
    tasks: drafts,
    summary,
    language: config.summaryLanguage,
  })
  await setJobQualityWarnings(jobId, qualityWarnings)
  evidenceLog.info('evidence analysis completed', {
    mediaFileId, jobId, factCount: validFacts.length, mergedFactCount: mergedFacts.length,
    taskCount: drafts.length, qualityWarningCount: qualityWarnings.length,
    useDictionary: job.useDictionary, discoverTerms: job.discoverTerms,
  })
}

function emptySummary(language: string): EvidenceFinalSummary {
  return language.toLowerCase().startsWith('en')
    ? { title: 'No substantive speech found', summary: 'No validated facts were extracted.', keyPoints: [], decisions: [], problems: [], openQuestions: [], proposals: [] }
    : { title: 'Содержательной речи не обнаружено', summary: 'Подтверждённые факты отсутствуют.', keyPoints: [], decisions: [], problems: [], openQuestions: [], proposals: [] }
}

function promptVersionForStage(stage: string): string | undefined {
  if (stage === 'fact_extraction') return PROMPT_VERSIONS.factExtraction
  if (stage === 'fact_deduplication') return PROMPT_VERSIONS.factDeduplication
  if (stage === 'tasks') return PROMPT_VERSIONS.taskExtraction
  if (stage === 'summary') return PROMPT_VERSIONS.finalSummary
  if (stage === 'term_discovery') return PROMPT_VERSIONS.termDiscovery
  return undefined
}

function schemaVersionForStage(stage: string): string {
  if (stage === 'fact_extraction') return 'atomic-fact-v2'
  if (stage === 'fact_deduplication') return 'merged-fact-v1'
  if (stage === 'tasks') return 'task-candidate-v1'
  if (stage === 'summary') return 'evidence-summary-v1'
  if (stage === 'term_discovery') return 'term-suggestion-v1'
  return 'normalization-v1'
}
