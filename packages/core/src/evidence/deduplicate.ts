import { randomUUID } from 'node:crypto'
import type { MergedFact, TaskCandidate, ValidatedFact } from '@wisploc/shared'
import { normalizeQuote } from './validateFacts'
import { classifyFactRelation } from './generate'
import { createLogger } from '../logger'

const dedupeLog = createLogger('fact-deduplication', 'worker.log')

export function deduplicateFacts(facts: ValidatedFact[]): MergedFact[] {
  const merged: MergedFact[] = []
  for (const fact of facts.filter((item) => item.validationStatus === 'valid')) {
    const key = `${fact.type}:${normalizeQuote(fact.text)}`
    const existing = merged.find((item) => `${item.type}:${normalizeQuote(item.text)}` === key)
    const evidence = { quote: fact.evidenceQuote, startSec: fact.startSec, endSec: fact.endSec, chunkIndex: fact.chunkIndex }
    if (!existing) {
      merged.push({ id: randomUUID(), mediaFileId: fact.mediaFileId, type: fact.type, text: fact.text, evidence: [evidence], sourceFactIds: [fact.id] })
      continue
    }
    if (!existing.sourceFactIds.includes(fact.id)) existing.sourceFactIds.push(fact.id)
    if (!existing.evidence.some((item) => item.quote === evidence.quote && item.startSec === evidence.startSec && item.endSec === evidence.endSec)) {
      existing.evidence.push(evidence)
    }
  }
  return merged
}

export function deduplicateTasks(tasks: TaskCandidate[]): Array<TaskCandidate & { mergedCandidateIds: string[] }> {
  const merged: Array<TaskCandidate & { mergedCandidateIds: string[] }> = []
  for (const task of tasks) {
    const key = `${normalizeQuote(task.title)}:${normalizeQuote(task.description ?? '')}:${task.assignee?.toLocaleLowerCase() ?? ''}:${task.dueDate?.toLocaleLowerCase() ?? ''}`
    const existing = merged.find((item) => `${normalizeQuote(item.title)}:${normalizeQuote(item.description ?? '')}:${item.assignee?.toLocaleLowerCase() ?? ''}:${item.dueDate?.toLocaleLowerCase() ?? ''}` === key)
    if (!existing) {
      merged.push({ ...task, mergedCandidateIds: [task.id] })
      continue
    }
    existing.mergedCandidateIds.push(task.id)
    existing.sourceFactIds = [...new Set([...existing.sourceFactIds, ...task.sourceFactIds])]
    existing.evidence = [...existing.evidence, ...task.evidence.filter((candidate) => !existing.evidence.some((item) => item.quote === candidate.quote && item.startSec === candidate.startSec))]
  }
  return merged
}

export async function semanticDeduplicateFacts(facts: MergedFact[], signal?: AbortSignal, similarityThreshold = 0.55, maxComparisons = 200): Promise<MergedFact[]> {
  const result = [...facts]
  let comparisons = 0
  let skippedByBudget = 0
  for (let leftIndex = 0; leftIndex < result.length; leftIndex += 1) {
    const left = result[leftIndex]
    for (let rightIndex = result.length - 1; rightIndex > leftIndex; rightIndex -= 1) {
      const right = result[rightIndex]
      if (left.type !== right.type || tokenSimilarity(left.text, right.text) < similarityThreshold) continue
      if (comparisons >= maxComparisons) {
        skippedByBudget += 1
        continue
      }
      comparisons += 1
      const relation = await classifyFactRelation(left, right, signal)
      if (relation !== 'duplicate') continue
      left.sourceFactIds = [...new Set([...left.sourceFactIds, ...right.sourceFactIds])]
      left.evidence = [...left.evidence, ...right.evidence.filter((candidate) => !left.evidence.some((item) =>
        item.quote === candidate.quote && item.startSec === candidate.startSec && item.endSec === candidate.endSec))]
      result.splice(rightIndex, 1)
    }
  }
  dedupeLog.info('semantic fact deduplication completed', { comparisons, maxComparisons, skippedByBudget })
  return result
}

function tokenSimilarity(left: string, right: string): number {
  const leftTokens = new Set(normalizeQuote(left).split(' ').filter(Boolean))
  const rightTokens = new Set(normalizeQuote(right).split(' ').filter(Boolean))
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0
  const intersection = [...leftTokens].filter((token) => rightTokens.has(token)).length
  return intersection / Math.max(leftTokens.size, rightTokens.size)
}
