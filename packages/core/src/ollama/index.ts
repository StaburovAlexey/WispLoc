import path from 'node:path'
import { spawn } from 'node:child_process'
import { Agent } from 'undici'
import { zodToJsonSchema } from 'zod-to-json-schema'
import type { ZodType } from 'zod'
import { loadConfig } from '../config'
import { writeManagedOllamaPid } from './runtime'
import { createLogger } from '../logger'
import type { ChunkSummary, ExtractedActionItem, FinalSummary } from '@wisploc/shared'
import {
  DEFAULTS,
  PATHS,
  chunkSummarySchema,
  finalSummarySchema,
  taskExtractionSchema,
} from '@wisploc/shared'

const OLLAMA_CHAT_URL = '/api/chat'
const OLLAMA_INACTIVITY_TIMEOUT_MS = 180_000
const OLLAMA_DISPATCHER = new Agent({
  headersTimeout: OLLAMA_INACTIVITY_TIMEOUT_MS,
  bodyTimeout: OLLAMA_INACTIVITY_TIMEOUT_MS,
})
const MAX_CHUNK_TRANSCRIPT_CHARS = 8_000
const MAX_FINAL_SUMMARIES_CHARS = 12_000
const MAX_TASK_EXTRACTION_CHARS = 12_000
const NO_SPEECH_SUMMARY = 'Содержательной речи не обнаружено.'
const ollamaLog = createLogger('ollama', 'worker.log')
let ollamaQueue: Promise<void> = Promise.resolve()

type OllamaMode =
  | 'chunk-summary'
  | 'final-summary'
  | 'task-extraction'
  | 'json-repair'
  | 'fact-extraction'
  | 'fact-repair'
  | 'fact-deduplication'
  | 'evidence-task-extraction'
  | 'task-deduplication'
  | 'evidence-final-summary'
  | 'term-discovery'

const OLLAMA_OPTIONS_BY_MODE = {
  'chunk-summary': {
    temperature: 0.2,
    top_p: 0.8,
    top_k: 20,
    min_p: 0,
    repeat_penalty: 1.05,
    num_ctx: 4096,
    num_batch: 256,
    num_predict: 1100,
  },

  'final-summary': {
    temperature: 0.25,
    top_p: 0.8,
    top_k: 20,
    min_p: 0,
    repeat_penalty: 1.05,
    num_ctx: 4096,
    num_batch: 256,
    num_predict: 1800,
  },

  'task-extraction': {
    temperature: 0.1,
    top_p: 0.8,
    top_k: 20,
    min_p: 0,
    repeat_penalty: 1.05,
    num_ctx: 4096,
    num_batch: 256,
    num_predict: 1000,
  },

  'json-repair': {
    temperature: 0,
    top_p: 0.8,
    top_k: 20,
    min_p: 0,
    repeat_penalty: 1.05,
    num_ctx: 8192,
    num_batch: 256,
    num_predict: 1200,
  },
  'fact-extraction': { temperature: 0, top_p: 0.8, top_k: 20, min_p: 0, repeat_penalty: 1.05, num_ctx: 4096, num_batch: 256, num_predict: 1000 },
  'fact-repair': { temperature: 0, top_p: 0.8, top_k: 20, min_p: 0, repeat_penalty: 1.05, num_ctx: 4096, num_batch: 256, num_predict: 700 },
  'fact-deduplication': { temperature: 0, top_p: 0.8, top_k: 20, min_p: 0, repeat_penalty: 1.05, num_ctx: 4096, num_batch: 256, num_predict: 800 },
  'evidence-task-extraction': { temperature: 0, top_p: 0.8, top_k: 20, min_p: 0, repeat_penalty: 1.05, num_ctx: 4096, num_batch: 256, num_predict: 1000 },
  'task-deduplication': { temperature: 0, top_p: 0.8, top_k: 20, min_p: 0, repeat_penalty: 1.05, num_ctx: 4096, num_batch: 256, num_predict: 800 },
  'evidence-final-summary': { temperature: 0, top_p: 0.8, top_k: 20, min_p: 0, repeat_penalty: 1.05, num_ctx: 8192, num_batch: 256, num_predict: 1400 },
  'term-discovery': { temperature: 0, top_p: 0.8, top_k: 20, min_p: 0, repeat_penalty: 1.05, num_ctx: 4096, num_batch: 256, num_predict: 800 },
} satisfies Record<OllamaMode, Record<string, number>>

interface OllamaChatInput {
  prompt: string
  systemPrompt?: string
  mode: OllamaMode
  jsonSchema: unknown
  numPredict?: number
  think?: boolean
  signal?: AbortSignal
  requestId?: string
}

interface OllamaChatRequest {
  model: string
  messages: Array<{ role: string; content: string }>
  stream: true
  think: boolean
  keep_alive: '5m'
  format: unknown
  options: Record<string, number>
}

// Ollama turns JSON Schema into a llama grammar. Some bundled llama-server
// versions reject validation keywords such as minLength and maxItems even
// though they are valid JSON Schema. Keep the transport schema portable and
// let Zod remain the authoritative validator after generation.
const chunkSummaryJsonSchema = toOllamaJsonSchema(chunkSummarySchema)
const finalSummaryJsonSchema = toOllamaJsonSchema(finalSummarySchema)
const taskExtractionJsonSchema = toOllamaJsonSchema(taskExtractionSchema)

async function ollamaChat(input: OllamaChatInput): Promise<string> {
  return enqueueOllamaRequest(() => runOllamaChat(input))
}

async function runOllamaChat(input: OllamaChatInput): Promise<string> {
  const config = loadConfig()
  const startedAt = Date.now()
  input.signal?.throwIfAborted()

  await ensureOllamaReady(config.ollamaHost)

  const messages: Array<{ role: string; content: string }> = []

  if (input.systemPrompt) {
    messages.push({ role: 'system', content: input.systemPrompt })
  }

  messages.push({ role: 'user', content: input.prompt })

  const baseOptions = OLLAMA_OPTIONS_BY_MODE[input.mode]
  const body: OllamaChatRequest = {
    model: config.llmModel || DEFAULTS.llmModel,
    messages,
    stream: true,
    think: input.think ?? false,
    keep_alive: '5m',
    format: input.jsonSchema,
    options: {
      ...baseOptions,
      num_predict: input.numPredict ?? baseOptions.num_predict,
    },
  }

  const inactivityController = new AbortController()
  let inactivityTimer: ReturnType<typeof setTimeout> | undefined
  const resetInactivityTimer = () => {
    if (inactivityTimer) clearTimeout(inactivityTimer)
    inactivityTimer = setTimeout(() => {
      inactivityController.abort(new Error(`Ollama produced no data for ${Math.round(OLLAMA_INACTIVITY_TIMEOUT_MS / 1000)}s`))
    }, OLLAMA_INACTIVITY_TIMEOUT_MS)
    inactivityTimer.unref()
  }

  let response: Response
  try {
    ollamaLog.info('ollama chat started', {
      mode: input.mode,
      model: body.model,
      ollamaHost: config.ollamaHost,
      numPredict: body.options.num_predict,
      numCtx: body.options.num_ctx,
      requestId: input.requestId,
      thinking: body.think,
    })
    resetInactivityTimer()
    const requestInit: RequestInit & { dispatcher: Agent } = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      dispatcher: OLLAMA_DISPATCHER,
      signal: input.signal
        ? AbortSignal.any([input.signal, inactivityController.signal])
        : inactivityController.signal,
    }
    response = await fetch(`${config.ollamaHost}${OLLAMA_CHAT_URL}`, requestInit)
  } catch (err: any) {
    const reason = inactivityController.signal.aborted
      ? inactivityController.signal.reason?.message ?? `no response data for ${Math.round(OLLAMA_INACTIVITY_TIMEOUT_MS / 1000)}s`
      : err.cause?.message ?? err.message ?? String(err)
    ollamaLog.error('ollama chat request failed', {
      mode: input.mode,
      model: body.model,
      ollamaHost: config.ollamaHost,
      error: err,
    })
    if (inactivityTimer) clearTimeout(inactivityTimer)
    throw new Error(`Ollama request failed at ${config.ollamaHost}: ${reason}`)
  }

  if (!response.ok) {
    const text = await response.text()
    ollamaLog.error('ollama chat api failed', {
      mode: input.mode,
      model: body.model,
      status: response.status,
      bodyPreview: text.slice(0, 500),
    })
    if (inactivityTimer) clearTimeout(inactivityTimer)
    throw new Error(`Ollama API error ${response.status}: ${text.slice(0, 500)}`)
  }

  let streamed
  try {
    streamed = await readOllamaStream(response, resetInactivityTimer)
  } catch (err: any) {
    const reason = inactivityController.signal.aborted
      ? inactivityController.signal.reason?.message ?? `no response data for ${Math.round(OLLAMA_INACTIVITY_TIMEOUT_MS / 1000)}s`
      : err.cause?.message ?? err.message ?? String(err)
    ollamaLog.error('ollama chat stream failed', {
      mode: input.mode,
      model: body.model,
      ollamaHost: config.ollamaHost,
      error: err,
    })
    throw new Error(`Ollama request failed at ${config.ollamaHost}: ${reason}`)
  } finally {
    if (inactivityTimer) clearTimeout(inactivityTimer)
  }

  const content = stripThinkBlocks(streamed.content)
  const tokensPerSecond = streamed.evalCount && streamed.evalDuration
    ? streamed.evalCount / (streamed.evalDuration / 1_000_000_000)
    : undefined
  ollamaLog.info('ollama chat completed', {
    mode: input.mode,
    model: body.model,
    durationMs: Date.now() - startedAt,
    responseLength: content.length,
    doneReason: streamed.doneReason,
    promptEvalCount: streamed.promptEvalCount,
    evalCount: streamed.evalCount,
    evalRatePerSecond: tokensPerSecond === undefined ? undefined : Number(tokensPerSecond.toFixed(2)),
  })
  return content
}

async function readOllamaStream(response: Response, onData: () => void): Promise<{
  content: string
  doneReason?: string
  promptEvalCount?: number
  evalCount?: number
  evalDuration?: number
}> {
  if (!response.body) throw new Error('Ollama returned an empty response stream')

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let content = ''
  let metrics: { doneReason?: string; promptEvalCount?: number; evalCount?: number; evalDuration?: number } = {}

  const consumeLine = (line: string) => {
    if (!line.trim()) return
    const chunk = JSON.parse(line) as {
      message?: { content?: string }
      error?: string
      done_reason?: string
      prompt_eval_count?: number
      eval_count?: number
      eval_duration?: number
    }
    if (chunk.error) throw new Error(chunk.error)
    content += chunk.message?.content ?? ''
    metrics = {
      doneReason: chunk.done_reason ?? metrics.doneReason,
      promptEvalCount: chunk.prompt_eval_count ?? metrics.promptEvalCount,
      evalCount: chunk.eval_count ?? metrics.evalCount,
      evalDuration: chunk.eval_duration ?? metrics.evalDuration,
    }
  }

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    onData()
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) consumeLine(line)
  }
  buffer += decoder.decode()
  consumeLine(buffer)
  return { content, ...metrics }
}

function enqueueOllamaRequest<T>(request: () => Promise<T>): Promise<T> {
  const result = ollamaQueue.then(request, request)
  ollamaQueue = result.then(() => undefined, () => undefined)
  return result
}

export async function structuredOllamaChat<T>(input: {
  prompt: string
  systemPrompt: string
  mode: Extract<OllamaMode, 'fact-extraction' | 'fact-repair' | 'fact-deduplication' | 'evidence-task-extraction' | 'task-deduplication' | 'evidence-final-summary' | 'term-discovery'>
  schema: ZodType<T>
  label: string
  think?: boolean
  signal?: AbortSignal
  requestId?: string
  numPredict?: number
}): Promise<T> {
  const jsonSchema = toOllamaJsonSchema(input.schema)
  const raw = await ollamaChat({
    prompt: input.prompt,
    systemPrompt: input.systemPrompt,
    mode: input.mode,
    jsonSchema,
    think: input.think,
    signal: input.signal,
    requestId: input.requestId,
    numPredict: input.numPredict,
  })
  return parseValidateOrRepair(raw, input.schema, jsonSchema, input.label, {
    signal: input.signal,
    requestId: input.requestId,
  })
}

type JsonSchemaRecord = Record<string, unknown>

function toOllamaJsonSchema(schema: ZodType<unknown>): JsonSchemaRecord {
  const generated = zodToJsonSchema(schema) as JsonSchemaRecord
  return simplifyJsonSchemaForOllama(generated, generated) as JsonSchemaRecord
}

/**
 * Use only the JSON Schema grammar features supported consistently by the
 * embedded Ollama runtime. Zod still checks bounds, refinements and unknown
 * keys before anything is persisted.
 */
function simplifyJsonSchemaForOllama(value: unknown, root: JsonSchemaRecord): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => simplifyJsonSchemaForOllama(item, root))
  }

  if (!value || typeof value !== 'object') return value

  const record = value as JsonSchemaRecord
  const reference = typeof record.$ref === 'string' ? resolveLocalSchemaRef(record.$ref, root) : undefined
  if (reference) return simplifyJsonSchemaForOllama(reference, root)

  const result: JsonSchemaRecord = {}
  if (typeof record.type === 'string') result.type = record.type
  if (Array.isArray(record.enum)) result.enum = record.enum

  if (record.properties && typeof record.properties === 'object' && !Array.isArray(record.properties)) {
    result.properties = Object.fromEntries(
      Object.entries(record.properties as JsonSchemaRecord)
        .map(([key, property]) => [key, simplifyJsonSchemaForOllama(property, root)]),
    )
  }

  if (Array.isArray(record.required)) {
    result.required = record.required.filter((key): key is string => typeof key === 'string')
  }

  if (record.items !== undefined) {
    result.items = simplifyJsonSchemaForOllama(record.items, root)
  }

  return result
}

function resolveLocalSchemaRef(reference: string, root: JsonSchemaRecord): unknown {
  if (!reference.startsWith('#/')) return undefined

  return reference.slice(2).split('/').reduce<unknown>((current, key) => {
    if (!current || typeof current !== 'object') return undefined
    return (current as JsonSchemaRecord)[key.replace(/~1/g, '/').replace(/~0/g, '~')]
  }, root)
}

async function ensureOllamaReady(ollamaHost: string): Promise<void> {
  if (await isOllamaReachable(ollamaHost)) return

  const ollamaBin = path.join(PATHS.bin, process.platform === 'win32' ? 'ollama.exe' : 'ollama')
  const child = spawn(ollamaBin, ['serve'], {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, OLLAMA_HOST: ollamaHost, OLLAMA_NUM_PARALLEL: '1', OLLAMA_MAX_LOADED_MODELS: '1' },
  })

  try {
    await waitForProcessSpawn(child, ollamaBin)
    if (child.pid) writeManagedOllamaPid(child.pid)
    ollamaLog.info('ollama service started', { ollamaHost, ollamaBin, pid: child.pid })
    child.unref()
  } catch (err: any) {
    ollamaLog.error('ollama service start failed', { ollamaHost, ollamaBin, error: err })
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

function waitForProcessSpawn(
  child: ReturnType<typeof spawn>,
  command: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false

    const finish = (callback: () => void) => {
      if (settled) return
      settled = true
      child.off('error', onError)
      child.off('spawn', onSpawn)
      callback()
    }

    const onError = (error: Error) => {
      finish(() => reject(error))
    }

    const onSpawn = () => {
      finish(resolve)
    }

    child.once('error', onError)
    child.once('spawn', onSpawn)
  })
}

async function parseValidateOrRepair<T>(
  raw: string,
  schema: { parse: (data: unknown) => T },
  jsonSchema: unknown,
  label: string,
  options: { signal?: AbortSignal; requestId?: string } = {},
): Promise<T> {
  try {
    return parseAndValidate(raw, schema, label)
  } catch (firstError) {
    const validationError = firstError instanceof Error ? firstError.message : String(firstError)
    ollamaLog.warn('ollama json validation failed, repairing once', { label, validationError })
    const repairedRaw = await ollamaChat({
      mode: 'json-repair',
      jsonSchema,
      systemPrompt: 'You repair invalid JSON responses.',
      prompt: buildJsonRepairPrompt({
        label,
        rawResponse: raw,
        validationError,
      }),
      signal: options.signal,
      requestId: options.requestId ? `${options.requestId}:json-repair` : undefined,
    })

    const repaired = parseAndValidate(repairedRaw, schema, label)
    ollamaLog.info('ollama json repair completed', { label })
    return repaired
  }
}

function parseAndValidate<T>(
  raw: string,
  schema: { parse: (data: unknown) => T },
  label: string,
): T {
  const candidate = extractJsonCandidate(raw)
  if (!candidate) {
    throw new Error(`Failed to parse ${label} from LLM output: ${preview(raw)}`)
  }

  try {
    return validateKnownJsonShapes(JSON.parse(candidate), schema, label)
  } catch (err: any) {
    if (err instanceof SyntaxError) {
      throw new Error(`Failed to parse ${label} from LLM output: ${preview(raw)}`)
    }
    throw err
  }
}

function validateKnownJsonShapes<T>(parsed: unknown, schema: { parse: (data: unknown) => T }, label: string): T {
  const normalized = normalizeModelShape(parsed)
  try {
    return schema.parse(normalized)
  } catch (err: any) {
    const details = err?.issues?.map((issue: any) => `${issue.path?.join('.') || '<root>'}: ${issue.message}`).slice(0, 5).join('; ')
    throw new Error(`Failed to validate ${label} from LLM output${details ? `: ${details}` : ''}`)
  }
}

function normalizeModelShape(parsed: unknown): unknown {
  if (typeof parsed === 'string') {
    const candidate = extractJsonCandidate(parsed)
    if (!candidate) return parsed
    try {
      return normalizeModelShape(JSON.parse(candidate))
    } catch {
      return parsed
    }
  }

  if (!parsed || typeof parsed !== 'object') return parsed

  const record = parsed as Record<string, unknown>
  for (const key of ['response', 'result', 'data']) {
    if (record[key] && typeof record[key] === 'object') {
      return normalizeModelShape(record[key])
    }
  }

  for (const key of ['keyPoints', 'decisions', 'risks', 'problems', 'openQuestions', 'proposals', 'actionItems']) {
    if (key in record && !Array.isArray(record[key])) record[key] = []
  }

  for (const key of ['keyPoints', 'decisions', 'risks', 'problems', 'openQuestions', 'proposals']) {
    if (!Array.isArray(record[key])) continue
    record[key] = record[key].flatMap((item) => {
      if (!item || typeof item !== 'object' || !('sourceFactIds' in item)) return [item]
      const summaryItem = item as Record<string, unknown>
      const text = typeof summaryItem.text === 'string' ? summaryItem.text.trim() : ''
      const sourceFactIds = Array.isArray(summaryItem.sourceFactIds)
        ? [...new Set(summaryItem.sourceFactIds.filter((id): id is string => typeof id === 'string' && id.trim().length > 0).map((id) => id.trim()))]
        : []
      return text && sourceFactIds.length > 0 ? [{ ...summaryItem, text, sourceFactIds }] : []
    })
  }

  if (Array.isArray(record.actionItems)) {
    record.actionItems = record.actionItems
      .filter((item) => item && typeof item === 'object')
      .map((item) => normalizeActionItemShape(item as Record<string, unknown>))
      .filter(Boolean)
  }

  return record
}

function normalizeActionItemShape(item: Record<string, unknown>): Record<string, unknown> | null {
  const title = typeof item.title === 'string' ? item.title.trim() : ''
  if (!title) return null

  const priority = typeof item.priority === 'string' && ['low', 'medium', 'high'].includes(item.priority)
    ? item.priority
    : undefined

  return {
    ...item,
    title,
    description: typeof item.description === 'string' ? item.description.trim() : '',
    priority,
    labels: Array.isArray(item.labels) ? item.labels : undefined,
    confidence: clampConfidence(typeof item.confidence === 'number' ? item.confidence : undefined),
  }
}

function extractJsonCandidate(raw: string): string | null {
  const withoutThink = stripThinkBlocks(raw).trim()
  if (!withoutThink) return null

  const fenceMatch = withoutThink.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/)
  if (fenceMatch) return fenceMatch[1].trim()

  if (withoutThink.startsWith('{') && withoutThink.endsWith('}')) return withoutThink

  return extractBalancedJsonObject(withoutThink)
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

function buildJsonRepairPrompt(input: {
  label: string
  rawResponse: string
  validationError: string
}): string {
  return `The previous response did not match the required JSON schema.

Validation errors:
${input.validationError}

Invalid response:
${limitText(stripThinkBlocks(input.rawResponse), 8_000)}

Fix the JSON for ${input.label}.

Hard rules:
- Return only valid JSON.
- Do not add new facts.
- Do not remove valid facts.
- Do not translate JSON keys.
- Keep all user-facing string values in Russian Cyrillic.
- Do not use Markdown.
- Do not explain anything.
/no_think`
}

function stripThinkBlocks(value: string): string {
  return value.replace(/<think>[\s\S]*?<\/think>/gi, '').trim()
}

function preview(value: string): string {
  return stripThinkBlocks(value).replace(/\s+/g, ' ').trim().slice(0, 500)
}

const CHUNK_SUMMARY_SYSTEM = `You summarize Russian meeting transcript chunks.

The transcript may contain ASR errors, missing punctuation, repeated words, broken phrases, wrong word endings, and mixed Russian/English technical terms.

Hard rules:
- Return only valid JSON matching the provided schema.
- Do not use Markdown.
- Do not add explanations outside JSON.
- Keep JSON keys in English.
- Keep all user-facing string values in Russian Cyrillic.
- Preserve technical terms, product names, library names, filenames, and commands as written.
- Do not invent facts, names, dates, decisions, or tasks.
- Extract action items only when the transcript contains an actual requested action.
- If information is unclear, put it into openQuestions.
- Use empty arrays when no items exist.
- Keep every field concise.
- Maximum 5 keyPoints.
- Maximum 5 actionItems.
/no_think`

export async function summarizeChunk(
  transcript: string,
  chunkIndex: number,
  startSec: number,
  endSec: number,
): Promise<ChunkSummary> {
  if (isNonSpeechTranscript(transcript)) {
    return buildNoSpeechChunkSummary(chunkIndex, startSec, endSec)
  }

  const compactTranscript = limitText(transcript, MAX_CHUNK_TRANSCRIPT_CHARS)
  const prompt = `Summarize this transcript chunk (${formatTime(startSec)}-${formatTime(endSec)}). Return JSON only. /no_think

${buildVocabularyBlock()}

Transcript:
${compactTranscript}`

  const raw = await ollamaChat({
    prompt,
    systemPrompt: CHUNK_SUMMARY_SYSTEM,
    mode: 'chunk-summary',
    jsonSchema: chunkSummaryJsonSchema,
  })

  try {
    const parsed = await parseValidateOrRepair(raw, chunkSummarySchema, chunkSummaryJsonSchema, 'chunk summary')
    return normalizeChunkSummary({
      ...parsed,
      chunkIndex,
      startSec,
      endSec,
    })
  } catch (err) {
    console.warn('[llm] Falling back after invalid chunk summary:', err instanceof Error ? err.message : err)
    return buildFallbackChunkSummary(raw, transcript, chunkIndex, startSec, endSec)
  }
}

const FINAL_SUMMARY_SYSTEM = `You consolidate multiple Russian transcript chunk summaries into one final meeting summary.

Hard rules:
- Return only valid JSON matching the provided schema.
- Do not use Markdown.
- Do not add explanations outside JSON.
- Keep JSON keys in English.
- Keep all user-facing string values in Russian Cyrillic.
- Preserve technical terms, product names, library names, filenames, and commands as written.
- Do not invent facts, names, dates, decisions, or tasks.
- Merge duplicates.
- If a decision is not explicit, do not put it into decisions.
- If a task is not explicit, do not put it into actionItems.
- If something is ambiguous, put it into openQuestions.
- Maximum 8 keyPoints.
- Maximum 12 actionItems.
/no_think`

export async function summarizeFinal(
  chunkSummaries: ChunkSummary[],
): Promise<FinalSummary> {
  if (chunkSummaries.length === 0 || chunkSummaries.every(isNonSubstantiveChunkSummary)) {
    return buildNoSpeechFinalSummary()
  }

  const summariesText = limitText(chunkSummaries
    .map((cs) => `[Chunk ${cs.chunkIndex} - ${formatTime(cs.startSec)}-${formatTime(cs.endSec)}]
Summary: ${cs.summary}
Key points: ${cs.keyPoints.join('; ')}
Decisions: ${cs.decisions.join('; ')}
Risks: ${cs.risks.join('; ')}
Open questions: ${cs.openQuestions.join('; ')}`)
    .join('\n\n'), MAX_FINAL_SUMMARIES_CHARS)

  const prompt = `Create the consolidated final meeting summary as JSON only. Keep actionItems as an empty array; task extraction is a separate step. /no_think

${buildVocabularyBlock()}

Chunk summaries:
${summariesText}`

  const raw = await ollamaChat({
    prompt,
    systemPrompt: FINAL_SUMMARY_SYSTEM,
    mode: 'final-summary',
    jsonSchema: finalSummaryJsonSchema,
  })

  try {
    const parsed = await parseValidateOrRepair(raw, finalSummarySchema, finalSummaryJsonSchema, 'final summary')
    return normalizeFinalSummary({
      ...parsed,
      actionItems: [],
    })
  } catch (err) {
    console.warn('[llm] Falling back after invalid final summary:', err instanceof Error ? err.message : err)
    return normalizeFinalSummary({
      ...buildFallbackFinalSummary(raw, chunkSummaries),
      actionItems: [],
    })
  }
}

const TASK_EXTRACTION_SYSTEM = `You extract actionable tasks from Russian meeting summaries.

Hard rules:
- Return only valid JSON matching the provided schema.
- Extract only real tasks that somebody needs to do.
- Do not create tasks from general discussion.
- Do not invent assignees, due dates, labels, priorities, or source timecodes.
- If assignee is unclear, use assigneeHint only when there is a hint in the source text.
- If due date is unclear, leave dueDateHint empty or omit it.
- Keep all user-facing string values in Russian Cyrillic.
- Keep JSON keys in English.
- Do not use Markdown.
- Do not add explanations outside JSON.
/no_think`

export async function extractFinalTasks(
  finalSummary: FinalSummary,
  chunkSummaries: ChunkSummary[],
): Promise<ExtractedActionItem[]> {
  if (isNonSubstantiveFinalSummary(finalSummary) && chunkSummaries.every(isNonSubstantiveChunkSummary)) {
    return []
  }

  const chunkActionCandidates = chunkSummaries
    .flatMap((summary) => summary.actionItems.map((item) => ({
      ...item,
      sourceChunkIndex: summary.chunkIndex,
      sourceTimecode: formatTime(summary.startSec),
    })))

  const prompt = `Extract explicit actionable tasks from the final summary and chunk action candidates. Return JSON only. /no_think

${buildVocabularyBlock()}

Final summary:
${limitText(JSON.stringify({
    shortSummary: finalSummary.shortSummary,
    detailedSummary: finalSummary.detailedSummary,
    keyPoints: finalSummary.keyPoints,
    decisions: finalSummary.decisions,
    risks: finalSummary.risks,
    openQuestions: finalSummary.openQuestions,
  }, null, 2), MAX_TASK_EXTRACTION_CHARS)}

Chunk action candidates:
${limitText(JSON.stringify(chunkActionCandidates, null, 2), MAX_TASK_EXTRACTION_CHARS)}`

  const raw = await ollamaChat({
    prompt,
    systemPrompt: TASK_EXTRACTION_SYSTEM,
    mode: 'task-extraction',
    jsonSchema: taskExtractionJsonSchema,
  })

  try {
    const parsed = await parseValidateOrRepair(raw, taskExtractionSchema, taskExtractionJsonSchema, 'task extraction')
    return normalizeActionItems(parsed.actionItems)
  } catch (err) {
    console.warn('[llm] Falling back after invalid task extraction:', err instanceof Error ? err.message : err)
    return normalizeActionItems(chunkActionCandidates)
  }
}

function isNonSpeechTranscript(transcript: string): boolean {
  const withoutBracketedMarkers = transcript
    .replace(/\[[^\]]+\]/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
  const normalized = withoutBracketedMarkers
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()

  if (!normalized) return true

  const words = normalized.split(/\s+/).filter(Boolean)
  if (words.length > 3) return false

  const nonSpeechWords = new Set([
    'music',
    'applause',
    'silence',
    'noise',
    'laughter',
    'музыка',
    'аплодисменты',
    'тишина',
    'шум',
    'смех',
  ])

  return words.every((word) => nonSpeechWords.has(word))
}

function buildNoSpeechChunkSummary(
  chunkIndex: number,
  startSec: number,
  endSec: number,
): ChunkSummary {
  return {
    chunkIndex,
    startSec,
    endSec,
    summary: NO_SPEECH_SUMMARY,
    keyPoints: [],
    decisions: [],
    risks: [],
    openQuestions: [],
    actionItems: [],
  }
}

function buildNoSpeechFinalSummary(): FinalSummary {
  return {
    shortSummary: NO_SPEECH_SUMMARY,
    detailedSummary: 'В записи не найдено содержательной речи для саммари.',
    keyPoints: [],
    decisions: [],
    risks: [],
    openQuestions: [],
    actionItems: [],
  }
}

function isNonSubstantiveChunkSummary(summary: ChunkSummary): boolean {
  return summary.keyPoints.length === 0
    && summary.decisions.length === 0
    && summary.risks.length === 0
    && summary.openQuestions.length === 0
    && summary.actionItems.length === 0
    && (!summary.summary.trim() || summary.summary.trim() === NO_SPEECH_SUMMARY)
}

function isNonSubstantiveFinalSummary(summary: FinalSummary): boolean {
  return summary.keyPoints.length === 0
    && summary.decisions.length === 0
    && summary.risks.length === 0
    && summary.openQuestions.length === 0
    && summary.actionItems.length === 0
    && (!summary.shortSummary.trim() || summary.shortSummary.trim() === NO_SPEECH_SUMMARY)
}

function normalizeChunkSummary(summary: ChunkSummary): ChunkSummary {
  return {
    chunkIndex: summary.chunkIndex,
    startSec: summary.startSec,
    endSec: summary.endSec,
    summary: cleanText(summary.summary),
    keyPoints: normalizeStringArray(summary.keyPoints, 5),
    decisions: normalizeStringArray(summary.decisions, 5),
    risks: normalizeStringArray(summary.risks, 5),
    openQuestions: normalizeStringArray(summary.openQuestions, 5),
    actionItems: normalizeChunkActionItems(summary.actionItems).slice(0, 5),
  }
}

function normalizeFinalSummary(summary: FinalSummary): FinalSummary {
  return {
    shortSummary: cleanText(summary.shortSummary),
    detailedSummary: cleanText(summary.detailedSummary),
    keyPoints: normalizeStringArray(summary.keyPoints, 8),
    decisions: normalizeStringArray(summary.decisions, 8),
    risks: normalizeStringArray(summary.risks, 8),
    openQuestions: normalizeStringArray(summary.openQuestions, 8),
    actionItems: normalizeActionItems(summary.actionItems),
  }
}

function normalizeChunkActionItems(items: ChunkSummary['actionItems']): ChunkSummary['actionItems'] {
  const seen = new Set<string>()

  return items
    .map((item) => ({
      ...item,
      title: cleanText(item.title),
      description: cleanText(item.description),
      priority: normalizePriority(item.priority),
      assigneeHint: cleanOptionalText(item.assigneeHint),
      dueDateHint: cleanOptionalText(item.dueDateHint),
      confidence: clampConfidence(item.confidence),
    }))
    .filter((item) => item.title.length > 0)
    .filter((item) => dedupeByTitleDescription(item, seen))
}

function normalizeActionItems(items: ExtractedActionItem[]): ExtractedActionItem[] {
  const seen = new Set<string>()

  return items
    .map((item) => ({
      ...item,
      title: cleanText(item.title),
      description: cleanText(item.description),
      sourceTimecode: cleanOptionalText(item.sourceTimecode),
      priority: normalizePriority(item.priority),
      labels: Array.isArray(item.labels)
        ? normalizeStringArray(item.labels, 8)
        : [],
      assigneeHint: cleanOptionalText(item.assigneeHint),
      dueDateHint: cleanOptionalText(item.dueDateHint),
      confidence: clampConfidence(item.confidence),
    }))
    .filter((item) => item.title.length > 0)
    .filter((item) => dedupeByTitleDescription(item, seen))
    .slice(0, 12)
}

function normalizeStringArray(values: string[], limit: number): string[] {
  const seen = new Set<string>()
  const normalized: string[] = []

  for (const value of values) {
    const cleaned = cleanText(value)
    if (!cleaned) continue
    const key = cleaned.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    normalized.push(cleaned)
    if (normalized.length >= limit) break
  }

  return normalized
}

function dedupeByTitleDescription(item: { title: string; description: string }, seen: Set<string>): boolean {
  const key = `${item.title.toLowerCase()}::${item.description.toLowerCase()}`
  if (seen.has(key)) return false
  seen.add(key)
  return true
}

function cleanText(value: string | undefined): string {
  return typeof value === 'string' ? stripThinkBlocks(value).replace(/\s+/g, ' ').trim() : ''
}

function cleanOptionalText(value: string | undefined): string | undefined {
  const cleaned = cleanText(value)
  return cleaned || undefined
}

function normalizePriority(value: unknown): 'low' | 'medium' | 'high' | undefined {
  return value === 'low' || value === 'medium' || value === 'high' ? value : undefined
}

function clampConfidence(value: number | undefined): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return 0.5
  return Math.min(1, Math.max(0, value))
}

function buildFallbackChunkSummary(
  raw: string,
  transcript: string,
  chunkIndex: number,
  startSec: number,
  endSec: number,
): ChunkSummary {
  const summary = firstUsefulText(raw) || firstUsefulText(transcript) || 'Саммари чанка не было сгенерировано.'
  return normalizeChunkSummary({
    chunkIndex,
    startSec,
    endSec,
    summary,
    keyPoints: [],
    decisions: [],
    risks: [],
    openQuestions: [],
    actionItems: [],
  })
}

function buildFallbackFinalSummary(raw: string, chunkSummaries: ChunkSummary[]): FinalSummary {
  const fallbackText = firstUsefulText(raw)
  const shortSummary = fallbackText || chunkSummaries[0]?.summary || 'Саммари не было сгенерировано.'
  const keyPoints = chunkSummaries.flatMap((summary) => summary.keyPoints)
  const decisions = chunkSummaries.flatMap((summary) => summary.decisions)
  const risks = chunkSummaries.flatMap((summary) => summary.risks)
  const openQuestions = chunkSummaries.flatMap((summary) => summary.openQuestions)

  return normalizeFinalSummary({
    shortSummary,
    detailedSummary: chunkSummaries.map((summary) => summary.summary).filter(Boolean).join('\n\n') || shortSummary,
    keyPoints,
    decisions,
    risks,
    openQuestions,
    actionItems: [],
  })
}

function firstUsefulText(value: string): string {
  const normalized = stripThinkBlocks(value)
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
  return `${head}\n\n[Content middle omitted for local CPU processing]\n\n${tail}`
}

function buildVocabularyBlock(): string {
  const vocabulary = loadConfig().customVocabulary?.map((term) => term.trim()).filter(Boolean) ?? []
  if (vocabulary.length === 0) return ''

  return [
    'Known terms and names:',
    ...vocabulary.map((term) => `- ${term}`),
  ].join('\n')
}

function formatTime(sec: number): string {
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = Math.floor(sec % 60)
  if (h > 0) return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}
