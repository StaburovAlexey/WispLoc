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
export type JobStatus = 'PENDING' | 'PROCESSING' | 'DONE' | 'DONE_WITH_WARNINGS' | 'FAILED' | 'CANCELLED'

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

export type PipelineVersion = 'legacy-v1' | 'evidence-v2'
export type ProcessingStageStatus = 'pending' | 'running' | 'completed' | 'reused' | 'failed' | 'cancelled' | 'skipped'
export type FactType = 'statement' | 'decision' | 'problem' | 'requirement' | 'proposal' | 'question' | 'task_candidate'
export type FactValidationStatus = 'valid' | 'invalid_schema' | 'invalid_quote' | 'invalid_timecode' | 'needs_review'
export type TaskReviewStatus = 'DRAFT' | 'APPROVED' | 'REJECTED'

export interface EvidenceTranscriptSegment {
  id: string
  mediaFileId: string
  startSec: number
  endSec: number
  originalText: string
  normalizedText?: string
  speaker?: string
  sequence: number
}

export interface TranscriptChunk {
  index: number
  mediaFileId: string
  startSec: number
  endSec: number
  segmentIds: string[]
  originalText: string
  normalizedText: string
}

export interface AtomicFact {
  id: string
  mediaFileId: string
  chunkIndex: number
  type: FactType
  text: string
  evidenceQuote: string
  startSec: number
  endSec: number
  speaker?: string
  explicit: boolean
}

export interface ValidatedFact extends AtomicFact {
  validationStatus: FactValidationStatus
  validationErrors: string[]
}

export interface FactEvidence {
  quote: string
  startSec: number
  endSec: number
  chunkIndex: number
}

export interface MergedFact {
  id: string
  mediaFileId: string
  type: FactType
  text: string
  evidence: FactEvidence[]
  sourceFactIds: string[]
}

export interface TaskCandidate {
  id: string
  mediaFileId: string
  title: string
  description?: string
  assignee?: string
  dueDate?: string
  priority?: 'low' | 'medium' | 'high'
  sourceFactIds: string[]
  evidence: FactEvidence[]
  explicitAction: boolean
  explicitAssignee: boolean
  explicitDueDate: boolean
}

export interface DraftTask extends TaskCandidate {
  confidence: number
  status: TaskReviewStatus
  mergedCandidateIds: string[]
}

export interface SummaryItem {
  text: string
  sourceFactIds: string[]
}

export interface EvidenceSummaryBatch {
  keyPoints: SummaryItem[]
  decisions: SummaryItem[]
  problems: SummaryItem[]
  openQuestions: SummaryItem[]
  proposals: SummaryItem[]
}

export interface EvidenceFinalSummary {
  title: string
  summary: string
  keyPoints: SummaryItem[]
  decisions: SummaryItem[]
  problems: SummaryItem[]
  openQuestions: SummaryItem[]
  proposals: SummaryItem[]
}

export type DictionaryEntryStatus = 'ACTIVE' | 'DISABLED'
export interface DictionaryEntry {
  id: string
  canonical: string
  aliases: string[]
  status: DictionaryEntryStatus
  confirmedByUser: boolean
  usageCount: number
  createdAt: string
  updatedAt: string
}

export interface NormalizationReplacement {
  original: string
  canonical: string
  startOffset: number
  endOffset: number
  dictionaryEntryId: string
}

export interface NormalizationResult {
  originalText: string
  normalizedText: string
  replacements: NormalizationReplacement[]
}

export type TermSuggestionStatus = 'PROPOSED' | 'ACCEPTED' | 'REJECTED'
export interface TermSuggestionExample {
  quote: string
  startSec: number
  endSec: number
}

export interface TermSuggestion {
  id: string
  mediaFileId: string
  observedForm: string
  proposedCanonical: string
  aliases: string[]
  occurrenceCount: number
  examples: TermSuggestionExample[]
  status: TermSuggestionStatus
  createdAt: string
}

export interface ProcessMediaRequest {
  stages: ProcessingStage[]
  useDictionary: boolean
}

export type ProcessingStage =
  | 'transcription'
  | 'normalization'
  | 'fact-extraction'
  | 'fact-deduplication'
  | 'summary'
  | 'tasks'
  | 'term-discovery'

export interface ProcessingPlan {
  requestedStages: ProcessingStage[]
  executionStages: ProcessingStage[]
  autoAddedStages: ProcessingStage[]
  artifacts: Record<'transcript' | 'facts' | 'mergedFacts' | 'summary' | 'tasks' | 'terms', boolean>
}

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
  deduplicationLevel: 'fast' | 'standard' | 'precise'
  maxSemanticDedupeComparisons: number
  customVocabulary?: string[]
  chunkMinutes: number
  cleanChunks: boolean
  deleteOriginalAfterProcessing: boolean
  enableEvidencePipeline: boolean
  useDictionaryByDefault: boolean
  discoverTermsByDefault: boolean
  showNormalizedTranscriptByDefault: boolean
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

// ── GitHub ─────────────────────────────────────────────
export interface GitHubSettings {
  provider: 'github'
  token: string
  defaultOwner?: string
  defaultRepo?: string
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
  qualityWarnings: string[]
  startedAt: string | null
  finishedAt: string | null
  durationMs: number | null
  pipelineVersion: PipelineVersion
  requestedStages: ProcessingStage[]
  stageStates: Record<string, ProcessingStageStatus>
  useDictionary: boolean
  discoverTerms: boolean
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
  confidenceBreakdown: Record<string, boolean>
  status: string
  pipelineVersion: PipelineVersion
  sourceFactIds: string[]
  evidence: FactEvidence[]
  mergedCandidateIds: string[]
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
  stageStates?: Record<string, ProcessingStageStatus>
  qualityWarnings?: string[]
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
