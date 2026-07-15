import { execFile } from 'node:child_process'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const execFileAsync = promisify(execFile)
const originalDatabaseUrl = process.env.DATABASE_URL
const originalHome = process.env.HOME
const originalOllamaModels = process.env.OLLAMA_MODELS
let home: string
let prisma: ReturnType<(typeof import('../packages/core/src/database'))['getPrisma']>
let core: typeof import('../packages/core/src/index')

beforeAll(async () => {
  home = await fsp.mkdtemp(path.join(os.tmpdir(), 'wisploc-evidence-'))
  process.env.DATABASE_URL = `file:${path.join(home, 'evidence.db')}`
  await execFileAsync('pnpm', ['db:push'], {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env },
    timeout: 120_000,
  })
  process.env.HOME = home
  process.env.OLLAMA_MODELS = path.join(home, '.ollama', 'models')
  vi.resetModules()
  core = await import('../packages/core/src/index')
  prisma = core.getPrisma()
}, 120_000)

afterAll(async () => {
  await prisma?.$disconnect()
  process.env.DATABASE_URL = originalDatabaseUrl
  process.env.HOME = originalHome
  process.env.OLLAMA_MODELS = originalOllamaModels
  await fsp.rm(home, { recursive: true, force: true })
})

describe('evidence persistence', () => {
  it('keeps transcript order stable when chunk zero is retranscribed last', async () => {
    const media = await createMedia('resume.wav')
    const chunks = await Promise.all([0, 1, 2].map((index) => prisma.mediaChunk.create({ data: {
      mediaFileId: media.id, index, startSec: index * 10, endSec: index * 10 + 10,
      audioPath: path.join(home, `chunk-${index}.wav`), status: 'DONE',
      transcriptionInputHash: 'same-input',
    } })))

    await core.saveSegments({ mediaFileId: media.id, chunkId: chunks[1].id, segments: [{ start: 10, end: 11, text: 'one' }] })
    await core.saveSegments({ mediaFileId: media.id, chunkId: chunks[2].id, segments: [{ start: 20, end: 21, text: 'two' }] })
    await core.saveSegments({ mediaFileId: media.id, chunkId: chunks[0].id, segments: [{ start: 0, end: 1, text: 'zero' }] })

    expect((await core.getSegments(media.id)).map((segment) => segment.text)).toEqual(['zero', 'one', 'two'])
    expect(await core.canReuseTranscription(chunks[0].id, 'same-input')).toBe(true)
    expect(await core.canReuseTranscription(chunks[0].id, 'changed-input')).toBe(false)

    await core.saveSegments({ mediaFileId: media.id, chunkId: chunks[0].id, segments: [{ start: 0, end: 2, text: 'zero updated' }] })
    const segments = await core.getSegments(media.id)
    expect(segments.map((segment) => segment.text)).toEqual(['zero updated', 'one', 'two'])
    expect(segments.filter((segment) => segment.chunkId === chunks[0].id)).toHaveLength(1)
  })

  it('preserves reviewed, rejected, edited, and exported tasks during regeneration', async () => {
    const media = await createMedia('tasks.wav')
    const job = await createJob(media.id)
    const createTask = (id: string, status: string, title = id, generatedTitle: string | null = title) => prisma.extractedTask.create({ data: {
      id, mediaFileId: media.id, processingJobId: job.id, title, description: `${id} description`, status,
      pipelineVersion: 'evidence-v2', generatedTitle, generatedDescription: `${id} description`,
    } })
    await createTask('replaceable', 'DRAFT')
    await createTask('approved', 'APPROVED')
    await createTask('rejected', 'REJECTED')
    await createTask('edited', 'DRAFT', 'Edited by user', 'Original generated title')
    await createTask('exported', 'DRAFT')
    await prisma.createdExternalTask.create({ data: {
      extractedTaskId: 'exported', provider: 'github', externalId: '42', externalUrl: 'https://github.com/example/repo/issues/42', status: 'created',
    } })

    await core.replaceEvidenceTasks({
      mediaFileId: media.id,
      jobId: job.id,
      modelName: 'qwen3:4b',
      promptVersion: 'task-v1',
      tasks: [{
        id: 'new-candidate', mediaFileId: media.id, title: 'Новая задача', description: 'Проверить результат',
        sourceFactIds: ['fact-1'], evidence: [{ quote: 'Проверить результат.', startSec: 1, endSec: 2, chunkIndex: 0 }],
        explicitAction: true, explicitAssignee: false, explicitDueDate: false,
        confidence: 0.8, status: 'DRAFT', mergedCandidateIds: [],
      }],
    })

    const tasks = await prisma.extractedTask.findMany({ where: { mediaFileId: media.id }, include: { externalTasks: true } })
    expect(tasks.map((task) => task.id)).not.toContain('replaceable')
    expect(tasks.map((task) => task.id)).toEqual(expect.arrayContaining(['approved', 'rejected', 'edited', 'exported']))
    expect(tasks.find((task) => task.id === 'exported')?.externalTasks).toHaveLength(1)
    expect(tasks.some((task) => task.title === 'Новая задача')).toBe(true)
  })

  it('promotes only accepted user corrections into retrieval knowledge', async () => {
    const media = await createMedia('correction.wav')
    const job = await createJob(media.id)
    const pending = await core.createUserCorrection({
      mediaFileId: media.id, processingJobId: job.id, stage: 'task-extraction',
      sourceInput: 'Может быть, когда-нибудь обновим React.',
      generatedOutputJson: '{"tasks":[{"title":"Обновить React"}]}',
      correctedOutputJson: '{"tasks":[]}', evidenceJson: '[]',
    })
    expect((await core.listKnowledgeExamples('task-extraction', 'ru')).some((example) => example.id === `correction:${pending.id}`)).toBe(false)
    const beforeReview = await core.buildRetrievalContext({
      stage: 'task-extraction', language: 'ru', text: 'Может быть, когда-нибудь обновим React.', maxExamples: 4,
    })
    expect(beforeReview.exampleIds).not.toContain(`correction:${pending.id}`)
    await core.reviewUserCorrection(pending.id, 'accepted')
    const examples = await core.listKnowledgeExamples('task-extraction', 'ru')
    expect(examples).toContainEqual(expect.objectContaining({ id: `correction:${pending.id}`, quality: 'reviewed', source: 'user-correction' }))
    const afterReview = await core.buildRetrievalContext({
      stage: 'task-extraction', language: 'ru', text: 'Может быть, когда-нибудь обновим React.', maxExamples: 4,
    })
    expect(afterReview.exampleIds).toContain(`correction:${pending.id}`)
    expect(afterReview.manifestHash).not.toBe(beforeReview.manifestHash)

    const rejected = await core.createUserCorrection({
      mediaFileId: media.id, processingJobId: job.id, stage: 'task-extraction', sourceInput: 'Проверить сборку.',
      generatedOutputJson: '{"tasks":[]}', correctedOutputJson: '{"tasks":[{"title":"Проверить сборку"}]}', evidenceJson: '[]',
    })
    await core.reviewUserCorrection(rejected.id, 'rejected')
    expect((await core.listKnowledgeExamples('task-extraction', 'ru')).some((example) => example.id === `correction:${rejected.id}`)).toBe(false)
  })

  it('retrieves only glossary entries relevant to the current input', async () => {
    const wisploc = await core.createDictionaryEntry({ canonical: 'WispLoc', aliases: ['висп лок'] })
    const react = await core.createDictionaryEntry({ canonical: 'React', aliases: ['реакт'] })
    const context = await core.buildRetrievalContext({
      stage: 'fact-extraction', language: 'ru', text: 'Запусти висп лок и проверь результат.', maxExamples: 2,
    })
    expect(context.glossaryEntryIds).toContain(wisploc.id)
    expect(context.glossaryEntryIds).not.toContain(react.id)
  })

  it('deletes transcript and every evidence artifact with its media record', async () => {
    const media = await createMedia('cascade.wav')
    const job = await createJob(media.id)
    const chunk = await prisma.mediaChunk.create({ data: { mediaFileId: media.id, index: 0, startSec: 0, endSec: 10, audioPath: 'chunk.wav' } })
    const segment = await prisma.transcriptSegment.create({ data: { mediaFileId: media.id, chunkId: chunk.id, startSec: 1, endSec: 2, text: 'Иван, проверь сборку.' } })
    await prisma.normalizedTranscriptSegment.create({ data: {
      mediaFileId: media.id, processingJobId: job.id, segmentId: segment.id, normalizedText: segment.text,
      replacementsJson: '[]', dictionaryHash: 'dictionary', normalizationPromptVersion: 'normalization-v1',
    } })
    await prisma.evidenceTranscriptChunk.create({ data: {
      mediaFileId: media.id, processingJobId: job.id, index: 0, startSec: 1, endSec: 2,
      segmentIdsJson: JSON.stringify([segment.id]), originalText: segment.text, normalizedText: segment.text, inputHash: 'chunk-input',
    } })
    await prisma.atomicFactRecord.create({ data: {
      id: 'cascade-fact', mediaFileId: media.id, processingJobId: job.id, chunkIndex: 0, type: 'task_candidate',
      text: 'Иван должен проверить сборку.', evidenceQuote: segment.text, startSec: 1, endSec: 2,
      explicit: true, validationStatus: 'valid', validationErrorsJson: '[]', promptVersion: 'fact-v1', modelName: 'qwen3:4b',
    } })
    await prisma.mergedFactRecord.create({ data: {
      id: 'cascade-merged', mediaFileId: media.id, processingJobId: job.id, type: 'task_candidate',
      text: 'Иван должен проверить сборку.', evidenceJson: '[]', sourceFactIdsJson: '["cascade-fact"]',
    } })
    await prisma.taskCandidateRecord.create({ data: {
      id: 'cascade-candidate', mediaFileId: media.id, processingJobId: job.id, title: 'Проверить сборку',
      sourceFactIdsJson: '["cascade-merged"]', evidenceJson: '[]', explicitAction: true,
      explicitAssignee: false, explicitDueDate: false,
    } })
    await prisma.factChunkCheckpoint.create({ data: {
      mediaFileId: media.id, chunkIndex: 0, inputHash: 'fact-input', factsJson: '[]', modelName: 'qwen3:4b',
      promptVersion: 'fact-v1', schemaVersion: 'atomic-fact-v1',
    } })
    await prisma.summaryBatchCheckpoint.create({ data: {
      mediaFileId: media.id, processingJobId: job.id, batchIndex: 0, inputHash: 'summary-input',
      summaryJson: '{"keyPoints":[],"decisions":[],"problems":[],"openQuestions":[],"proposals":[]}',
      modelName: 'qwen3:4b', promptVersion: 'summary-v1',
    } })
    await prisma.artifactGeneration.create({ data: {
      mediaFileId: media.id, processingJobId: job.id, stage: 'fact_extraction', inputHash: 'generation-input',
      status: 'completed', pipelineVersion: 'evidence-v2', schemaVersion: 'atomic-fact-v1',
    } })
    await prisma.termSuggestion.create({ data: {
      mediaFileId: media.id, processingJobId: job.id, observedForm: 'реакт', proposedCanonical: 'React',
      aliasesJson: '["реакт"]', occurrenceCount: 1, examplesJson: '[]',
    } })

    await core.deleteMediaRecord(media.id)

    const counts = await Promise.all([
      prisma.mediaFile.count({ where: { id: media.id } }), prisma.mediaChunk.count({ where: { mediaFileId: media.id } }),
      prisma.transcriptSegment.count({ where: { mediaFileId: media.id } }), prisma.normalizedTranscriptSegment.count({ where: { mediaFileId: media.id } }),
      prisma.evidenceTranscriptChunk.count({ where: { mediaFileId: media.id } }), prisma.atomicFactRecord.count({ where: { mediaFileId: media.id } }),
      prisma.mergedFactRecord.count({ where: { mediaFileId: media.id } }), prisma.taskCandidateRecord.count({ where: { mediaFileId: media.id } }),
      prisma.factChunkCheckpoint.count({ where: { mediaFileId: media.id } }), prisma.summaryBatchCheckpoint.count({ where: { mediaFileId: media.id } }),
      prisma.artifactGeneration.count({ where: { mediaFileId: media.id } }), prisma.termSuggestion.count({ where: { mediaFileId: media.id } }),
      prisma.processingJob.count({ where: { mediaFileId: media.id } }),
    ])
    expect(counts).toEqual(Array(counts.length).fill(0))
  })

  it('marks a running stage terminal without discarding completed stage state', async () => {
    const media = await createMedia('stage-state.wav')
    const job = await prisma.processingJob.create({ data: {
      mediaFileId: media.id, type: 'full', status: 'FAILED', pipelineVersion: 'evidence-v2',
      stagesJson: JSON.stringify({ transcription: 'completed', fact_extraction: 'running', tasks: 'pending' }),
    } })
    await core.finishRunningPipelineStages(job.id, 'failed')
    const updated = await core.getJob(job.id)
    expect(updated?.stageStates).toEqual({ transcription: 'completed', fact_extraction: 'failed', tasks: 'pending' })
  })

  it('deletes job-scoped generated artifacts while retaining reviewed outputs', async () => {
    const media = await createMedia('job-delete.wav')
    const job = await createJob(media.id)
    await prisma.evidenceTranscriptChunk.create({ data: {
      mediaFileId: media.id, processingJobId: job.id, index: 0, startSec: 0, endSec: 1,
      segmentIdsJson: '[]', originalText: 'text', normalizedText: 'text', inputHash: 'job-chunk',
    } })
    await prisma.artifactGeneration.create({ data: {
      mediaFileId: media.id, processingJobId: job.id, stage: 'fact_extraction', inputHash: 'job-generation',
      status: 'completed', pipelineVersion: 'evidence-v2', schemaVersion: 'atomic-fact-v1',
    } })
    const summary = await prisma.summary.create({ data: {
      mediaFileId: media.id, processingJobId: job.id, kind: 'final', modelName: 'qwen3:4b', pipelineVersion: 'evidence-v2',
    } })
    const task = await prisma.extractedTask.create({ data: {
      mediaFileId: media.id, processingJobId: job.id, title: 'Reviewed', description: '', status: 'APPROVED', pipelineVersion: 'evidence-v2',
    } })

    await prisma.processingJob.delete({ where: { id: job.id } })

    expect(await prisma.evidenceTranscriptChunk.count({ where: { processingJobId: job.id } })).toBe(0)
    expect(await prisma.artifactGeneration.count({ where: { processingJobId: job.id } })).toBe(0)
    expect((await prisma.summary.findUnique({ where: { id: summary.id } }))?.processingJobId).toBeNull()
    expect((await prisma.extractedTask.findUnique({ where: { id: task.id } }))?.processingJobId).toBeNull()
  })

  it('keeps dictionary knowledge on result cleanup and removes it on reset-all', async () => {
    const media = await createMedia('maintenance.wav')
    const job = await createJob(media.id)
    await prisma.artifactGeneration.create({ data: {
      mediaFileId: media.id, processingJobId: job.id, stage: 'summary', inputHash: 'maintenance-input',
      status: 'completed', pipelineVersion: 'evidence-v2', schemaVersion: 'evidence-summary-v1',
    } })
    const entry = await core.createDictionaryEntry({ canonical: 'FFmpeg', aliases: ['эф эф мпег'] })

    await core.clearProcessedResults()
    expect(await prisma.artifactGeneration.count({ where: { mediaFileId: media.id } })).toBe(0)
    expect(await prisma.dictionaryEntry.findUnique({ where: { id: entry.id } })).not.toBeNull()

    await core.resetAllLocalData({ removeDependencies: false })
    expect(await prisma.dictionaryEntry.count()).toBe(0)
    expect(await prisma.mediaFile.count()).toBe(0)
  })
})

function createMedia(name: string) {
  return prisma.mediaFile.create({ data: {
    originalName: name, mimeType: 'audio/wav', sizeBytes: 10, sourcePath: path.join(home, name), status: 'UPLOADED',
  } })
}

function createJob(mediaFileId: string) {
  return prisma.processingJob.create({ data: {
    mediaFileId, type: 'full', status: 'DONE', pipelineVersion: 'evidence-v2', requestedStagesJson: '["fact-extraction"]',
  } })
}
