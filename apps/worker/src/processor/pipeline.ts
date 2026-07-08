/**
 * WispLoc Processing Pipeline
 *
 * Runs inside the worker process. Called when a PENDING job is claimed.
 */
import fs from 'node:fs/promises'
import {
  getMediaRecordRaw,
  updateMediaDuration,
  updateMediaStatus,
  updateJobProgress,
  probeMedia,
  extractChunks,
  getChunksDir,
  createChunksBatch,
  listChunksByMedia,
  updateChunkStatus,
  updateChunkTranscriptPath,
  transcribeChunk,
  saveSegments,
  saveRawTranscript,
  getChunkTranscriptText,
  summarizeChunk,
  summarizeFinal,
  extractFinalTasks,
  saveChunkSummary,
  saveFinalSummary,
  getChunkSummaries,
  saveExtractedTasks,
  getJob,
  loadConfig,
  createLogger,
} from '@wisploc/core'

const pipelineLog = createLogger('pipeline', 'worker.log')

export async function runPipeline(mediaId: string, jobId: string): Promise<void> {
  pipelineLog.info('pipeline started', { mediaId, jobId })
  await updateJobProgress(jobId, {
    status: 'PROCESSING',
    progress: 5,
    currentStep: 'probing',
  })

  const record = await getMediaRecordRaw(mediaId)
  if (!record) throw new Error('Media not found')
  pipelineLog.info('media loaded for pipeline', {
    mediaId,
    jobId,
    sourcePath: record.sourcePath,
    sizeBytes: record.sizeBytes,
    status: record.status,
  })

  // 1. Probe
  const probe = await probeMedia(record.sourcePath)
  pipelineLog.info('media probed', {
    mediaId,
    jobId,
    durationSec: probe.durationSec,
    audioCodec: probe.audioCodec,
    videoCodec: probe.videoCodec,
  })
  if (probe.durationSec) {
    await updateMediaDuration(mediaId, probe.durationSec)
  }
  await updateJobProgress(jobId, { progress: 10, currentStep: 'extracting_audio' })
  await updateMediaStatus(mediaId, 'EXTRACTING_AUDIO')

  // 2. Extract chunks — skip if chunks already exist (retry/resume)
  let dbChunks = await listChunksByMedia(mediaId)
  if (dbChunks.length === 0) {
    const chunksDir = await getChunksDir(mediaId)
    const config = loadConfig()
    const chunkSeconds = Math.max(60, Math.round(config.chunkMinutes * 60))
    pipelineLog.info('audio chunk extraction started', {
      mediaId,
      jobId,
      chunksDir,
      chunkSeconds,
    })
    const chunks = await extractChunks(record.sourcePath, chunksDir, chunkSeconds)
    pipelineLog.info('audio chunk extraction completed', {
      mediaId,
      jobId,
      chunkCount: chunks.length,
    })

    await createChunksBatch(
      chunks.map((c) => ({
        mediaFileId: mediaId,
        index: c.index,
        startSec: c.startSec,
        endSec: probe.durationSec ? Math.min(c.endSec, probe.durationSec) : c.endSec,
        audioPath: c.audioPath,
      })),
    )
    dbChunks = await listChunksByMedia(mediaId)
  } else {
    pipelineLog.info('existing chunks reused', { mediaId, jobId, chunkCount: dbChunks.length })
  }

  await updateJobProgress(jobId, { progress: 30, currentStep: 'transcribing' })
  await updateMediaStatus(mediaId, 'TRANSCRIBING')

  const totalChunks = dbChunks.length
  if (totalChunks === 0) {
    throw new Error('FFmpeg did not produce any audio chunks')
  }

  // 3. Transcribe each chunk sequentially (skip already-DONE chunks)
  for (let i = 0; i < totalChunks; i++) {
    await throwIfCancelled(jobId)
    const chunk = dbChunks[i]
    if (chunk.status === 'DONE') {
      const existingTranscript = await getChunkTranscriptText(chunk.id)
      if (existingTranscript.trim()) {
        pipelineLog.info('transcription chunk reused', {
          mediaId,
          jobId,
          chunkId: chunk.id,
          chunkIndex: chunk.index,
        })
        continue // resume support
      }
      await updateChunkStatus(chunk.id, 'PENDING')
    }

    await updateChunkStatus(chunk.id, 'PROCESSING')
    await updateJobProgress(jobId, {
      progress: 30 + Math.round((i / totalChunks) * 50),
      currentStep: `transcribing_chunk_${i + 1}_of_${totalChunks}`,
    })

    try {
      pipelineLog.info('transcription chunk started', {
        mediaId,
        jobId,
        chunkId: chunk.id,
        chunkIndex: chunk.index,
      })
      const result = await transcribeChunk(chunk.audioPath)
      if (result.segments.length === 0 || !result.text.trim()) {
        throw new Error('whisper-cli produced no transcript segments')
      }
      await saveSegments({
        mediaFileId: mediaId,
        chunkId: chunk.id,
        segments: result.segments.map((segment) => ({
          ...segment,
          start: chunk.startSec + segment.start,
          end: chunk.startSec + segment.end,
        })),
      })
      const transcriptPath = await saveRawTranscript(mediaId, chunk.index, result.rawOutput)
      await updateChunkTranscriptPath(chunk.id, transcriptPath)
      await updateChunkStatus(chunk.id, 'DONE')
      pipelineLog.info('transcription chunk completed', {
        mediaId,
        jobId,
        chunkId: chunk.id,
        chunkIndex: chunk.index,
        segmentsCount: result.segments.length,
        textLength: result.text.length,
      })
    } catch (err: any) {
      await updateChunkStatus(chunk.id, 'FAILED', err.message)
      pipelineLog.error('transcription chunk failed', {
        mediaId,
        jobId,
        chunkId: chunk.id,
        chunkIndex: chunk.index,
        error: err,
      })
      throw new Error(`Transcription failed for chunk ${chunk.index}: ${err.message ?? String(err)}`)
    }
  }

  dbChunks = await listChunksByMedia(mediaId)

  await updateJobProgress(jobId, { progress: 80, currentStep: 'summarizing' })
  await updateMediaStatus(mediaId, 'SUMMARIZING')

  // 4. Summarize each chunk transcript. Existing chunk summaries are reused per chunk.
  const existingChunkSummaries = await loadExistingChunkSummariesByIndex(mediaId)
  const chunkSummaries: Awaited<ReturnType<typeof summarizeChunk>>[] = []
  for (let i = 0; i < totalChunks; i++) {
    await throwIfCancelled(jobId)
    const chunk = dbChunks[i]
    if (chunk.status !== 'DONE') continue

    const existingSummary = existingChunkSummaries.get(chunk.index)
    if (existingSummary) {
      chunkSummaries.push(existingSummary)
      pipelineLog.info('chunk summary reused', {
        mediaId,
        jobId,
        chunkId: chunk.id,
        chunkIndex: chunk.index,
      })
      continue
    }

    await updateJobProgress(jobId, {
      progress: 80 + Math.round((i / totalChunks) * 8),
      currentStep: `summarizing_chunk_${i + 1}_of_${totalChunks}`,
    })

    try {
      const chunkTranscript = await getChunkTranscriptText(chunk.id)
      if (chunkTranscript) {
        pipelineLog.info('chunk summary started', {
          mediaId,
          jobId,
          chunkId: chunk.id,
          chunkIndex: chunk.index,
          transcriptLength: chunkTranscript.length,
        })
        const cs = await summarizeChunk(chunkTranscript, chunk.index, chunk.startSec, chunk.endSec)
        chunkSummaries.push(cs)
        existingChunkSummaries.set(chunk.index, cs)
        await saveChunkSummary(mediaId, cs)
        pipelineLog.info('chunk summary completed', {
          mediaId,
          jobId,
          chunkId: chunk.id,
          chunkIndex: chunk.index,
          actionItemsCount: cs.actionItems.length,
        })
      } else {
        throw new Error(`Chunk ${chunk.index} has no transcript text`)
      }
    } catch (err: any) {
      console.error(`[summarize] Chunk ${chunk.index} failed:`, err)
      pipelineLog.error('chunk summary failed', {
        mediaId,
        jobId,
        chunkId: chunk.id,
        chunkIndex: chunk.index,
        error: err,
      })
      throw new Error(`Summary failed for chunk ${chunk.index}: ${err.message ?? String(err)}`)
    }
  }

  if (chunkSummaries.length === 0) {
    throw new Error('No chunk summaries were generated')
  }

  await updateJobProgress(jobId, { progress: 88, currentStep: 'final_summary' })

  // 5. Final summary + extract tasks
  try {
    pipelineLog.info('final summary started', { mediaId, jobId, chunkSummariesCount: chunkSummaries.length })
    const finalSummary = await summarizeFinal(chunkSummaries)
    pipelineLog.info('final summary completed', { mediaId, jobId })

    await updateJobProgress(jobId, { progress: 93, currentStep: 'extracting_tasks' })
    await updateMediaStatus(mediaId, 'EXTRACTING_TASKS')

    pipelineLog.info('task extraction started', { mediaId, jobId })
    const actionItems = await extractFinalTasks(finalSummary, chunkSummaries)
    pipelineLog.info('task extraction completed', { mediaId, jobId, actionItemsCount: actionItems.length })
    const summaryWithTasks = {
      ...finalSummary,
      actionItems,
    }

    await saveFinalSummary(mediaId, summaryWithTasks)

    if (actionItems.length > 0) {
      await saveExtractedTasks(mediaId, actionItems)
    }
  } catch (err: any) {
    console.error('[summarize] Final summary failed:', err)
    pipelineLog.error('final summary or task extraction failed', { mediaId, jobId, error: err })
    throw new Error(`Final summary failed: ${err.message ?? String(err)}`)
  }

  await updateJobProgress(jobId, { progress: 98, currentStep: 'finalizing' })

  // 6. Done
  await deleteOriginalIfConfigured(record.sourcePath)
  await updateMediaStatus(mediaId, 'DONE')
  await updateJobProgress(jobId, { status: 'DONE', progress: 100, currentStep: 'done' })
  pipelineLog.info('pipeline completed', { mediaId, jobId })
}

async function deleteOriginalIfConfigured(sourcePath: string): Promise<void> {
  const config = loadConfig()
  if (!config.deleteOriginalAfterProcessing) return

  try {
    await fs.rm(sourcePath, { force: true })
    pipelineLog.info('original uploaded file deleted after processing', { sourcePath })
  } catch (err) {
    console.warn(`[worker] Failed to delete original uploaded file: ${err}`)
    pipelineLog.warn('original uploaded file deletion failed', { sourcePath, error: err })
  }
}

async function loadExistingChunkSummariesByIndex(
  mediaId: string,
): Promise<Map<number, Awaited<ReturnType<typeof summarizeChunk>>>> {
  const existing = await getChunkSummaries(mediaId)
  const chunkSummaries = existing.filter((summary) => summary.kind === 'chunk')
  const byIndex = new Map<number, Awaited<ReturnType<typeof summarizeChunk>>>()

  for (const summary of chunkSummaries) {
    const chunkIndex = typeof summary.chunkIndex === 'number' ? summary.chunkIndex : byIndex.size
    byIndex.set(chunkIndex, {
      chunkIndex,
      startSec: 0,
      endSec: 0,
      summary: summary.shortSummary ?? '',
      keyPoints: summary.keyPoints,
      decisions: summary.decisions,
      risks: summary.risks,
      openQuestions: summary.openQuestions,
      actionItems: summary.actionItems,
    })
  }

  return byIndex
}

async function throwIfCancelled(jobId: string): Promise<void> {
  const job = await getJob(jobId)
  if (job?.status === 'CANCELLED') {
    throw new Error('Job cancelled')
  }
}
