import { translate, type Language } from './i18n'

export function friendlyError(
  message: string | null | undefined,
  fallback?: string,
  language: Language = 'en',
): string {
  const defaultFallback = fallback ?? translate(language, 'error.default')
  if (!message) return defaultFallback

  const text = message.replace(/\s+/g, ' ').trim()
  const lower = text.toLowerCase()

  if (lower.includes('checksum mismatch')) {
    return translate(language, 'error.checksum')
  }

  if (lower.includes('download failed') || lower.includes('enotfound') || lower.includes('etimedout') || lower.includes('network')) {
    return translate(language, 'error.download')
  }

  if (lower.includes('auto-install is supported only on linux and windows')) {
    return translate(language, 'error.unsupportedInstall')
  }

  if (lower.includes('ollama')) {
    if (lower.includes('not reachable') || lower.includes('econnrefused') || lower.includes('failed to start')) {
      return translate(language, 'error.ollamaReachable')
    }
    return translate(language, 'error.ollama')
  }

  if (lower.includes('whisper') || lower.includes('transcription failed')) {
    return translate(language, 'error.whisper')
  }

  if (lower.includes('ffmpeg') || lower.includes('ffprobe')) {
    return translate(language, 'error.ffmpeg')
  }

  if (lower.includes('failed to parse') || lower.includes('failed to validate') || lower.includes('summary failed')) {
    return translate(language, 'error.summary')
  }

  if (lower.includes('no chunk summaries')) {
    return translate(language, 'error.noChunkSummaries')
  }

  if (lower.includes('maintenance is blocked')) {
    return translate(language, 'error.maintenanceBlocked')
  }

  if (lower.includes('prisma') || lower.includes('sqlite') || lower.includes('database')) {
    return translate(language, 'error.database')
  }

  if (lower.includes('upload failed')) {
    return translate(language, 'error.upload')
  }

  if (/request failed: \d+|http \d+|api error \d+/.test(lower)) {
    return translate(language, 'error.api')
  }

  if (text.length <= 140 && !looksTechnical(text)) return text
  return defaultFallback
}

function looksTechnical(value: string): boolean {
  return /\/home\/|C:\\|Error:|TypeError|ECONN|ENOENT|sha256|stack|at\s+\w+|\{".*":/.test(value)
}
