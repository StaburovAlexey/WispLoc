import { randomUUID } from 'node:crypto'
import type { AtomicFact, EvidenceFinalSummary, EvidenceSummaryBatch, EvidenceTranscriptSegment, MergedFact, TaskCandidate, TranscriptChunk } from '@wisploc/shared'
import { evidenceFinalSummarySchema, evidenceSummaryBatchSchema, factModelItemSchema, factModelResultSchema, factRelationSchema, taskCandidateModelResultSchema, termDiscoveryResultSchema } from '@wisploc/shared'
import { structuredOllamaChat } from '../ollama'
import { loadConfig } from '../config'
import { createLogger } from '../logger'
import { validateTaskFieldsAgainstEvidence } from './validateTask'
import { PROMPT_VERSIONS } from './promptVersions'
import { hashInput, loadSummaryBatchCheckpoint, pruneSummaryBatchCheckpoints, saveSummaryBatchCheckpoint } from './repository'

const SUMMARY_BATCH_SIZE = 15
const summaryLog = createLogger('summary-generation', 'worker.log')

const FACT_SYSTEM = `Extract only atomic facts explicitly stated in the transcript.
Do not add information that is not present. Do not invent assignees or deadlines.
Do not convert a suggestion or wish into a confirmed task. Return one atomic fact per object.
Every fact requires one short exact supporting quote that exists in the original transcript, maximum 300 characters.
Return an empty facts array when no facts are present. JSON only. /no_think`

const TASK_SYSTEM = `Create tasks only from the supplied validated facts and only for explicit actions.
Do not invent assignees, deadlines, priority, or evidence. Do not create tasks from general discussion, hypotheses, wishes, or unaccepted proposals.
Every task must reference existing sourceFactIds. JSON only. /no_think`

function languageInstruction(): string {
  return loadConfig().summaryLanguage.toLowerCase().startsWith('en')
    ? 'All user-facing text must be written in English. Preserve technical names, commands and filenames as written.'
    : 'All user-facing text must be written in Russian Cyrillic. Preserve technical names, commands and filenames as written.'
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
  signal?: AbortSignal
}): Promise<AtomicFact[]> {
  const result = await structuredOllamaChat({
    mode: 'fact-extraction',
    schema: factModelResultSchema,
    label: 'atomic facts',
    systemPrompt: `${FACT_SYSTEM}\n${languageInstruction()}`,
    signal: input.signal,
    requestId: `${input.mediaFileId}:facts:${input.chunk.index}`,
    prompt: `Chunk ${input.chunk.index}, ${input.chunk.startSec}-${input.chunk.endSec} seconds.\nOriginal transcript:\n${input.chunk.originalText}\n\nNormalized transcript (reference only):\n${input.chunk.normalizedText}`,
  })
  return result.facts.map((fact) => ({
    id: randomUUID(),
    mediaFileId: input.mediaFileId,
    chunkIndex: input.chunk.index,
    ...fact,
    evidenceQuote: compactEvidenceQuote(fact.evidenceQuote),
  }))
}

export async function extractTasksFromFacts(mediaFileId: string, facts: MergedFact[], signal?: AbortSignal): Promise<TaskCandidate[]> {
  const actionable = facts.filter((fact) => ['task_candidate', 'decision', 'requirement', 'problem'].includes(fact.type))
  if (actionable.length === 0) return []
  const result = await structuredOllamaChat({
    mode: 'evidence-task-extraction', schema: taskCandidateModelResultSchema, label: 'evidence tasks',
    systemPrompt: `${TASK_SYSTEM}\n${languageInstruction()}`, signal, requestId: `${mediaFileId}:tasks`,
    prompt: JSON.stringify(actionable),
  })
  const factById = new Map(actionable.map((fact) => [fact.id, fact]))
  return result.tasks.flatMap((task) => {
    const sources = task.sourceFactIds.map((id) => factById.get(id)).filter((fact): fact is MergedFact => Boolean(fact))
    if (!task.explicitAction || sources.length !== task.sourceFactIds.length) return []
    const evidence = sources.flatMap((fact) => fact.evidence)
    const validatedTask = validateTaskFieldsAgainstEvidence(task, evidence)
    return [{
      id: randomUUID(), mediaFileId, ...validatedTask,
      evidence,
    }]
  })
}

export async function generateEvidenceSummary(mediaFileId: string, facts: MergedFact[], tasks: TaskCandidate[], signal?: AbortSignal): Promise<EvidenceFinalSummary> {
  const config = loadConfig()
  const taskPayload = tasks.map(({ id, title, description, sourceFactIds }) => ({ id, title, description, sourceFactIds }))
  const factBatches = Array.from({ length: Math.ceil(facts.length / SUMMARY_BATCH_SIZE) }, (_, index) => facts.slice(index * SUMMARY_BATCH_SIZE, (index + 1) * SUMMARY_BATCH_SIZE))
  const preparedBatches = factBatches.map((batch, index) => {
    const factIdByAlias = new Map(batch.map((fact, factIndex) => [`f${factIndex + 1}`, fact.id]))
    const aliasByFactId = new Map([...factIdByAlias].map(([alias, id]) => [id, alias]))
    const compactFacts = batch.map(({ id, type, text }) => ({ id: aliasByFactId.get(id), type, text }))
    const batchFactIds = new Set(batch.map((fact) => fact.id))
    const batchTasks = taskPayload
      .filter((task) => task.sourceFactIds.some((id) => batchFactIds.has(id)))
      .map((task) => ({
        title: task.title,
        description: task.description,
        sourceFactIds: task.sourceFactIds.flatMap((id) => aliasByFactId.get(id) ?? []),
      }))
    const promptPayload = { facts: compactFacts, tasks: batchTasks }
    const inputHash = hashInput(JSON.stringify({
      promptPayload,
      model: config.llmModel,
      language: config.summaryLanguage,
      promptVersion: PROMPT_VERSIONS.summaryBatch,
    }))
    return { index, promptPayload, inputHash, factIdByAlias }
  })
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
      systemPrompt: `${SUMMARY_BATCH_SYSTEM}\n${languageInstruction()}`, signal, requestId: `${mediaFileId}:summary:batch:${batch.index}`,
      numPredict: 1000,
      prompt: JSON.stringify(batch.promptPayload),
    })
    const partial = restoreSummaryBatchFactIds(generatedPartial, batch.factIdByAlias)
    await saveSummaryBatchCheckpoint({
      mediaFileId,
      batchIndex: batch.index,
      inputHash: batch.inputHash,
      summary: partial,
      modelName: config.llmModel,
      promptVersion: PROMPT_VERSIONS.summaryBatch,
    })
    partials.push(partial)
    summaryLog.info('summary batch checkpoint saved', {
      mediaFileId, batchIndex: batch.index, batchCount: preparedBatches.length,
    })
  }

  const finalInput = prepareFinalSummaryInput(partials)
  const generatedResult = await structuredOllamaChat({
    mode: 'evidence-final-summary', schema: evidenceFinalSummarySchema, label: 'evidence final summary',
    systemPrompt: `${SUMMARY_SYSTEM}\n${languageInstruction()}`, signal, requestId: `${mediaFileId}:summary`,
    prompt: JSON.stringify({ partialSummaries: [finalInput.summary] }),
  })
  const result = restoreFinalSummaryFactIds(generatedResult, finalInput.factIdByAlias)
  const allowedIds = new Set(facts.map((fact) => fact.id))
  return ensureUsefulSummaryNarrative(filterSummaryItems(result, allowedIds))
}

const SUMMARY_SECTIONS = ['keyPoints', 'decisions', 'problems', 'openQuestions', 'proposals'] as const

function prepareFinalSummaryInput(partials: EvidenceSummaryBatch[]): {
  summary: EvidenceSummaryBatch
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
  return { summary, factIdByAlias }
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

function filterSummaryItems(result: EvidenceFinalSummary, allowedIds: Set<string>): EvidenceFinalSummary {
  const filterItems = (items: EvidenceFinalSummary['keyPoints']) => items.filter((item) => item.sourceFactIds.length > 0 && item.sourceFactIds.every((id) => allowedIds.has(id)))
  return { ...result, keyPoints: filterItems(result.keyPoints), decisions: filterItems(result.decisions), problems: filterItems(result.problems), openQuestions: filterItems(result.openQuestions), proposals: filterItems(result.proposals) }
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
  const result = await structuredOllamaChat({
    mode: 'term-discovery', schema: termDiscoveryResultSchema, label: 'term suggestions',
    systemPrompt: TERM_SYSTEM, signal, requestId: `${mediaFileId}:terms`,
    prompt: JSON.stringify(segments.map(({ startSec, endSec, originalText }) => ({ startSec, endSec, originalText }))),
  })
  return result.suggestions.filter((suggestion) => suggestion.examples.every((example) =>
    segments.some((segment) => segment.originalText.toLocaleLowerCase().includes(example.quote.toLocaleLowerCase())
      && example.startSec >= segment.startSec && example.endSec <= segment.endSec)))
}

export async function repairAtomicFact(input: { fact: AtomicFact; chunk: TranscriptChunk; errors: string[]; signal?: AbortSignal }): Promise<AtomicFact> {
  const repaired = await structuredOllamaChat({
    mode: 'fact-repair', schema: factModelItemSchema, label: 'repaired fact', signal: input.signal,
    systemPrompt: 'Repair one invalid fact using only the supplied original transcript. The evidence quote must be one short exact quote from that transcript, maximum 300 characters. If no supporting quote exists, preserve the original quote and do not invent evidence. JSON only. /no_think',
    requestId: `${input.fact.mediaFileId}:repair:${input.fact.id}`,
    prompt: JSON.stringify({ validationErrors: input.errors, invalidFact: input.fact, originalTranscript: input.chunk.originalText }),
  })
  return {
    ...input.fact,
    ...repaired,
    id: input.fact.id,
    mediaFileId: input.fact.mediaFileId,
    chunkIndex: input.fact.chunkIndex,
    evidenceQuote: compactEvidenceQuote(repaired.evidenceQuote),
  }
}

function compactEvidenceQuote(value: string): string {
  const quote = value.trim()
  if (quote.length <= 1_000) return quote

  const cutoff = quote.lastIndexOf(' ', 1_000)
  return quote.slice(0, cutoff > 0 ? cutoff : 1_000).trim()
}

export async function classifyFactRelation(left: MergedFact, right: MergedFact, signal?: AbortSignal) {
  const result = await structuredOllamaChat({
    mode: 'fact-deduplication', schema: factRelationSchema, label: 'fact relation', signal,
    systemPrompt: 'Classify only the relation between two evidence-backed facts. Do not rewrite them. JSON only. /no_think',
    requestId: `${left.mediaFileId}:dedupe:${left.id}:${right.id}`,
    prompt: JSON.stringify({ left, right }),
  })
  return result.relation
}
