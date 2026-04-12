import fs from 'fs';
import path from 'path';
import { db } from '../../database/client.js';
import {
  deleteTaskJobRowsByTaskId,
} from '../../database/repositories/task-jobs-repository.js';
import {
  deleteTaskMessageRowsByTaskId,
  listTaskMessageRows,
} from '../../database/repositories/task-messages-repository.js';
import {
  deleteTaskRowForUser,
  listTaskRowsByUserAndIds,
  listTaskRowsByUserAndNotebook,
  updateTaskRowById,
  updateTaskRowForUser,
} from '../../database/repositories/tasks-repository.js';
import { isLlmConfigured } from '../../lib/llm.js';
import { clearTaskIndex, reindexTask, syncTaskWorkspaceScope } from '../../lib/search-index.js';
import { getUserSettings } from '../../lib/settings.js';
import { buildWebVttFromSegments } from '../../lib/subtitles.js';
import {
  buildTagSuggestionMetadata,
  markTaskTagSuggestionsGenerating,
  persistTaskTagSuggestions,
  removeAppliedTagsFromSuggestions,
} from '../../lib/task-tag-suggestions.js';
import { resetTaskDerivedState } from '../../lib/task-derived-state.js';
import {
  findTaskForUser,
  NotebookWorkspaceValidationError,
  validateNotebookForWorkspace,
} from '../../lib/task-helpers.js';
import { repairPossiblyMojibakeText } from '../../lib/text-encoding.js';
import { enqueueTaskJob } from '../../lib/task-queue.js';
import { normalizeTags, parseJsonField, toTaskListResponse, toTaskResponse, type TaskRow } from '../../lib/task-types.js';
import { createUploadTask, type UploadTaskInput } from '../../lib/upload-service.js';
import {
  assertWorkspaceBelongsToUser,
  resolveCurrentWorkspaceForUser,
} from '../../lib/workspaces.js';
import { listTaskRowsByUserAndWorkspace } from '../../database/repositories/tasks-repository.js';

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

export class UserTaskWorkspaceValidationError extends Error {
  constructor(message: string) {
    super(message);
  }
}

export class UserTaskSelectionError extends Error {
  constructor(message: string) {
    super(message);
  }
}

async function syncTaskSearchIndex(previousTask: TaskRow, updatedTask: TaskRow) {
  const workspaceChanged = previousTask.workspaceId !== updatedTask.workspaceId;
  const searchMetadataChanged =
    previousTask.originalName !== updatedTask.originalName ||
    previousTask.summary !== updatedTask.summary ||
    previousTask.tags !== updatedTask.tags;

  if (workspaceChanged && !searchMetadataChanged) {
    await syncTaskWorkspaceScope([updatedTask.id], String(updatedTask.workspaceId || ''));
    return;
  }

  if (updatedTask.status === 'completed' && updatedTask.transcript) {
    await reindexTask(updatedTask);
    return;
  }

  if (workspaceChanged) {
    await clearTaskIndex(updatedTask.id);
  }
}

export async function createUploadTaskForUser(input: UploadTaskInput) {
  try {
    return await createUploadTask(input);
  } catch (error) {
    if (error instanceof NotebookWorkspaceValidationError) {
      throw new UserTaskWorkspaceValidationError(error.message);
    }
    throw error;
  }
}

export async function reprocessTaskForUser(
  userId: string,
  taskId: string,
  options?: { provider?: string | null; language?: string | null },
) {
  const task = await findTaskForUser(userId, taskId);
  if (!task) {
    throw new UserTaskNotFoundError();
  }

  const provider = String(
    options?.provider || task.provider || process.env.TRANSCRIPTION_PROVIDER || 'local-python',
  );
  const updates: Record<string, unknown> = {
    status: 'pending',
    summary: null,
    result: null,
    metadata: resetTaskDerivedState(task),
    updatedAt: Date.now(),
  };
  if (options?.language !== undefined) {
    updates.language = options.language || 'auto';
  }
  await updateTaskRowById(task.id, updates);
  await enqueueTaskJob({ taskId: task.id, userId, provider });
}

export async function listTasksForUser(userId: string) {
  const { currentWorkspaceId } = await resolveCurrentWorkspaceForUser(userId);
  return (await listTaskRowsByUserAndWorkspace(userId, currentWorkspaceId)).map(toTaskListResponse);
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
    workspaceId?: unknown;
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
  const requestedWorkspaceId =
    input.workspaceId !== undefined ? String(input.workspaceId || '').trim() || null : undefined;
  const targetWorkspaceId =
    requestedWorkspaceId !== undefined
      ? requestedWorkspaceId
      : String(task.workspaceId || '').trim() || null;

  if (requestedWorkspaceId) {
    try {
      await assertWorkspaceBelongsToUser(userId, requestedWorkspaceId);
      updates.workspaceId = requestedWorkspaceId;
    } catch (error) {
      throw new UserTaskWorkspaceValidationError(
        error instanceof Error ? error.message : 'Workspace not found.',
      );
    }
  }

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
  if (input.notebookId !== undefined || requestedWorkspaceId !== undefined) {
    try {
      updates.notebookId =
        input.notebookId !== undefined
          ? input.notebookId
            ? String(input.notebookId)
            : null
          : requestedWorkspaceId !== undefined && requestedWorkspaceId !== task.workspaceId
            ? null
            : task.notebookId || null;
      await validateNotebookForWorkspace(
        userId,
        String(targetWorkspaceId || ''),
        updates.notebookId,
      );
    } catch (error) {
      if (error instanceof NotebookWorkspaceValidationError) {
        throw new UserTaskWorkspaceValidationError(error.message);
      }
      throw error;
    }
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

  await syncTaskSearchIndex(task, updatedTask);

  return toTaskResponse(updatedTask);
}

export async function moveTasksToWorkspaceForUser(
  userId: string,
  taskIds: string[],
  workspaceId: string,
) {
  const uniqueTaskIds = [...new Set(taskIds.map((taskId) => String(taskId || '').trim()).filter(Boolean))];
  if (uniqueTaskIds.length === 0) {
    throw new UserTaskSelectionError('At least one task is required.');
  }

  try {
    await assertWorkspaceBelongsToUser(userId, workspaceId);
  } catch (error) {
    throw new UserTaskWorkspaceValidationError(
      error instanceof Error ? error.message : 'Workspace not found.',
    );
  }

  const tasks = await listTaskRowsByUserAndIds(userId, uniqueTaskIds);
  if (tasks.length !== uniqueTaskIds.length) {
    throw new UserTaskSelectionError('One or more tasks were not found.');
  }

  const now = Date.now();
  await db('tasks')
    .where({ userId })
    .whereIn('id', uniqueTaskIds)
    .update({
      workspaceId,
      notebookId: null,
      updatedAt: now,
    });

  await syncTaskWorkspaceScope(uniqueTaskIds, workspaceId);

  return {
    moved: uniqueTaskIds.length,
    workspaceId,
  };
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
