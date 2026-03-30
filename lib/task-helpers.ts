import { db } from '../db.js';
import { repairPossiblyMojibakeText } from './text-encoding.js';
import { normalizeSummaryPromptNotebookIds } from './summary-prompts.js';
import { parseJsonField, toTaskResponse, type TaskRow } from './task-types.js';

export async function findTaskForUser(userId: string, taskId: string) {
  return (await db('tasks').where({ id: taskId, userId }).first()) as TaskRow | undefined;
}

export async function getValidatedNotebookIdsForUser(userId: string, input: unknown) {
  const requestedIds = normalizeSummaryPromptNotebookIds(input);
  if (!requestedIds.length) {
    return [];
  }

  const rows = (await db('notebooks').where({ userId }).whereIn('id', requestedIds).select('id')) as Array<{
    id: string;
  }>;
  const validIds = new Set(rows.map((row) => row.id));
  return requestedIds.filter((id) => validIds.has(id));
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
