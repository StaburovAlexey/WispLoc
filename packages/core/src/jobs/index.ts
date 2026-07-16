import type { PipelineVersion, ProcessingJobDto, ProcessingStage, ProcessingStageStatus, JobStatus } from '@wisploc/shared'
import { getPrisma } from '../database'

const prisma = getPrisma()

// In-memory event emitters for SSE
type JobEventListener = (event: JobProgressEvent) => void
const jobListeners = new Map<string, Set<JobEventListener>>()

export interface JobProgressEvent {
  jobId: string
  type: string
  status: JobStatus
  progress: number
  currentStep?: string
  error?: string
  stageStates?: Record<string, ProcessingStageStatus>
  qualityWarnings?: string[]
}

export async function createJob(
  mediaFileId: string,
  type: string,
  options: {
    pipelineVersion?: PipelineVersion
    requestedStages?: ProcessingStage[]
    useDictionary?: boolean
  } = {},
): Promise<ProcessingJobDto> {
  const record = await prisma.processingJob.create({
    data: {
      mediaFileId,
      type,
      status: 'PENDING',
      progress: 0,
      pipelineVersion: options.pipelineVersion ?? 'legacy-v1',
      requestedStagesJson: JSON.stringify(options.requestedStages ?? defaultStages()),
      useDictionary: options.useDictionary ?? false,
      discoverTerms: options.requestedStages?.includes('term-discovery') ?? false,
    },
  })
  return toDto(record)
}

export async function getJob(id: string): Promise<ProcessingJobDto | null> {
  const record = await prisma.processingJob.findUnique({ where: { id } })
  return record ? toDto(record) : null
}

export async function listJobs(mediaFileId?: string): Promise<ProcessingJobDto[]> {
  const records = await prisma.processingJob.findMany({
    where: mediaFileId ? { mediaFileId } : undefined,
    orderBy: { createdAt: 'desc' },
    take: 50,
  })
  return records.map(toDto)
}

export async function updateJobProgress(
  id: string,
  updates: {
    status?: JobStatus
    progress?: number
    currentStep?: string
    errorMessage?: string
  },
): Promise<void> {
  await prisma.processingJob.update({
    where: { id },
    data: {
      status: updates.status,
      progress: updates.progress,
      currentStep: updates.currentStep,
      errorMessage: updates.errorMessage,
    },
  })

  // Emit event to listeners
  const job = await prisma.processingJob.findUnique({ where: { id } })
  if (job) {
    emit(id, {
      jobId: id,
      type: job.type,
      status: job.status as JobStatus,
      progress: job.progress,
      currentStep: job.currentStep ?? undefined,
      error: job.errorMessage ?? undefined,
      stageStates: readStageStates(job.stagesJson),
      qualityWarnings: readStringArray(job.qualityWarningsJson),
    })
  }
}

export async function setJobQualityWarnings(id: string, warnings: string[]): Promise<void> {
  await prisma.processingJob.update({
    where: { id },
    data: { qualityWarningsJson: JSON.stringify([...new Set(warnings)].filter(Boolean)) },
  })
}

export async function retryJob(id: string): Promise<void> {
  const job = await prisma.processingJob.findUnique({ where: { id } })
  if (!job) return

  // Reset FAILED chunks to PENDING so the worker retries them
  if (job.mediaFileId) {
    await prisma.mediaChunk.updateMany({
      where: { mediaFileId: job.mediaFileId, status: 'FAILED' },
      data: { status: 'PENDING', errorMessage: null },
    })
    // Reset media status so it goes through the pipeline again
    await prisma.mediaFile.update({
      where: { id: job.mediaFileId },
      data: { status: 'UPLOADED', errorMessage: null },
    })
  }

  await prisma.processingJob.update({
    where: { id },
    data: {
      status: 'PENDING',
      errorMessage: null,
      qualityWarningsJson: '[]',
      progress: 0,
      currentStep: null,
    },
  })
}

export async function cancelJob(id: string): Promise<void> {
  await prisma.processingJob.update({
    where: { id },
    data: { status: 'CANCELLED' },
  })
  emit(id, { jobId: id, type: 'cancel', status: 'CANCELLED', progress: 0 })
}

// ── SSE helpers ────────────────────────────────────────
export function subscribeToJob(jobId: string, listener: JobEventListener): () => void {
  if (!jobListeners.has(jobId)) {
    jobListeners.set(jobId, new Set())
  }
  jobListeners.get(jobId)!.add(listener)
  return () => {
    jobListeners.get(jobId)?.delete(listener)
  }
}

function emit(jobId: string, event: JobProgressEvent): void {
  const listeners = jobListeners.get(jobId)
  if (listeners) {
    for (const fn of listeners) {
      try { fn(event) } catch { /* disconnected */ }
    }
  }
}

// ── private ────────────────────────────────────────────
function toDto(record: any): ProcessingJobDto {
  return {
    id: record.id,
    mediaFileId: record.mediaFileId,
    type: record.type,
    status: record.status,
    progress: record.progress,
    currentStep: record.currentStep,
    errorMessage: record.errorMessage,
    qualityWarnings: readStringArray(record.qualityWarningsJson),
    startedAt: record.startedAt?.toISOString() ?? null,
    finishedAt: record.finishedAt?.toISOString() ?? null,
    durationMs: record.durationMs ?? null,
    pipelineVersion: record.pipelineVersion ?? 'legacy-v1',
    requestedStages: readRequestedStages(record.requestedStagesJson),
    stageStates: readStageStates(record.stagesJson),
    useDictionary: record.useDictionary ?? false,
    discoverTerms: record.discoverTerms ?? false,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  }
}

function readStringArray(value: string | null | undefined): string[] {
  try {
    const parsed: unknown = JSON.parse(value ?? '[]')
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

function readStageStates(value: string | null | undefined): Record<string, ProcessingStageStatus> {
  try {
    const parsed: unknown = JSON.parse(value ?? '{}')
    return parsed && typeof parsed === 'object' ? parsed as Record<string, ProcessingStageStatus> : {}
  } catch {
    return {}
  }
}

function readRequestedStages(value: string | null | undefined): ProcessingStage[] {
  try {
    const parsed = JSON.parse(value ?? '[]')
    return Array.isArray(parsed) && parsed.length > 0 ? parsed as ProcessingStage[] : defaultStages()
  } catch {
    return defaultStages()
  }
}

function defaultStages(): ProcessingStage[] {
  return ['transcription', 'normalization', 'fact-extraction', 'fact-deduplication', 'tasks', 'summary']
}
