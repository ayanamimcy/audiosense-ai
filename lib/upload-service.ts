import { v4 as uuidv4 } from 'uuid';
import { db } from '../db.js';
import { repairPossiblyMojibakeText } from './text-encoding.js';
import { enqueueTaskJob } from './task-queue.js';
import { getUserSettings } from './settings.js';
import { normalizeTags, type TaskRow } from './task-types.js';

export interface UploadTaskInput {
  userId: string;
  file: {
    filename: string;
    originalname: string;
    mimetype: string;
    size: number;
  };
  body: {
    originalName?: string;
    diarization?: string;
    wordTimestamps?: string;
    translationEnabled?: string;
    translationTargetLanguage?: string;
    expectedSpeakers?: string;
    provider?: string;
    notebookId?: string;
    tags?: unknown;
    language?: string;
    sourceType?: string;
    eventDate?: string;
  };
}

export async function createUploadTask(input: UploadTaskInput) {
  const { userId, file, body } = input;
  const now = Date.now();
  const taskId = uuidv4();
  const userSettings = await getUserSettings(userId);
  const diarizationEnabled = body.diarization !== 'false';
  const wordTimestampsEnabled = body.wordTimestamps === 'true';
  const translationEnabled = body.translationEnabled === 'true';
  const translationTargetLanguage = body.translationTargetLanguage
    ? String(body.translationTargetLanguage).trim()
    : null;
  const parsedExpectedSpeakers =
    body.expectedSpeakers !== undefined && body.expectedSpeakers !== ''
      ? Number(body.expectedSpeakers)
      : null;
  const expectedSpeakers = Number.isFinite(parsedExpectedSpeakers) ? parsedExpectedSpeakers : null;
  const originalName = repairPossiblyMojibakeText(
    body.originalName?.trim() || file.originalname,
  );
  const provider = String(
    body.provider ||
      userSettings.defaultProvider ||
      process.env.TRANSCRIPTION_PROVIDER ||
      'local-python',
  ).toLowerCase();

  const task: TaskRow = {
    id: taskId,
    userId,
    filename: file.filename,
    originalName,
    status: 'pending',
    createdAt: now,
    notebookId: body.notebookId || null,
    tags: JSON.stringify(normalizeTags(body.tags)),
    language: body.language || 'auto',
    provider,
    sourceType: body.sourceType || 'upload',
    eventDate: body.eventDate ? Number(body.eventDate) : now,
    metadata: JSON.stringify({
      diarization: diarizationEnabled,
      wordTimestamps: wordTimestampsEnabled,
      translationEnabled,
      translationTargetLanguage,
      expectedSpeakers,
      originalMimeType: file.mimetype,
      size: file.size,
    }),
    updatedAt: now,
  };

  await db('tasks').insert(task);
  await enqueueTaskJob({
    taskId,
    userId,
    provider,
    payload: {
      language: task.language,
      diarization: diarizationEnabled,
      wordTimestamps: wordTimestampsEnabled,
      task: translationEnabled ? 'translate' : 'transcribe',
      translationTargetLanguage,
      expectedSpeakers,
    },
  });

  return taskId;
}
