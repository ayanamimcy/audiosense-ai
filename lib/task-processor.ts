import path from 'path';
import { db } from '../db.js';
import { generateTaskSummary, isLlmConfigured } from './llm.js';
import { transcribeWithFallback } from './provider-routing.js';
import { reindexTask } from './search-index.js';
import { getUserSettings } from './settings.js';
import { formatTranscriptMarkdown } from './transcription.js';
import { parseJsonField, type TaskJobRow, type TaskRow } from './task-types.js';

const uploadDir = path.join(process.cwd(), 'uploads');

export async function processQueuedJob(job: TaskJobRow) {
  const task = (await db('tasks').where({ id: job.taskId }).first()) as TaskRow | undefined;
  if (!task) {
    throw new Error(`Task ${job.taskId} not found.`);
  }

  const metadata = parseJsonField<Record<string, unknown>>(task.metadata, {});
  const userSettings = task.userId ? await getUserSettings(task.userId) : null;
  const now = Date.now();

  await db('tasks').where({ id: task.id }).update({
    status: 'processing',
    startedAt: now,
    updatedAt: now,
    provider: job.provider || task.provider,
  });

  const { providerName, result } = await transcribeWithFallback(task.userId, job.provider || task.provider, {
    filePath: path.join(uploadDir, task.filename),
    language: task.language || 'auto',
    diarization: metadata.diarization !== false,
  });

  const transcript = result.text;
  const shouldAutoSummarize = userSettings?.autoGenerateSummary || process.env.AUTO_GENERATE_SUMMARY === 'true';
  const summary =
    shouldAutoSummarize && isLlmConfigured()
      ? await generateTaskSummary(
          {
            title: task.originalName,
            transcript,
            language: result.language || task.language,
            speakers: result.speakers,
          },
          'Summarize this transcript with overview, key insights, and action items.',
        )
      : null;

  await db('tasks').where({ id: task.id }).update({
    status: 'completed',
    result: formatTranscriptMarkdown(result),
    transcript,
    summary,
    segments: JSON.stringify(result.segments),
    speakers: JSON.stringify(result.speakers),
    language: result.language || task.language,
    provider: providerName,
    durationSeconds: result.durationSeconds || null,
    completedAt: Date.now(),
    updatedAt: Date.now(),
    metadata: JSON.stringify({
      ...metadata,
      completedAt: Date.now(),
      finalProvider: providerName,
    }),
  });

  const updatedTask = (await db('tasks').where({ id: task.id }).first()) as TaskRow;
  await reindexTask(updatedTask);
}
