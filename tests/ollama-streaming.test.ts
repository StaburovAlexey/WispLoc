import { afterEach, describe, expect, it, vi } from 'vitest'
import { evidenceSummaryBatchSchema, factRelationSchema } from '../packages/shared/src/schemas'
import { structuredOllamaChat } from '../packages/core/src/ollama'

afterEach(() => vi.unstubAllGlobals())

describe('Ollama streaming', () => {
  it('collects NDJSON content and uses the configured summary context', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input).endsWith('/api/tags')) return new Response('{}', { status: 200 })
      const lines = [
        JSON.stringify({ message: { content: '{"relation":' }, done: false }),
        JSON.stringify({ message: { content: '"different"}' }, done: true, done_reason: 'stop', prompt_eval_count: 40, eval_count: 8, eval_duration: 2_000_000_000 }),
      ].join('\n') + '\n'
      return new Response(lines, { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(structuredOllamaChat({
      prompt: 'compare', systemPrompt: 'JSON only', mode: 'evidence-final-summary',
      schema: factRelationSchema, label: 'stream test',
    })).resolves.toEqual({ relation: 'different' })

    const request = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))
    expect(request).toMatchObject({ stream: true, think: false, keep_alive: '5m' })
    expect(request.options.num_ctx).toBe(8192)
  })

  it('runs only one Ollama chat request at a time', async () => {
    let activeChats = 0
    let maxActiveChats = 0
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      if (String(input).endsWith('/api/tags')) return new Response('{}', { status: 200 })
      activeChats += 1
      maxActiveChats = Math.max(maxActiveChats, activeChats)
      await new Promise((resolve) => setTimeout(resolve, 10))
      activeChats -= 1
      return new Response(`${JSON.stringify({ message: { content: '{"relation":"different"}' }, done: true })}\n`, { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)

    await Promise.all([1, 2].map(() => structuredOllamaChat({
      prompt: 'compare', systemPrompt: 'JSON only', mode: 'fact-deduplication',
      schema: factRelationSchema, label: 'queue test',
    })))

    expect(maxActiveChats).toBe(1)
  })

  it('drops evidence summary items without usable fact references', async () => {
    const response = {
      keyPoints: [{ text: 'Сохранить', sourceFactIds: [' f1 ', 'f1'] }],
      decisions: [],
      problems: [],
      openQuestions: [{ text: 'Нет источника', sourceFactIds: [] }],
      proposals: [],
    }
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      if (String(input).endsWith('/api/tags')) return new Response('{}', { status: 200 })
      return new Response(`${JSON.stringify({ message: { content: JSON.stringify(response) }, done: true })}\n`, { status: 200 })
    }))

    await expect(structuredOllamaChat({
      prompt: 'summarize', systemPrompt: 'JSON only', mode: 'evidence-final-summary',
      schema: evidenceSummaryBatchSchema, label: 'summary normalization test',
    })).resolves.toEqual({
      keyPoints: [{ text: 'Сохранить', sourceFactIds: ['f1'] }],
      decisions: [],
      problems: [],
      openQuestions: [],
      proposals: [],
    })
  })
})
