import fs from 'node:fs/promises'
import path from 'node:path'
import {
  compareEvaluationReports,
  EVIDENCE_EVALUATION_FIXTURES,
  evaluateEvidencePredictions,
} from '../packages/core/src/evaluation'
import type { EvaluationComparison, EvaluationPrediction, EvaluationReport } from '../packages/core/src/evaluation'

const [baselinePath, candidatePath, outputPath] = process.argv.slice(2)
if (!baselinePath || !candidatePath) {
  console.error('Usage: pnpm evaluate:evidence <baseline-predictions.json> <rag-predictions.json> [report.md]')
  process.exitCode = 1
} else {
  const [baseline, candidate] = await Promise.all([readPredictions(baselinePath), readPredictions(candidatePath)])
  const comparison = compareEvaluationReports(
    evaluateEvidencePredictions(EVIDENCE_EVALUATION_FIXTURES, baseline),
    evaluateEvidencePredictions(EVIDENCE_EVALUATION_FIXTURES, candidate),
  )
  const report = formatReport(comparison)
  if (outputPath) {
    await fs.mkdir(path.dirname(path.resolve(outputPath)), { recursive: true })
    await fs.writeFile(outputPath, report, 'utf8')
    console.log(`Evidence evaluation report written to ${path.resolve(outputPath)}`)
  } else {
    console.log(report)
  }
}

async function readPredictions(filePath: string): Promise<EvaluationPrediction[]> {
  const parsed: unknown = JSON.parse(await fs.readFile(path.resolve(filePath), 'utf8'))
  if (!Array.isArray(parsed)) throw new Error(`${filePath} must contain a JSON array`)
  return parsed as EvaluationPrediction[]
}

function formatReport(comparison: EvaluationComparison): string {
  const rows: Array<[string, (report: EvaluationReport) => number, number]> = [
    ['Fact precision', (report) => report.facts.precision, comparison.deltas.factPrecision],
    ['Fact recall', (report) => report.facts.recall, comparison.deltas.factRecall],
    ['Task precision', (report) => report.tasks.precision, comparison.deltas.taskPrecision],
    ['Task recall', (report) => report.tasks.recall, comparison.deltas.taskRecall],
    ['False task rate', (report) => report.tasks.falseTaskRate, comparison.deltas.falseTaskRate],
    ['Supported summary items', (report) => report.summary.supportedItemRate, comparison.deltas.summarySupport],
    ['Required term retention', (report) => report.summary.requiredTermRetention, comparison.deltas.summaryRetention],
  ]
  const qualityTable = rows.map(([name, read, delta]) => `| ${name} | ${percent(read(comparison.baseline))} | ${percent(read(comparison.candidate))} | ${signed(delta)} |`).join('\n')
  return `# WispLoc evidence evaluation

Compared ${comparison.candidate.fixtureCount} fixed Russian fixtures. Baseline is evidence pipeline without RAG; candidate is Local RAG v1.

| Metric | Baseline | RAG v1 | Delta |
| --- | ---: | ---: | ---: |
${qualityTable}

## Runtime

| Metric | Baseline | RAG v1 | Delta |
| --- | ---: | ---: | ---: |
| Average duration | ${comparison.baseline.runtime.averageDurationMs} ms | ${comparison.candidate.runtime.averageDurationMs} ms | ${signedNumber(comparison.deltas.averageDurationMs)} ms |
| Ollama calls | ${comparison.baseline.runtime.ollamaCalls} | ${comparison.candidate.runtime.ollamaCalls} | ${signedNumber(comparison.deltas.ollamaCalls)} |
| Prompt tokens | ${comparison.baseline.runtime.promptTokens} | ${comparison.candidate.runtime.promptTokens} | ${signedNumber(comparison.candidate.runtime.promptTokens - comparison.baseline.runtime.promptTokens)} |
| Generated tokens | ${comparison.baseline.runtime.generatedTokens} | ${comparison.candidate.runtime.generatedTokens} | ${signedNumber(comparison.candidate.runtime.generatedTokens - comparison.baseline.runtime.generatedTokens)} |
| Semantic comparisons | ${comparison.baseline.runtime.semanticDedupeComparisons} | ${comparison.candidate.runtime.semanticDedupeComparisons} | ${signedNumber(comparison.candidate.runtime.semanticDedupeComparisons - comparison.baseline.runtime.semanticDedupeComparisons)} |
| Reused artifacts | ${comparison.baseline.runtime.reusedArtifacts} | ${comparison.candidate.runtime.reusedArtifacts} | ${signedNumber(comparison.candidate.runtime.reusedArtifacts - comparison.baseline.runtime.reusedArtifacts)} |

Missing predictions: baseline ${comparison.baseline.missingPredictionCount}, RAG v1 ${comparison.candidate.missingPredictionCount}.
`
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`
}

function signed(value: number): string {
  return `${value >= 0 ? '+' : ''}${(value * 100).toFixed(1)} pp`
}

function signedNumber(value: number): string {
  return `${value >= 0 ? '+' : ''}${value}`
}
