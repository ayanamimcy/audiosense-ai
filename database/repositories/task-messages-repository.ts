import { db } from '../client.js';
import type { TaskMessageRow } from '../../lib/tasks/task-types.js';

export async function listTaskMessageRows(taskId: string) {
  return (await db('task_messages')
    .where({ taskId })
    .orderBy('createdAt', 'asc')) as TaskMessageRow[];
}

export async function insertTaskMessageRow(row: TaskMessageRow) {
  await db('task_messages').insert(row);
}

export async function insertTaskMessageRows(rows: TaskMessageRow[]) {
  if (!rows.length) {
    return;
  }

  await db('task_messages').insert(rows);
}

export async function deleteTaskMessageRowsByTaskId(taskId: string) {
  await db('task_messages').where({ taskId }).delete();
}
