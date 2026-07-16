import { describe, expect, it } from 'vitest'
import type { AtomicFact, DictionaryEntry, EvidenceTranscriptSegment, ValidatedFact } from '@wisploc/shared'
import { calculateTaskConfidence, createTranscriptChunks, deduplicateFacts, normalizeTerms, validateFacts, validateTaskFieldsAgainstEvidence } from '../packages/core/src/evidence'

const entries: DictionaryEntry[] = [
  {
    id: 'dictionary-1',
    canonical: 'WispLoc',
    aliases: ['висп лок', 'wisploc'],
    status: 'ACTIVE',
    confirmedByUser: true,
    usageCount: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
]

describe('evidence foundation', () => {
  it('normalizes confirmed aliases without changing original text', () => {
    const result = normalizeTerms('Запусти висп лок, но не перевисполк.', entries)
    expect(result.originalText).toBe('Запусти висп лок, но не перевисполк.')
    expect(result.normalizedText).toBe('Запусти WispLoc, но не перевисполк.')
    expect(result.replacements).toHaveLength(1)
  })

  it('does not apply conflicting aliases', () => {
    const result = normalizeTerms('Используем prime view.', [
      { ...entries[0], id: 'one', canonical: 'PrimeVue', aliases: ['prime view'] },
      { ...entries[0], id: 'two', canonical: 'PrimeReact', aliases: ['prime view'] },
    ])
    expect(result.normalizedText).toBe(result.originalText)
  })

  it('creates two-minute chunks with real segment overlap', () => {
    const segments = Array.from({ length: 8 }, (_, index): EvidenceTranscriptSegment => ({
      id: `segment-${index}`,
      mediaFileId: 'media-1',
      startSec: index * 30,
      endSec: index * 30 + 25,
      originalText: `Segment ${index}`,
      sequence: index,
    }))
    const chunks = createTranscriptChunks('media-1', segments)
    expect(chunks).toHaveLength(3)
    expect(chunks[0].segmentIds).toEqual(['segment-0', 'segment-1', 'segment-2', 'segment-3'])
    expect(chunks[1].segmentIds[0]).toBe('segment-3')
    expect(chunks[1].startSec).toBe(90)
  })

  it('keeps one chunk for a short recording', () => {
    const segments: EvidenceTranscriptSegment[] = [{
      id: 'segment-1', mediaFileId: 'media-1', startSec: 4.25, endSec: 22.75,
      originalText: 'Короткая запись', sequence: 0,
    }]
    expect(createTranscriptChunks('media-1', segments)).toHaveLength(1)
  })

  it('validates exact evidence and restores segment timestamps', () => {
    const segments: EvidenceTranscriptSegment[] = [{
      id: 'segment-1', mediaFileId: 'media-1', startSec: 42.5, endSec: 48.25,
      originalText: 'Алексей, исправь форму авторизации.', sequence: 0,
    }]
    const fact: AtomicFact = {
      id: 'fact-1', mediaFileId: 'media-1', chunkIndex: 2, type: 'task_candidate',
      text: 'Алексей должен исправить форму авторизации.',
      evidenceQuote: 'Алексей, исправь форму авторизации.', startSec: 0, endSec: 0, explicit: true,
    }
    const result = validateFacts([fact], 2, segments)
    expect(result.validFacts[0]).toMatchObject({ startSec: 42.5, endSec: 48.25 })
  })

  it('rejects a nonexistent evidence quote', () => {
    const segments: EvidenceTranscriptSegment[] = [{
      id: 'segment-1', mediaFileId: 'media-1', startSec: 1, endSec: 2,
      originalText: 'Обсудили авторизацию.', sequence: 0,
    }]
    const fact: AtomicFact = {
      id: 'fact-1', mediaFileId: 'media-1', chunkIndex: 0, type: 'task_candidate',
      text: 'Иван исправит авторизацию завтра.', evidenceQuote: 'Иван исправит авторизацию завтра.',
      startSec: 1, endSec: 2, explicit: true,
    }
    expect(validateFacts([fact], 0, segments).invalidFacts[0].validationStatus).toBe('invalid_quote')
  })

  it('calculates confidence deterministically', () => {
    expect(calculateTaskConfidence({
      quoteValidated: true,
      timecodeValidated: true,
      explicitAction: true,
      explicitAssignee: false,
      explicitDueDate: false,
      multipleEvidenceItems: false,
      segmentMatch: true,
    })).toBe(0.7)
  })

  it('removes invented assignees and deadlines', () => {
    const validated = validateTaskFieldsAgainstEvidence({
      assignee: 'Алексей', dueDate: 'завтра', priority: 'high' as const,
      explicitAssignee: true, explicitDueDate: true,
    }, [{ quote: 'Нужно исправить форму авторизации.', startSec: 10, endSec: 15, chunkIndex: 0 }])
    expect(validated.assignee).toBeUndefined()
    expect(validated.dueDate).toBeUndefined()
    expect(validated.priority).toBeUndefined()
  })

  it('deduplicates overlap facts while preserving evidence', () => {
    const base: ValidatedFact = {
      id: 'fact-1', mediaFileId: 'media-1', chunkIndex: 0, type: 'decision', text: 'Исправить форму.',
      evidenceQuote: 'Исправить форму.', startSec: 100, endSec: 105, explicit: true,
      validationStatus: 'valid', validationErrors: [],
    }
    const merged = deduplicateFacts([{ ...base }, { ...base, id: 'fact-2', chunkIndex: 1, startSec: 102, endSec: 106 }])
    expect(merged).toHaveLength(1)
    expect(merged[0].sourceFactIds).toEqual(['fact-1', 'fact-2'])
    expect(merged[0].evidence).toHaveLength(2)
  })
})
