import {
  findNotebookRowByUserAndId,
  listNotebookIdRowsByUser,
  listNotebookIdRowsByUserAndWorkspace,
} from '../database/repositories/notebooks-repository.js';
import { findTaskRowForUser } from '../database/repositories/tasks-repository.js';
import { repairPossiblyMojibakeText } from './text-encoding.js';
import { normalizeSummaryPromptNotebookIds } from './summary-prompts.js';
import { parseJsonField, toTaskResponse, type TaskRow } from './task-types.js';

export class NotebookWorkspaceValidationError extends Error {
  constructor() {
    super('Notebook must belong to the current workspace.');
  }
}

export async function findTaskForUser(userId: string, taskId: string) {
  return findTaskRowForUser(userId, taskId);
}

export async function getValidatedNotebookIdsForUser(userId: string, input: unknown) {
  const requestedIds = normalizeSummaryPromptNotebookIds(input);
  if (!requestedIds.length) {
    return [];
  }

  const rows = await listNotebookIdRowsByUser(userId, requestedIds);
  const validIds = new Set(rows.map((row) => row.id));
  return requestedIds.filter((id) => validIds.has(id));
}

export async function getValidatedNotebookIdsForWorkspace(
  userId: string,
  workspaceId: string,
  input: unknown,
) {
  const requestedIds = normalizeSummaryPromptNotebookIds(input);
  if (!requestedIds.length) {
    return [];
  }

  const rows = await listNotebookIdRowsByUserAndWorkspace(userId, workspaceId, requestedIds);
  const validIds = new Set(rows.map((row) => row.id));
  return requestedIds.filter((id) => validIds.has(id));
}

export async function validateNotebookForWorkspace(
  userId: string,
  workspaceId: string,
  notebookId: string | null | undefined,
) {
  if (!notebookId) {
    return null;
  }

  const notebook = await findNotebookRowByUserAndId(userId, notebookId);
  if (!notebook || notebook.workspaceId !== workspaceId) {
    throw new NotebookWorkspaceValidationError();
  }

  return notebook;
}

export function buildTaskContext(task: TaskRow) {
  return {
    title: repairPossiblyMojibakeText(task.originalName),
    transcript: task.transcript || '',
    language: task.language,
    speakers: parseJsonField(task.speakers, []),
  };
}

export function scoreTask(query: string, task: ReturnType<typeof toTaskResponse>) {
  const normalizedQuery = query.toLowerCase();
  let score = 0;

  if (task.originalName.toLowerCase().includes(normalizedQuery)) {
    score += 5;
  }
  if (task.tags.some((tag) => tag.toLowerCase().includes(normalizedQuery))) {
    score += 4;
  }
  if ((task.summary || '').toLowerCase().includes(normalizedQuery)) {
    score += 3;
  }
  if ((task.transcript || '').toLowerCase().includes(normalizedQuery)) {
    score += 2;
  }
  if ((task.notebookId || '').toLowerCase().includes(normalizedQuery)) {
    score += 1;
  }

  return score;
}
