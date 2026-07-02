import { loadConfig } from '../config'
import type { ChunkSummary, FinalSummary, ExtractedActionItem } from '@wisploc/shared'
import { chunkSummarySchema, finalSummarySchema } from '@wisploc/shared'

const OLLAMA_CHAT_URL = '/api/chat'

interface OllamaChatRequest {
  model: string
  messages: Array<{ role: string; content: string }>
  stream: false
  format?: 'json'
}

interface OllamaChatResponse {
  message: { role: string; content: string }
}

async function ollamaChat(
  prompt: string,
  systemPrompt?: string,
): Promise<string> {
  const config = loadConfig()
  const url = `${config.ollamaHost}${OLLAMA_CHAT_URL}`

  const messages: Array<{ role: string; content: string }> = []
  if (systemPrompt) {
    messages.push({ role: 'system', content: systemPrompt })
  }
  messages.push({ role: 'user', content: prompt })

  const body: OllamaChatRequest = {
    model: config.llmModel,
    messages,
    stream: false,
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Ollama API error ${response.status}: ${text.slice(0, 200)}`)
  }

  const data = (await response.json()) as OllamaChatResponse
  return data.message.content
}

/**
 * Parse and validate JSON from LLM output.
 * Tries direct parse, then repair (extract JSON from markdown fences), then falls back.
 */
function parseAndValidate<T>(raw: string, schema: { parse: (data: unknown) => T }, label: string): T {
  // Try direct parse
  try {
    return schema.parse(JSON.parse(raw))
  } catch {}

  // Try to extract JSON from markdown code fences
  const fenceMatch = raw.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/)
  if (fenceMatch) {
    try {
      return schema.parse(JSON.parse(fenceMatch[1]))
    } catch {}
  }

  // Try to find a JSON object in the text
  const jsonMatch = raw.match(/\{[\s\S]*\}/)
  if (jsonMatch) {
    try {
      return schema.parse(JSON.parse(jsonMatch[0]))
    } catch {}
  }

  throw new Error(`Failed to parse ${label} from LLM output`)
}

// ── Chunk summary ──────────────────────────────────────
const CHUNK_SUMMARY_SYSTEM = `You are a precise meeting summarizer. Analyze the transcript chunk and output ONLY valid JSON with this structure:
{
  "chunkIndex": 0,
  "startSec": 0,
  "endSec": 0,
  "summary": "concise summary in 2-3 sentences",
  "keyPoints": ["point 1", "point 2"],
  "decisions": ["decision 1"],
  "risks": ["risk 1"],
  "openQuestions": ["question 1"],
  "actionItems": [
    {
      "title": "Task title",
      "description": "Task description",
      "priority": "medium",
      "assigneeHint": "role or name",
      "dueDateHint": "when needed",
      "confidence": 0.8
    }
  ]
}
Do not include any text outside the JSON.`

export async function summarizeChunk(
  transcript: string,
  chunkIndex: number,
  startSec: number,
  endSec: number,
): Promise<ChunkSummary> {
  const prompt = `Summarize the following transcript chunk (${formatTime(startSec)}–${formatTime(endSec)}):\n\n${transcript}`

  const raw = await ollamaChat(prompt, CHUNK_SUMMARY_SYSTEM)

  const result = parseAndValidate(raw, chunkSummarySchema, 'chunk summary')
  result.chunkIndex = chunkIndex
  result.startSec = startSec
  result.endSec = endSec
  return result
}

// ── Final summary ──────────────────────────────────────
const FINAL_SUMMARY_SYSTEM = `You are a precise meeting summarizer. Given multiple chunk summaries from a long transcript, produce a consolidated final summary. Output ONLY valid JSON:
{
  "shortSummary": "1-2 sentence overview",
  "detailedSummary": "3-5 paragraph detailed summary",
  "keyPoints": ["key point 1", "key point 2"],
  "decisions": ["decision 1"],
  "risks": ["risk 1"],
  "openQuestions": ["question 1"],
  "actionItems": [
    {
      "title": "Task title",
      "description": "Task description",
      "sourceTimecode": "00:05:30",
      "sourceChunkIndex": 1,
      "priority": "medium",
      "labels": ["label1"],
      "assigneeHint": "role or name",
      "dueDateHint": "when needed",
      "confidence": 0.8
    }
  ]
}
Merge duplicate action items. Do not include any text outside the JSON.`

export async function summarizeFinal(
  chunkSummaries: ChunkSummary[],
): Promise<FinalSummary> {
  const summariesText = chunkSummaries
    .map((cs) => `[Chunk ${cs.chunkIndex} — ${formatTime(cs.startSec)}–${formatTime(cs.endSec)}]\n${cs.summary}\nKey points: ${cs.keyPoints.join('; ')}`)
    .join('\n\n')

  const prompt = `Here are summaries of ${chunkSummaries.length} transcript chunks. Produce a consolidated final summary:\n\n${summariesText}`

  const raw = await ollamaChat(prompt, FINAL_SUMMARY_SYSTEM)
  return parseAndValidate(raw, finalSummarySchema, 'final summary')
}

// ── Helpers ────────────────────────────────────────────
function formatTime(sec: number): string {
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = Math.floor(sec % 60)
  if (h > 0) return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}
