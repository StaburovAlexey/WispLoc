import { describe, expect, it } from 'vitest'
import type { KnowledgeExample, KnowledgeRule } from '../packages/core/src/knowledge'
import {
  applyPromptBudget,
  buildRetrievalContext,
  BUILTIN_EXAMPLES,
  inferRetrievalLabels,
  rankExamples,
  tokenizeKnowledgeText,
} from '../packages/core/src/knowledge'

describe('local RAG retrieval', () => {
  it('ships at least 50 reviewed Russian examples and hard-filters by stage and language', () => {
    expect(BUILTIN_EXAMPLES.length).toBeGreaterThanOrEqual(50)
    const candidates = BUILTIN_EXAMPLES.filter((example) => example.stage === 'task-extraction' && example.language === 'ru')
    const selected = rankExamples({
      text: 'Иван, исправь авторизацию до пятницы.',
      labels: ['explicit-task'],
      examples: candidates,
      maxExamples: 4,
    })
    expect(selected).toHaveLength(4)
    expect(selected[0].labels).toContain('explicit-task')
    expect(selected.every((example) => example.stage === 'task-extraction' && example.language === 'ru')).toBe(true)
  })

  it('does not classify a noun inflection as a proposal', () => {
    expect(inferRetrievalLabels('Нужно спросить о возможных зависимостях')).toContain('explicit-task')
    expect(inferRetrievalLabels('Нужно спросить о возможных зависимостях')).not.toContain('proposal')
  })

  it('retrieves negative task examples for proposals and questions', () => {
    const text = 'Может, давайте когда-нибудь обновим React?'
    const selected = rankExamples({
      text,
      labels: inferRetrievalLabels(text),
      examples: BUILTIN_EXAMPLES.filter((example) => example.stage === 'task-extraction'),
      maxExamples: 4,
    })
    expect(selected.some((example) => example.labels.includes('not-a-task'))).toBe(true)
    expect(selected.some((example) => example.labels.includes('proposal') || example.labels.includes('question'))).toBe(true)
  })

  it('prefers gold examples and removes duplicate inputs', () => {
    const base: KnowledgeExample = {
      id: 'gold', stage: 'task-extraction', language: 'ru', inputText: 'Проверь сборку.',
      expectedOutputJson: '{"tasks":[]}', labels: ['explicit-task'], quality: 'gold', enabled: true,
      source: 'builtin', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    }
    const selected = rankExamples({
      text: base.inputText,
      labels: base.labels,
      examples: [
        { ...base, id: 'synthetic', quality: 'synthetic' },
        base,
        { ...base, id: 'duplicate', quality: 'reviewed', inputText: 'Проверь сборку.' },
      ],
      maxExamples: 3,
    })
    expect(selected.map((example) => example.id)).toEqual(['gold'])
  })

  it('preserves technical tokens and enforces prompt budgets', () => {
    expect(tokenizeKnowledgeText('qwen3:4b whisper.cpp /api/chat')).toEqual(expect.arrayContaining(['qwen3:4b', 'whisper.cpp', '/api/chat']))
    const rule = (id: string, length: number, priority: number): KnowledgeRule => ({
      id, stage: 'summary-final', language: 'ru', title: id, content: 'r'.repeat(length),
      version: 'v1', enabled: true, priority,
    })
    const result = applyPromptBudget({
      rules: [rule('important', 80, 100), rule('optional', 80, 1)],
      examples: BUILTIN_EXAMPLES.slice(0, 3).map((example) => ({ ...example, inputText: 'x'.repeat(100) })),
      maxRuleCharacters: 100,
      maxExampleCharacters: 120,
    })
    expect(result.rules.map((item) => item.id)).toEqual(['important'])
    expect(result.examples.length).toBeLessThan(3)
  })

  it('supports a developer-only no-RAG baseline for A/B evaluation', async () => {
    const previous = process.env.WISPLOC_RAG_ENABLED
    process.env.WISPLOC_RAG_ENABLED = 'false'
    try {
      const context = await buildRetrievalContext({ stage: 'task-extraction', language: 'ru', text: 'Иван, проверь сборку.' })
      expect(context.retrievalVersion).toBe('local-rag-v1-disabled')
      expect(context.ruleIds).toEqual([])
      expect(context.exampleIds).toEqual([])
    } finally {
      if (previous === undefined) delete process.env.WISPLOC_RAG_ENABLED
      else process.env.WISPLOC_RAG_ENABLED = previous
    }
  })
})
