import type { EvaluationComparison, EvaluationFixture, EvaluationPrediction, EvaluationReport } from './types'

const MATCH_THRESHOLD = 0.45

export function evaluateEvidencePredictions(
  fixtures: EvaluationFixture[],
  predictions: EvaluationPrediction[],
): EvaluationReport {
  const predictionByFixture = new Map(predictions.map((prediction) => [prediction.fixtureId, prediction]))
  let expectedFacts = 0
  let predictedFacts = 0
  let matchedFacts = 0
  let matchedFactTypes = 0
  let expectedTasks = 0
  let predictedTasks = 0
  let matchedTasks = 0
  let assigneeChecks = 0
  let assigneeMatches = 0
  let dueDateChecks = 0
  let dueDateMatches = 0
  let supportedSummaryItems = 0
  let summaryItems = 0
  let requiredTerms = 0
  let retainedTerms = 0
  let missingPredictionCount = 0
  const runtimeValues: NonNullable<EvaluationPrediction['runtime']>[] = []

  for (const fixture of fixtures) {
    const prediction = predictionByFixture.get(fixture.id)
    expectedFacts += fixture.expectedFacts.length
    expectedTasks += fixture.expectedTasks.length
    requiredTerms += fixture.requiredSummaryTerms.length
    if (!prediction) {
      missingPredictionCount += 1
      continue
    }
    if (prediction.runtime) runtimeValues.push(prediction.runtime)
    predictedFacts += prediction.facts.length
    predictedTasks += prediction.tasks.length

    const factMatches = matchItems(fixture.expectedFacts, prediction.facts, (item) => item.text)
    matchedFacts += factMatches.length
    matchedFactTypes += factMatches.filter(({ expected, predicted }) => expected.type === predicted.type).length

    const taskMatches = matchItems(fixture.expectedTasks, prediction.tasks, (item) => item.title)
    matchedTasks += taskMatches.length
    for (const { expected, predicted } of taskMatches) {
      if (expected.assignee) {
        assigneeChecks += 1
        if (normalize(expected.assignee) === normalize(predicted.assignee ?? '')) assigneeMatches += 1
      }
      if (expected.dueDate) {
        dueDateChecks += 1
        if (similarity(expected.dueDate, predicted.dueDate ?? '') >= MATCH_THRESHOLD) dueDateMatches += 1
      }
    }

    const factIds = new Set(prediction.facts.map((fact) => fact.id))
    summaryItems += prediction.summaryItems.length
    supportedSummaryItems += prediction.summaryItems.filter((item) => (
      item.sourceFactIds.length > 0 && item.sourceFactIds.every((id) => factIds.has(id))
    )).length
    const summaryText = prediction.summaryItems.map((item) => item.text).join(' ')
    retainedTerms += fixture.requiredSummaryTerms.filter((term) => normalize(summaryText).includes(normalize(term))).length

    const forbiddenMatches = prediction.tasks.filter((task) => fixture.forbiddenTasks.some((forbidden) => similarity(forbidden, task.title) >= MATCH_THRESHOLD)).length
    matchedTasks = Math.max(0, matchedTasks - forbiddenMatches)
  }

  return {
    fixtureCount: fixtures.length,
    missingPredictionCount,
    facts: {
      precision: ratio(matchedFacts, predictedFacts),
      recall: ratio(matchedFacts, expectedFacts),
      unsupportedRate: ratio(predictedFacts - matchedFacts, predictedFacts),
      typeAccuracy: ratio(matchedFactTypes, matchedFacts),
    },
    tasks: {
      precision: ratio(matchedTasks, predictedTasks),
      recall: ratio(matchedTasks, expectedTasks),
      falseTaskRate: ratio(predictedTasks - matchedTasks, predictedTasks),
      assigneeAccuracy: ratio(assigneeMatches, assigneeChecks),
      dueDateAccuracy: ratio(dueDateMatches, dueDateChecks),
    },
    summary: {
      supportedItemRate: ratio(supportedSummaryItems, summaryItems),
      requiredTermRetention: ratio(retainedTerms, requiredTerms),
    },
    runtime: aggregateRuntime(runtimeValues),
  }
}

export function compareEvaluationReports(baseline: EvaluationReport, candidate: EvaluationReport): EvaluationComparison {
  return {
    baseline,
    candidate,
    deltas: {
      factPrecision: candidate.facts.precision - baseline.facts.precision,
      factRecall: candidate.facts.recall - baseline.facts.recall,
      taskPrecision: candidate.tasks.precision - baseline.tasks.precision,
      taskRecall: candidate.tasks.recall - baseline.tasks.recall,
      falseTaskRate: candidate.tasks.falseTaskRate - baseline.tasks.falseTaskRate,
      summarySupport: candidate.summary.supportedItemRate - baseline.summary.supportedItemRate,
      summaryRetention: candidate.summary.requiredTermRetention - baseline.summary.requiredTermRetention,
      averageDurationMs: candidate.runtime.averageDurationMs - baseline.runtime.averageDurationMs,
      ollamaCalls: candidate.runtime.ollamaCalls - baseline.runtime.ollamaCalls,
    },
  }
}

function matchItems<E, P>(expected: E[], predicted: P[], text: (item: E | P) => string): Array<{ expected: E; predicted: P }> {
  const used = new Set<number>()
  return expected.flatMap((expectedItem) => {
    const best = predicted.map((predictedItem, index) => ({ predictedItem, index, score: used.has(index) ? -1 : similarity(text(expectedItem), text(predictedItem)) }))
      .sort((left, right) => right.score - left.score)[0]
    if (!best || best.score < MATCH_THRESHOLD) return []
    used.add(best.index)
    return [{ expected: expectedItem, predicted: best.predictedItem }]
  })
}

function similarity(left: string, right: string): number {
  const leftTokens = new Set(normalize(left).split(' ').filter(Boolean))
  const rightTokens = new Set(normalize(right).split(' ').filter(Boolean))
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0
  const intersection = [...leftTokens].filter((token) => rightTokens.has(token)).length
  return intersection / Math.max(leftTokens.size, rightTokens.size)
}

function normalize(value: string): string {
  return value.toLocaleLowerCase().replace(/[^\p{L}\p{N}_./:+-]+/gu, ' ').trim()
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 1 : Number((numerator / denominator).toFixed(4))
}

function aggregateRuntime(values: NonNullable<EvaluationPrediction['runtime']>[]): EvaluationReport['runtime'] {
  const sum = (key: keyof NonNullable<EvaluationPrediction['runtime']>) => values.reduce((total, value) => total + (value[key] ?? 0), 0)
  return {
    averageDurationMs: values.length === 0 ? 0 : Math.round(sum('durationMs') / values.length),
    promptTokens: sum('promptTokens'),
    generatedTokens: sum('generatedTokens'),
    ollamaCalls: sum('ollamaCalls'),
    semanticDedupeComparisons: sum('semanticDedupeComparisons'),
    reusedArtifacts: sum('reusedArtifacts'),
  }
}
