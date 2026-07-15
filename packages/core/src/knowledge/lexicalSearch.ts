import type { KnowledgeExample } from './types'

const QUALITY_WEIGHT = { gold: 3, reviewed: 2, synthetic: -2 } as const

export function tokenizeKnowledgeText(value: string): string[] {
  return [...new Set(value.toLocaleLowerCase().match(/[\p{L}\p{N}_./:+-]+/gu) ?? [])]
}

export function inferRetrievalLabels(text: string): string[] {
  const normalized = text.toLocaleLowerCase()
  const labels: string[] = []
  if (/(?:^|[^\p{L}\p{N}_])(?:может|можно|возможно|давайте|хотел)(?:$|[^\p{L}\p{N}_])|предлага/u.test(normalized)) labels.push('proposal', 'not-a-task')
  if (/\?/u.test(text)) labels.push('question', 'not-a-task')
  if (/(?:^|[^\p{L}\p{N}_])(?:вчера|раньше)(?:$|[^\p{L}\p{N}_])|прошл|уже сделал/u.test(normalized)) labels.push('historical-action', 'not-a-task')
  if (/(?:отмен|не делаем|не выполнять|оставляем как есть)/u.test(normalized)) labels.push('cancelled-decision', 'not-a-task')
  if (/(?:^|[^\p{L}\p{N}_])(?:сделай|сделайте|исправь|исправьте|проверь|проверьте|подготовь|подготовьте|обнови|обновите|спроси|спросите|спросить|удали|удалите|добавь|добавьте|сделаю)(?:$|[^\p{L}\p{N}_])|беру на себя/u.test(normalized)) labels.push('explicit-task')
  return [...new Set(labels)]
}

export function rankExamples(input: {
  text: string
  labels: string[]
  examples: KnowledgeExample[]
  maxExamples: number
}): KnowledgeExample[] {
  const queryTokens = new Set(tokenizeKnowledgeText(input.text))
  const labels = new Set(input.labels)
  const ranked = input.examples.map((example) => {
    const exampleTokens = tokenizeKnowledgeText(example.inputText)
    const overlap = exampleTokens.filter((token) => queryTokens.has(token)).length
    const lexical = overlap / Math.max(1, Math.sqrt(queryTokens.size * exampleTokens.length))
    const labelMatch = example.labels.filter((label) => labels.has(label)).length * 1.5
    return { example, score: lexical * 10 + labelMatch + QUALITY_WEIGHT[example.quality] }
  }).sort((a, b) => b.score - a.score || a.example.id.localeCompare(b.example.id))

  const prioritized = input.labels.includes('explicit-task')
    ? [
        ...ranked.filter(({ example }) => example.labels.includes('explicit-task')),
        ...ranked.filter(({ example }) => !example.labels.includes('explicit-task')),
      ]
    : ranked
  const seen = new Set<string>()
  return prioritized.flatMap(({ example }) => {
    const key = tokenizeKnowledgeText(example.inputText).join(' ')
    if (seen.has(key)) return []
    seen.add(key)
    return [example]
  }).slice(0, input.maxExamples)
}
