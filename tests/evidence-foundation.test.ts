import { describe, expect, it } from 'vitest'
import type { AtomicFact, DictionaryEntry, EvidenceFinalSummary, EvidenceSummaryBatch, EvidenceTranscriptSegment, ValidatedFact } from '@wisploc/shared'
import { buildExplicitTaskFallback, calculateTaskConfidence, createTranscriptChunks, deduplicateFacts, evaluateEvidenceQuality, hasExplicitActionCue, isSubstantiveFact, isTaskContentGrounded, normalizeTerms, preservePartialSummarySections, validateFacts, validateTaskFieldsAgainstEvidence } from '../packages/core/src/evidence'
import { clampWhisperSegments } from '../packages/core/src/whisper'
import { calculateDictionaryHash } from '../packages/core/src/dictionary'

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

  it('uses a stable dictionary hash and invalidates it on a relevant change', () => {
    const reordered = [{ ...entries[0], aliases: ['wisploc', 'висп лок'] }]
    expect(calculateDictionaryHash(entries)).toBe(calculateDictionaryHash(reordered))
    expect(calculateDictionaryHash(entries)).not.toBe(calculateDictionaryHash([{ ...entries[0], canonical: 'WispLoc App' }]))
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
    const segments: EvidenceTranscriptSegment[] = [
      { id: 'segment-0', mediaFileId: 'media-1', startSec: 35, endSec: 40, originalText: 'Обсудили выпуск.', sequence: 0 },
      {
        id: 'segment-1', mediaFileId: 'media-1', startSec: 42.5, endSec: 48.25,
        originalText: 'Алексей, исправь форму авторизации.', sequence: 1,
      },
    ]
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

  it('preserves validated partial summary sections omitted by the final model response', () => {
    const generated: EvidenceFinalSummary = {
      title: 'Обсуждение проекта', summary: 'Участники обсудили дальнейшую работу над проектом.',
      keyPoints: [], decisions: [], problems: [], openQuestions: [], proposals: [],
    }
    const fallback: EvidenceSummaryBatch = {
      keyPoints: [{ text: 'Скрипт сохраняется в проекте', sourceFactIds: ['fact-1'] }],
      decisions: [{ text: 'Удалить устаревшие параметры', sourceFactIds: ['fact-2'] }],
      problems: [], openQuestions: [], proposals: [],
    }

    const result = preservePartialSummarySections(generated, fallback, new Set(['fact-1', 'fact-2']))

    expect(result.keyPoints).toEqual(fallback.keyPoints)
    expect(result.decisions).toEqual(fallback.decisions)
  })

  it('recognizes explicit action wording without promoting cancelled actions', () => {
    const evidence = (quote: string) => [{ quote, startSec: 1, endSec: 2, chunkIndex: 0 }]
    expect(hasExplicitActionCue({ text: 'Нужно спросить у Алексея', evidence: evidence('Нужно спросить у Алексея') })).toBe(true)
    expect(hasExplicitActionCue({ text: 'Добавить настройку', evidence: evidence('Давай добавим настройку, но это отменяется') })).toBe(false)
    expect(hasExplicitActionCue({ text: 'Обсуждается настройка', evidence: evidence('Может быть, когда-нибудь настроим') })).toBe(false)
  })

  it('builds a bounded task fallback only from direct action fact text', () => {
    const base = {
      id: 'fact-1', mediaFileId: 'media-1', type: 'task_candidate' as const,
      evidence: [{ quote: 'Нужно спросить у Алексея.', startSec: 1, endSec: 2, chunkIndex: 0 }],
      sourceFactIds: ['atomic-1'],
    }
    expect(buildExplicitTaskFallback('media-1', { ...base, text: 'Нужно спросить у Алексея' })).toMatchObject({
      title: 'Спросить у Алексея', sourceFactIds: ['fact-1'], explicitAction: true,
    })
    expect(buildExplicitTaskFallback('media-1', { ...base, type: 'question', text: 'Сохраняется ли проект?' })).toBeNull()
    expect(buildExplicitTaskFallback('media-1', { ...base, type: 'statement', text: 'Нужно спросить у Алексея' })).toBeNull()
  })

  it('rejects task text copied from examples when evidence does not support it', () => {
    const source = {
      id: 'fact-1', mediaFileId: 'media-1', type: 'task_candidate' as const,
      text: 'Нужно проверить постоянные обрывы соединения',
      evidence: [{ quote: 'Нужно проверить, почему есть постоянные обрывы соединения.', startSec: 1, endSec: 2, chunkIndex: 0 }],
      sourceFactIds: ['atomic-1'],
    }
    expect(isTaskContentGrounded({ text: 'Подготовить README', title: 'Подготовить README' }, [source])).toBe(false)
    expect(isTaskContentGrounded({ text: 'Проверить обрывы соединения', title: 'Проверить обрывы соединения' }, [source])).toBe(true)
  })

  it('filters conversational noise and reports weak evidence quality', () => {
    const evidence = [{ quote: 'Ну да.', startSec: 1, endSec: 2, chunkIndex: 0 }]
    expect(isSubstantiveFact({
      id: 'fact-1', mediaFileId: 'media-1', type: 'statement', text: 'Ну да', evidence, sourceFactIds: ['a'],
    })).toBe(false)
    const warnings = evaluateEvidenceQuality({
      segments: Array.from({ length: 10 }, (_, index) => ({
        id: `s${index}`, mediaFileId: 'media-1', startSec: index, endSec: index + 1,
        originalText: index === 0 ? 'Решили использовать SQLite.' : 'Продолжаем обсуждение.', sequence: index,
      })),
      totalFactCount: 10,
      validFactCount: 5,
      mergedFacts: [],
      tasks: [],
      summary: null,
      language: 'ru',
    })
    expect(warnings.length).toBeGreaterThanOrEqual(2)
  })

  it('clamps Whisper timestamps to the audio chunk', () => {
    expect(clampWhisperSegments([
      { start: -1, end: 3, text: 'Первый' },
      { start: 9, end: 15, text: 'Последний' },
      { start: 12, end: 14, text: 'За пределами' },
    ], 10)).toEqual([
      { start: 0, end: 3, text: 'Первый' },
      { start: 9, end: 10, text: 'Последний' },
    ])
  })
})
