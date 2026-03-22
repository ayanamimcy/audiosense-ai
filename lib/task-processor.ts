import path from 'path';
import { db } from '../db.js';
import { parseAudioWithFallback } from './audio-engine/engine.js';
import { formatTranscriptMarkdown } from './audio-engine/markdown.js';
import { generateTaskSummary, isLlmConfigured } from './llm.js';
import { getDefaultSummaryPromptForNotebook, listSummaryPrompts } from './summary-prompts.js';
import { reindexTask } from './search-index.js';
import { getUserSettings } from './settings.js';
import { parseJsonField, type TaskJobRow, type TaskRow } from './task-types.js';

const configuredUploadDir = process.env.UPLOAD_DIR?.trim();
const uploadDir = path.resolve(configuredUploadDir || path.join(process.cwd(), 'uploads'));

export async function processQueuedJob(job: TaskJobRow) {
  const task = (await db('tasks').where({ id: job.taskId }).first()) as TaskRow | undefined;
  if (!task) {
    throw new Error(`Task ${job.taskId} not found.`);
  }

  const metadata = parseJsonField<Record<string, unknown>>(task.metadata, {});
  const userSettings = task.userId ? await getUserSettings(task.userId) : null;
  const now = Date.now();
  const expectedSpeakers =
    typeof metadata.expectedSpeakers === 'number'
      ? metadata.expectedSpeakers
      : typeof metadata.expectedSpeakers === 'string' && metadata.expectedSpeakers.trim()
        ? Number(metadata.expectedSpeakers)
        : undefined;

  await db('tasks').where({ id: task.id }).update({
    status: 'processing',
    startedAt: now,
    updatedAt: now,
    provider: job.provider || task.provider,
  });

  const { providerName, result, attemptedProviders, skippedProviders } = await parseAudioWithFallback(
    task.userId,
    job.provider || task.provider,
    {
      filePath: path.join(uploadDir, task.filename),
      fileName: task.originalName,
      mimeType: typeof metadata.originalMimeType === 'string' ? metadata.originalMimeType : undefined,
      language: task.language || 'auto',
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

  const transcript = result.text;
  const shouldAutoSummarize = userSettings?.autoGenerateSummary || process.env.AUTO_GENERATE_SUMMARY === 'true';
  const summaryPrompts = task.userId ? await listSummaryPrompts(task.userId) : [];
  const defaultPrompt = getDefaultSummaryPromptForNotebook(summaryPrompts, task.notebookId)?.prompt || null;
  const summary =
    shouldAutoSummarize && isLlmConfigured(userSettings || undefined)
      ? await generateTaskSummary(
          {
            title: task.originalName,
            transcript,
            language: result.language || task.language,
            speakers: result.speakers,
          },
          undefined,
          userSettings || undefined,
          defaultPrompt,
        )
      : null;
  const completedAt = Date.now();

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
    completedAt,
    updatedAt: completedAt,
    metadata: JSON.stringify({
      ...metadata,
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

  const updatedTask = (await db('tasks').where({ id: task.id }).first()) as TaskRow;
  await reindexTask(updatedTask);
}
