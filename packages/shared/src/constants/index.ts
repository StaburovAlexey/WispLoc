import type { WispLocConfig } from '../types'

// ── Runtime paths ──────────────────────────────────────
const ENV = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env
const PLATFORM = (globalThis as { process?: { platform?: string } }).process?.platform
const HOME = ENV?.HOME || ENV?.USERPROFILE || '/tmp'
const EXE = PLATFORM === 'win32' ? '.exe' : ''
export const WISPLOC_HOME = `${HOME}/.wisploc`

export const PATHS = {
  home: WISPLOC_HOME,
  bin: `${WISPLOC_HOME}/bin`,
  models: `${WISPLOC_HOME}/models`,
  whisper: `${WISPLOC_HOME}/models/whisper`,
  data: `${WISPLOC_HOME}/data`,
  uploads: `${WISPLOC_HOME}/data/uploads`,
  chunks: `${WISPLOC_HOME}/data/chunks`,
  transcripts: `${WISPLOC_HOME}/data/transcripts`,
  summaries: `${WISPLOC_HOME}/data/summaries`,
  exports: `${WISPLOC_HOME}/data/exports`,
  logs: `${WISPLOC_HOME}/logs`,
  config: `${WISPLOC_HOME}/config.json`,
  database: `${WISPLOC_HOME}/data/wisploc.db`,
} as const

// ── Default config ─────────────────────────────────────
export const DEFAULT_CONFIG: WispLocConfig = {
  appHost: '127.0.0.1',
  appPort: 3030,
  dataDir: PATHS.data,
  ffmpegPath: `${PATHS.bin}/ffmpeg${EXE}`,
  whisperBinPath: `${PATHS.bin}/whisper-cli${EXE}`,
  whisperModelPath: `${PATHS.whisper}/ggml-base.bin`,
  ollamaHost: 'http://127.0.0.1:11434',
  llmModel: 'qwen3:4b',
  language: 'ru',
  summaryLanguage: 'ru',
  deduplicationLevel: 'standard',
  customVocabulary: [
    'WispLoc',
    'FFmpeg',
    'ffprobe',
    'whisper.cpp',
    'whisper-cli',
    'ggml-base.bin',
    'Ollama',
    'qwen3:4b',
    'Setup Wizard',
    'React',
    'Fastify',
    'Prisma',
    'SQLite',
  ],
  chunkMinutes: 5,
  cleanChunks: true,
  deleteOriginalAfterProcessing: false,
  enableEvidencePipeline: true,
  useDictionaryByDefault: false,
  discoverTermsByDefault: false,
  showNormalizedTranscriptByDefault: false,
  setupCompleted: false,
}

// ── Defaults ───────────────────────────────────────────
export const DEFAULTS = {
  chunkSeconds: 120,
  transcriptChunkSeconds: 120,
  transcriptChunkOverlapSeconds: 20,
  sampleRate: 16000,
  audioChannels: 1,
  audioCodec: 'pcm_s16le',
  whisperModel: 'ggml-base.bin',
  llmModel: 'qwen3:4b',
  ollamaHost: 'http://127.0.0.1:11434',
} as const

// ── Supported formats ──────────────────────────────────
export const SUPPORTED_MIME_TYPES = [
  'audio/mpeg',
  'audio/mp3',
  'audio/wav',
  'audio/x-wav',
  'audio/ogg',
  'audio/mp4',
  'audio/m4a',
  'audio/flac',
  'audio/aac',
  'video/mp4',
  'video/webm',
  'video/x-matroska',
  'video/quicktime',
  'video/x-msvideo',
] as const
