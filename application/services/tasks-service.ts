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
import { clearTaskIndex, reindexTask } from '../../lib/search-index.js';
import { findTaskForUser } from '../../lib/task-helpers.js';
import { repairPossiblyMojibakeText } from '../../lib/text-encoding.js';
import { enqueueTaskJob } from '../../lib/task-queue.js';
import { normalizeTags, toTaskListResponse, toTaskResponse, type TaskRow } from '../../lib/task-types.js';
import { createUploadTask, type UploadTaskInput } from '../../lib/upload-service.js';

export class UserTaskNotFoundError extends Error {
  constructor() {
    super('Task not found.');
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
    updates.tags = JSON.stringify(normalizeTags(input.tags));
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
