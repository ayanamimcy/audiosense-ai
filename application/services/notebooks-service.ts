import { v4 as uuidv4 } from 'uuid';
import {
  deleteNotebookRowByUserAndId,
  findNotebookRowByUserAndId,
  insertNotebookRow,
  listNotebookRowsByUser,
  updateNotebookRowByUserAndId,
} from '../../database/repositories/notebooks-repository.js';
import { clearNotebookFromTaskRows, listTaskTagRowsByUser } from '../../database/repositories/tasks-repository.js';
import { parseJsonField, type TaskRow } from '../../lib/task-types.js';

export class UserNotebookNotFoundError extends Error {
  constructor() {
    super('Notebook not found.');
  }
}

export async function listNotebooksForUser(userId: string) {
  return listNotebookRowsByUser(userId);
}

export async function createNotebookForUser(
  userId: string,
  input: { name: string; description?: string | null; color?: string | null },
) {
  const name = String(input.name || '').trim();
  if (!name) {
    throw new Error('Name is required.');
  }

  const notebook = {
    id: uuidv4(),
    userId,
    name,
    description: input.description ? String(input.description).trim() : null,
    color: input.color ? String(input.color).trim() : '#4f46e5',
    createdAt: Date.now(),
  };

  await insertNotebookRow(notebook);
  return notebook;
}

export async function updateNotebookForUser(
  userId: string,
  notebookId: string,
  input: { name?: unknown; description?: unknown; color?: unknown },
) {
  const notebook = await findNotebookRowByUserAndId(userId, notebookId);
  if (!notebook) {
    throw new UserNotebookNotFoundError();
  }

  const updates = {
    name: input.name ? String(input.name).trim() : notebook.name,
    description: input.description !== undefined ? String(input.description || '') || null : notebook.description,
    color: input.color !== undefined ? String(input.color || '') || null : notebook.color,
  };

  await updateNotebookRowByUserAndId(userId, notebookId, updates);
  return findNotebookRowByUserAndId(userId, notebookId);
}

export async function deleteNotebookForUser(userId: string, notebookId: string) {
  const deleted = await deleteNotebookRowByUserAndId(userId, notebookId);
  if (!deleted) {
    throw new UserNotebookNotFoundError();
  }

  await clearNotebookFromTaskRows(userId, notebookId, Date.now());
}

export async function listTagStatsForUser(userId: string) {
  const tasks = (await listTaskTagRowsByUser(userId)) as Pick<TaskRow, 'tags'>[];
  const counts = new Map<string, number>();

  for (const task of tasks) {
    for (const tag of parseJsonField<string[]>(task.tags, [])) {
      counts.set(tag, (counts.get(tag) || 0) + 1);
    }
  }

  return Array.from(counts.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}
