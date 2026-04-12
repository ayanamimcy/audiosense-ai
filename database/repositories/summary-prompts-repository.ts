import { db } from '../client.js';

export interface SummaryPromptRow {
  id: string;
  userId: string;
  workspaceId?: string | null;
  name: string;
  prompt: string;
  notebookIds?: string | null;
  isDefault?: boolean | number | null;
  createdAt: number;
  updatedAt: number;
}

export async function listSummaryPromptRows(userId: string) {
  return (await db('summary_prompts')
    .where({ userId })
    .orderBy([{ column: 'isDefault', order: 'desc' }, { column: 'updatedAt', order: 'desc' }])) as SummaryPromptRow[];
}

export async function listSummaryPromptRowsByWorkspace(userId: string, workspaceId: string) {
  return (await db('summary_prompts')
    .where({ userId, workspaceId })
    .orderBy([{ column: 'isDefault', order: 'desc' }, { column: 'updatedAt', order: 'desc' }])) as SummaryPromptRow[];
}

export async function findSummaryPromptRow(userId: string, id: string) {
  return (await db('summary_prompts').where({ userId, id }).first()) as SummaryPromptRow | undefined;
}

export async function findSummaryPromptRowByWorkspace(userId: string, workspaceId: string, id: string) {
  return (await db('summary_prompts')
    .where({ userId, workspaceId, id })
    .first()) as SummaryPromptRow | undefined;
}

export async function insertSummaryPromptRow(row: SummaryPromptRow) {
  await db('summary_prompts').insert(row);
}

export async function updateSummaryPromptRow(
  userId: string,
  id: string,
  updates: Partial<SummaryPromptRow>,
) {
  await db('summary_prompts').where({ userId, id }).update(updates);
}

export async function updateSummaryPromptRowByWorkspace(
  userId: string,
  workspaceId: string,
  id: string,
  updates: Partial<SummaryPromptRow>,
) {
  await db('summary_prompts').where({ userId, workspaceId, id }).update(updates);
}

export async function deleteSummaryPromptRow(userId: string, id: string) {
  return db('summary_prompts').where({ userId, id }).delete();
}

export async function deleteSummaryPromptRowByWorkspace(userId: string, workspaceId: string, id: string) {
  return db('summary_prompts').where({ userId, workspaceId, id }).delete();
}

export async function clearDefaultSummaryPromptRows(userId: string, exceptId?: string | null) {
  const query = db('summary_prompts').where({ userId });
  if (exceptId) {
    query.whereNot({ id: exceptId });
  }

  await query.update({
    isDefault: 0,
    updatedAt: Date.now(),
  });
}

export async function clearDefaultSummaryPromptRowsByWorkspace(
  userId: string,
  workspaceId: string,
  exceptId?: string | null,
) {
  const query = db('summary_prompts').where({ userId, workspaceId });
  if (exceptId) {
    query.whereNot({ id: exceptId });
  }

  await query.update({
    isDefault: 0,
    updatedAt: Date.now(),
  });
}
