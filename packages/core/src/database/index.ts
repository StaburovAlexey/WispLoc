import fs from 'node:fs'
import path from 'node:path'
import { PrismaClient } from '@prisma/client'
import { PATHS } from '@wisploc/shared'

let prisma: PrismaClient | null = null

export function ensureDatabaseEnv(): string {
  fs.mkdirSync(path.dirname(PATHS.database), { recursive: true })
  const databaseUrl = `file:${PATHS.database}`
  if (!process.env.DATABASE_URL || process.env.DATABASE_URL === 'file:./dev.db') {
    process.env.DATABASE_URL = databaseUrl
  }
  return process.env.DATABASE_URL
}

export function getPrisma(): PrismaClient {
  ensureDatabaseEnv()
  prisma ??= new PrismaClient()
  return prisma
}

export async function ensureDatabaseSchema(): Promise<void> {
  ensureDatabaseEnv()
  const client = getPrisma()

  for (const statement of DATABASE_SCHEMA_SQL) {
    await client.$executeRawUnsafe(statement)
  }

  await ensureColumn(client, 'ProcessingJob', 'pipelineVersion', `TEXT NOT NULL DEFAULT 'legacy-v1'`)
  await ensureColumn(client, 'ProcessingJob', 'useDictionary', 'BOOLEAN NOT NULL DEFAULT false')
  await ensureColumn(client, 'ProcessingJob', 'discoverTerms', 'BOOLEAN NOT NULL DEFAULT false')
  await ensureColumn(client, 'ProcessingJob', 'stagesJson', 'TEXT')
  await ensureColumn(client, 'ProcessingJob', 'requestedStagesJson', 'TEXT')
  await ensureColumn(client, 'ProcessingJob', 'inputHash', 'TEXT')
  await ensureColumn(client, 'ProcessingJob', 'promptVersion', 'TEXT')
  await ensureColumn(client, 'ProcessingJob', 'modelName', 'TEXT')
  await ensureColumn(client, 'ProcessingJob', 'qualityWarningsJson', `TEXT NOT NULL DEFAULT '[]'`)
  await ensureColumn(client, 'TranscriptSegment', 'normalizedText', 'TEXT')
  await ensureColumn(client, 'TranscriptSegment', 'sequence', 'INTEGER NOT NULL DEFAULT 0')
  await ensureColumn(client, 'TranscriptSegment', 'replacementsJson', 'TEXT')
  await ensureColumn(client, 'TranscriptSegment', 'chunkIndex', 'INTEGER')
  await ensureColumn(client, 'TranscriptSegment', 'segmentIndex', 'INTEGER')
  await ensureColumn(client, 'MediaChunk', 'audioFingerprint', 'TEXT')
  await ensureColumn(client, 'MediaChunk', 'transcriptionInputHash', 'TEXT')
  await ensureColumn(client, 'MediaChunk', 'transcriptionModel', 'TEXT')
  await ensureColumn(client, 'MediaChunk', 'transcriptionLanguage', 'TEXT')
  await ensureColumn(client, 'MediaChunk', 'transcriptionVersion', 'TEXT')
  await ensureColumn(client, 'Summary', 'pipelineVersion', `TEXT NOT NULL DEFAULT 'legacy-v1'`)
  await ensureColumn(client, 'Summary', 'promptVersion', 'TEXT')
  await ensureColumn(client, 'Summary', 'sourceItemsJson', 'TEXT')
  await ensureColumn(client, 'Summary', 'problemsJson', 'TEXT')
  await ensureColumn(client, 'Summary', 'proposalsJson', 'TEXT')
  await ensureColumn(client, 'Summary', 'processingJobId', 'TEXT')
  await ensureColumn(client, 'Summary', 'artifactGenerationId', 'TEXT')
  await ensureColumn(client, 'Summary', 'inputHash', 'TEXT')
  await ensureColumn(client, 'Summary', 'schemaVersion', `TEXT DEFAULT 'evidence-summary-v1'`)
  await ensureColumn(client, 'Summary', 'dictionaryHash', 'TEXT')
  await ensureColumn(client, 'Summary', 'retrievalVersion', 'TEXT')
  await ensureColumn(client, 'Summary', 'retrievalManifestJson', 'TEXT')
  await ensureColumn(client, 'ExtractedTask', 'pipelineVersion', `TEXT NOT NULL DEFAULT 'legacy-v1'`)
  await ensureColumn(client, 'ExtractedTask', 'modelName', 'TEXT')
  await ensureColumn(client, 'ExtractedTask', 'promptVersion', 'TEXT')
  await ensureColumn(client, 'ExtractedTask', 'sourceFactIdsJson', 'TEXT')
  await ensureColumn(client, 'ExtractedTask', 'evidenceJson', 'TEXT')
  await ensureColumn(client, 'ExtractedTask', 'mergedCandidateIdsJson', 'TEXT')
  await ensureColumn(client, 'ExtractedTask', 'generatedTitle', 'TEXT')
  await ensureColumn(client, 'ExtractedTask', 'generatedDescription', 'TEXT')
  await ensureColumn(client, 'ExtractedTask', 'processingJobId', 'TEXT')
  await ensureColumn(client, 'ExtractedTask', 'confidenceBreakdownJson', 'TEXT')
  await ensureColumn(client, 'ExtractedTask', 'artifactGenerationId', 'TEXT')
  await ensureColumn(client, 'ExtractedTask', 'inputHash', 'TEXT')
  await ensureColumn(client, 'ExtractedTask', 'schemaVersion', `TEXT DEFAULT 'evidence-task-v1'`)
  await ensureColumn(client, 'ExtractedTask', 'dictionaryHash', 'TEXT')
  await ensureColumn(client, 'ExtractedTask', 'retrievalVersion', 'TEXT')
  await ensureColumn(client, 'ExtractedTask', 'retrievalManifestJson', 'TEXT')
  for (const table of ['EvidenceTranscriptChunk', 'AtomicFactRecord', 'MergedFactRecord', 'TaskCandidateRecord']) {
    await ensureColumn(client, table, 'artifactGenerationId', 'TEXT')
    await ensureColumn(client, table, 'dictionaryHash', 'TEXT')
    await ensureColumn(client, table, 'retrievalVersion', 'TEXT')
    await ensureColumn(client, table, 'retrievalManifestJson', 'TEXT')
  }
  await ensureColumn(client, 'AtomicFactRecord', 'inputHash', 'TEXT')
  await ensureColumn(client, 'AtomicFactRecord', 'schemaVersion', `TEXT NOT NULL DEFAULT 'atomic-fact-v1'`)
  await ensureColumn(client, 'MergedFactRecord', 'inputHash', 'TEXT')
  await ensureColumn(client, 'MergedFactRecord', 'modelName', 'TEXT')
  await ensureColumn(client, 'MergedFactRecord', 'promptVersion', 'TEXT')
  await ensureColumn(client, 'MergedFactRecord', 'schemaVersion', `TEXT NOT NULL DEFAULT 'merged-fact-v1'`)
  await ensureColumn(client, 'TaskCandidateRecord', 'inputHash', 'TEXT')
  await ensureColumn(client, 'TaskCandidateRecord', 'modelName', 'TEXT')
  await ensureColumn(client, 'TaskCandidateRecord', 'promptVersion', 'TEXT')
  await ensureColumn(client, 'TaskCandidateRecord', 'schemaVersion', `TEXT NOT NULL DEFAULT 'task-candidate-v1'`)
  await ensureColumn(client, 'SummaryBatchCheckpoint', 'processingJobId', 'TEXT')
  await ensureColumn(client, 'SummaryBatchCheckpoint', 'artifactGenerationId', 'TEXT')
  await ensureColumn(client, 'SummaryBatchCheckpoint', 'schemaVersion', `TEXT NOT NULL DEFAULT 'summary-batch-v1'`)
  await ensureColumn(client, 'SummaryBatchCheckpoint', 'dictionaryHash', 'TEXT')
  await ensureColumn(client, 'SummaryBatchCheckpoint', 'retrievalVersion', 'TEXT')
  await ensureColumn(client, 'SummaryBatchCheckpoint', 'retrievalManifestJson', 'TEXT')
}

async function ensureColumn(client: PrismaClient, table: string, column: string, definition: string): Promise<void> {
  const columns = await client.$queryRawUnsafe<Array<{ name: string }>>(`PRAGMA table_info("${table}")`)
  if (!columns.some((item) => item.name === column)) {
    await client.$executeRawUnsafe(`ALTER TABLE "${table}" ADD COLUMN "${column}" ${definition}`)
  }
}

const DATABASE_SCHEMA_SQL = [
  `CREATE TABLE IF NOT EXISTS "AppSetting" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS "SetupState" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "setupCompleted" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'IDLE',
    "currentStep" TEXT,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "ffmpegStatus" TEXT NOT NULL DEFAULT 'missing',
    "whisperStatus" TEXT NOT NULL DEFAULT 'missing',
    "modelStatus" TEXT NOT NULL DEFAULT 'missing',
    "ollamaStatus" TEXT NOT NULL DEFAULT 'missing',
    "llmStatus" TEXT NOT NULL DEFAULT 'missing',
    "errorMessage" TEXT,
    "logJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS "MediaFile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "durationSec" REAL,
    "status" TEXT NOT NULL DEFAULT 'UPLOADED',
    "sourcePath" TEXT NOT NULL,
    "errorMessage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS "MediaChunk" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "mediaFileId" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "startSec" REAL NOT NULL,
    "endSec" REAL NOT NULL,
    "audioPath" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "transcriptPath" TEXT,
    "summaryPath" TEXT,
    "errorMessage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "MediaChunk_mediaFileId_fkey" FOREIGN KEY ("mediaFileId") REFERENCES "MediaFile" ("id") ON DELETE CASCADE ON UPDATE CASCADE
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "MediaChunk_mediaFileId_index_key" ON "MediaChunk"("mediaFileId", "index")`,
  `CREATE TABLE IF NOT EXISTS "ProcessingJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "mediaFileId" TEXT,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "currentStep" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "startedAt" DATETIME,
    "finishedAt" DATETIME,
    "durationMs" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ProcessingJob_mediaFileId_fkey" FOREIGN KEY ("mediaFileId") REFERENCES "MediaFile" ("id") ON DELETE CASCADE ON UPDATE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS "TranscriptSegment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "mediaFileId" TEXT NOT NULL,
    "chunkId" TEXT,
    "startSec" REAL NOT NULL,
    "endSec" REAL NOT NULL,
    "text" TEXT NOT NULL,
    "speaker" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TranscriptSegment_mediaFileId_fkey" FOREIGN KEY ("mediaFileId") REFERENCES "MediaFile" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TranscriptSegment_chunkId_fkey" FOREIGN KEY ("chunkId") REFERENCES "MediaChunk" ("id") ON DELETE CASCADE ON UPDATE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS "Summary" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "mediaFileId" TEXT NOT NULL,
    "processingJobId" TEXT,
    "kind" TEXT NOT NULL,
    "shortSummary" TEXT,
    "detailedSummary" TEXT,
    "keyPointsJson" TEXT,
    "decisionsJson" TEXT,
    "risksJson" TEXT,
    "openQuestionsJson" TEXT,
    "actionItemsJson" TEXT,
    "modelName" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Summary_mediaFileId_fkey" FOREIGN KEY ("mediaFileId") REFERENCES "MediaFile" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Summary_processingJobId_fkey" FOREIGN KEY ("processingJobId") REFERENCES "ProcessingJob" ("id") ON DELETE SET NULL ON UPDATE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS "ExtractedTask" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "mediaFileId" TEXT NOT NULL,
    "processingJobId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "sourceTimecode" TEXT,
    "sourceChunkIndex" INTEGER,
    "priority" TEXT,
    "labelsJson" TEXT,
    "assigneeHint" TEXT,
    "dueDateHint" TEXT,
    "confidence" REAL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ExtractedTask_mediaFileId_fkey" FOREIGN KEY ("mediaFileId") REFERENCES "MediaFile" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ExtractedTask_processingJobId_fkey" FOREIGN KEY ("processingJobId") REFERENCES "ProcessingJob" ("id") ON DELETE SET NULL ON UPDATE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS "DictionaryEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "canonical" TEXT NOT NULL,
    "aliasesJson" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "confirmedByUser" BOOLEAN NOT NULL DEFAULT true,
    "usageCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS "EvidenceTranscriptChunk" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "mediaFileId" TEXT NOT NULL,
    "processingJobId" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "startSec" REAL NOT NULL,
    "endSec" REAL NOT NULL,
    "segmentIdsJson" TEXT NOT NULL,
    "originalText" TEXT NOT NULL,
    "normalizedText" TEXT NOT NULL,
    "inputHash" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "EvidenceTranscriptChunk_mediaFileId_fkey" FOREIGN KEY ("mediaFileId") REFERENCES "MediaFile" ("id") ON DELETE CASCADE,
    CONSTRAINT "EvidenceTranscriptChunk_processingJobId_fkey" FOREIGN KEY ("processingJobId") REFERENCES "ProcessingJob" ("id") ON DELETE CASCADE
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "EvidenceTranscriptChunk_processingJobId_index_key" ON "EvidenceTranscriptChunk"("processingJobId", "index")`,
  `CREATE TABLE IF NOT EXISTS "AtomicFactRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "mediaFileId" TEXT NOT NULL,
    "processingJobId" TEXT NOT NULL,
    "chunkIndex" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "evidenceQuote" TEXT NOT NULL,
    "startSec" REAL NOT NULL,
    "endSec" REAL NOT NULL,
    "speaker" TEXT,
    "explicit" BOOLEAN NOT NULL,
    "validationStatus" TEXT NOT NULL,
    "validationErrorsJson" TEXT NOT NULL,
    "repairUsed" BOOLEAN NOT NULL DEFAULT false,
    "promptVersion" TEXT NOT NULL,
    "modelName" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AtomicFactRecord_mediaFileId_fkey" FOREIGN KEY ("mediaFileId") REFERENCES "MediaFile" ("id") ON DELETE CASCADE,
    CONSTRAINT "AtomicFactRecord_processingJobId_fkey" FOREIGN KEY ("processingJobId") REFERENCES "ProcessingJob" ("id") ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS "MergedFactRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "mediaFileId" TEXT NOT NULL,
    "processingJobId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "evidenceJson" TEXT NOT NULL,
    "sourceFactIdsJson" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MergedFactRecord_mediaFileId_fkey" FOREIGN KEY ("mediaFileId") REFERENCES "MediaFile" ("id") ON DELETE CASCADE,
    CONSTRAINT "MergedFactRecord_processingJobId_fkey" FOREIGN KEY ("processingJobId") REFERENCES "ProcessingJob" ("id") ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS "SummaryBatchCheckpoint" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "mediaFileId" TEXT NOT NULL,
    "processingJobId" TEXT,
    "batchIndex" INTEGER NOT NULL,
    "inputHash" TEXT NOT NULL,
    "summaryJson" TEXT NOT NULL,
    "modelName" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SummaryBatchCheckpoint_mediaFileId_fkey" FOREIGN KEY ("mediaFileId") REFERENCES "MediaFile" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SummaryBatchCheckpoint_processingJobId_fkey" FOREIGN KEY ("processingJobId") REFERENCES "ProcessingJob" ("id") ON DELETE SET NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "SummaryBatchCheckpoint_mediaFileId_batchIndex_inputHash_key" ON "SummaryBatchCheckpoint"("mediaFileId", "batchIndex", "inputHash")`,
  `CREATE TABLE IF NOT EXISTS "TaskCandidateRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "mediaFileId" TEXT NOT NULL,
    "processingJobId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "assignee" TEXT,
    "dueDate" TEXT,
    "priority" TEXT,
    "sourceFactIdsJson" TEXT NOT NULL,
    "evidenceJson" TEXT NOT NULL,
    "explicitAction" BOOLEAN NOT NULL,
    "explicitAssignee" BOOLEAN NOT NULL,
    "explicitDueDate" BOOLEAN NOT NULL,
    "mergedCandidateIdsJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TaskCandidateRecord_mediaFileId_fkey" FOREIGN KEY ("mediaFileId") REFERENCES "MediaFile" ("id") ON DELETE CASCADE,
    CONSTRAINT "TaskCandidateRecord_processingJobId_fkey" FOREIGN KEY ("processingJobId") REFERENCES "ProcessingJob" ("id") ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS "TermSuggestion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "mediaFileId" TEXT NOT NULL,
    "processingJobId" TEXT NOT NULL,
    "observedForm" TEXT NOT NULL,
    "proposedCanonical" TEXT NOT NULL,
    "aliasesJson" TEXT NOT NULL,
    "occurrenceCount" INTEGER NOT NULL,
    "examplesJson" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PROPOSED',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TermSuggestion_mediaFileId_fkey" FOREIGN KEY ("mediaFileId") REFERENCES "MediaFile" ("id") ON DELETE CASCADE,
    CONSTRAINT "TermSuggestion_processingJobId_fkey" FOREIGN KEY ("processingJobId") REFERENCES "ProcessingJob" ("id") ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS "IntegrationAccount" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "provider" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "baseUrl" TEXT,
    "authType" TEXT NOT NULL,
    "encryptedToken" TEXT NOT NULL,
    "organizationId" TEXT,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "settingsJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS "IntegrationTarget" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "integrationId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "key" TEXT,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "settingsJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "IntegrationTarget_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "IntegrationAccount" ("id") ON DELETE CASCADE ON UPDATE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS "CreatedExternalTask" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "extractedTaskId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "integrationId" TEXT,
    "externalId" TEXT NOT NULL,
    "externalKey" TEXT,
    "externalUrl" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "errorMessage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CreatedExternalTask_extractedTaskId_fkey" FOREIGN KEY ("extractedTaskId") REFERENCES "ExtractedTask" ("id") ON DELETE CASCADE ON UPDATE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS "NormalizedTranscriptSegment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "mediaFileId" TEXT NOT NULL,
    "processingJobId" TEXT NOT NULL,
    "segmentId" TEXT NOT NULL,
    "normalizedText" TEXT NOT NULL,
    "replacementsJson" TEXT NOT NULL,
    "dictionaryHash" TEXT NOT NULL,
    "normalizationPromptVersion" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "NormalizedTranscriptSegment_mediaFileId_fkey" FOREIGN KEY ("mediaFileId") REFERENCES "MediaFile" ("id") ON DELETE CASCADE,
    CONSTRAINT "NormalizedTranscriptSegment_processingJobId_fkey" FOREIGN KEY ("processingJobId") REFERENCES "ProcessingJob" ("id") ON DELETE CASCADE,
    CONSTRAINT "NormalizedTranscriptSegment_segmentId_fkey" FOREIGN KEY ("segmentId") REFERENCES "TranscriptSegment" ("id") ON DELETE CASCADE
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "NormalizedTranscriptSegment_processingJobId_segmentId_key" ON "NormalizedTranscriptSegment"("processingJobId", "segmentId")`,
  `CREATE TABLE IF NOT EXISTS "FactChunkCheckpoint" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "mediaFileId" TEXT NOT NULL,
    "chunkIndex" INTEGER NOT NULL,
    "inputHash" TEXT NOT NULL,
    "factsJson" TEXT NOT NULL,
    "modelName" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "schemaVersion" TEXT NOT NULL,
    "dictionaryHash" TEXT,
    "retrievalVersion" TEXT,
    "retrievalManifestJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "FactChunkCheckpoint_mediaFileId_fkey" FOREIGN KEY ("mediaFileId") REFERENCES "MediaFile" ("id") ON DELETE CASCADE
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "FactChunkCheckpoint_mediaFileId_chunkIndex_inputHash_key" ON "FactChunkCheckpoint"("mediaFileId", "chunkIndex", "inputHash")`,
  `CREATE TABLE IF NOT EXISTS "ArtifactGeneration" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "mediaFileId" TEXT NOT NULL,
    "processingJobId" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "inputHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "pipelineVersion" TEXT NOT NULL,
    "modelName" TEXT,
    "modelBundleId" TEXT,
    "promptVersion" TEXT,
    "schemaVersion" TEXT NOT NULL,
    "dictionaryHash" TEXT,
    "retrievalVersion" TEXT,
    "retrievalManifestJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" DATETIME,
    CONSTRAINT "ArtifactGeneration_processingJobId_fkey" FOREIGN KEY ("processingJobId") REFERENCES "ProcessingJob" ("id") ON DELETE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS "ArtifactGeneration_mediaFileId_stage_status_createdAt_idx" ON "ArtifactGeneration"("mediaFileId", "stage", "status", "createdAt")`,
  `CREATE TABLE IF NOT EXISTS "KnowledgeExample" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "stage" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "inputText" TEXT NOT NULL,
    "expectedOutputJson" TEXT NOT NULL,
    "labelsJson" TEXT NOT NULL,
    "quality" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "source" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS "KnowledgeExample_stage_language_enabled_idx" ON "KnowledgeExample"("stage", "language", "enabled")`,
  `CREATE TABLE IF NOT EXISTS "UserCorrectionRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "mediaFileId" TEXT NOT NULL,
    "processingJobId" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "sourceInput" TEXT NOT NULL,
    "generatedOutputJson" TEXT NOT NULL,
    "correctedOutputJson" TEXT NOT NULL,
    "evidenceJson" TEXT NOT NULL,
    "reviewStatus" TEXT NOT NULL DEFAULT 'pending',
    "promotedExampleId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" DATETIME,
    CONSTRAINT "UserCorrectionRecord_mediaFileId_fkey" FOREIGN KEY ("mediaFileId") REFERENCES "MediaFile" ("id") ON DELETE CASCADE,
    CONSTRAINT "UserCorrectionRecord_processingJobId_fkey" FOREIGN KEY ("processingJobId") REFERENCES "ProcessingJob" ("id") ON DELETE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS "UserCorrectionRecord_stage_reviewStatus_idx" ON "UserCorrectionRecord"("stage", "reviewStatus")`,
]
