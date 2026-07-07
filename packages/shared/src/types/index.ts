// ── Setup ──────────────────────────────────────────────
export type SetupStep =
  | 'storage'
  | 'database'
  | 'ffmpeg'
  | 'whisper-cli'
  | 'whisper-model'
  | 'ollama'
  | 'llm-model'
  | 'config'
  | 'doctor'

export type SetupEvent =
  | { type: 'step-started'; step: SetupStep; message: string }
  | {
      type: 'step-progress'
      step: SetupStep
      progress: number
      downloadedBytes?: number
      totalBytes?: number
      message?: string
    }
  | { type: 'step-completed'; step: SetupStep; message: string }
  | { type: 'step-failed'; step: SetupStep; error: string; recoverable: boolean }
  | { type: 'setup-failed'; error: string }
  | { type: 'setup-completed' }

// ── Status enums ───────────────────────────────────────
export type JobStatus = 'PENDING' | 'PROCESSING' | 'DONE' | 'FAILED' | 'CANCELLED'

export type MediaStatus =
  | 'UPLOADED'
  | 'EXTRACTING_AUDIO'
  | 'TRANSCRIBING'
  | 'SUMMARIZING'
  | 'EXTRACTING_TASKS'
  | 'DONE'
  | 'FAILED'
  | 'CANCELLED'

export type ChunkStatus = 'PENDING' | 'PROCESSING' | 'DONE' | 'FAILED'

// ── Config ─────────────────────────────────────────────
export interface WispLocConfig {
  appHost: string
  appPort: number
  dataDir: string
  ffmpegPath: string
  whisperBinPath: string
  whisperModelPath: string
  ollamaHost: string
  llmModel: string
  language: string
  summaryLanguage: string
  customVocabulary?: string[]
  chunkMinutes: number
  cleanChunks: boolean
  deleteOriginalAfterProcessing: boolean
  setupCompleted: boolean
}

// ── Summaries ──────────────────────────────────────────
export interface ChunkSummaryActionItem {
  title: string
  description: string
  priority?: 'low' | 'medium' | 'high'
  assigneeHint?: string
  dueDateHint?: string
  confidence: number
}

export interface ChunkSummary {
  chunkIndex: number
  startSec: number
  endSec: number
  summary: string
  keyPoints: string[]
  decisions: string[]
  risks: string[]
  openQuestions: string[]
  actionItems: ChunkSummaryActionItem[]
}

export interface FinalSummary {
  shortSummary: string
  detailedSummary: string
  keyPoints: string[]
  decisions: string[]
  risks: string[]
  openQuestions: string[]
  actionItems: ExtractedActionItem[]
}

// ── Tasks ──────────────────────────────────────────────
export interface ExtractedActionItem {
  title: string
  description: string
  sourceTimecode?: string
  sourceChunkIndex?: number
  priority?: 'low' | 'medium' | 'high'
  labels?: string[]
  assigneeHint?: string
  dueDateHint?: string
  confidence: number
}

// ── Integrations ───────────────────────────────────────
export type TaskProvider =
  | 'yandex-tracker'
  | 'github'
  | 'gitlab'
  | 'jira'
  | 'linear'
  | 'youtrack'
  | 'trello'

export interface IntegrationTarget {
  id: string
  key?: string
  name: string
  type: 'queue' | 'repository' | 'project' | 'team' | 'board' | 'list'
}

export interface CreateExternalTaskInput {
  title: string
  description: string
  priority?: 'low' | 'medium' | 'high'
  labels?: string[]
  assignee?: string
  sourceTimecode?: string
  sourceMediaId?: string
}

export interface CreatedExternalTaskResult {
  externalId: string
  externalKey?: string
  externalUrl: string
}

export interface TaskIntegrationProvider {
  provider: TaskProvider
  checkAuth(): Promise<boolean>
  listTargets(): Promise<IntegrationTarget[]>
  createTask(
    targetId: string,
    input: CreateExternalTaskInput,
  ): Promise<CreatedExternalTaskResult>
}

// ── Yandex Tracker ─────────────────────────────────────
export interface YandexTrackerSettings {
  provider: 'yandex-tracker'
  authType: 'oauth' | 'iam'
  token: string
  organizationHeader: 'X-Org-ID' | 'X-Cloud-Org-ID'
  organizationId: string
  defaultQueue?: string
  defaultIssueType?: string
  defaultPriority?: string
}

// ── GitHub ─────────────────────────────────────────────
export interface GitHubSettings {
  provider: 'github'
  token: string
  defaultOwner?: string
  defaultRepo?: string
}

// ── GitLab ─────────────────────────────────────────────
export interface GitLabSettings {
  provider: 'gitlab'
  baseUrl: string
  token: string
  defaultProjectId?: string
}

// ── DTOs ───────────────────────────────────────────────
export interface SetupStatusDto {
  setupCompleted: boolean
  status: 'IDLE' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED'
  currentStep: SetupStep | null
  progress: number
  ffmpegStatus: string
  whisperStatus: string
  modelStatus: string
  ollamaStatus: string
  llmStatus: string
  errorMessage?: string | null
  logs: string[]
  steps: SetupStepStatusDto[]
}

export interface SetupStepStatusDto {
  step: SetupStep
  status: 'pending' | 'running' | 'completed' | 'failed'
  message?: string
  error?: string
}

export interface MediaFileDto {
  id: string
  originalName: string
  mimeType: string
  sizeBytes: number
  durationSec: number | null
  status: MediaStatus
  errorMessage: string | null
  createdAt: string
  updatedAt: string
}

export interface ProcessingJobDto {
  id: string
  mediaFileId: string | null
  type: string
  status: JobStatus
  progress: number
  currentStep: string | null
  errorMessage: string | null
  startedAt: string | null
  finishedAt: string | null
  durationMs: number | null
  createdAt: string
  updatedAt: string
}

export interface ExtractedTaskDto {
  id: string
  mediaFileId: string
  title: string
  description: string
  sourceTimecode: string | null
  sourceChunkIndex: number | null
  priority: string | null
  labels: string[]
  assigneeHint: string | null
  dueDateHint: string | null
  confidence: number | null
  status: string
  createdAt: string
  updatedAt: string
}

// ── Job progress event (shared between core SSE and web UI) ──
export interface JobProgressEvent {
  jobId: string
  type: string
  status: JobStatus
  progress: number
  currentStep?: string
  error?: string
}

export interface IntegrationAccountDto {
  id: string
  provider: string
  displayName: string
  baseUrl: string | null
  authType: string
  isEnabled: boolean
  createdAt: string
  updatedAt: string
}
