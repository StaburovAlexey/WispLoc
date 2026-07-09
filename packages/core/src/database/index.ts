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
    CONSTRAINT "TranscriptSegment_mediaFileId_fkey" FOREIGN KEY ("mediaFileId") REFERENCES "MediaFile" ("id") ON DELETE CASCADE ON UPDATE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS "Summary" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "mediaFileId" TEXT NOT NULL,
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
    CONSTRAINT "Summary_mediaFileId_fkey" FOREIGN KEY ("mediaFileId") REFERENCES "MediaFile" ("id") ON DELETE CASCADE ON UPDATE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS "ExtractedTask" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "mediaFileId" TEXT NOT NULL,
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
    CONSTRAINT "ExtractedTask_mediaFileId_fkey" FOREIGN KEY ("mediaFileId") REFERENCES "MediaFile" ("id") ON DELETE CASCADE ON UPDATE CASCADE
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
]
