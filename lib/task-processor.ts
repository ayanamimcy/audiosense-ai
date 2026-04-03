import path from 'path';
import {
  findTaskRowById,
  updateTaskRowById,
} from '../database/repositories/tasks-repository.js';
import { parseAudioWithFallback } from './audio-engine/engine.js';
import { formatTranscriptMarkdown } from './audio-engine/markdown.js';
import { reindexTask } from './search-index.js';
import { getUserSettings, type UserSettings } from './settings.js';
import { repairPossiblyMojibakeText } from './text-encoding.js';
import { parseJsonField, type TaskJobRow, type TaskRow } from './task-types.js';
import { runTaskPostProcessing } from './task-post-processing.js';

const configuredUploadDir = process.env.UPLOAD_DIR?.trim();
const uploadDir = path.resolve(configuredUploadDir || path.join(process.cwd(), 'uploads'));

// ---------------------------------------------------------------------------
// Processing context — collects everything the pipeline stages need
// ---------------------------------------------------------------------------

interface TaskProcessingContext {
  task: TaskRow;
  userId: string | null;
  userSettings: Partial<UserSettings> | null;
  provider: string;
  job: TaskJobRow;
  metadata: Record<string, unknown>;
  displayName: string;
  startedAt: number;
}

// ---------------------------------------------------------------------------
// Phase functions
// ---------------------------------------------------------------------------

async function loadProcessingContext(job: TaskJobRow): Promise<TaskProcessingContext> {
  const task = (await findTaskRowById(job.taskId)) as TaskRow | undefined;
  if (!task) {
    throw new Error(`Task ${job.taskId} not found.`);
  }

  const metadata = parseJsonField<Record<string, unknown>>(task.metadata, {});
  const displayName = repairPossiblyMojibakeText(task.originalName);
  const userId = task.userId ?? null;
  const userSettings = userId ? await getUserSettings(userId) : null;
  const provider = job.provider || task.provider || '';

  return {
    task,
    userId,
    userSettings,
    provider,
    job,
    metadata,
    displayName,
    startedAt: Date.now(),
  };
}

async function markTaskProcessing(ctx: TaskProcessingContext) {
  await updateTaskRowById(ctx.task.id, {
    status: 'processing',
    startedAt: ctx.startedAt,
    updatedAt: ctx.startedAt,
    provider: ctx.provider || ctx.task.provider,
  });
}

async function runPrimaryTranscription(ctx: TaskProcessingContext) {
  const { metadata } = ctx;
  const expectedSpeakers =
    typeof metadata.expectedSpeakers === 'number'
      ? metadata.expectedSpeakers
      : typeof metadata.expectedSpeakers === 'string' && (metadata.expectedSpeakers as string).trim()
        ? Number(metadata.expectedSpeakers)
        : undefined;

  return parseAudioWithFallback(
    ctx.userId ?? undefined,
    ctx.provider,
    {
      filePath: path.join(uploadDir, ctx.task.filename),
      fileName: ctx.displayName,
      mimeType: typeof metadata.originalMimeType === 'string' ? metadata.originalMimeType : undefined,
      language: ctx.task.language || 'auto',
      diarization: metadata.diarization !== false,
      wordTimestamps: metadata.wordTimestamps === true || metadata.diarization !== false,
      task: metadata.translationEnabled === true ? 'translate' : 'transcribe',
      translationTargetLanguage:
        typeof metadata.translationTargetLanguage === 'string' ? metadata.translationTargetLanguage : undefined,
      expectedSpeakers:
        typeof expectedSpeakers === 'number' && Number.isFinite(expectedSpeakers) && expectedSpeakers > 0
          ? expectedSpeakers
          : undefined,
    },
  );
}

async function persistTranscriptionResult(
  ctx: TaskProcessingContext,
  transcriptionResult: Awaited<ReturnType<typeof parseAudioWithFallback>>,
) {
  const { providerName, result, attemptedProviders, skippedProviders } = transcriptionResult;
  const completedAt = Date.now();

  await updateTaskRowById(ctx.task.id, {
    status: 'completed',
    result: formatTranscriptMarkdown(result),
    transcript: result.text,
    summary: null,
    segments: JSON.stringify(result.segments),
    speakers: JSON.stringify(result.speakers),
    language: result.language || ctx.task.language,
    provider: providerName,
    durationSeconds: result.durationSeconds || null,
    completedAt,
    updatedAt: completedAt,
    metadata: JSON.stringify({
      ...ctx.metadata,
      completedAt,
      finalProvider: providerName,
      attemptedProviders,
      skippedProviders,
      media: result.metadata.media,
      analysisMode: result.metadata.analysisMode,
      warnings: result.metadata.warnings,
      detected: result.metadata.detected,
    }),
  });

  return completedAt;
}

async function finalizePrimaryTask(ctx: TaskProcessingContext) {
  const updatedTask = (await findTaskRowById(ctx.task.id)) as TaskRow;
  await reindexTask(updatedTask);
  return updatedTask;
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export async function processQueuedJob(job: TaskJobRow) {
  // 1. Load context
  const ctx = await loadProcessingContext(job);

  // 2. Mark processing
  await markTaskProcessing(ctx);

  // 3. Run transcription
  const transcriptionResult = await runPrimaryTranscription(ctx);

  // 4. Persist result & mark completed
  const completedAt = await persistTranscriptionResult(ctx, transcriptionResult);

  // 5. Finalize (reindex)
  const completedTask = await finalizePrimaryTask(ctx);

  // 6. Post-processing (summary, tag suggestions) — errors here never fail the task
  await runTaskPostProcessing(completedTask, ctx.userSettings, { completedAt });
}
