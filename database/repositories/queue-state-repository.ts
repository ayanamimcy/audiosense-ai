import { db } from '../client.js';
import type { QueueStateRow } from '../../lib/task-types.js';

export async function findQueueStateRow(queueName: string) {
  return (await db('queue_state').where({ queueName }).first()) as QueueStateRow | undefined;
}

export async function upsertQueueStateRow(row: QueueStateRow) {
  const existing = await findQueueStateRow(row.queueName);
  if (existing) {
    await db('queue_state').where({ queueName: row.queueName }).update(row);
    return;
  }

  await db('queue_state').insert(row);
}

export async function updateQueueStateRow(queueName: string, updates: Partial<QueueStateRow>) {
  await db('queue_state').where({ queueName }).update(updates);
}
