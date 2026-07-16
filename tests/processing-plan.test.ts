import { describe, expect, it } from 'vitest'
import { resolveProcessingStages } from '../packages/core/src/processingPlan'

const empty = { transcript: false, facts: false, mergedFacts: false, summary: false, tasks: false, terms: false }

describe('processing stage planner', () => {
  it('adds the full prerequisite chain for tasks on a new file', () => {
    const plan = resolveProcessingStages(['tasks'], empty)
    expect(plan.executionStages).toEqual(['transcription', 'fact-extraction', 'fact-deduplication', 'tasks'])
    expect(plan.autoAddedStages).toEqual(['transcription', 'fact-extraction', 'fact-deduplication'])
  })

  it('runs summary alone when merged facts already exist', () => {
    const plan = resolveProcessingStages(['summary'], { ...empty, transcript: true, facts: true, mergedFacts: true })
    expect(plan.executionStages).toEqual(['summary'])
    expect(plan.autoAddedStages).toEqual([])
  })

  it('adds only deduplication when validated facts already exist', () => {
    const plan = resolveProcessingStages(['tasks'], { ...empty, transcript: true, facts: true })
    expect(plan.executionStages).toEqual(['fact-deduplication', 'tasks'])
  })

  it('allows term discovery from an existing transcript', () => {
    const plan = resolveProcessingStages(['term-discovery'], { ...empty, transcript: true })
    expect(plan.executionStages).toEqual(['term-discovery'])
  })
})
