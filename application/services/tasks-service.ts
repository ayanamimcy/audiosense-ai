import fs from 'fs';
import path from 'path';
import {
  deleteTaskJobRowsByTaskId,
} from '../../database/repositories/task-jobs-repository.js';
import {
  deleteTaskMessageRowsByTaskId,
  listTaskMessageRows,
} from '../../database/repositories/task-messages-repository.js';
import {
  deleteTaskRowForUser,
  listTaskRowsByUser,
  updateTaskRowById,
  updateTaskRowForUser,
} from '../../database/repositories/tasks-repository.js';
import { isLlmConfigured } from '../../lib/llm.js';
import { clearTaskIndex, reindexTask } from '../../lib/search-index.js';
import { getUserSettings } from '../../lib/settings.js';
import { buildWebVttFromSegments } from '../../lib/subtitles.js';
import {
  buildTagSuggestionMetadata,
  markTaskTagSuggestionsGenerating,
  persistTaskTagSuggestions,
  removeAppliedTagsFromSuggestions,
} from '../../lib/task-tag-suggestions.js';
import { findTaskForUser } from '../../lib/task-helpers.js';
import { repairPossiblyMojibakeText } from '../../lib/text-encoding.js';
import { enqueueTaskJob } from '../../lib/task-queue.js';
import { normalizeTags, parseJsonField, toTaskListResponse, toTaskResponse, type TaskRow } from '../../lib/task-types.js';
import { createUploadTask, type UploadTaskInput } from '../../lib/upload-service.js';

export class UserTaskNotFoundError extends Error {
  constructor() {
    super('Task not found.');
  }
}

export class UserTaskTagSuggestionError extends Error {
  constructor(message: string) {
    super(message);
  }
}

export async function createUploadTaskForUser(input: UploadTaskInput) {
  return createUploadTask(input);
}

export async function reprocessTaskForUser(
  userId: string,
  taskId: string,
  providerOverride?: string | null,
) {
  const task = await findTaskForUser(userId, taskId);
  if (!task) {
    throw new UserTaskNotFoundError();
  }

  const provider = String(
    providerOverride || task.provider || process.env.TRANSCRIPTION_PROVIDER || 'local-python',
  );
  await updateTaskRowById(task.id, {
    status: 'pending',
    summary: null,
    result: null,
    metadata: buildTagSuggestionMetadata(task, {
      status: null,
      error: null,
      requestId: null,
      items: null,
      generatedAt: null,
      dismissedAt: null,
    }),
    updatedAt: Date.now(),
  });
  await enqueueTaskJob({ taskId: task.id, userId, provider });
}

export async function listTasksForUser(userId: string) {
  return (await listTaskRowsByUser(userId)).map(toTaskListResponse);
}

export async function getTaskDetailForUser(userId: string, taskId: string) {
  const task = await findTaskForUser(userId, taskId);
  if (!task) {
    throw new UserTaskNotFoundError();
  }

  return toTaskResponse(task);
}

export async function updateTaskForUser(
  userId: string,
  taskId: string,
  input: {
    originalName?: unknown;
    tags?: unknown;
    notebookId?: unknown;
    eventDate?: unknown;
    summary?: unknown;
  },
) {
  const task = await findTaskForUser(userId, taskId);
  if (!task) {
    throw new UserTaskNotFoundError();
  }

  const updates: Partial<TaskRow> = {
    updatedAt: Date.now(),
  };

  if (input.originalName !== undefined) {
    updates.originalName = repairPossiblyMojibakeText(String(input.originalName || '').trim());
  }
  if (input.tags !== undefined) {
    const nextTags = normalizeTags(input.tags);
    updates.tags = JSON.stringify(nextTags);
    const nextMetadata = removeAppliedTagsFromSuggestions(task, nextTags);
    if (nextMetadata !== task.metadata) {
      updates.metadata = nextMetadata;
    }
  }
  if (input.notebookId !== undefined) {
    updates.notebookId = input.notebookId ? String(input.notebookId) : null;
  }
  if (input.eventDate !== undefined) {
    updates.eventDate = input.eventDate ? Number(input.eventDate) : null;
  }
  if (input.summary !== undefined) {
    updates.summary = input.summary ? String(input.summary) : null;
  }

  await updateTaskRowForUser(userId, task.id, updates);
  const updatedTask = await findTaskForUser(userId, task.id);
  if (!updatedTask) {
    throw new UserTaskNotFoundError();
  }

  if (updatedTask.status === 'completed' && updatedTask.transcript) {
    await reindexTask(updatedTask);
  }

  return toTaskResponse(updatedTask);
}

export async function generateTaskTagSuggestionsForUser(userId: string, taskId: string) {
  const task = await findTaskForUser(userId, taskId);
  if (!task) {
    throw new UserTaskNotFoundError();
  }
  if (task.status !== 'completed' || !task.transcript) {
    throw new UserTaskTagSuggestionError(
      'Tag suggestions are only available for completed tasks with a transcript.',
    );
  }

  const userSettings = await getUserSettings(userId);
  if (!isLlmConfigured(userSettings)) {
    throw new UserTaskTagSuggestionError('LLM is not configured.');
  }

  const requestId = await markTaskTagSuggestionsGenerating(task);
  void persistTaskTagSuggestions(task.id, userSettings, requestId);

  const current = await findTaskForUser(userId, task.id);
  if (!current) {
    throw new UserTaskNotFoundError();
  }

  return toTaskResponse(current);
}

export async function applyTaskTagSuggestionsForUser(
  userId: string,
  taskId: string,
  input: {
    tags?: unknown;
  },
) {
  const task = await findTaskForUser(userId, taskId);
  if (!task) {
    throw new UserTaskNotFoundError();
  }

  const requestedTags = normalizeTags(input.tags);
  if (requestedTags.length === 0) {
    return toTaskResponse(task);
  }

  const nextTags = normalizeTags([
    ...parseJsonField<string[]>(task.tags, []),
    ...requestedTags,
  ]);

  await updateTaskRowForUser(userId, task.id, {
    tags: JSON.stringify(nextTags),
    metadata: buildTagSuggestionMetadata(task, {
      status: null,
      error: null,
      requestId: null,
      items: null,
      generatedAt: null,
      dismissedAt: null,
    }),
    updatedAt: Date.now(),
  });

  const updatedTask = await findTaskForUser(userId, task.id);
  if (!updatedTask) {
    throw new UserTaskNotFoundError();
  }

  if (updatedTask.status === 'completed' && updatedTask.transcript) {
    await reindexTask(updatedTask);
  }

  return toTaskResponse(updatedTask);
}

export async function dismissTaskTagSuggestionsForUser(userId: string, taskId: string) {
  const task = await findTaskForUser(userId, taskId);
  if (!task) {
    throw new UserTaskNotFoundError();
  }

  await updateTaskRowForUser(userId, task.id, {
    metadata: buildTagSuggestionMetadata(task, {
      status: null,
      error: null,
      requestId: null,
      items: null,
      generatedAt: null,
      dismissedAt: Date.now(),
    }),
    updatedAt: Date.now(),
  });

  const updatedTask = await findTaskForUser(userId, task.id);
  if (!updatedTask) {
    throw new UserTaskNotFoundError();
  }

  return toTaskResponse(updatedTask);
}

export async function deleteTaskForUserAndCleanup(userId: string, taskId: string, uploadRoot: string) {
  const task = await findTaskForUser(userId, taskId);
  if (!task) {
    throw new UserTaskNotFoundError();
  }

  const filePath = path.join(uploadRoot, task.filename);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }

  await clearTaskIndex(task.id);
  await deleteTaskJobRowsByTaskId(task.id);
  await deleteTaskMessageRowsByTaskId(task.id);
  await deleteTaskRowForUser(userId, task.id);
}

export async function listTaskMessagesForUser(userId: string, taskId: string) {
  const task = await findTaskForUser(userId, taskId);
  if (!task) {
    throw new UserTaskNotFoundError();
  }

  return listTaskMessageRows(task.id);
}

export async function buildTaskSubtitlesForUser(userId: string, taskId: string) {
  const task = await findTaskForUser(userId, taskId);
  if (!task) {
    throw new UserTaskNotFoundError();
  }

  const segments = parseJsonField(task.segments, []);
  return buildWebVttFromSegments(segments);
}
