import { db } from '../client.js';

export interface NotebookRow {
  id: string;
  userId: string;
  workspaceId?: string | null;
  name: string;
  description?: string | null;
  color?: string | null;
  createdAt: number;
}

export async function listNotebookRowsByUser(userId: string) {
  return (await db('notebooks').where({ userId }).orderBy('createdAt', 'desc')) as NotebookRow[];
}

export async function listNotebookRowsByUserAndWorkspace(userId: string, workspaceId: string) {
  return (await db('notebooks')
    .where({ userId, workspaceId })
    .orderBy('createdAt', 'desc')) as NotebookRow[];
}

export async function listNotebookIdRowsByUser(userId: string, requestedIds: string[]) {
  return (await db('notebooks').where({ userId }).whereIn('id', requestedIds).select('id')) as Array<{
    id: string;
  }>;
}

export async function listNotebookIdRowsByUserAndWorkspace(
  userId: string,
  workspaceId: string,
  requestedIds: string[],
) {
  return (await db('notebooks')
    .where({ userId, workspaceId })
    .whereIn('id', requestedIds)
    .select('id')) as Array<{ id: string }>;
}

export async function findNotebookRowByUserAndId(userId: string, notebookId: string) {
  return (await db('notebooks').where({ id: notebookId, userId }).first()) as NotebookRow | undefined;
}

export async function insertNotebookRow(row: NotebookRow) {
  await db('notebooks').insert(row);
}

export async function updateNotebookRowByUserAndId(
  userId: string,
  notebookId: string,
  updates: Partial<NotebookRow>,
) {
  await db('notebooks').where({ id: notebookId, userId }).update(updates);
}

export async function deleteNotebookRowByUserAndId(userId: string, notebookId: string) {
  return db('notebooks').where({ id: notebookId, userId }).delete();
}
