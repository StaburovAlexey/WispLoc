import type { EvidenceTranscriptSegment, TranscriptChunk } from '@wisploc/shared'

export interface ChunkingConfig {
  targetDurationSec: number
  overlapSec: number
}

export const DEFAULT_CHUNKING_CONFIG: ChunkingConfig = { targetDurationSec: 120, overlapSec: 20 }

export function createTranscriptChunks(
  mediaFileId: string,
  inputSegments: EvidenceTranscriptSegment[],
  config: ChunkingConfig = DEFAULT_CHUNKING_CONFIG,
): TranscriptChunk[] {
  validateConfig(config)
  const segments = [...inputSegments]
    .filter((segment) => segment.originalText.trim().length > 0)
    .sort((left, right) => left.startSec - right.startSec || left.sequence - right.sequence)
  if (segments.length === 0) return []

  const chunks: TranscriptChunk[] = []
  let startIndex = 0
  while (startIndex < segments.length) {
    const chunkStart = segments[startIndex].startSec
    const targetEnd = chunkStart + config.targetDurationSec
    let endIndex = startIndex
    while (endIndex + 1 < segments.length && segments[endIndex + 1].endSec <= targetEnd) endIndex += 1
    if (endIndex === startIndex && segments[endIndex].endSec < targetEnd && endIndex + 1 < segments.length) endIndex += 1

    const selected = segments.slice(startIndex, endIndex + 1)
    chunks.push({
      index: chunks.length,
      mediaFileId,
      startSec: selected[0].startSec,
      endSec: selected[selected.length - 1].endSec,
      segmentIds: selected.map((segment) => segment.id),
      originalText: selected.map((segment) => segment.originalText.trim()).join(' '),
      normalizedText: selected.map((segment) => (segment.normalizedText ?? segment.originalText).trim()).join(' '),
    })

    if (endIndex >= segments.length - 1) break
    const overlapStart = selected[selected.length - 1].endSec - config.overlapSec
    let nextStart = endIndex + 1
    for (let index = endIndex; index > startIndex; index -= 1) {
      if (segments[index].endSec > overlapStart) nextStart = index
      else break
    }
    startIndex = Math.max(startIndex + 1, nextStart)
  }
  return chunks
}

function validateConfig(config: ChunkingConfig): void {
  if (!Number.isFinite(config.targetDurationSec) || config.targetDurationSec <= 0) {
    throw new Error('targetDurationSec must be greater than zero')
  }
  if (!Number.isFinite(config.overlapSec) || config.overlapSec < 0 || config.overlapSec >= config.targetDurationSec) {
    throw new Error('overlapSec must be non-negative and smaller than targetDurationSec')
  }
}
