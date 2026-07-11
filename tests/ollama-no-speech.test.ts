import { describe, expect, it } from 'vitest'
import { extractFinalTasks, summarizeChunk, summarizeFinal } from '../packages/core/src/ollama'

describe('ollama no-speech guards', () => {
  it('does not ask the LLM to invent summaries or tasks for non-speech chunks', async () => {
    const chunk = await summarizeChunk('[Music]', 0, 0, 2)

    expect(chunk).toMatchObject({
      chunkIndex: 0,
      summary: 'Содержательной речи не обнаружено.',
      keyPoints: [],
      decisions: [],
      risks: [],
      openQuestions: [],
      actionItems: [],
    })

    const finalSummary = await summarizeFinal([chunk])
    expect(finalSummary).toMatchObject({
      shortSummary: 'Содержательной речи не обнаружено.',
      keyPoints: [],
      decisions: [],
      risks: [],
      openQuestions: [],
      actionItems: [],
    })

    await expect(extractFinalTasks(finalSummary, [chunk])).resolves.toEqual([])
  })
})
