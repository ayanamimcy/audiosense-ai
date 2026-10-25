import { db } from '../client.js';
import type { TaskJobRow } from '../../lib/tasks/task-types.js';

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

/**
 * Heartbeat: extends the lease only while this worker still owns the job.
 * Returns 0 when the job was reclaimed, cancelled or finished elsewhere.
 */
export async function refreshTaskJobLease(jobId: string, workerId: string, now: number) {
  return db('task_jobs')
    .where({ id: jobId, status: 'processing', workerId })
    .update({ lockedAt: now, updatedAt: now });
}

export async function findExpiredProcessingTaskJobs(leaseCutoff: number) {
  return (await db('task_jobs')
    .where({ status: 'processing' })
    .andWhere((query) => {
      query.whereNull('lockedAt').orWhere('lockedAt', '<', leaseCutoff);
    })
    .orderBy('lockedAt', 'asc')) as TaskJobRow[];
}

/**
 * Compare-and-set on the lease a reclaimer observed, so two workers sweeping at the
 * same time (or a worker whose heartbeat just landed) never both win.
 */
export async function updateExpiredTaskJob(
  job: Pick<TaskJobRow, 'id' | 'workerId' | 'lockedAt'>,
  updates: Partial<TaskJobRow>,
) {
  const query = db('task_jobs').where({ id: job.id, status: 'processing' });
  if (job.workerId) query.andWhere({ workerId: job.workerId }); else query.whereNull('workerId');
  if (job.lockedAt == null) query.whereNull('lockedAt'); else query.andWhere({ lockedAt: job.lockedAt });
  return query.update(updates);
}

/** Like updateTaskJobRowByIdWhereStatus, but only while `workerId` still holds the job. */
export async function updateOwnedTaskJobRow(
  jobId: string,
  workerId: string,
  updates: Partial<TaskJobRow>,
) {
  return db('task_jobs').where({ id: jobId, status: 'processing', workerId }).update(updates);
}

export async function findTaskJobRowById(jobId: string) {
  return (await db('task_jobs').where({ id: jobId }).first()) as TaskJobRow | undefined;
}

export async function findActiveTaskJobRowByTaskId(taskId: string) {
  return (await db('task_jobs')
    .where({ taskId })
    .whereIn('status', ['queued', 'processing', 'blocked'])
    .orderBy('createdAt', 'desc')
    .first()) as TaskJobRow | undefined;
}

export async function updateTaskJobRowByIdWhereStatus(
  jobId: string,
  statuses: TaskJobRow['status'][],
  updates: Partial<TaskJobRow>,
) {
  return db('task_jobs').where({ id: jobId }).whereIn('status', statuses).update(updates);
}

export async function deleteTaskJobRowsByTaskId(taskId: string) {
  await db('task_jobs').where({ taskId }).delete();
}
