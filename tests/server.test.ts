import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const originalHome = process.env.HOME
const originalUserProfile = process.env.USERPROFILE
const originalDatabaseUrl = process.env.DATABASE_URL

afterEach(() => {
  process.env.HOME = originalHome
  process.env.USERPROFILE = originalUserProfile
  process.env.DATABASE_URL = originalDatabaseUrl
  vi.resetModules()
})

describe('api server smoke', () => {
  it('serves shallow health and restricts CORS to local origins', async () => {
    const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'wisploc-api-'))
    process.env.HOME = home
    delete process.env.USERPROFILE
    process.env.DATABASE_URL = `file:${path.join(home, '.wisploc/data/wisploc.db')}`
    vi.resetModules()

    const { createServer } = await import('../apps/api/src/server')
    const app = await createServer()

    try {
      const health = await app.inject({ method: 'GET', url: '/api/health' })
      expect(health.statusCode).toBe(200)
      expect(health.json()).toMatchObject({ status: 'ok' })

      const allowed = await app.inject({
        method: 'GET',
        url: '/api/health',
        headers: { origin: 'http://127.0.0.1:5173' },
      })
      expect(allowed.headers['access-control-allow-origin']).toBe('http://127.0.0.1:5173')

      const denied = await app.inject({
        method: 'GET',
        url: '/api/health',
        headers: { origin: 'http://example.com' },
      })
      expect(denied.headers['access-control-allow-origin']).toBeUndefined()

      const createdTerm = await app.inject({
        method: 'POST', url: '/api/dictionary',
        payload: { canonical: 'WispLoc', aliases: ['висп лок'] },
      })
      expect(createdTerm.statusCode).toBe(200)
      const dictionary = await app.inject({ method: 'GET', url: '/api/dictionary' })
      expect(dictionary.json()).toEqual([expect.objectContaining({ canonical: 'WispLoc', aliases: ['висп лок'] })])

      const { getPrisma } = await import('../packages/core/src/database/index')
      const prisma = getPrisma()
      const sourcePath = path.join(home, '.wisploc/data/uploads/meeting.wav')
      await fsp.mkdir(path.dirname(sourcePath), { recursive: true })
      await fsp.writeFile(sourcePath, '')
      const media = await prisma.mediaFile.create({ data: {
        originalName: 'meeting.wav', mimeType: 'audio/wav', sizeBytes: 100,
        sourcePath, status: 'UPLOADED',
      } })
      const { loadSummaryBatchCheckpoint, saveSummaryBatchCheckpoint } = await import('../packages/core/src/evidence/repository')
      const partialSummary = {
        keyPoints: [{ text: 'Обсудили WispLoc.', sourceFactIds: ['fact-1'] }],
        decisions: [], problems: [], openQuestions: [], proposals: [],
      }
      await saveSummaryBatchCheckpoint({
        mediaFileId: media.id,
        batchIndex: 0,
        inputHash: 'summary-input-hash',
        summary: partialSummary,
        modelName: 'qwen3:4b',
        promptVersion: 'summary-batch-v2',
      })
      await expect(loadSummaryBatchCheckpoint(media.id, 0, 'summary-input-hash')).resolves.toEqual(partialSummary)
      const facts = await app.inject({ method: 'GET', url: `/api/media/${media.id}/facts` })
      expect(facts.statusCode).toBe(200)
      expect(facts.json()).toEqual({ atomic: [], merged: [] })
      const missingFacts = await app.inject({ method: 'GET', url: '/api/media/missing/facts' })
      expect(missingFacts.statusCode).toBe(404)
      const planResponse = await app.inject({
        method: 'POST', url: `/api/media/${media.id}/process-plan`,
        payload: { stages: ['tasks'], useDictionary: false },
      })
      expect(planResponse.statusCode).toBe(200)
      expect(planResponse.json().executionStages).toEqual(['transcription', 'fact-extraction', 'fact-deduplication', 'tasks'])
      const processResponse = await app.inject({
        method: 'POST', url: `/api/media/${media.id}/process`,
        payload: { stages: ['transcription', 'normalization'], useDictionary: true },
      })
      expect(processResponse.statusCode, processResponse.body).toBe(200)
      const job = await prisma.processingJob.findUniqueOrThrow({ where: { id: processResponse.json().jobId } })
      expect(job).toMatchObject({ pipelineVersion: 'evidence-v2', useDictionary: true, discoverTerms: false })
      expect(JSON.parse(job.requestedStagesJson ?? '[]')).toEqual(['transcription', 'normalization'])
    } finally {
      await app.close()
    }
  })
})
