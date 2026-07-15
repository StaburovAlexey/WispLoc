import { PATHS } from '@wisploc/shared'
import { getPrisma } from '../database'

const prisma = getPrisma()

export interface CreateChunkInput {
  mediaFileId: string
  index: number
  startSec: number
  endSec: number
  audioPath: string
}

export async function createChunk(input: CreateChunkInput) {
  return prisma.mediaChunk.create({
    data: {
      mediaFileId: input.mediaFileId,
      index: input.index,
      startSec: input.startSec,
      endSec: input.endSec,
      audioPath: input.audioPath,
      status: 'PENDING',
    },
  })
}

export async function createChunksBatch(inputs: CreateChunkInput[]) {
  return prisma.mediaChunk.createMany({
    data: inputs.map((i) => ({
      mediaFileId: i.mediaFileId,
      index: i.index,
      startSec: i.startSec,
      endSec: i.endSec,
      audioPath: i.audioPath,
      status: 'PENDING',
    })),
  })
}

export async function listChunksByMedia(mediaFileId: string) {
  return prisma.mediaChunk.findMany({
    where: { mediaFileId },
    orderBy: { index: 'asc' },
  })
}

export async function updateChunkStatus(
  id: string,
  status: string,
  errorMessage?: string,
) {
  return prisma.mediaChunk.update({
    where: { id },
    data: {
      status,
      errorMessage: errorMessage ?? null,
    },
  })
}

export async function updateChunkTranscriptPath(
  id: string,
  transcriptPath: string,
) {
  return prisma.mediaChunk.update({
    where: { id },
    data: { transcriptPath },
  })
}

export async function updateChunkTranscriptionMetadata(id: string, metadata: {
  audioFingerprint: string
  transcriptionInputHash: string
  transcriptionModel: string
  transcriptionLanguage: string
  transcriptionVersion: string
}) {
  return prisma.mediaChunk.update({ where: { id }, data: metadata })
}

export async function canReuseTranscription(chunkId: string, inputHash: string): Promise<boolean> {
  const chunk = await prisma.mediaChunk.findUnique({ where: { id: chunkId } })
  if (!chunk || chunk.status !== 'DONE' || chunk.transcriptionInputHash !== inputHash) return false
  const segments = await prisma.transcriptSegment.findMany({
    where: { chunkId },
    select: { startSec: true, endSec: true, text: true },
  })
  return segments.length > 0 && segments.every((segment) => (
    segment.startSec >= 0 && segment.endSec > segment.startSec && segment.text.trim().length > 0
  ))
}

export async function getChunksDir(mediaFileId: string): Promise<string> {
  const dir = `${PATHS.chunks}/${mediaFileId}`
  const fs = await import('node:fs/promises')
  await fs.mkdir(dir, { recursive: true })
  return dir
}
