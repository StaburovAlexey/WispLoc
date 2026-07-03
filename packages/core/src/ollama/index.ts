import { execa } from 'execa'
import path from 'node:path'
import { loadConfig } from '../config'
import { writeManagedOllamaPid } from './runtime'
import type { ChunkSummary, FinalSummary, ExtractedActionItem } from '@wisploc/shared'
import { PATHS, chunkSummarySchema, finalSummarySchema } from '@wisploc/shared'

const OLLAMA_CHAT_URL = '/api/chat'
const OLLAMA_REQUEST_TIMEOUT_MS = 600_000
const MAX_CHUNK_TRANSCRIPT_CHARS = 8_000
const MAX_FINAL_SUMMARIES_CHARS = 12_000
const EMPTY_FINAL_SUMMARY: FinalSummary = {
  shortSummary: 'Summary was not generated.',
  detailedSummary: 'Summary was not generated.',
  keyPoints: [],
  decisions: [],
  risks: [],
  openQuestions: [],
  actionItems: [],
}

interface OllamaChatRequest {
  model: string
  messages: Array<{ role: string; content: string }>
  stream: false
  format?: 'json'
  think?: false
  keep_alive?: string
  options?: {
    temperature?: number
    num_ctx?: number
    num_predict?: number
  }
}

interface OllamaChatResponse {
  message: { role: string; content: string }
}

async function ollamaChat(
  prompt: string,
  systemPrompt?: string,
  numPredict = 900,
): Promise<string> {
  const config = loadConfig()
  await ensureOllamaReady(config.ollamaHost)
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
    format: 'json',
    think: false,
    keep_alive: '30s',
    options: {
      temperature: 0.1,
      num_ctx: 4096,
      num_predict: numPredict,
    },
  }

  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(OLLAMA_REQUEST_TIMEOUT_MS),
    })
  } catch (err: any) {
    const reason = err.name === 'TimeoutError'
      ? `request timed out after ${Math.round(OLLAMA_REQUEST_TIMEOUT_MS / 1000)}s`
      : err.cause?.message ?? err.message ?? String(err)
    throw new Error(`Ollama request failed at ${config.ollamaHost}: ${reason}`)
  }

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Ollama API error ${response.status}: ${text.slice(0, 200)}`)
  }

  const data = (await response.json()) as OllamaChatResponse
  return data.message.content
}

async function ensureOllamaReady(ollamaHost: string): Promise<void> {
  if (await isOllamaReachable(ollamaHost)) return

  const ollamaBin = path.join(PATHS.bin, process.platform === 'win32' ? 'ollama.exe' : 'ollama')
  try {
    const child = execa(ollamaBin, ['serve'], {
      detached: true,
      stdio: 'ignore',
      env: { ...process.env, OLLAMA_HOST: ollamaHost },
    })
    writeManagedOllamaPid(child.pid)
    child.unref()
  } catch (err: any) {
    throw new Error(`Failed to start Ollama service from ${ollamaBin}: ${err.message ?? String(err)}`)
  }

  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    await sleep(500)
    if (await isOllamaReachable(ollamaHost)) return
  }

  throw new Error(`Ollama service did not become reachable at ${ollamaHost}`)
}

async function isOllamaReachable(ollamaHost: string): Promise<boolean> {
  try {
    const response = await fetch(`${ollamaHost}/api/tags`, { signal: AbortSignal.timeout(2_000) })
    return response.ok
  } catch {
    return false
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Parse and validate JSON from LLM output.
 * Tries direct parse, then repair (extract JSON from markdown fences), then falls back.
 */
function parseAndValidate<T>(raw: string, schema: { parse: (data: unknown) => T }, label: string): T {
  let lastValidationError: Error | null = null

  // Try direct parse
  try {
    return validateKnownJsonShapes(JSON.parse(raw), schema, label)
  } catch (err) {
    if (err instanceof Error && isValidationError(err)) lastValidationError = err
  }

  // Try to extract JSON from markdown code fences
  const fenceMatch = raw.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/)
  if (fenceMatch) {
    try {
      return validateKnownJsonShapes(JSON.parse(fenceMatch[1]), schema, label)
    } catch (err) {
      if (err instanceof Error && isValidationError(err)) lastValidationError = err
    }
  }

  // Try to find a JSON object in the text
  const jsonCandidate = extractBalancedJsonObject(raw)
  if (jsonCandidate) {
    try {
      return validateKnownJsonShapes(JSON.parse(jsonCandidate), schema, label)
    } catch (err) {
      if (err instanceof Error && isValidationError(err)) lastValidationError = err
    }
  }

  if (lastValidationError) throw lastValidationError
  throw new Error(`Failed to parse ${label} from LLM output: ${preview(raw)}`)
}

function tryParseAndValidate<T>(raw: string, schema: { parse: (data: unknown) => T }, label: string): T | null {
  try {
    return parseAndValidate(raw, schema, label)
  } catch (err) {
    console.warn(`[llm] Falling back after invalid ${label}:`, err instanceof Error ? err.message : err)
    return null
  }
}

function validateKnownJsonShapes<T>(parsed: unknown, schema: { parse: (data: unknown) => T }, label: string): T {
  const normalized = normalizeSummaryShape(parsed)
  try {
    return schema.parse(normalized)
  } catch (err: any) {
    const details = err?.issues?.map((issue: any) => `${issue.path?.join('.') || '<root>'}: ${issue.message}`).slice(0, 5).join('; ')
    throw new Error(`Failed to validate ${label} from LLM output${details ? `: ${details}` : ''}`)
  }
}

function normalizeSummaryShape(parsed: unknown): unknown {
  if (typeof parsed === 'string') {
    const normalized = parsed.trim()
    if (!normalized) return parsed

    try {
      return normalizeSummaryShape(JSON.parse(normalized))
    } catch {}

    const jsonCandidate = extractBalancedJsonObject(normalized)
    if (jsonCandidate) {
      try {
        return normalizeSummaryShape(JSON.parse(jsonCandidate))
      } catch {}
    }

    return parsed
  }

  if (parsed && typeof parsed === 'object') {
    const record = parsed as Record<string, unknown>
    for (const key of ['response', 'result', 'data']) {
      if (record[key] && typeof record[key] === 'object') {
        return normalizeSummaryShape(record[key])
      }
    }

    for (const key of ['keyPoints', 'decisions', 'risks', 'openQuestions', 'actionItems']) {
      if (!Array.isArray(record[key])) record[key] = []
    }

    if (Array.isArray(record.actionItems)) {
      record.actionItems = record.actionItems
        .filter((item) => item && typeof item === 'object')
        .map((item) => {
          const action = item as Record<string, unknown>
          return {
            ...action,
            title: typeof action.title === 'string' && action.title.trim() ? action.title : 'Untitled task',
            description: typeof action.description === 'string' ? action.description : '',
            labels: Array.isArray(action.labels) ? action.labels : undefined,
            confidence: typeof action.confidence === 'number' ? action.confidence : 0.5,
          }
        })
    }
  }

  return parsed
}

function extractBalancedJsonObject(value: string): string | null {
  const start = value.indexOf('{')
  if (start === -1) return null

  let depth = 0
  let inString = false
  let escaped = false

  for (let index = start; index < value.length; index++) {
    const char = value[index]
    if (escaped) {
      escaped = false
      continue
    }
    if (char === '\\') {
      escaped = true
      continue
    }
    if (char === '"') {
      inString = !inString
      continue
    }
    if (inString) continue

    if (char === '{') depth += 1
    if (char === '}') depth -= 1
    if (depth === 0) return value.slice(start, index + 1)
  }

  return null
}

function isValidationError(err: unknown): boolean {
  return err instanceof Error && err.message.startsWith('Failed to validate')
}

function preview(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, 500)
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
Hard rules:
- Return exactly one JSON object.
- Do not wrap JSON in a string.
- Do not use markdown fences.
- Do not include explanations, comments, or text outside JSON.
- Use empty arrays when no items exist.
- Keep every field concise.
- Maximum 5 keyPoints and maximum 5 actionItems.
- If the requested output language is Russian, every user-facing string value must be Russian Cyrillic. Do not answer in English.
/no_think`

export async function summarizeChunk(
  transcript: string,
  chunkIndex: number,
  startSec: number,
  endSec: number,
): Promise<ChunkSummary> {
  const config = loadConfig()
  const outputLanguage = languageName(config.summaryLanguage)
  const outputLanguageRule = languageInstruction(config.summaryLanguage)
  const compactTranscript = limitText(transcript, MAX_CHUNK_TRANSCRIPT_CHARS)
  const prompt = `Summarize this transcript chunk (${formatTime(startSec)}-${formatTime(endSec)}). Return JSON only. Output language: ${outputLanguage}. ${outputLanguageRule} /no_think\n\n${compactTranscript}`

  const raw = await ollamaChat(prompt, CHUNK_SUMMARY_SYSTEM, 1600)

  const result = tryParseAndValidate(raw, chunkSummarySchema, 'chunk summary')
    ?? buildFallbackChunkSummary(raw, transcript, chunkIndex, startSec, endSec)
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
Hard rules:
- Return exactly one JSON object.
- Do not wrap JSON in a string.
- Do not use markdown fences.
- Do not include explanations, comments, or text outside JSON.
- Use empty arrays when no items exist.
- Keep every field concise.
- Maximum 8 keyPoints and maximum 12 actionItems.
- If the requested output language is Russian, every user-facing string value must be Russian Cyrillic. Do not answer in English.
Merge duplicate action items. /no_think`

export async function summarizeFinal(
  chunkSummaries: ChunkSummary[],
): Promise<FinalSummary> {
  const config = loadConfig()
  const outputLanguage = languageName(config.summaryLanguage)
  const outputLanguageRule = languageInstruction(config.summaryLanguage)
  const summariesText = limitText(chunkSummaries
    .map((cs) => `[Chunk ${cs.chunkIndex} — ${formatTime(cs.startSec)}–${formatTime(cs.endSec)}]\n${cs.summary}\nKey points: ${cs.keyPoints.join('; ')}`)
    .join('\n\n'), MAX_FINAL_SUMMARIES_CHARS)

  const prompt = `Here are summaries of ${chunkSummaries.length} transcript chunks. Produce a consolidated final summary and no more than 12 extracted action items as JSON only. Output language: ${outputLanguage}. ${outputLanguageRule} /no_think\n\n${summariesText}`

  const raw = await ollamaChat(prompt, FINAL_SUMMARY_SYSTEM, 2200)
  return tryParseAndValidate(raw, finalSummarySchema, 'final summary')
    ?? buildFallbackFinalSummary(raw, chunkSummaries)
}

// ── Helpers ────────────────────────────────────────────
function buildFallbackChunkSummary(
  raw: string,
  transcript: string,
  chunkIndex: number,
  startSec: number,
  endSec: number,
): ChunkSummary {
  const summary = firstUsefulText(raw) || firstUsefulText(transcript) || fallbackText('Chunk summary was not generated.', 'Саммари чанка не было сгенерировано.')
  return {
    chunkIndex,
    startSec,
    endSec,
    summary,
    keyPoints: [],
    decisions: [],
    risks: [],
    openQuestions: [],
    actionItems: [],
  }
}

function buildFallbackFinalSummary(raw: string, chunkSummaries: ChunkSummary[]): FinalSummary {
  const fallbackText = firstUsefulText(raw)
  const shortSummary = fallbackText || chunkSummaries[0]?.summary || EMPTY_FINAL_SUMMARY.shortSummary
  const keyPoints = chunkSummaries.flatMap((summary) => summary.keyPoints).slice(0, 8)
  const decisions = chunkSummaries.flatMap((summary) => summary.decisions).slice(0, 8)
  const risks = chunkSummaries.flatMap((summary) => summary.risks).slice(0, 8)
  const openQuestions = chunkSummaries.flatMap((summary) => summary.openQuestions).slice(0, 8)
  const actionItems = chunkSummaries.flatMap((summary) =>
    summary.actionItems.map((item): ExtractedActionItem => ({
      ...item,
      sourceChunkIndex: summary.chunkIndex,
      sourceTimecode: formatTime(summary.startSec),
    })),
  ).slice(0, 12)

  return {
    shortSummary,
    detailedSummary: chunkSummaries.map((summary) => summary.summary).filter(Boolean).join('\n\n') || shortSummary,
    keyPoints,
    decisions,
    risks,
    openQuestions,
    actionItems,
  }
}

function firstUsefulText(value: string): string {
  const normalized = value
    .replace(/```(?:json)?/g, '')
    .replace(/[{}[\]",]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!normalized) return ''
  return normalized.slice(0, 900)
}

function limitText(value: string, maxChars: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (normalized.length <= maxChars) return normalized
  const head = normalized.slice(0, Math.floor(maxChars * 0.7))
  const tail = normalized.slice(-Math.floor(maxChars * 0.3))
  return `${head}\n\n[Transcript middle omitted for local CPU processing]\n\n${tail}`
}

function languageName(language: string): string {
  if (language === 'en') return 'English'
  return 'Russian Cyrillic'
}

function languageInstruction(language: string): string {
  if (language === 'en') return 'All user-facing string values must be English.'
  return 'All user-facing string values must be Russian Cyrillic. Never translate output to English. Keep JSON keys in English, but values in Russian.'
}

function fallbackText(english: string, russian: string): string {
  const config = loadConfig()
  return config.summaryLanguage === 'en' ? english : russian
}

function formatTime(sec: number): string {
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = Math.floor(sec % 60)
  if (h > 0) return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}
