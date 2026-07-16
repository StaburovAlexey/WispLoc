# Evidence Pipeline Audit

## Current flow

`POST /api/media/upload` streams media into `~/.wisploc/data/uploads` and creates a `MediaFile`. `POST /api/media/:id/process` creates a SQLite-backed `ProcessingJob`. The worker probes media, uses FFmpeg to create fixed-duration WAV files, transcribes each WAV with `whisper-cli`, persists segments, summarizes every audio chunk with Ollama, generates a final summary, extracts tasks, and stores all generated tasks as `DRAFT`.

## Current schemas

- `TranscriptSegment` stores `text`, timestamps, an optional audio chunk ID, and no stable sequence.
- `MediaChunk` stores audio chunk timestamps and paths and is also used as the LLM chunk boundary.
- `Summary` stores legacy summary sections as scalar and JSON columns.
- `ExtractedTask` stores review state, but evidence is limited to an optional timecode and chunk index.
- Ollama output is validated with shared Zod schemas and receives one JSON repair attempt.

## Current persistence

SQLite is accessed through Prisma. Runtime setup also applies idempotent `CREATE TABLE IF NOT EXISTS` statements from `packages/core/src/database/index.ts`. Completed transcript chunks and chunk summaries are reused after a failure. Intermediate facts, validation results, prompt versions, input hashes, per-run dictionary options, and evidence chains are not currently persisted.

## Current API

- media upload/list/detail/delete/process/cancel;
- jobs list/detail/retry/cancel/events;
- transcript, summary, tasks, settings, setup, maintenance, and GitHub integration routes;
- job and setup progress use SSE.

The process endpoint currently accepts no per-run options.

## Current UI dependencies

- Media cards trigger processing directly and have no dictionary controls.
- Transcript reads legacy `text` and displays timestamped segments.
- Summary reads legacy summary fields.
- Tasks supports inline editing and explicit `DRAFT` approval/rejection before GitHub issue creation.
- Navigation and pages use React, HeroUI, `PageShell`, and the existing dark theme.

## Migration risks

1. Existing transcript, summary, and task records must remain readable.
2. Audio chunks cannot be silently reinterpreted as overlapping transcript chunks.
3. Runtime SQL and Prisma schema must evolve together.
4. Existing completed chunks may contain valid text but incomplete segment timing; resume must validate restored ranges.
5. Evidence-v2 must not reuse legacy chunk summaries as validated facts.
6. New task evidence must coexist with legacy `sourceTimecode` and `sourceChunkIndex`.
7. qwen3:4b calls must remain sequential and bounded for weak devices.

