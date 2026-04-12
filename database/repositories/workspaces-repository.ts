import { db } from '../client.js';

export interface WorkspaceRow {
  id: string;
  userId: string;
  name: string;
  description?: string | null;
  color?: string | null;
  createdAt: number;
  updatedAt: number;
}

export async function listWorkspaceRowsByUser(userId: string) {
  return (await db('workspaces')
    .where({ userId })
    .orderBy([{ column: 'updatedAt', order: 'desc' }, { column: 'createdAt', order: 'desc' }])) as WorkspaceRow[];
}

export async function findWorkspaceRowById(id: string) {
  return (await db('workspaces').where({ id }).first()) as WorkspaceRow | undefined;
}

export async function findWorkspaceRowByUserAndId(userId: string, id: string) {
  return (await db('workspaces').where({ userId, id }).first()) as WorkspaceRow | undefined;
}

export async function insertWorkspaceRow(row: WorkspaceRow) {
  await db('workspaces').insert(row);
}

export async function updateWorkspaceRowByUserAndId(
  userId: string,
  id: string,
  updates: Partial<WorkspaceRow>,
) {
  await db('workspaces').where({ userId, id }).update(updates);
}

export async function deleteWorkspaceRowByUserAndId(userId: string, id: string) {
  return db('workspaces').where({ userId, id }).delete();
}
