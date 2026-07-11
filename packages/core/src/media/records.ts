import type { MediaFileDto } from '@wisploc/shared'
import { getPrisma } from '../database'

const prisma = getPrisma()

export interface CreateMediaInput {
  originalName: string
  mimeType: string
  sizeBytes: number
  sourcePath: string
}

export async function createMediaRecord(input: CreateMediaInput) {
  const record = await prisma.mediaFile.create({
    data: {
      originalName: input.originalName,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      sourcePath: input.sourcePath,
      status: 'UPLOADED',
    },
  })
  return toDto(record)
}

export async function getMediaRecord(id: string): Promise<MediaFileDto | null> {
  const record = await prisma.mediaFile.findUnique({ where: { id } })
  return record ? toDto(record) : null
}

/** Internal — returns the raw Prisma record with sourcePath for processing. */
export async function getMediaRecordRaw(id: string) {
  return prisma.mediaFile.findUnique({ where: { id } })
}

export async function listMediaRecords(): Promise<MediaFileDto[]> {
  const records = await prisma.mediaFile.findMany({
    orderBy: { createdAt: 'desc' },
    take: 50,
  })
  return records.map(toDto)
}

export async function deleteMediaRecord(id: string): Promise<void> {
  await prisma.mediaFile.delete({ where: { id } })
}

export async function updateMediaStatus(
  id: string,
  status: string,
  errorMessage?: string,
): Promise<void> {
  await prisma.mediaFile.update({
    where: { id },
    data: {
      status,
      errorMessage: errorMessage ?? null,
    },
  })
}

export async function updateMediaDuration(
  id: string,
  durationSec: number,
): Promise<void> {
  await prisma.mediaFile.update({
    where: { id },
    data: { durationSec },
  })
}

function toDto(record: any): MediaFileDto {
  return {
    id: record.id,
    originalName: record.originalName,
    mimeType: record.mimeType,
    sizeBytes: record.sizeBytes,
    durationSec: record.durationSec,
    status: record.status,
    errorMessage: record.errorMessage,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  }
}
