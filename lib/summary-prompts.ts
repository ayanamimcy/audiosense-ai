import { db } from '../db.js';
import { parseJsonField } from './task-types.js';

export interface SummaryPromptRow {
  id: string;
  userId: string;
  name: string;
  prompt: string;
  notebookIds?: string | null;
  isDefault?: boolean | number | null;
  createdAt: number;
  updatedAt: number;
}

export interface SummaryPromptRecord {
  id: string;
  userId: string;
  name: string;
  prompt: string;
  notebookIds: string[];
  isDefault: boolean;
  createdAt: number;
  updatedAt: number;
}

export function normalizeSummaryPromptNotebookIds(value: unknown) {
  const input = Array.isArray(value) ? value : [];
  return input
    .map((item) => String(item || '').trim())
    .filter((item, index, array) => item && array.indexOf(item) === index)
    .slice(0, 100);
}

export function toSummaryPromptRecord(row: SummaryPromptRow): SummaryPromptRecord {
  return {
    id: row.id,
    userId: row.userId,
    name: String(row.name || '').trim(),
    prompt: String(row.prompt || '').trim(),
    notebookIds: normalizeSummaryPromptNotebookIds(parseJsonField<string[]>(row.notebookIds, [])),
    isDefault: Boolean(row.isDefault),
    createdAt: Number(row.createdAt || 0),
    updatedAt: Number(row.updatedAt || 0),
  };
}

export async function listSummaryPrompts(userId: string) {
  const rows = (await db('summary_prompts')
    .where({ userId })
    .orderBy([{ column: 'isDefault', order: 'desc' }, { column: 'updatedAt', order: 'desc' }])) as SummaryPromptRow[];

  return rows.map(toSummaryPromptRecord);
}

export async function findSummaryPrompt(userId: string, id: string) {
  const row = (await db('summary_prompts').where({ userId, id }).first()) as SummaryPromptRow | undefined;
  return row ? toSummaryPromptRecord(row) : null;
}

export function isSummaryPromptAvailableForNotebook(
  prompt: Pick<SummaryPromptRecord, 'notebookIds'>,
  notebookId?: string | null,
) {
  if (!prompt.notebookIds.length) {
    return true;
  }

  if (!notebookId) {
    return false;
  }

  return prompt.notebookIds.includes(notebookId);
}

export function getDefaultSummaryPromptForNotebook(
  prompts: SummaryPromptRecord[],
  notebookId?: string | null,
) {
  return (
    prompts.find((prompt) => prompt.isDefault && isSummaryPromptAvailableForNotebook(prompt, notebookId)) ||
    null
  );
}

export async function clearDefaultSummaryPrompts(userId: string, exceptId?: string | null) {
  const query = db('summary_prompts').where({ userId });
  if (exceptId) {
    query.whereNot({ id: exceptId });
  }

  await query.update({
    isDefault: 0,
    updatedAt: Date.now(),
  });
}
