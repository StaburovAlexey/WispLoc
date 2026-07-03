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
  chunkMinutes: z.number().int().min(1).default(5),
  cleanChunks: z.boolean().default(true),
  deleteOriginalAfterProcessing: z.boolean().default(false),
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
