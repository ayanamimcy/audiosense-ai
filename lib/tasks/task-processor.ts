import path from 'path';
import {
  findTaskRowById,
  updateTaskRowByIdWhereStatus,
} from '../../database/repositories/tasks-repository.js';
import { findTaskJobRowById } from '../../database/repositories/task-jobs-repository.js';
import { parseAudioWithFallback } from '../audio-engine/engine.js';
import { formatTranscriptMarkdown } from '../audio-engine/markdown.js';
import { reindexTask } from '../search/search-index.js';
import { getUserSettings, type UserSettings } from '../settings/settings.js';
import { repairPossiblyMojibakeText } from '../shared/text-encoding.js';
import { parseJsonField, type TaskJobRow, type TaskRow } from './task-types.js';
import { runTaskPostProcessing } from './task-post-processing.js';
import config from '../config.js';
import {
  TranscriptionCancelledError,
  throwIfTranscriptionCancelled,
} from '../audio-engine/cancellation.js';

const uploadDir = config.upload.dir;

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
  signal: AbortSignal;
}

// ---------------------------------------------------------------------------
// Phase functions
// ---------------------------------------------------------------------------

async function loadProcessingContext(
  job: TaskJobRow,
  signal: AbortSignal,
): Promise<TaskProcessingContext> {
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
    signal,
  };
}

async function assertJobActive(job: TaskJobRow, signal?: AbortSignal) {
  throwIfTranscriptionCancelled(signal);
  const [currentJob, currentTask] = await Promise.all([
    findTaskJobRowById(job.id),
    findTaskRowById(job.taskId),
  ]);
  if (!currentJob || !currentTask || currentJob.status === 'cancelled' || currentTask.status === 'cancelled') {
    throw new TranscriptionCancelledError();
  }
}

function startCancellationWatcher(job: TaskJobRow, controller: AbortController) {
  let polling = false;
  const timer = setInterval(() => {
    if (polling || controller.signal.aborted) {
      return;
    }
    polling = true;
    void assertJobActive(job, controller.signal)
      .catch((error) => {
        if (error instanceof TranscriptionCancelledError) {
          controller.abort();
        }
      })
      .finally(() => {
        polling = false;
      });
  }, 500);
  timer.unref();
  return () => clearInterval(timer);
}

async function markTaskProcessing(ctx: TaskProcessingContext) {
  const updated = await updateTaskRowByIdWhereStatus(ctx.task.id, ['pending', 'processing', 'blocked'], {
    status: 'processing',
    startedAt: ctx.startedAt,
    updatedAt: ctx.startedAt,
    provider: ctx.provider || ctx.task.provider,
  });
  if (!updated) {
    throw new TranscriptionCancelledError();
  }
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
      requestId: ctx.job.id,
      signal: ctx.signal,
    },
  );
}

async function persistTranscriptionResult(
  ctx: TaskProcessingContext,
  transcriptionResult: Awaited<ReturnType<typeof parseAudioWithFallback>>,
) {
  const { providerName, result, attemptedProviders, skippedProviders } = transcriptionResult;
  const completedAt = Date.now();

  const updated = await updateTaskRowByIdWhereStatus(ctx.task.id, ['processing'], {
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

  if (!updated) {
    throw new TranscriptionCancelledError();
  }

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
  const controller = new AbortController();
  const stopCancellationWatcher = startCancellationWatcher(job, controller);

  try {
    await assertJobActive(job, controller.signal);
    const ctx = await loadProcessingContext(job, controller.signal);

    await assertJobActive(job, controller.signal);
    await markTaskProcessing(ctx);

    const transcriptionResult = await runPrimaryTranscription(ctx);

    await assertJobActive(job, controller.signal);
    const completedAt = await persistTranscriptionResult(ctx, transcriptionResult);

    const completedTask = await finalizePrimaryTask(ctx);

    void runTaskPostProcessing(completedTask, ctx.userSettings, { completedAt });
  } finally {
    stopCancellationWatcher();
  }
}
