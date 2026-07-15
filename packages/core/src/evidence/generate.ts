import { randomUUID } from 'node:crypto'
import type { AtomicFact, EvidenceFinalSummary, EvidenceSummaryBatch, EvidenceTranscriptSegment, MergedFact, TaskCandidate, TranscriptChunk } from '@wisploc/shared'
import { evidenceFinalSummarySchema, evidenceSummaryBatchSchema, factModelItemSchema, factModelResultSchema, factRelationSchema, taskCandidateModelResultSchema, termDiscoveryResultSchema } from '@wisploc/shared'
import { structuredOllamaChat } from '../ollama'
import { loadConfig } from '../config'
import { createLogger } from '../logger'
import { buildRetrievalContext, formatRetrievalContext } from '../knowledge'
import type { RetrievalContext } from '../knowledge'
import { isTaskContentGrounded, validateTaskFieldsAgainstEvidence } from './validateTask'
import { PROMPT_VERSIONS } from './promptVersions'
import { hashInput, loadSummaryBatchCheckpoint, pruneSummaryBatchCheckpoints, saveSummaryBatchCheckpoint } from './repository'

const SUMMARY_BATCH_SIZE = 15
const TASK_BATCH_SIZE = 20
const TASK_EVIDENCE_MAX_CHARS = 600
const EXPLICIT_ACTION_PATTERN = /(?:сделай|сделайте|исправь|исправьте|проверь|проверьте|подготовь|подготовьте|спроси|спросить|удали|удалите|выпиливаем|удаляем|проверим|добавляем|бер[её]т на себя|беру на себя|долж(?:ен|на|ны)|нужно (?:спросить|проверить|сделать|удалить|исправить|добавить|подготовить|обновить)|надо (?:спросить|проверить|сделать|удалить|исправить|добавить|подготовить|обновить))/iu
const CANCELLED_ACTION_PATTERN = /(?:отмен|не будем|не делаем|не нужно|не обязательно|вопрос снимается|оставляем как есть)/iu
const FACT_PART_MAX_CHARS = 1_400
const FACT_PART_MIN_RETRY_SEGMENTS = 4
const summaryLog = createLogger('summary-generation', 'worker.log')
const factLog = createLogger('fact-generation', 'worker.log')
const taskLog = createLogger('task-generation', 'worker.log')

const FACT_SYSTEM = `Extract only atomic facts explicitly stated in the supplied transcript segments.
Do not add information that is not present. Do not invent assignees or deadlines.
Do not convert a suggestion or wish into a confirmed task. Return one atomic fact per object.
Classify confirmed choices as decision, requested actions as task_candidate, mandatory constraints as requirement, defects or blockers as problem, suggestions as proposal, unresolved questions as question, and neutral information as statement.
Use question only for an actual unresolved question. Phrases such as "нужно", "сделай", "давай сделаем", "удаляем", and "проверим" usually describe requested actions or confirmed decisions, not questions.
Return at most 12 facts. Keep fact text under 180 characters.
Every fact must reference one to six supplied source segment IDs. Never create or alter segment IDs.
Use the smallest consecutive range of segments that fully supports the fact.
Return an empty facts array when no facts are present. JSON only. /no_think`

const TASK_SYSTEM = `Create tasks only from the supplied validated facts and only for explicit actions.
Do not invent assignees, deadlines, priority, or evidence. Do not create tasks from general discussion, hypotheses, wishes, or unaccepted proposals.
Fact types are hints and may be inaccurate. Inspect fact text and evidence before deciding whether an explicit action exists.
An actionSignal value of explicit-language means the source contains direct action wording. Create a task for it unless the same source cancels, rejects, or makes the action conditional.
Every task must reference only the short fact IDs supplied in the current batch. JSON only. /no_think`

function languageInstruction(): string {
  return loadConfig().summaryLanguage.toLowerCase().startsWith('en')
    ? 'All user-facing text must be written in English. Preserve technical names, commands and filenames as written.'
    : 'All user-facing text must be written in Russian Cyrillic. Preserve technical names, commands and filenames as written.'
}

function knowledgeLanguage(): 'ru' | 'en' {
  return loadConfig().summaryLanguage.toLowerCase().startsWith('en') ? 'en' : 'ru'
}

const SUMMARY_SYSTEM = `Consolidate the supplied partial summaries into one final structured summary.
Do not add decisions, tasks, reasons, people, or deadlines. Preserve the supplied sourceFactIds for every item.
Merge duplicates and keep the result concise.
The title must describe the actual meeting topic. The summary must contain 3 to 6 factual sentences based on the supplied items.
Return at most 8 keyPoints and at most 4 items in each other section.
Return empty arrays for sections without data. JSON only. /no_think`
const SUMMARY_BATCH_SYSTEM = `Convert the supplied validated facts into concise summary section items.
Do not produce a title or an overall narrative. Do not invent or infer information.
Every item must reference only sourceFactIds supplied in this batch.
Merge closely related facts inside this batch and return empty arrays for sections without data.
Return at most 5 keyPoints and at most 3 items in each other section.
Keep each item short. JSON only. /no_think`
const TERM_SYSTEM = `Find only repeated technical terms, product names, library names, commands, or proper names that may have been transcribed inconsistently.
Do not suggest ordinary words. Every example quote must exist exactly in the original transcript. Suggestions are for human review and must not be accepted automatically.
Return an empty suggestions array when there are no useful candidates. JSON only. /no_think`

export async function extractAtomicFacts(input: {
  mediaFileId: string
  chunk: TranscriptChunk
  segments: EvidenceTranscriptSegment[]
  signal?: AbortSignal
  retrieval?: RetrievalContext
}): Promise<AtomicFact[]> {
  const retrieval = input.retrieval ?? await buildRetrievalContext({
    stage: 'fact-extraction', language: knowledgeLanguage(), text: input.chunk.originalText, maxExamples: 3,
  }, `${input.mediaFileId}:facts:${input.chunk.index}`)
  const parts = splitFactSegments(input.segments)
  const generated: AtomicFact[] = []
  for (const [partIndex, part] of parts.entries()) {
    input.signal?.throwIfAborted()
    generated.push(...await extractFactPart({
      mediaFileId: input.mediaFileId,
      chunkIndex: input.chunk.index,
      segments: part,
      partLabel: parts.length > 1 ? `${partIndex + 1}_of_${parts.length}` : undefined,
      retrieval,
      signal: input.signal,
      retryDepth: 0,
    }))
  }
  return generated
}

async function extractFactPart(input: {
  mediaFileId: string
  chunkIndex: number
  segments: EvidenceTranscriptSegment[]
  partLabel?: string
  retrieval: RetrievalContext
  signal?: AbortSignal
  retryDepth: number
}): Promise<AtomicFact[]> {
  const requestSuffix = input.partLabel ? `:part-${input.partLabel}` : ''
  const segmentByAlias = new Map(input.segments.map((segment, index) => [`s${index + 1}`, segment]))
  const payload = input.segments.map((segment, index) => ({
    id: `s${index + 1}`,
    text: segment.originalText,
    normalizedText: segment.normalizedText && segment.normalizedText !== segment.originalText
      ? segment.normalizedText
      : undefined,
  }))
  try {
    const result = await structuredOllamaChat({
      mode: 'fact-extraction',
      schema: factModelResultSchema,
      label: 'atomic facts',
      systemPrompt: `${FACT_SYSTEM}\n${languageInstruction()}\n\n${formatRetrievalContext(input.retrieval)}`,
      signal: input.signal,
      requestId: `${input.mediaFileId}:facts:${input.chunkIndex}${requestSuffix}`,
      prompt: JSON.stringify({ chunkIndex: input.chunkIndex, segments: payload }),
    })
    return result.facts.flatMap((fact) => {
      const materialized = materializeAtomicFact(input.mediaFileId, input.chunkIndex, fact, input.segments, segmentByAlias)
      return materialized ? [materialized] : []
    })
  } catch (error) {
    input.signal?.throwIfAborted()
    if (!isStructuredOutputError(error)) throw error

    if (input.segments.length >= FACT_PART_MIN_RETRY_SEGMENTS && input.retryDepth < 2) {
      const middle = Math.ceil(input.segments.length / 2)
      const retryParts = [input.segments.slice(0, middle), input.segments.slice(middle)].filter((part) => part.length > 0)
      if (retryParts.length > 1) {
        factLog.warn('fact output invalid; retrying with smaller transcript parts', {
          mediaFileId: input.mediaFileId,
          chunkIndex: input.chunkIndex,
          partLabel: input.partLabel,
          retryDepth: input.retryDepth + 1,
          partCount: retryParts.length,
          error,
        })
        const facts = []
        for (const [retryIndex, retryPart] of retryParts.entries()) {
          facts.push(...await extractFactPart({
            ...input,
            segments: retryPart,
            partLabel: `${input.partLabel ?? '1'}-${retryIndex + 1}`,
            retryDepth: input.retryDepth + 1,
          }))
        }
        return facts
      }
    }

    factLog.warn('fact output discarded after bounded structured-output retries', {
      mediaFileId: input.mediaFileId,
      chunkIndex: input.chunkIndex,
      partLabel: input.partLabel,
      segmentCount: input.segments.length,
      error,
    })
    return []
  }
}

function splitFactSegments(segments: EvidenceTranscriptSegment[], maxChars = FACT_PART_MAX_CHARS): EvidenceTranscriptSegment[][] {
  const parts: EvidenceTranscriptSegment[][] = []
  let current: EvidenceTranscriptSegment[] = []
  let currentChars = 0
  for (const segment of segments) {
    const segmentChars = segment.originalText.length + (
      segment.normalizedText && segment.normalizedText !== segment.originalText ? segment.normalizedText.length : 0
    )
    if (current.length > 0 && currentChars + segmentChars > maxChars) {
      parts.push(current)
      current = []
      currentChars = 0
    }
    current.push(segment)
    currentChars += segmentChars
  }
  if (current.length > 0) parts.push(current)
  return parts
}

function materializeAtomicFact(
  mediaFileId: string,
  chunkIndex: number,
  fact: ReturnType<typeof factModelItemSchema.parse>,
  segments: EvidenceTranscriptSegment[],
  segmentByAlias: Map<string, EvidenceTranscriptSegment>,
): AtomicFact | null {
  const referenced = [...new Set(fact.sourceSegmentIds)].flatMap((id) => segmentByAlias.get(id) ?? [])
  if (referenced.length !== new Set(fact.sourceSegmentIds).size) return null
  const positions = referenced.map((segment) => segments.findIndex((item) => item.id === segment.id)).sort((a, b) => a - b)
  if (positions.some((position) => position < 0)) return null
  const selected = segments.slice(positions[0], positions[positions.length - 1] + 1)
  if (selected.length === 0 || selected.length > 6) return null
  const evidenceQuote = compactEvidenceQuote(selected.map((segment) => segment.originalText.trim()).filter(Boolean).join(' '))
  if (!evidenceQuote) return null
  const speakers = [...new Set(selected.map((segment) => segment.speaker).filter((speaker): speaker is string => Boolean(speaker)))]
  return {
    id: randomUUID(),
    mediaFileId,
    chunkIndex,
    type: fact.type,
    text: fact.text,
    evidenceQuote,
    startSec: selected[0].startSec,
    endSec: selected[selected.length - 1].endSec,
    speaker: speakers.length === 1 ? speakers[0] : undefined,
    explicit: fact.explicit,
  }
}

function isStructuredOutputError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  return error.message.startsWith('Failed to parse ') || error.message.startsWith('Failed to validate ')
}

export async function extractTasksFromFacts(
  mediaFileId: string,
  facts: MergedFact[],
  signal?: AbortSignal,
  retrievalContext?: RetrievalContext,
): Promise<TaskCandidate[]> {
  if (facts.length === 0) return []
  const retrieval = retrievalContext ?? await buildRetrievalContext({
    stage: 'task-extraction', language: knowledgeLanguage(), text: JSON.stringify(facts), maxExamples: 0,
  }, `${mediaFileId}:tasks`)
  const batches = Array.from(
    { length: Math.ceil(facts.length / TASK_BATCH_SIZE) },
    (_, index) => facts.slice(index * TASK_BATCH_SIZE, (index + 1) * TASK_BATCH_SIZE),
  )
  const tasks: TaskCandidate[] = []

  for (const [batchIndex, batch] of batches.entries()) {
    signal?.throwIfAborted()
    const factIdByAlias = new Map(batch.map((fact, index) => [`f${index + 1}`, fact.id]))
    const factById = new Map(batch.map((fact) => [fact.id, fact]))
    const payload = batch.map((fact, index) => ({
      id: `f${index + 1}`,
      type: fact.type,
      text: fact.text,
      actionSignal: hasExplicitActionCue(fact) ? 'explicit-language' : 'none',
      evidence: fact.evidence.slice(0, 2).map((item) => item.quote.slice(0, TASK_EVIDENCE_MAX_CHARS)),
    }))
    const result = await structuredOllamaChat({
      mode: 'evidence-task-extraction', schema: taskCandidateModelResultSchema, label: `evidence tasks batch ${batchIndex + 1}`,
      systemPrompt: `${TASK_SYSTEM}\n${languageInstruction()}\n\n${formatRetrievalContext(retrieval)}`, signal,
      requestId: `${mediaFileId}:tasks:batch:${batchIndex}`,
      prompt: JSON.stringify({ facts: payload }),
    })

    tasks.push(...result.tasks.flatMap((task) => {
      const restoredIds = [...new Set(task.sourceFactIds.flatMap((id) => {
        const restored = factIdByAlias.get(id)
        if (restored) return [restored]
        return factById.has(id) ? [id] : []
      }))]
      if (!task.explicitAction || restoredIds.length !== task.sourceFactIds.length) return []
      const sources = restoredIds.map((id) => factById.get(id)).filter((fact): fact is MergedFact => Boolean(fact))
      if (sources.length !== restoredIds.length) return []
      if (!isTaskContentGrounded({ text: task.title, title: task.title, description: task.description }, sources)) {
        taskLog.warn('ungrounded task candidate discarded', { mediaFileId, title: task.title, sourceFactIds: restoredIds })
        return []
      }
      const evidence = sources.flatMap((fact) => fact.evidence)
      const validatedTask = validateTaskFieldsAgainstEvidence({ ...task, sourceFactIds: restoredIds }, evidence)
      return [{ id: randomUUID(), mediaFileId, ...validatedTask, evidence }]
    }))
  }

  const referencedFactIds = new Set(tasks.flatMap((task) => task.sourceFactIds))
  const fallbacks = facts.flatMap((fact) => {
    if (referencedFactIds.has(fact.id)) return []
    const fallback = buildExplicitTaskFallback(mediaFileId, fact)
    return fallback ? [fallback] : []
  })
  if (fallbacks.length > 0) {
    taskLog.warn('task model omitted direct validated actions; preserving deterministic fallbacks', {
      mediaFileId,
      sourceFactIds: fallbacks.flatMap((task) => task.sourceFactIds),
    })
  }

  return [...tasks, ...fallbacks]
}

export function hasExplicitActionCue(fact: Pick<MergedFact, 'text' | 'evidence'>): boolean {
  const source = `${fact.text}\n${fact.evidence.map((item) => item.quote).join('\n')}`
  return EXPLICIT_ACTION_PATTERN.test(source) && !CANCELLED_ACTION_PATTERN.test(source)
}

export function buildExplicitTaskFallback(mediaFileId: string, fact: MergedFact): TaskCandidate | null {
  if (fact.type !== 'task_candidate') return null
  if (!EXPLICIT_ACTION_PATTERN.test(fact.text) || CANCELLED_ACTION_PATTERN.test(fact.text)) return null
  if (/^(?:кто|что|где|когда|как|зачем|почему|какой|какая|какие|можно ли|нужно ли|надо ли|точно ли)\b|\?\s*$/iu.test(fact.text)) return null
  const title = fact.text
    .replace(/^(?:нужно|надо)\s+/iu, '')
    .replace(/[.!?]+$/u, '')
    .trim()
  if (!title || !isTaskContentGrounded({ text: title, title }, [fact])) return null
  return {
    id: randomUUID(),
    mediaFileId,
    title: `${title.charAt(0).toLocaleUpperCase()}${title.slice(1)}`,
    sourceFactIds: [fact.id],
    evidence: fact.evidence,
    explicitAction: true,
    explicitAssignee: false,
    explicitDueDate: false,
  }
}

export interface EvidenceSummaryGeneration {
  summary: EvidenceFinalSummary
  retrieval: RetrievalContext
}

export async function generateEvidenceSummary(
  mediaFileId: string,
  processingJobId: string,
  facts: MergedFact[],
  _tasks: TaskCandidate[],
  signal?: AbortSignal,
  metadata: { artifactGenerationId?: string; dictionaryHash?: string } = {},
): Promise<EvidenceSummaryGeneration> {
  const config = loadConfig()
  const factBatches = Array.from({ length: Math.ceil(facts.length / SUMMARY_BATCH_SIZE) }, (_, index) => facts.slice(index * SUMMARY_BATCH_SIZE, (index + 1) * SUMMARY_BATCH_SIZE))
  const preparedBatches = await Promise.all(factBatches.map(async (batch, index) => {
    const factIdByAlias = new Map(batch.map((fact, factIndex) => [`f${factIndex + 1}`, fact.id]))
    const aliasByFactId = new Map([...factIdByAlias].map(([alias, id]) => [id, alias]))
    const compactFacts = batch.map(({ id, type, text }) => ({ id: aliasByFactId.get(id), type, text }))
    const promptPayload = { facts: compactFacts }
    const retrieval = await buildRetrievalContext({
      stage: 'summary-batch', language: knowledgeLanguage(), text: JSON.stringify(promptPayload), maxExamples: 1,
    }, `${mediaFileId}:summary:batch:${index}`)
    const inputHash = hashInput(JSON.stringify({
      promptPayload,
      sourceFactIds: batch.map((fact) => fact.id),
      model: config.llmModel,
      language: config.summaryLanguage,
      promptVersion: PROMPT_VERSIONS.summaryBatch,
      retrievalVersion: retrieval.retrievalVersion,
      retrievalManifestHash: retrieval.manifestHash,
    }))
    return { index, promptPayload, inputHash, factIdByAlias, retrieval }
  }))
  await pruneSummaryBatchCheckpoints(mediaFileId, preparedBatches.map((batch) => batch.inputHash))

  const partials: EvidenceSummaryBatch[] = []

  for (const batch of preparedBatches) {
    signal?.throwIfAborted()
    const checkpoint = await loadSummaryBatchCheckpoint(mediaFileId, batch.index, batch.inputHash)
    if (checkpoint) {
      partials.push(checkpoint)
      summaryLog.info('summary batch checkpoint reused', {
        mediaFileId, batchIndex: batch.index, batchCount: preparedBatches.length,
      })
      continue
    }

    const generatedPartial = await structuredOllamaChat({
      mode: 'evidence-final-summary', schema: evidenceSummaryBatchSchema, label: `evidence summary batch ${batch.index + 1}`,
      systemPrompt: `${SUMMARY_BATCH_SYSTEM}\n${languageInstruction()}\n\n${formatRetrievalContext(batch.retrieval)}`, signal, requestId: `${mediaFileId}:summary:batch:${batch.index}`,
      numPredict: 1000,
      prompt: JSON.stringify(batch.promptPayload),
    })
    const partial = restoreSummaryBatchFactIds(generatedPartial, batch.factIdByAlias)
    await saveSummaryBatchCheckpoint({
      mediaFileId,
      processingJobId,
      artifactGenerationId: metadata.artifactGenerationId,
      batchIndex: batch.index,
      inputHash: batch.inputHash,
      summary: partial,
      modelName: config.llmModel,
      promptVersion: PROMPT_VERSIONS.summaryBatch,
      dictionaryHash: metadata.dictionaryHash,
      retrieval: batch.retrieval,
    })
    partials.push(partial)
    summaryLog.info('summary batch checkpoint saved', {
      mediaFileId, batchIndex: batch.index, batchCount: preparedBatches.length,
    })
  }

  const finalInput = prepareFinalSummaryInput(partials)
  const finalRetrieval = await buildRetrievalContext({
    stage: 'summary-final', language: knowledgeLanguage(), text: JSON.stringify(finalInput.summary), maxExamples: 0,
  }, `${mediaFileId}:summary`)
  const generatedResult = await structuredOllamaChat({
    mode: 'evidence-final-summary', schema: evidenceFinalSummarySchema, label: 'evidence final summary',
    systemPrompt: `${SUMMARY_SYSTEM}\n${languageInstruction()}\n\n${formatRetrievalContext(finalRetrieval)}`, signal, requestId: `${mediaFileId}:summary`,
    prompt: JSON.stringify({ partialSummaries: [finalInput.summary] }),
  })
  const result = restoreFinalSummaryFactIds(generatedResult, finalInput.factIdByAlias)
  const factById = new Map(facts.map((fact) => [fact.id, fact]))
  const allowedIds = new Set(factById.keys())
  const filtered = filterSummaryItems(result, factById)
  return {
    summary: ensureUsefulSummaryNarrative(preservePartialSummarySections(filtered, finalInput.fallback, allowedIds, factById)),
    retrieval: finalRetrieval,
  }
}

const SUMMARY_SECTIONS = ['keyPoints', 'decisions', 'problems', 'openQuestions', 'proposals'] as const

function prepareFinalSummaryInput(partials: EvidenceSummaryBatch[]): {
  summary: EvidenceSummaryBatch
  fallback: EvidenceSummaryBatch
  factIdByAlias: Map<string, string>
} {
  const selected: EvidenceSummaryBatch = {
    keyPoints: selectRoundRobin(partials.map((partial) => partial.keyPoints), 8),
    decisions: selectRoundRobin(partials.map((partial) => partial.decisions), 4),
    problems: selectRoundRobin(partials.map((partial) => partial.problems), 4),
    openQuestions: selectRoundRobin(partials.map((partial) => partial.openQuestions), 4),
    proposals: selectRoundRobin(partials.map((partial) => partial.proposals), 4),
  }
  const factIds = [...new Set(SUMMARY_SECTIONS.flatMap((section) => selected[section].flatMap((item) => item.sourceFactIds)))]
  const factIdByAlias = new Map(factIds.map((id, index) => [`f${index + 1}`, id]))
  const aliasByFactId = new Map([...factIdByAlias].map(([alias, id]) => [id, alias]))
  const useAliases = (items: EvidenceSummaryBatch['keyPoints']) => items.map((item) => ({
      ...item,
      sourceFactIds: item.sourceFactIds.flatMap((id) => aliasByFactId.get(id) ?? []),
    }))
  const summary: EvidenceSummaryBatch = {
    keyPoints: useAliases(selected.keyPoints),
    decisions: useAliases(selected.decisions),
    problems: useAliases(selected.problems),
    openQuestions: useAliases(selected.openQuestions),
    proposals: useAliases(selected.proposals),
  }
  return { summary, fallback: selected, factIdByAlias }
}

function selectRoundRobin<T>(groups: T[][], limit: number): T[] {
  const selected: T[] = []
  for (let itemIndex = 0; selected.length < limit; itemIndex += 1) {
    let found = false
    for (const group of groups) {
      if (itemIndex >= group.length) continue
      selected.push(group[itemIndex])
      found = true
      if (selected.length === limit) break
    }
    if (!found) break
  }
  return selected
}

function restoreFinalSummaryFactIds(
  summary: EvidenceFinalSummary,
  factIdByAlias: Map<string, string>,
): EvidenceFinalSummary {
  const restoreItems = (items: EvidenceFinalSummary['keyPoints'], limit: number) => items.flatMap((item) => {
    const restoredIds = [...new Set(item.sourceFactIds.flatMap((id) => factIdByAlias.get(id) ?? []))]
    return restoredIds.length === item.sourceFactIds.length && restoredIds.length > 0
      ? [{ ...item, sourceFactIds: restoredIds }]
      : []
  }).slice(0, limit)
  return {
    ...summary,
    keyPoints: restoreItems(summary.keyPoints, 8),
    decisions: restoreItems(summary.decisions, 4),
    problems: restoreItems(summary.problems, 4),
    openQuestions: restoreItems(summary.openQuestions, 4),
    proposals: restoreItems(summary.proposals, 4),
  }
}

function restoreSummaryBatchFactIds(
  summary: EvidenceSummaryBatch,
  factIdByAlias: Map<string, string>,
): EvidenceSummaryBatch {
  const restoreItems = (items: EvidenceSummaryBatch['keyPoints'], limit: number) => items.flatMap((item) => {
    const restoredIds = [...new Set(item.sourceFactIds.flatMap((id) => factIdByAlias.get(id) ?? []))]
    return restoredIds.length === item.sourceFactIds.length && restoredIds.length > 0
      ? [{ ...item, sourceFactIds: restoredIds }]
      : []
  }).slice(0, limit)
  return {
    keyPoints: restoreItems(summary.keyPoints, 5),
    decisions: restoreItems(summary.decisions, 3),
    problems: restoreItems(summary.problems, 3),
    openQuestions: restoreItems(summary.openQuestions, 3),
    proposals: restoreItems(summary.proposals, 3),
  }
}

function filterSummaryItems(result: EvidenceFinalSummary, factById: Map<string, MergedFact>): EvidenceFinalSummary {
  const filterItems = (section: typeof SUMMARY_SECTIONS[number], items: EvidenceFinalSummary['keyPoints']) => items.filter((item) =>
    item.sourceFactIds.length > 0
    && item.sourceFactIds.every((id) => factById.has(id))
    && summarySectionMatchesFacts(section, item.sourceFactIds, factById))
  return {
    ...result,
    keyPoints: filterItems('keyPoints', result.keyPoints),
    decisions: filterItems('decisions', result.decisions),
    problems: filterItems('problems', result.problems),
    openQuestions: filterItems('openQuestions', result.openQuestions),
    proposals: filterItems('proposals', result.proposals),
  }
}

export function preservePartialSummarySections(
  result: EvidenceFinalSummary,
  fallback: EvidenceSummaryBatch,
  allowedIds: Set<string>,
  factById?: Map<string, MergedFact>,
): EvidenceFinalSummary {
  const validFallback = (section: typeof SUMMARY_SECTIONS[number], items: EvidenceSummaryBatch['keyPoints']) => items.filter((item) =>
    item.sourceFactIds.length > 0
    && item.sourceFactIds.every((id) => allowedIds.has(id))
    && (!factById || summarySectionMatchesFacts(section, item.sourceFactIds, factById)))
  const recoveredSections: string[] = []
  const next = { ...result }

  for (const section of SUMMARY_SECTIONS) {
    if (next[section].length > 0) continue
    const recovered = validFallback(section, fallback[section])
    if (recovered.length === 0) continue
    next[section] = recovered
    recoveredSections.push(section)
  }

  if (recoveredSections.length > 0) {
    summaryLog.warn('final summary omitted validated partial sections; preserving partial output', { recoveredSections })
  }
  return next
}

function summarySectionMatchesFacts(
  section: typeof SUMMARY_SECTIONS[number],
  sourceFactIds: string[],
  factById: Map<string, MergedFact>,
): boolean {
  if (section === 'keyPoints') return true
  const expectedType = {
    decisions: 'decision',
    problems: 'problem',
    openQuestions: 'question',
    proposals: 'proposal',
  }[section]
  return sourceFactIds.every((id) => factById.get(id)?.type === expectedType)
}

function ensureUsefulSummaryNarrative(summary: EvidenceFinalSummary): EvidenceFinalSummary {
  if (summary.summary.length >= 120) return summary

  const sourceItems = [
    ...summary.keyPoints,
    ...summary.decisions,
    ...summary.problems,
    ...summary.proposals,
  ].slice(0, 6)
  if (sourceItems.length === 0) return summary

  const narrative = sourceItems
    .map((item) => item.text.replace(/[.!?]+$/u, '').trim())
    .filter(Boolean)
    .map((text) => `${text}.`)
    .join(' ')
  const prefix = loadConfig().summaryLanguage.toLowerCase().startsWith('en') ? 'Discussion: ' : 'Обсуждение: '
  return {
    ...summary,
    title: `${prefix}${sourceItems[0].text}`.slice(0, 200),
    summary: narrative.slice(0, 8_000),
  }
}

export async function discoverTermSuggestions(mediaFileId: string, segments: EvidenceTranscriptSegment[], signal?: AbortSignal) {
  const payload = JSON.stringify(segments.map(({ startSec, endSec, originalText }) => ({ startSec, endSec, originalText })))
  const retrieval = await buildRetrievalContext({
    stage: 'term-discovery', language: knowledgeLanguage(), text: payload, maxExamples: 2,
  }, `${mediaFileId}:terms`)
  const result = await structuredOllamaChat({
    mode: 'term-discovery', schema: termDiscoveryResultSchema, label: 'term suggestions',
    systemPrompt: `${TERM_SYSTEM}\n\n${formatRetrievalContext(retrieval)}`, signal, requestId: `${mediaFileId}:terms`,
    prompt: payload,
  })
  return result.suggestions.filter((suggestion) => suggestion.examples.every((example) =>
    segments.some((segment) => segment.originalText.toLocaleLowerCase().includes(example.quote.toLocaleLowerCase())
      && example.startSec >= segment.startSec && example.endSec <= segment.endSec)))
}

function compactEvidenceQuote(value: string): string {
  const quote = value.trim()
  if (quote.length <= 1_000) return quote

  const cutoff = quote.lastIndexOf(' ', 1_000)
  return quote.slice(0, cutoff > 0 ? cutoff : 1_000).trim()
}

export async function classifyFactRelation(left: MergedFact, right: MergedFact, signal?: AbortSignal) {
  const retrieval = await buildRetrievalContext({
    stage: 'fact-deduplication', language: knowledgeLanguage(), text: `${left.text}\n${right.text}`, maxExamples: 2,
  }, `${left.mediaFileId}:dedupe:${left.id}:${right.id}`)
  const result = await structuredOllamaChat({
    mode: 'fact-deduplication', schema: factRelationSchema, label: 'fact relation', signal,
    systemPrompt: `Classify only the relation between two evidence-backed facts. Do not rewrite them. JSON only. /no_think\n\n${formatRetrievalContext(retrieval)}`,
    requestId: `${left.mediaFileId}:dedupe:${left.id}:${right.id}`,
    prompt: JSON.stringify({ left, right }),
  })
  return result.relation
}
