import { execa } from 'execa'
import { loadConfig } from '../config'
import { createLogger } from '../logger'

const ffmpegLog = createLogger('ffmpeg', 'worker.log')

export interface MediaProbe {
  durationSec: number | null
  audioCodec: string | null
  videoCodec: string | null
  format: string | null
  sampleRate: number | null
  channels: number | null
  bitrate: number | null
}

/** Probe media file metadata using ffprobe. */
export async function probeMedia(inputPath: string): Promise<MediaProbe> {
  const config = loadConfig()
  const startedAt = Date.now()

  const args = [
    '-v', 'quiet',
    '-print_format', 'json',
    '-show_format',
    '-show_streams',
    inputPath,
  ]

  let stdout: string
  try {
    ffmpegLog.info('ffprobe started', { inputPath, command: config.ffmpegPath.replace('ffmpeg', 'ffprobe') })
    const result = await execa(config.ffmpegPath.replace('ffmpeg', 'ffprobe'), args, {
      timeout: 30_000,
    })
    stdout = result.stdout
  } catch (err) {
    // Try PATH
    ffmpegLog.warn('configured ffprobe failed, trying PATH fallback', { inputPath, error: err })
    const result = await execa('ffprobe', args, { timeout: 30_000 })
    stdout = result.stdout
  }

  const parsed = JSON.parse(stdout)
  const format = parsed.format ?? {}
  const audioStream = (parsed.streams ?? []).find((s: any) => s.codec_type === 'audio')
  const videoStream = (parsed.streams ?? []).find((s: any) => s.codec_type === 'video')

  const probe = {
    durationSec: format.duration ? parseFloat(format.duration) : null,
    audioCodec: audioStream?.codec_name ?? null,
    videoCodec: videoStream?.codec_name ?? null,
    format: format.format_name ?? null,
    sampleRate: audioStream?.sample_rate ? parseInt(audioStream.sample_rate, 10) : null,
    channels: audioStream?.channels ?? null,
    bitrate: format.bit_rate ? parseInt(format.bit_rate, 10) : null,
  }
  ffmpegLog.info('ffprobe completed', { inputPath, durationMs: Date.now() - startedAt, ...probe })
  return probe
}

export interface ChunkResult {
  index: number
  startSec: number
  endSec: number
  audioPath: string
}

/**
 * Extract audio chunks from media file.
 *
 * Uses FFmpeg segment muxer: 16kHz mono 16-bit WAV, 5-minute segments by default.
 */
export async function extractChunks(
  inputPath: string,
  outputDir: string,
  chunkSeconds: number = 300,
): Promise<ChunkResult[]> {
  const config = loadConfig()
  const startedAt = Date.now()

  const outputPattern = `${outputDir}/chunk_%05d.wav`

  const args = [
    '-y',
    '-i', inputPath,
    '-vn',                          // no video
    '-ac', '1',                     // mono
    '-ar', '16000',                 // 16kHz
    '-c:a', 'pcm_s16le',            // 16-bit PCM WAV
    '-f', 'segment',                // segment muxer
    '-segment_time', String(chunkSeconds),
    '-reset_timestamps', '1',
    outputPattern,
  ]

  try {
    ffmpegLog.info('ffmpeg chunk extraction started', { inputPath, outputDir, chunkSeconds, command: config.ffmpegPath })
    await execa(config.ffmpegPath, args, { timeout: 600_000 })
  } catch (err) {
    // Try PATH fallback
    ffmpegLog.warn('configured ffmpeg failed, trying PATH fallback', { inputPath, outputDir, error: err })
    await execa('ffmpeg', args, { timeout: 600_000 })
  }

  // Discover generated chunks
  const fs = await import('node:fs/promises')
  const files = await fs.readdir(outputDir)
  const chunkFiles = files
    .filter((f) => /^chunk_\d{5}\.wav$/.test(f))
    .sort()

  const chunks = chunkFiles.map((file, index) => {
    const startSec = index * chunkSeconds
    // Estimate end — real duration would require probing each chunk
    return {
      index,
      startSec,
      endSec: startSec + chunkSeconds,
      audioPath: `${outputDir}/${file}`,
    }
  })
  ffmpegLog.info('ffmpeg chunk extraction completed', {
    inputPath,
    outputDir,
    chunkCount: chunks.length,
    durationMs: Date.now() - startedAt,
  })
  return chunks
}

/** Build the ffmpeg path from config, falling back to PATH. */
export function resolveFfmpeg(): string {
  const config = loadConfig()
  return config.ffmpegPath
}
