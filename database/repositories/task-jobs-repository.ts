import { db } from '../client.js';
import type { TaskJobRow } from '../../lib/task-types.js';

export async function insertTaskJobRow(job: TaskJobRow) {
  await db('task_jobs').insert(job);
}

export async function findNextQueuedTaskJob(now: number) {
  return (await db('task_jobs')
    .where({ status: 'queued' })
    .andWhere('runAfter', '<=', now)
    .orderBy('createdAt', 'asc')
    .first()) as TaskJobRow | undefined;
}

export async function markTaskJobProcessing(jobId: string, workerId: string, now: number) {
  return db('task_jobs')
    .where({ id: jobId, status: 'queued' })
    .update({
      status: 'processing',
      lockedAt: now,
      workerId,
      updatedAt: now,
    });
}

export async function findTaskJobRowById(jobId: string) {
  return (await db('task_jobs').where({ id: jobId }).first()) as TaskJobRow | undefined;
}

export async function updateTaskJobRowById(jobId: string, updates: Partial<TaskJobRow>) {
  await db('task_jobs').where({ id: jobId }).update(updates);
}

export async function deleteTaskJobRowsByTaskId(taskId: string) {
  await db('task_jobs').where({ taskId }).delete();
}
