import type { DraftTask, EvidenceFinalSummary, EvidenceTranscriptSegment, MergedFact } from '@wisploc/shared'

const FILLER_PATTERN = /^(?:да|нет|ну|угу|ага|окей|ладно|понятно|хорошо|спасибо|привет|слышно|видно|всё|все)(?:[,.!?\s]+|$)/iu
const DECISION_CUE_PATTERN = /(?:решили|договорились|выбрали|оставляем|утвердили|согласовали|будем использовать)/iu
const WORD_PATTERN = /[\p{L}\p{N}][\p{L}\p{N}._:+#/-]*/gu

export function isSubstantiveFact(fact: MergedFact): boolean {
  const text = fact.text.trim()
  const words = text.toLocaleLowerCase().match(WORD_PATTERN) ?? []
  const minimumWords = fact.type === 'statement' ? 3 : 2
  if (text.length < 8 || words.length < minimumWords) return false
  if (FILLER_PATTERN.test(text) && words.length < 6) return false
  if (words.length >= 6 && new Set(words).size / words.length < 0.4) return false
  return fact.evidence.some((item) => item.quote.trim().length >= 4)
}

export function evaluateEvidenceQuality(input: {
  segments: EvidenceTranscriptSegment[]
  totalFactCount: number
  validFactCount: number
  mergedFacts: MergedFact[]
  tasks: DraftTask[]
  summary: EvidenceFinalSummary | null
  language: string
}): string[] {
  const russian = !input.language.toLocaleLowerCase().startsWith('en')
  const warnings: string[] = []
  const invalidCount = Math.max(0, input.totalFactCount - input.validFactCount)
  const invalidRatio = input.totalFactCount > 0 ? invalidCount / input.totalFactCount : 0
  const transcriptText = input.segments.map((segment) => segment.originalText).join(' ')

  if (input.totalFactCount > 0 && invalidRatio > 0.2) {
    warnings.push(russian
      ? `Не удалось подтвердить ${Math.round(invalidRatio * 100)}% извлечённых фактов по исходной транскрипции.`
      : `${Math.round(invalidRatio * 100)}% of extracted facts could not be grounded in the source transcript.`)
  }
  if (input.segments.length >= 10 && input.mergedFacts.length === 0) {
    warnings.push(russian
      ? 'В транскрипции не найдено достаточно подтверждённых содержательных фактов.'
      : 'The transcript did not yield enough grounded substantive facts.')
  }
  if (DECISION_CUE_PATTERN.test(transcriptText) && !input.mergedFacts.some((fact) => fact.type === 'decision')) {
    warnings.push(russian
      ? 'В речи есть признаки решений, но ни одно решение не прошло проверку evidence.'
      : 'The transcript contains decision cues, but no decision passed evidence validation.')
  }
  if (input.mergedFacts.some((fact) => fact.type === 'task_candidate') && input.tasks.length === 0) {
    warnings.push(russian
      ? 'Обнаружены кандидаты в задачи, но ни один не прошёл проверку связи с исходными фактами.'
      : 'Task candidates were found, but none passed source-grounding validation.')
  }
  if (input.summary && input.mergedFacts.length > 0 && input.summary.keyPoints.length === 0) {
    warnings.push(russian
      ? 'Summary создано без подтверждённых ключевых пунктов.'
      : 'The summary was created without grounded key points.')
  }
  return [...new Set(warnings)]
}
