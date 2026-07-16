import { execa } from 'execa'
import fs from 'node:fs/promises'
import path from 'node:path'
import { loadConfig } from '../config'
import { listActiveDictionaryEntries } from '../dictionary'
import { createLogger } from '../logger'

const whisperLog = createLogger('whisper', 'worker.log')

export interface WhisperSegment {
  start: number   // seconds
  end: number     // seconds
  text: string
}

export interface WhisperResult {
  text: string
  segments: WhisperSegment[]
  rawOutput: string
}

/**
 * Transcribe a WAV file using whisper-cli.
 *
 * Args: whisper-cli -m <model> -f <wav> -l <lang> --output-json
 * Returns parsed JSON output.
 */
export async function transcribeChunk(
  wavPath: string,
  language?: string,
  vocabulary?: string[],
): Promise<WhisperResult> {
  const config = loadConfig()
  const startedAt = Date.now()
  const selectedLanguage = language || config.language || 'ru'
  const promptTerms = vocabulary ?? await getWhisperVocabulary()

  const args = [
    '-m', config.whisperModelPath,
    '-f', wavPath,
    '-l', selectedLanguage,
    '--split-on-word',
    '--output-json',
  ]
  const prompt = promptTerms.join(', ').slice(0, 1_000).trim()
  if (prompt) args.push('--prompt', prompt)

  let stdout: string
  try {
    whisperLog.info('whisper transcription started', {
      wavPath,
      language: selectedLanguage,
      command: config.whisperBinPath,
      modelPath: config.whisperModelPath,
    })
    const result = await execa(config.whisperBinPath, args, {
      env: runtimeBinaryEnv(path.dirname(config.whisperBinPath)),
      timeout: 600_000, // 10 min max per chunk
    })
    stdout = result.stdout
  } catch (err) {
    // Fallback to PATH
    whisperLog.warn('configured whisper-cli failed, trying PATH fallback', { wavPath, error: err })
    const result = await execa('whisper-cli', args, {
      env: runtimeBinaryEnv(path.dirname(config.whisperBinPath)),
      timeout: 600_000,
    })
    stdout = result.stdout
  }

  const fileOutput = await readWhisperJsonOutput(wavPath)
  const rawOutput = fileOutput || stdout
  const parsed = parseWhisperOutput(rawOutput)
  whisperLog.info('whisper transcription completed', {
    wavPath,
    language: selectedLanguage,
    segmentsCount: parsed.segments.length,
    textLength: parsed.text.length,
    durationMs: Date.now() - startedAt,
    usedSidecarOutput: Boolean(fileOutput),
  })
  return parsed
}

export async function getWhisperVocabulary(): Promise<string[]> {
  const config = loadConfig()
  const dictionary = await listActiveDictionaryEntries()
  return [...new Set([
    ...(config.customVocabulary ?? []),
    ...dictionary.flatMap((entry) => [entry.canonical, ...entry.aliases]),
  ].map((term) => term.trim()).filter(Boolean))].slice(0, 80)
}

export function clampWhisperSegments(segments: WhisperSegment[], durationSec: number): WhisperSegment[] {
  if (!Number.isFinite(durationSec) || durationSec <= 0) return []
  return segments.flatMap((segment) => {
    const start = Math.max(0, Math.min(durationSec, segment.start))
    const end = Math.max(start, Math.min(durationSec, segment.end))
    if (!segment.text.trim() || start >= durationSec || end <= start) return []
    return [{ ...segment, start, end }]
  })
}

/**
 * Parse whisper-cli JSON output.
 *
 * Whisper outputs one JSON object per line with transcription results.
 * We extract the text and any segment-level data.
 */
function parseWhisperOutput(stdout: string): WhisperResult {
  const trimmed = stdout.trim()
  const segments: WhisperSegment[] = []
  let fullText = ''

  if (!trimmed) {
    return { text: '', segments: [], rawOutput: stdout }
  }

  try {
    const parsed = JSON.parse(trimmed)
    const parsedSegments = parseWhisperJsonObject(parsed)
    return {
      text: parsedSegments.map((segment) => segment.text).join(' '),
      segments: parsedSegments,
      rawOutput: stdout,
    }
  } catch {}

  for (const line of trimmed.split('\n')) {
    try {
      const parsed = JSON.parse(line)
      const parsedSegments = parseWhisperJsonObject(parsed)
      for (const segment of parsedSegments) {
        segments.push(segment)
        fullText += (fullText ? ' ' : '') + segment.text
      }
    } catch {}
  }

  return {
    text: fullText,
    segments,
    rawOutput: stdout,
  }
}

function parseWhisperJsonObject(parsed: any): WhisperSegment[] {
  const items = Array.isArray(parsed?.transcription)
    ? parsed.transcription
    : Array.isArray(parsed?.segments)
      ? parsed.segments
      : parsed?.text
        ? [parsed]
        : []

  return items
    .map((item: any, index: number) => {
      const text = String(item.text ?? '').trim()
      if (!text) return null

      const start = numberOrNull(item.offsets?.from_ms) !== null
        ? Number(item.offsets.from_ms) / 1000
        : numberOrNull(item.offsets?.from) !== null
          ? Number(item.offsets.from) / 1000
          : numberOrNull(item.t0) !== null
            ? Number(item.t0) * 0.01
            : numberOrNull(item.start) ?? index

      const end = numberOrNull(item.offsets?.to_ms) !== null
        ? Number(item.offsets.to_ms) / 1000
        : numberOrNull(item.offsets?.to) !== null
          ? Number(item.offsets.to) / 1000
          : numberOrNull(item.t1) !== null
            ? Number(item.t1) * 0.01
            : numberOrNull(item.end) ?? start + 1

      return { start, end, text }
    })
    .filter((segment: WhisperSegment | null): segment is WhisperSegment => segment !== null)
}

function numberOrNull(value: unknown): number | null {
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

async function readWhisperJsonOutput(wavPath: string): Promise<string | null> {
  const candidates = [`${wavPath}.json`, `${wavPath}.txt.json`]
  for (const candidate of candidates) {
    try {
      return await fs.readFile(candidate, 'utf-8')
    } catch {}
  }
  return null
}

/** Check if whisper-cli is available. */
export async function checkWhisperAvailable(): Promise<boolean> {
  const config = loadConfig()
  try {
    await execa(config.whisperBinPath, ['--help'], {
      env: runtimeBinaryEnv(path.dirname(config.whisperBinPath)),
      timeout: 5_000,
    })
    return true
  } catch {
    try {
      await execa('whisper-cli', ['--help'], { timeout: 5_000 })
      return true
    } catch {
      return false
    }
  }
}

function runtimeBinaryEnv(binDir: string): NodeJS.ProcessEnv {
  return {
    LD_LIBRARY_PATH: process.env.LD_LIBRARY_PATH
      ? `${binDir}${path.delimiter}${process.env.LD_LIBRARY_PATH}`
      : binDir,
    PATH: process.env.PATH
      ? `${binDir}${path.delimiter}${process.env.PATH}`
      : binDir,
  }
}
