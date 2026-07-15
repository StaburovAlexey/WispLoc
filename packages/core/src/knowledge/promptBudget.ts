import type { KnowledgeExample, KnowledgeRule } from './types'

export interface PromptBudgetResult {
  rules: KnowledgeRule[]
  examples: KnowledgeExample[]
  estimatedTokens: number
}

export function estimateTokens(value: string): number {
  return Math.ceil(value.length / 3.5)
}

export function applyPromptBudget(input: {
  rules: KnowledgeRule[]
  examples: KnowledgeExample[]
  maxRuleCharacters: number
  maxExampleCharacters: number
}): PromptBudgetResult {
  const rules = [...input.rules].sort((a, b) => b.priority - a.priority)
  while (rules.reduce((sum, rule) => sum + rule.content.length, 0) > input.maxRuleCharacters && rules.length > 1) rules.pop()

  const examples = [...input.examples]
  while (examples.reduce((sum, example) => sum + example.inputText.length + example.expectedOutputJson.length, 0) > input.maxExampleCharacters && examples.length > 0) examples.pop()

  return {
    rules,
    examples,
    estimatedTokens: estimateTokens([
      ...rules.map((rule) => rule.content),
      ...examples.flatMap((example) => [example.inputText, example.expectedOutputJson]),
    ].join('\n')),
  }
}
