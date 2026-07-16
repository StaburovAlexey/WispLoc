import { afterEach, describe, expect, it, vi } from 'vitest'
import { factModelResultSchema } from '../packages/shared/src/schemas'
import { structuredOllamaChat } from '../packages/core/src/ollama'

afterEach(() => vi.unstubAllGlobals())

describe('Ollama cancellation', () => {
  it('aborts an active structured generation request', async () => {
    const fetchMock = vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/api/tags')) return Promise.resolve(new Response('{}', { status: 200 }))
      return new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal
        if (signal?.aborted) reject(signal.reason)
        else signal?.addEventListener('abort', () => reject(signal.reason), { once: true })
      })
    })
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()
    const request = structuredOllamaChat({
      prompt: 'test', systemPrompt: 'test', mode: 'fact-extraction',
      schema: factModelResultSchema, label: 'cancel test', signal: controller.signal,
    })
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    controller.abort(new Error('Job cancelled'))
    await expect(request).rejects.toThrow('Job cancelled')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
