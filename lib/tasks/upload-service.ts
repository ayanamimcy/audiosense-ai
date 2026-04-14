import { v4 as uuidv4 } from 'uuid';
import { insertTaskRow } from '../../database/repositories/tasks-repository.js';
import config from '../config.js';
import { repairPossiblyMojibakeText } from '../shared/text-encoding.js';
import { enqueueTaskJob } from './task-queue.js';
import { getUserSettings } from '../settings/settings.js';
import { validateNotebookForWorkspace } from './task-helpers.js';
import { normalizeTags, type TaskRow } from './task-types.js';
import { resolveCurrentWorkspaceForUser } from '../workspaces/workspaces.js';

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
  const { currentWorkspaceId } = await resolveCurrentWorkspaceForUser(userId);
  const diarizationEnabled =
    body.diarization !== undefined
      ? body.diarization !== 'false'
      : userSettings.enableDiarization !== false;
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
      config.transcription.defaultProvider,
  ).toLowerCase();
  const notebookId = body.notebookId ? String(body.notebookId) : null;

  await validateNotebookForWorkspace(userId, currentWorkspaceId, notebookId);

  const task: TaskRow = {
    id: taskId,
    userId,
    workspaceId: currentWorkspaceId,
    filename: file.filename,
    originalName,
    status: 'pending',
    createdAt: now,
    notebookId,
    tags: JSON.stringify(normalizeTags(body.tags)),
    language: body.language || userSettings.parseLanguage || 'auto',
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

  await insertTaskRow(task);
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
