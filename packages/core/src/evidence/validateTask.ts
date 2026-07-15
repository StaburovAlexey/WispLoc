import type { FactEvidence, MergedFact } from '@wisploc/shared'

const QUESTION_PATTERN = /^(?:кто|что|где|когда|как|зачем|почему|какой|какая|какие|можно ли|нужно ли|надо ли|точно ли)\b|\?\s*$/iu
const TOKEN_PATTERN = /[\p{L}\p{N}][\p{L}\p{N}._:+#/-]*/gu
const STOP_WORDS = new Set([
  'а', 'без', 'бы', 'был', 'была', 'были', 'в', 'во', 'для', 'до', 'его', 'ее', 'её', 'и', 'из', 'или',
  'к', 'как', 'на', 'над', 'не', 'но', 'о', 'об', 'от', 'по', 'под', 'при', 'с', 'со', 'то', 'у', 'что',
  'это', 'этот', 'эта', 'эти', 'мы', 'вы', 'они', 'он', 'она', 'я', 'нужно', 'надо', 'должен', 'должна',
  'the', 'a', 'an', 'and', 'or', 'to', 'of', 'for', 'in', 'on', 'is', 'are', 'be', 'this', 'that',
])

export function validateTaskFieldsAgainstEvidence<T extends {
  assignee?: string
  dueDate?: string
  priority?: 'low' | 'medium' | 'high'
  explicitAssignee: boolean
  explicitDueDate: boolean
}>(task: T, evidence: FactEvidence[]): T {
  const evidenceText = evidence.map((item) => item.quote).join(' ').toLocaleLowerCase()
  const explicitAssignee = Boolean(task.explicitAssignee && task.assignee && evidenceText.includes(task.assignee.toLocaleLowerCase()))
  const explicitDueDate = Boolean(task.explicitDueDate && task.dueDate && evidenceText.includes(task.dueDate.toLocaleLowerCase()))
  const priority = task.priority && evidenceText.includes(task.priority.toLocaleLowerCase()) ? task.priority : undefined
  return {
    ...task,
    assignee: explicitAssignee ? task.assignee : undefined,
    dueDate: explicitDueDate ? task.dueDate : undefined,
    priority,
    explicitAssignee,
    explicitDueDate,
  }
}

export function isTaskContentGrounded(
  task: Pick<MergedFact, 'text'> & { title?: string; description?: string },
  sourceFacts: MergedFact[],
): boolean {
  const title = (task.title ?? task.text).trim()
  if (!title || QUESTION_PATTERN.test(title)) return false

  const titleTokens = contentTokens(title)
  if (titleTokens.length < 2) return false

  const sourceText = sourceFacts
    .flatMap((fact) => [fact.text, ...fact.evidence.map((item) => item.quote)])
    .join(' ')
  const sourceTokens = new Set(contentTokens(sourceText))
  const titleMatches = titleTokens.filter((token) => sourceTokens.has(token)).length
  const requiredMatches = Math.min(2, titleTokens.length)
  if (titleMatches < requiredMatches || titleMatches / titleTokens.length < 0.5) return false

  const descriptionTokens = contentTokens(task.description ?? '')
  if (descriptionTokens.length > 0 && !descriptionTokens.some((token) => sourceTokens.has(token))) return false
  return true
}

function contentTokens(value: string): string[] {
  return [...new Set((value.toLocaleLowerCase().match(TOKEN_PATTERN) ?? [])
    .map((token) => token.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''))
    .filter((token) => token.length >= 2 && !STOP_WORDS.has(token)))]
}
