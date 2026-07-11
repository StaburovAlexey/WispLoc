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
  const records = input.segments.map((seg) => ({
    mediaFileId: input.mediaFileId,
    chunkId: input.chunkId ?? null,
    startSec: seg.start,
    endSec: seg.end,
    text: seg.text,
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
    orderBy: { startSec: 'asc' },
  })
}

/** Get the concatenated transcript text for a specific chunk. */
export async function getChunkTranscriptText(chunkId: string): Promise<string> {
  const segments = await prisma.transcriptSegment.findMany({
    where: { chunkId },
    orderBy: { startSec: 'asc' },
  })
  return segments.map((s) => s.text).join(' ')
}

/** Build the full transcript text from segments. */
export async function getFullTranscript(mediaFileId: string): Promise<{
  text: string
  segments: Array<{
    startSec: number
    endSec: number
    text: string
    speaker: string | null
  }>
}> {
  const segments = await getSegments(mediaFileId)

  const text = segments.map((s) => s.text).join(' ')

  return {
    text,
    segments: segments.map((s) => ({
      startSec: s.startSec,
      endSec: s.endSec,
      text: s.text,
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
