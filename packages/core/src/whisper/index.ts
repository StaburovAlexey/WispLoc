import { execa } from 'execa'
import path from 'node:path'
import { loadConfig } from '../config'

export interface WhisperSegment {
  start: number   // seconds
  end: number     // seconds
  text: string
}

export interface WhisperResult {
  text: string
  segments: WhisperSegment[]
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
): Promise<WhisperResult> {
  const config = loadConfig()

  const args = [
    '-m', config.whisperModelPath,
    '-f', wavPath,
    '-l', language || config.language || 'ru',
    '--output-json',
  ]

  let stdout: string
  try {
    const result = await execa(config.whisperBinPath, args, {
      env: runtimeBinaryEnv(path.dirname(config.whisperBinPath)),
      timeout: 600_000, // 10 min max per chunk
    })
    stdout = result.stdout
  } catch {
    // Fallback to PATH
    const result = await execa('whisper-cli', args, {
      env: runtimeBinaryEnv(path.dirname(config.whisperBinPath)),
      timeout: 600_000,
    })
    stdout = result.stdout
  }

  return parseWhisperOutput(stdout, wavPath)
}

/**
 * Parse whisper-cli JSON output.
 *
 * Whisper outputs one JSON object per line with transcription results.
 * We extract the text and any segment-level data.
 */
function parseWhisperOutput(stdout: string, wavPath: string): WhisperResult {
  const lines = stdout.trim().split('\n')
  const segments: WhisperSegment[] = []
  let fullText = ''

  for (const line of lines) {
    try {
      const parsed = JSON.parse(line)
      // whisper.cpp output formats vary by version; handle common shapes
      if (parsed.text) {
        const start = parsed.offsets?.from_ms
          ? parsed.offsets.from_ms / 1000
          : parsed.t0
            ? parsed.t0 * 0.01 // whisper.cpp uses 10ms tokens
            : segments.length > 0
              ? segments[segments.length - 1].end
              : 0

        const end = parsed.offsets?.to_ms
          ? parsed.offsets.to_ms / 1000
          : parsed.t1
            ? parsed.t1 * 0.01
            : start + 1

        segments.push({
          start,
          end,
          text: parsed.text.trim(),
        })
        fullText += (fullText ? ' ' : '') + parsed.text.trim()
      }
    } catch {
      // Non-JSON line (e.g., log output) — skip
    }
  }

  return {
    text: fullText,
    segments,
  }
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
