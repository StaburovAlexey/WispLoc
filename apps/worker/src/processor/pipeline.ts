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
  saveChunkSummary,
  saveFinalSummary,
  getChunkSummaries,
  saveExtractedTasks,
  getJob,
  loadConfig,
} from '@wisploc/core'

export async function runPipeline(mediaId: string, jobId: string): Promise<void> {
  await updateJobProgress(jobId, {
    status: 'PROCESSING',
    progress: 5,
    currentStep: 'probing',
  })

  const record = await getMediaRecordRaw(mediaId)
  if (!record) throw new Error('Media not found')

  // 1. Probe
  const probe = await probeMedia(record.sourcePath)
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
    const chunks = await extractChunks(record.sourcePath, chunksDir, chunkSeconds)

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
      if (existingTranscript.trim()) continue // resume support
      await updateChunkStatus(chunk.id, 'PENDING')
    }

    await updateChunkStatus(chunk.id, 'PROCESSING')
    await updateJobProgress(jobId, {
      progress: 30 + Math.round((i / totalChunks) * 50),
      currentStep: `transcribing_chunk_${i + 1}_of_${totalChunks}`,
    })

    try {
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
    } catch (err: any) {
      await updateChunkStatus(chunk.id, 'FAILED', err.message)
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
      continue
    }

    await updateJobProgress(jobId, {
      progress: 80 + Math.round((i / totalChunks) * 8),
      currentStep: `summarizing_chunk_${i + 1}_of_${totalChunks}`,
    })

    try {
      const chunkTranscript = await getChunkTranscriptText(chunk.id)
      if (chunkTranscript) {
        const cs = await summarizeChunk(chunkTranscript, chunk.index, chunk.startSec, chunk.endSec)
        chunkSummaries.push(cs)
        existingChunkSummaries.set(chunk.index, cs)
        await saveChunkSummary(mediaId, cs)
      } else {
        throw new Error(`Chunk ${chunk.index} has no transcript text`)
      }
    } catch (err: any) {
      console.error(`[summarize] Chunk ${chunk.index} failed:`, err)
      throw new Error(`Summary failed for chunk ${chunk.index}: ${err.message ?? String(err)}`)
    }
  }

  if (chunkSummaries.length === 0) {
    throw new Error('No chunk summaries were generated')
  }

  await updateJobProgress(jobId, { progress: 88, currentStep: 'final_summary' })

  // 5. Final summary + extract tasks
  try {
    const finalSummary = await summarizeFinal(chunkSummaries)
    await saveFinalSummary(mediaId, finalSummary)

    await updateJobProgress(jobId, { progress: 93, currentStep: 'extracting_tasks' })
    await updateMediaStatus(mediaId, 'EXTRACTING_TASKS')

    if (finalSummary.actionItems.length > 0) {
      await saveExtractedTasks(mediaId, finalSummary.actionItems)
    }
  } catch (err: any) {
    console.error('[summarize] Final summary failed:', err)
    throw new Error(`Final summary failed: ${err.message ?? String(err)}`)
  }

  await updateJobProgress(jobId, { progress: 98, currentStep: 'finalizing' })

  // 6. Done
  await deleteOriginalIfConfigured(record.sourcePath)
  await updateMediaStatus(mediaId, 'DONE')
  await updateJobProgress(jobId, { status: 'DONE', progress: 100, currentStep: 'done' })
}

async function deleteOriginalIfConfigured(sourcePath: string): Promise<void> {
  const config = loadConfig()
  if (!config.deleteOriginalAfterProcessing) return

  try {
    await fs.rm(sourcePath, { force: true })
  } catch (err) {
    console.warn(`[worker] Failed to delete original uploaded file: ${err}`)
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
