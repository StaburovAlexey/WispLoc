import { describe, expect, it } from 'vitest'
import {
  compareEvaluationReports,
  EVIDENCE_EVALUATION_FIXTURES,
  evaluateEvidencePredictions,
} from '../packages/core/src/evaluation'
import type { EvaluationPrediction } from '../packages/core/src/evaluation'

describe('evidence evaluation', () => {
  it('keeps fixed fixtures separate from retrieval examples and covers required scenarios', () => {
    expect(EVIDENCE_EVALUATION_FIXTURES).toHaveLength(10)
    expect(new Set(EVIDENCE_EVALUATION_FIXTURES.map((fixture) => fixture.id)).size).toBe(10)
    expect(EVIDENCE_EVALUATION_FIXTURES.some((fixture) => fixture.id === 'proposal-without-commitment')).toBe(true)
    expect(EVIDENCE_EVALUATION_FIXTURES.some((fixture) => fixture.id === 'middle-information')).toBe(true)
  })

  it('calculates supported evidence metrics and A/B deltas', () => {
    const fixture = EVIDENCE_EVALUATION_FIXTURES[0]
    const candidate: EvaluationPrediction = {
      fixtureId: fixture.id,
      facts: [{ id: 'fact-1', ...fixture.expectedFacts[0] }],
      tasks: [{ ...fixture.expectedTasks[0], sourceFactIds: ['fact-1'] }],
      summaryItems: [{ text: `Обсуждалась ${fixture.requiredSummaryTerms[0]}.`, sourceFactIds: ['fact-1'] }],
      runtime: { durationMs: 1_000, promptTokens: 100, generatedTokens: 20, ollamaCalls: 2 },
    }
    const baseline: EvaluationPrediction = {
      fixtureId: fixture.id,
      facts: [], tasks: [{ title: 'Выдуманная задача', sourceFactIds: [] }], summaryItems: [],
      runtime: { durationMs: 800, ollamaCalls: 1 },
    }
    const candidateReport = evaluateEvidencePredictions([fixture], [candidate])
    const baselineReport = evaluateEvidencePredictions([fixture], [baseline])
    const comparison = compareEvaluationReports(baselineReport, candidateReport)

    expect(candidateReport.facts).toMatchObject({ precision: 1, recall: 1, unsupportedRate: 0, typeAccuracy: 1 })
    expect(candidateReport.tasks).toMatchObject({ precision: 1, recall: 1, falseTaskRate: 0 })
    expect(candidateReport.summary.supportedItemRate).toBe(1)
    expect(comparison.deltas.factRecall).toBeGreaterThan(0)
    expect(comparison.deltas.falseTaskRate).toBeLessThan(0)
    expect(comparison.deltas.ollamaCalls).toBe(1)
  })
})
