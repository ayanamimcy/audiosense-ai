import {
  clearDefaultSummaryPromptRows,
  findSummaryPromptRow,
  listSummaryPromptRows,
  findSummaryPromptRowByWorkspace,
  listSummaryPromptRowsByWorkspace,
  type SummaryPromptRow,
} from '../../database/repositories/summary-prompts-repository.js';
import { findNotebookRowByUserAndId } from '../../database/repositories/notebooks-repository.js';
import { parseJsonField } from './task-types.js';

export interface SummaryPromptRecord {
  id: string;
  userId: string;
  workspaceId?: string | null;
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
    workspaceId: row.workspaceId || null,
    name: String(row.name || '').trim(),
    prompt: String(row.prompt || '').trim(),
    notebookIds: normalizeSummaryPromptNotebookIds(parseJsonField<string[]>(row.notebookIds, [])),
    isDefault: Boolean(row.isDefault),
    createdAt: Number(row.createdAt || 0),
    updatedAt: Number(row.updatedAt || 0),
  };
}

export async function listSummaryPrompts(userId: string, workspaceId?: string) {
  const rows = workspaceId
    ? await listSummaryPromptRowsByWorkspace(userId, workspaceId)
    : await listSummaryPromptRows(userId);
  return rows.map(toSummaryPromptRecord);
}

export async function findSummaryPrompt(userId: string, id: string, workspaceId?: string) {
  const row = workspaceId
    ? await findSummaryPromptRowByWorkspace(userId, workspaceId, id)
    : await findSummaryPromptRow(userId, id);
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

/**
 * The template used when a summary is generated without picking one: the notebook's own
 * default when it is set and still usable in that notebook, otherwise the workspace default.
 */
export function getDefaultSummaryPromptForNotebook(
  prompts: SummaryPromptRecord[],
  notebookId?: string | null,
  notebookDefaultPromptId?: string | null,
) {
  if (notebookId && notebookDefaultPromptId) {
    const notebookDefault = prompts.find((prompt) => (
      prompt.id === notebookDefaultPromptId && isSummaryPromptAvailableForNotebook(prompt, notebookId)
    ));
    if (notebookDefault) {
      return notebookDefault;
    }
  }

  return (
    prompts.find((prompt) => prompt.isDefault && isSummaryPromptAvailableForNotebook(prompt, notebookId)) ||
    null
  );
}

export async function resolveDefaultSummaryPromptForNotebook(
  userId: string,
  prompts: SummaryPromptRecord[],
  notebookId?: string | null,
) {
  const notebook = notebookId ? await findNotebookRowByUserAndId(userId, notebookId) : undefined;
  return getDefaultSummaryPromptForNotebook(prompts, notebookId, notebook?.defaultSummaryPromptId);
}

export async function clearDefaultSummaryPrompts(userId: string, exceptId?: string | null) {
  await clearDefaultSummaryPromptRows(userId, exceptId);
}
