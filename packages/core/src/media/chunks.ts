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

export async function getChunksDir(mediaFileId: string): Promise<string> {
  const dir = `${PATHS.chunks}/${mediaFileId}`
  const fs = await import('node:fs/promises')
  await fs.mkdir(dir, { recursive: true })
  return dir
}
