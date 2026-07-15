import type { AtomicFact, EvidenceTranscriptSegment, ValidatedFact } from '@wisploc/shared'

export interface FactValidationResult {
  validFacts: ValidatedFact[]
  invalidFacts: ValidatedFact[]
}

export function validateFacts(
  facts: AtomicFact[],
  chunkIndex: number,
  segments: EvidenceTranscriptSegment[],
): FactValidationResult {
  const validFacts: ValidatedFact[] = []
  const invalidFacts: ValidatedFact[] = []
  const chunkText = segments.map((segment) => segment.originalText).join(' ')

  for (const fact of facts) {
    const errors: string[] = []
    if (fact.chunkIndex !== chunkIndex) errors.push('chunk_index_mismatch')
    const matchingSegments = findQuoteSegments(fact.evidenceQuote, segments)
    if (!normalizeQuote(chunkText).includes(normalizeQuote(fact.evidenceQuote))) errors.push('quote_not_found')
    if (matchingSegments.length === 0) errors.push('segment_quote_not_found')

    let startSec = fact.startSec
    let endSec = fact.endSec
    if (matchingSegments.length > 0) {
      startSec = matchingSegments[0].startSec
      endSec = matchingSegments[matchingSegments.length - 1].endSec
    }
    if (startSec < 0 || endSec < startSec) errors.push('invalid_timecode')

    const validationStatus = errors.includes('quote_not_found') || errors.includes('segment_quote_not_found')
      ? 'invalid_quote'
      : errors.includes('invalid_timecode')
        ? 'invalid_timecode'
        : errors.length > 0
          ? 'needs_review'
          : 'valid'
    const validated: ValidatedFact = { ...fact, startSec, endSec, validationStatus, validationErrors: errors }
    if (validationStatus === 'valid') validFacts.push(validated)
    else invalidFacts.push(validated)
  }
  return { validFacts, invalidFacts }
}

export function normalizeQuote(value: string): string {
  return value
    .toLocaleLowerCase()
    .replace(/[«»„“”]/g, '"')
    .replace(/[.,!?;:()[\]{}—–-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function findQuoteSegments(quote: string, segments: EvidenceTranscriptSegment[]): EvidenceTranscriptSegment[] {
  const normalizedQuote = normalizeQuote(quote)
  if (!normalizedQuote) return []
  let bestMatch: EvidenceTranscriptSegment[] = []
  for (let start = 0; start < segments.length; start += 1) {
    let combined = ''
    for (let end = start; end < segments.length; end += 1) {
      combined = `${combined} ${segments[end].originalText}`.trim()
      const normalizedCombined = normalizeQuote(combined)
      if (normalizedCombined.includes(normalizedQuote)) {
        const candidate = segments.slice(start, end + 1)
        if (bestMatch.length === 0 || candidate.length < bestMatch.length) bestMatch = candidate
        break
      }
      if (normalizedCombined.length > normalizedQuote.length * 3 + 200) break
    }
  }
  return bestMatch
}
