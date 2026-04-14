import { v4 as uuidv4 } from 'uuid';
import { db } from '../../database/client.js';
import {
  deleteNotebookRowByUserAndId,
  findNotebookRowByUserAndId,
  insertNotebookRow,
  listNotebookRowsByUserAndWorkspace,
  updateNotebookRowByUserAndId,
} from '../../database/repositories/notebooks-repository.js';
import {
  clearNotebookFromTaskRows,
  listTaskRowsByUserAndNotebook,
  listTaskTagRowsByUserAndWorkspace,
} from '../../database/repositories/tasks-repository.js';
import {
  listSummaryPromptRowsByWorkspace,
  updateSummaryPromptRowByWorkspace,
} from '../../database/repositories/summary-prompts-repository.js';
import { syncTaskWorkspaceScope } from '../../lib/search/search-index.js';
import { parseJsonField, type TaskRow } from '../../lib/tasks/task-types.js';
import {
  assertWorkspaceBelongsToUser,
  resolveCurrentWorkspaceForUser,
} from '../../lib/workspaces/workspaces.js';

export class UserNotebookNotFoundError extends Error {
  constructor() {
    super('Notebook not found.');
  }
}

export async function listNotebooksForUser(userId: string) {
  const { currentWorkspaceId } = await resolveCurrentWorkspaceForUser(userId);
  return listNotebookRowsByUserAndWorkspace(userId, currentWorkspaceId);
}

export async function createNotebookForUser(
  userId: string,
  input: { name: string; description?: string | null; color?: string | null },
) {
  const name = String(input.name || '').trim();
  if (!name) {
    throw new Error('Name is required.');
  }
  const { currentWorkspaceId } = await resolveCurrentWorkspaceForUser(userId);

  const notebook = {
    id: uuidv4(),
    userId,
    workspaceId: currentWorkspaceId,
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
  input: { name?: unknown; description?: unknown; color?: unknown; workspaceId?: unknown },
) {
  const notebook = await findNotebookRowByUserAndId(userId, notebookId);
  if (!notebook) {
    throw new UserNotebookNotFoundError();
  }

  const requestedWorkspaceId =
    input.workspaceId !== undefined ? String(input.workspaceId || '').trim() || null : undefined;
  if (requestedWorkspaceId && requestedWorkspaceId !== notebook.workspaceId) {
    await assertWorkspaceBelongsToUser(userId, requestedWorkspaceId);
  }

  const updates = {
    name: input.name ? String(input.name).trim() : notebook.name,
    description: input.description !== undefined ? String(input.description || '') || null : notebook.description,
    color: input.color !== undefined ? String(input.color || '') || null : notebook.color,
    workspaceId: requestedWorkspaceId !== undefined ? requestedWorkspaceId : notebook.workspaceId,
  };

  await updateNotebookRowByUserAndId(userId, notebookId, updates);

  if (requestedWorkspaceId && requestedWorkspaceId !== notebook.workspaceId) {
    const movedTasks = await listTaskRowsByUserAndNotebook(userId, notebookId);
    const sourceWorkspaceId = String(notebook.workspaceId || '');
    const now = Date.now();
    const movedTaskIds = movedTasks.map((task) => task.id);

    if (movedTaskIds.length > 0) {
      await db('tasks')
        .where({ userId, notebookId })
        .update({
          workspaceId: requestedWorkspaceId,
          updatedAt: now,
        });
      await syncTaskWorkspaceScope(movedTaskIds, requestedWorkspaceId);
    }

    if (sourceWorkspaceId) {
      const prompts = await listSummaryPromptRowsByWorkspace(userId, sourceWorkspaceId);
      for (const prompt of prompts) {
        const notebookIds = parseJsonField<string[]>(prompt.notebookIds, []).filter((id) => id !== notebookId);
        if (notebookIds.length !== parseJsonField<string[]>(prompt.notebookIds, []).length) {
          await updateSummaryPromptRowByWorkspace(userId, sourceWorkspaceId, prompt.id, {
            notebookIds: JSON.stringify(notebookIds),
            updatedAt: now,
          });
        }
      }
    }
  }

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
  const { currentWorkspaceId } = await resolveCurrentWorkspaceForUser(userId);
  const tasks = (await listTaskTagRowsByUserAndWorkspace(
    userId,
    currentWorkspaceId,
  )) as Pick<TaskRow, 'tags'>[];
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
