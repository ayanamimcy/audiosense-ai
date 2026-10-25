import { db } from '../client.js';

export interface LlmCallRow {
  id: string;
  userId?: string | null;
  taskId?: string | null;
  operation: string;
  model: string;
  providerHost?: string | null;
  promptVersion: string;
  streamed: boolean;
  status: 'ok' | 'error' | 'cancelled';
  errorCategory?: string | null;
  httpStatus?: number | null;
  latencyMs: number;
  firstTokenMs?: number | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  usageSource: 'provider' | 'estimated';
  inputChars: number;
  outputChars: number;
  createdAt: number;
}

export async function insertLlmCallRow(row: LlmCallRow) {
  await db('llm_calls').insert(row);
}

export async function listLlmCallRowsForUserSince(userId: string, since: number) {
  return (await db('llm_calls')
    .where({ userId })
    .andWhere('createdAt', '>=', since)
    .orderBy('createdAt', 'asc')) as LlmCallRow[];
}
