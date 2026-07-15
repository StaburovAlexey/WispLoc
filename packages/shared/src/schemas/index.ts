import { z } from 'zod'

// ── Setup ──────────────────────────────────────────────
export const setupStepSchema = z.enum([
  'storage',
  'database',
  'ffmpeg',
  'whisper-cli',
  'whisper-model',
  'ollama',
  'llm-model',
  'config',
  'doctor',
])

// ── Config ─────────────────────────────────────────────
export const wispLocConfigSchema = z.object({
  appHost: z.string().default('127.0.0.1'),
  appPort: z.number().int().default(3030),
  dataDir: z.string(),
  ffmpegPath: z.string(),
  whisperBinPath: z.string(),
  whisperModelPath: z.string(),
  ollamaHost: z.string().default('http://127.0.0.1:11434'),
  llmModel: z.string().default('qwen3:4b'),
  language: z.string().default('ru'),
  summaryLanguage: z.string().default('ru'),
  deduplicationLevel: z.enum(['fast', 'standard', 'precise']).default('standard'),
  customVocabulary: z.array(z.string()).optional(),
  chunkMinutes: z.number().int().min(1).default(5),
  cleanChunks: z.boolean().default(true),
  deleteOriginalAfterProcessing: z.boolean().default(false),
  enableEvidencePipeline: z.boolean().default(true),
  useDictionaryByDefault: z.boolean().default(false),
  discoverTermsByDefault: z.boolean().default(false),
  showNormalizedTranscriptByDefault: z.boolean().default(false),
  setupCompleted: z.boolean().default(false),
})

export type WispLocConfigParsed = z.infer<typeof wispLocConfigSchema>

// ── Chunk summary ──────────────────────────────────────
export const chunkSummaryActionItemSchema = z.object({
  title: z.string(),
  description: z.string(),
  priority: z.enum(['low', 'medium', 'high']).optional(),
  assigneeHint: z.string().optional(),
  dueDateHint: z.string().optional(),
  confidence: z.number().min(0).max(1),
})

export const chunkSummarySchema = z.object({
  chunkIndex: z.number().int().min(0),
  startSec: z.number().min(0),
  endSec: z.number().min(0),
  summary: z.string(),
  keyPoints: z.array(z.string()),
  decisions: z.array(z.string()),
  risks: z.array(z.string()),
  openQuestions: z.array(z.string()),
  actionItems: z.array(chunkSummaryActionItemSchema),
})

// ── Final summary ──────────────────────────────────────
export const extractedActionItemSchema = z.object({
  title: z.string(),
  description: z.string(),
  sourceTimecode: z.string().optional(),
  sourceChunkIndex: z.number().int().optional(),
  priority: z.enum(['low', 'medium', 'high']).optional(),
  labels: z.array(z.string()).optional(),
  assigneeHint: z.string().optional(),
  dueDateHint: z.string().optional(),
  confidence: z.number().min(0).max(1),
})

export const finalSummarySchema = z.object({
  shortSummary: z.string(),
  detailedSummary: z.string(),
  keyPoints: z.array(z.string()),
  decisions: z.array(z.string()),
  risks: z.array(z.string()),
  openQuestions: z.array(z.string()),
  actionItems: z.array(extractedActionItemSchema),
})

export const taskExtractionSchema = z.object({
  actionItems: z.array(extractedActionItemSchema),
})

// ── Integrations ───────────────────────────────────────
export const createExternalTaskInputSchema = z.object({
  title: z.string().min(1),
  description: z.string(),
  priority: z.enum(['low', 'medium', 'high']).optional(),
  labels: z.array(z.string()).optional(),
  assignee: z.string().optional(),
  sourceTimecode: z.string().optional(),
  sourceMediaId: z.string().optional(),
})

export const pipelineVersionSchema = z.enum(['legacy-v1', 'evidence-v2'])
export const factTypeSchema = z.enum(['statement', 'decision', 'problem', 'requirement', 'proposal', 'question', 'task_candidate'])
export const factEvidenceSchema = z.object({
  quote: z.string().trim().min(1).max(1_000),
  startSec: z.number().min(0),
  endSec: z.number().min(0),
  chunkIndex: z.number().int().min(0),
}).refine((value) => value.endSec >= value.startSec, { message: 'endSec must be greater than or equal to startSec' })

export const atomicFactSchema = z.object({
  id: z.string().min(1),
  mediaFileId: z.string().min(1),
  chunkIndex: z.number().int().min(0),
  type: factTypeSchema,
  text: z.string().trim().min(1).max(2_000),
  evidenceQuote: z.string().trim().min(1).max(1_000),
  startSec: z.number().min(0),
  endSec: z.number().min(0),
  speaker: z.string().trim().max(200).optional(),
  explicit: z.boolean(),
}).refine((value) => value.endSec >= value.startSec, { message: 'endSec must be greater than or equal to startSec' })

export const factExtractionResultSchema = z.object({ facts: z.array(atomicFactSchema).max(100) })
export const factModelItemSchema = z.object({
  type: factTypeSchema,
  text: z.string().trim().min(1).max(2_000),
  // The model schema is deliberately more permissive than persisted facts.
  // Oversized quotes are compacted by the evidence pipeline before validation.
  evidenceQuote: z.string().trim().min(1).max(12_000),
  startSec: z.number().min(0),
  endSec: z.number().min(0),
  speaker: z.string().trim().max(200).optional(),
  explicit: z.boolean(),
}).refine((value) => value.endSec >= value.startSec, { message: 'endSec must be greater than or equal to startSec' })
export const factModelResultSchema = z.object({ facts: z.array(factModelItemSchema).max(100) })
export const taskCandidateModelSchema = z.object({
  title: z.string().trim().min(1).max(300),
  description: z.string().trim().max(2_000).optional(),
  assignee: z.string().trim().max(200).optional(),
  dueDate: z.string().trim().max(200).optional(),
  priority: z.enum(['low', 'medium', 'high']).optional(),
  sourceFactIds: z.array(z.string().min(1)).min(1),
  explicitAction: z.boolean(),
  explicitAssignee: z.boolean(),
  explicitDueDate: z.boolean(),
})
export const taskCandidateModelResultSchema = z.object({ tasks: z.array(taskCandidateModelSchema).max(30) })
export const termSuggestionModelSchema = z.object({
  observedForm: z.string().trim().min(1).max(200),
  proposedCanonical: z.string().trim().min(1).max(200),
  aliases: z.array(z.string().trim().min(1).max(200)).max(20),
  examples: z.array(z.object({
    quote: z.string().trim().min(1).max(500),
    startSec: z.number().min(0),
    endSec: z.number().min(0),
  })).min(1).max(10),
})
export const termDiscoveryResultSchema = z.object({ suggestions: z.array(termSuggestionModelSchema).max(20) })
export const factRelationSchema = z.object({ relation: z.enum(['duplicate', 'different', 'clarification', 'contradiction']) })
export const summaryItemSchema = z.object({
  text: z.string().trim().min(1).max(2_000),
  sourceFactIds: z.array(z.string().min(1)).min(1),
})
export const evidenceSummaryBatchSchema = z.object({
  keyPoints: z.array(summaryItemSchema),
  decisions: z.array(summaryItemSchema),
  problems: z.array(summaryItemSchema),
  openQuestions: z.array(summaryItemSchema),
  proposals: z.array(summaryItemSchema),
})
export const evidenceFinalSummarySchema = z.object({
  title: z.string().trim().min(1).max(200),
  summary: z.string().trim().min(1).max(8_000),
  keyPoints: z.array(summaryItemSchema),
  decisions: z.array(summaryItemSchema),
  problems: z.array(summaryItemSchema),
  openQuestions: z.array(summaryItemSchema),
  proposals: z.array(summaryItemSchema),
})

export const processingStageSchema = z.enum([
  'transcription',
  'normalization',
  'fact-extraction',
  'fact-deduplication',
  'summary',
  'tasks',
  'term-discovery',
])

export const processMediaRequestSchema = z.object({
  stages: z.array(processingStageSchema).min(1).default([
    'transcription', 'normalization', 'fact-extraction', 'fact-deduplication', 'summary', 'tasks',
  ]),
  useDictionary: z.boolean().default(false),
})

export const dictionaryEntryInputSchema = z.object({
  canonical: z.string().trim().min(1).max(200),
  aliases: z.array(z.string().trim().min(1).max(200)).max(50).default([]),
})
