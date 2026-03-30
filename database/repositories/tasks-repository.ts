import { db } from '../client.js';
import type { TaskRow } from '../../lib/task-types.js';

export async function findTaskRowById(taskId: string) {
  return (await db('tasks').where({ id: taskId }).first()) as TaskRow | undefined;
}

export async function findTaskRowForUser(userId: string, taskId: string) {
  return (await db('tasks').where({ id: taskId, userId }).first()) as TaskRow | undefined;
}

export async function findTaskRowByFilenameForUser(userId: string, filename: string) {
  return (await db('tasks').where({ userId, filename }).first()) as TaskRow | undefined;
}

export async function listTaskRowsByUser(userId: string) {
  return (await db('tasks').where({ userId }).orderBy('createdAt', 'desc')) as TaskRow[];
}

export async function listTaskTagRowsByUser(userId: string) {
  return (await db('tasks').where({ userId }).select('tags')) as Pick<TaskRow, 'tags'>[];
}

export async function insertTaskRow(row: TaskRow) {
  await db('tasks').insert(row);
}

export async function updateTaskRowById(taskId: string, updates: Partial<TaskRow>) {
  await db('tasks').where({ id: taskId }).update(updates);
}

export async function updateTaskRowForUser(userId: string, taskId: string, updates: Partial<TaskRow>) {
  await db('tasks').where({ id: taskId, userId }).update(updates);
}

export async function clearNotebookFromTaskRows(userId: string, notebookId: string, updatedAt: number) {
  await db('tasks').where({ userId, notebookId }).update({
    notebookId: null,
    updatedAt,
  });
}

export async function deleteTaskRowForUser(userId: string, taskId: string) {
  await db('tasks').where({ id: taskId, userId }).delete();
}
