import { createHash } from 'node:crypto'
import type { KnowledgeExample, KnowledgeStage, UserCorrectionInput } from './types'
import { BUILTIN_EXAMPLES } from './builtinExamples'
import { getPrisma } from '../database'

const prisma = getPrisma()

export async function listKnowledgeExamples(stage?: KnowledgeStage, language?: 'ru' | 'en'): Promise<KnowledgeExample[]> {
  const stored = await prisma.knowledgeExample.findMany({
    where: {
      enabled: true,
      ...(stage ? { stage } : {}),
      ...(language ? { language } : {}),
      quality: { in: ['gold', 'reviewed'] },
    },
    orderBy: { updatedAt: 'desc' },
  })
  const mapped = stored.map(toKnowledgeExample)
  return [...BUILTIN_EXAMPLES, ...mapped].filter((example) => (
    example.enabled && (!stage || example.stage === stage) && (!language || example.language === language)
  ))
}

export async function listKnowledgeExamplesForReview(stage?: KnowledgeStage, language?: 'ru' | 'en'): Promise<KnowledgeExample[]> {
  const stored = await prisma.knowledgeExample.findMany({
    where: {
      ...(stage ? { stage } : {}),
      ...(language ? { language } : {}),
    },
    orderBy: { updatedAt: 'desc' },
  })
  return [...BUILTIN_EXAMPLES, ...stored.map(toKnowledgeExample)].filter((example) => (
    (!stage || example.stage === stage) && (!language || example.language === language)
  ))
}

export async function setKnowledgeExampleEnabled(id: string, enabled: boolean): Promise<void> {
  if (id.startsWith('builtin:')) throw new Error('Built-in examples are read-only')
  await prisma.knowledgeExample.update({ where: { id }, data: { enabled } })
}

export async function createUserCorrection(input: UserCorrectionInput) {
  return prisma.userCorrectionRecord.create({ data: input })
}

export async function listUserCorrections(status?: 'pending' | 'accepted' | 'rejected') {
  return prisma.userCorrectionRecord.findMany({
    where: status ? { reviewStatus: status } : {},
    orderBy: { createdAt: 'desc' },
  })
}

export async function reviewUserCorrection(id: string, status: 'accepted' | 'rejected') {
  return prisma.$transaction(async (tx) => {
    const correction = await tx.userCorrectionRecord.findUnique({ where: { id } })
    if (!correction) throw new Error('Correction not found')
    let promotedExampleId: string | null = null
    if (status === 'accepted') {
      promotedExampleId = `correction:${correction.id}`
      const contentHash = createHash('sha256').update(JSON.stringify({
        input: correction.sourceInput,
        output: correction.correctedOutputJson,
      })).digest('hex')
      await tx.knowledgeExample.upsert({
        where: { id: promotedExampleId },
        create: {
          id: promotedExampleId,
          stage: correction.stage,
          language: containsCyrillic(correction.sourceInput) ? 'ru' : 'en',
          inputText: correction.sourceInput,
          expectedOutputJson: correction.correctedOutputJson,
          labelsJson: '[]',
          quality: 'reviewed',
          enabled: true,
          source: 'user-correction',
          contentHash,
        },
        update: { expectedOutputJson: correction.correctedOutputJson, contentHash, enabled: true },
      })
    }
    return tx.userCorrectionRecord.update({
      where: { id },
      data: { reviewStatus: status, reviewedAt: new Date(), promotedExampleId },
    })
  })
}

export async function listRagDebugManifests(mediaFileId: string) {
  const [facts, summaries, generations] = await Promise.all([
    prisma.factChunkCheckpoint.findMany({
      where: { mediaFileId, retrievalManifestJson: { not: null } },
      orderBy: { updatedAt: 'desc' },
      take: 50,
      select: { chunkIndex: true, inputHash: true, retrievalVersion: true, retrievalManifestJson: true, updatedAt: true },
    }),
    prisma.summaryBatchCheckpoint.findMany({
      where: { mediaFileId, retrievalManifestJson: { not: null } },
      orderBy: { updatedAt: 'desc' },
      take: 50,
      select: { batchIndex: true, inputHash: true, retrievalVersion: true, retrievalManifestJson: true, updatedAt: true },
    }),
    prisma.artifactGeneration.findMany({
      where: { mediaFileId }, orderBy: { createdAt: 'desc' }, take: 50,
      select: { id: true, stage: true, status: true, inputHash: true, retrievalVersion: true, retrievalManifestJson: true, createdAt: true, completedAt: true },
    }),
  ])
  return { facts, summaries, generations }
}

function parseArray(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch { return [] }
}

function toKnowledgeExample(item: {
  id: string
  stage: string
  language: string
  inputText: string
  expectedOutputJson: string
  labelsJson: string
  quality: string
  enabled: boolean
  source: string
  createdAt: Date
  updatedAt: Date
}): KnowledgeExample {
  return {
    id: item.id,
    stage: item.stage as KnowledgeStage,
    language: item.language === 'en' ? 'en' : 'ru',
    inputText: item.inputText,
    expectedOutputJson: item.expectedOutputJson,
    labels: parseArray(item.labelsJson),
    quality: item.quality === 'gold' ? 'gold' : item.quality === 'synthetic' ? 'synthetic' : 'reviewed',
    enabled: item.enabled,
    source: item.source === 'manual' ? 'manual' : 'user-correction',
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
  }
}

function containsCyrillic(value: string): boolean {
  return /[А-Яа-яЁё]/u.test(value)
}
