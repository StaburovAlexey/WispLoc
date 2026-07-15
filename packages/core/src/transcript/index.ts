import { PATHS } from '@wisploc/shared'
import type { WhisperSegment } from '../whisper'
import { getPrisma } from '../database'

const prisma = getPrisma()

export interface SaveSegmentsInput {
  mediaFileId: string
  chunkId?: string
  segments: WhisperSegment[]
}

/** Persist transcript segments for a chunk. */
export async function saveSegments(input: SaveSegmentsInput) {
  const chunk = input.chunkId
    ? await prisma.mediaChunk.findUnique({ where: { id: input.chunkId }, select: { index: true } })
    : null
  if (input.chunkId) {
    await prisma.transcriptSegment.deleteMany({ where: { mediaFileId: input.mediaFileId, chunkId: input.chunkId } })
  }
  const records = input.segments.map((seg, index) => ({
    mediaFileId: input.mediaFileId,
    chunkId: input.chunkId ?? null,
    startSec: seg.start,
    endSec: seg.end,
    text: seg.text,
    chunkIndex: chunk?.index ?? null,
    segmentIndex: index,
    sequence: chunk ? chunk.index * 1_000_000 + index : index,
  }))

  // Insert in batches
  for (const record of records) {
    await prisma.transcriptSegment.create({ data: record })
  }

  return records.length
}

/** Get all transcript segments for a media file, ordered by start time. */
export async function getSegments(mediaFileId: string) {
  return prisma.transcriptSegment.findMany({
    where: { mediaFileId },
    orderBy: [{ startSec: 'asc' }, { endSec: 'asc' }, { sequence: 'asc' }],
  })
}

/** Get the concatenated transcript text for a specific chunk. */
export async function getChunkTranscriptText(chunkId: string): Promise<string> {
  const segments = await prisma.transcriptSegment.findMany({
    where: { chunkId },
    orderBy: { startSec: 'asc' },
  })
  return segments.map((s) => s.normalizedText ?? s.text).join(' ')
}

/** Build the full transcript text from segments. */
export async function getFullTranscript(mediaFileId: string): Promise<{
  text: string
  segments: Array<{
    id: string
    startSec: number
    endSec: number
    text: string
    originalText: string
    normalizedText: string | null
    sequence: number
    speaker: string | null
  }>
}> {
  const segments = await getSegments(mediaFileId)

  const text = segments.map((s) => s.text).join(' ')

  return {
    text,
    segments: segments.map((s) => ({
      id: s.id,
      startSec: s.startSec,
      endSec: s.endSec,
      text: s.text,
      originalText: s.text,
      normalizedText: s.normalizedText,
      sequence: s.sequence,
      speaker: s.speaker,
    })),
  }
}

/** Delete all transcript segments for a media file. */
export async function deleteTranscript(mediaFileId: string) {
  await prisma.transcriptSegment.deleteMany({
    where: { mediaFileId },
  })
}

export async function getTranscriptContext(input: {
  mediaFileId: string
  segmentIds?: string[]
  startSec?: number
  endSec?: number
  beforeSegments?: number
  afterSegments?: number
}) {
  const segments = await getSegments(input.mediaFileId)
  const matchingIndexes = segments.flatMap((segment, index) => {
    const idMatch = input.segmentIds?.includes(segment.id) ?? false
    const rangeMatch = input.startSec !== undefined || input.endSec !== undefined
      ? segment.endSec >= (input.startSec ?? 0) && segment.startSec <= (input.endSec ?? Number.POSITIVE_INFINITY)
      : false
    return idMatch || rangeMatch ? [index] : []
  })
  if (matchingIndexes.length === 0) return []
  const before = Math.max(0, Math.min(10, input.beforeSegments ?? 2))
  const after = Math.max(0, Math.min(10, input.afterSegments ?? 2))
  const start = Math.max(0, Math.min(...matchingIndexes) - before)
  const end = Math.min(segments.length, Math.max(...matchingIndexes) + after + 1)
  return segments.slice(start, end).map((segment) => ({
    id: segment.id,
    startSec: segment.startSec,
    endSec: segment.endSec,
    text: segment.text,
    speaker: segment.speaker,
  }))
}

/** Get the transcript path for a chunk. */
export function getTranscriptPath(mediaFileId: string, chunkIndex: number): string {
  return `${PATHS.transcripts}/${mediaFileId}/chunk_${String(chunkIndex).padStart(5, '0')}.json`
}

/** Save raw whisper output to disk. */
export async function saveRawTranscript(
  mediaFileId: string,
  chunkIndex: number,
  rawOutput: string,
): Promise<string> {
  const dir = `${PATHS.transcripts}/${mediaFileId}`
  const fs = await import('node:fs/promises')
  await fs.mkdir(dir, { recursive: true })
  const filePath = getTranscriptPath(mediaFileId, chunkIndex)
  await fs.writeFile(filePath, rawOutput, 'utf-8')
  return filePath
}
