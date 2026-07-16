import type { FactType } from '@wisploc/shared'

export interface EvaluationFixture {
  id: string
  transcript: string
  expectedFacts: Array<{ type: FactType; text: string }>
  expectedTasks: Array<{ title: string; assignee?: string; dueDate?: string }>
  forbiddenTasks: string[]
  requiredSummaryTerms: string[]
}

export interface EvaluationPrediction {
  fixtureId: string
  facts: Array<{ id: string; type: FactType; text: string }>
  tasks: Array<{ title: string; assignee?: string; dueDate?: string; sourceFactIds: string[] }>
  summaryItems: Array<{ text: string; sourceFactIds: string[] }>
  runtime?: {
    durationMs?: number
    promptTokens?: number
    generatedTokens?: number
    ollamaCalls?: number
    semanticDedupeComparisons?: number
    reusedArtifacts?: number
  }
}

export interface EvaluationReport {
  fixtureCount: number
  missingPredictionCount: number
  facts: { precision: number; recall: number; unsupportedRate: number; typeAccuracy: number }
  tasks: { precision: number; recall: number; falseTaskRate: number; assigneeAccuracy: number; dueDateAccuracy: number }
  summary: { supportedItemRate: number; requiredTermRetention: number }
  runtime: {
    averageDurationMs: number
    promptTokens: number
    generatedTokens: number
    ollamaCalls: number
    semanticDedupeComparisons: number
    reusedArtifacts: number
  }
}

export interface EvaluationComparison {
  baseline: EvaluationReport
  candidate: EvaluationReport
  deltas: {
    factPrecision: number
    factRecall: number
    taskPrecision: number
    taskRecall: number
    falseTaskRate: number
    summarySupport: number
    summaryRetention: number
    averageDurationMs: number
    ollamaCalls: number
  }
}
