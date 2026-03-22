import { v4 as uuidv4 } from 'uuid';
import { db } from '../db.js';
import { processQueuedJob } from './task-processor.js';
import { parseJsonField, type TaskJobRow } from './task-types.js';

const DEFAULT_PROVIDER = (process.env.TRANSCRIPTION_PROVIDER || 'local-python').toLowerCase();

export async function enqueueTaskJob(input: {
  taskId: string;
  userId?: string | null;
  provider?: string | null;
  payload?: Record<string, unknown>;
  runAfter?: number;
}) {
  const now = Date.now();
  const job: TaskJobRow = {
    id: uuidv4(),
    taskId: input.taskId,
    userId: input.userId || null,
    status: 'queued',
    provider: (input.provider || DEFAULT_PROVIDER).toLowerCase(),
    attemptCount: 0,
    payload: JSON.stringify(input.payload || {}),
    lastError: null,
    runAfter: input.runAfter || now,
    lockedAt: null,
    workerId: null,
    createdAt: now,
    updatedAt: now,
  };

  await db('task_jobs').insert(job);
  await db('tasks').where({ id: input.taskId }).update({
    status: 'pending',
    provider: job.provider,
    updatedAt: now,
  });

  return job;
}

export async function claimNextJob(workerId: string) {
  const now = Date.now();
  const candidate = (await db('task_jobs')
    .where({ status: 'queued' })
    .andWhere('runAfter', '<=', now)
    .orderBy('createdAt', 'asc')
    .first()) as TaskJobRow | undefined;

  if (!candidate) {
    return null;
  }

  const updated = await db('task_jobs')
    .where({ id: candidate.id, status: 'queued' })
    .update({
      status: 'processing',
      lockedAt: now,
      workerId,
      updatedAt: now,
    });

  if (!updated) {
    return null;
  }

  return (await db('task_jobs').where({ id: candidate.id }).first()) as TaskJobRow;
}

export async function completeJob(jobId: string) {
  await db('task_jobs').where({ id: jobId }).update({
    status: 'completed',
    updatedAt: Date.now(),
  });
}

export async function failJob(job: TaskJobRow, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const nextAttemptCount = Number(job.attemptCount || 0) + 1;
  const shouldRetry = nextAttemptCount < 3;
  const now = Date.now();

  await db('task_jobs').where({ id: job.id }).update({
    status: shouldRetry ? 'queued' : 'failed',
    attemptCount: nextAttemptCount,
    lastError: message,
    lockedAt: null,
    workerId: null,
    runAfter: shouldRetry ? now + nextAttemptCount * 15000 : job.runAfter,
    updatedAt: now,
  });

  if (!shouldRetry) {
    await db('tasks').where({ id: job.taskId }).update({
      status: 'failed',
      result: message,
      updatedAt: now,
      metadata: JSON.stringify({
        ...parseJsonField<Record<string, unknown>>(
          (await db('tasks').where({ id: job.taskId }).first())?.metadata,
          {},
        ),
        failedAt: now,
        jobError: message,
      }),
    });
  }
}

export async function runWorkerCycle(workerId: string) {
  const job = await claimNextJob(workerId);
  if (!job) {
    return false;
  }

  try {
    await processQueuedJob(job);
    await completeJob(job.id);
  } catch (error) {
    console.error(`Worker ${workerId} failed job ${job.id}`, error);
    await failJob(job, error);
  }

  return true;
}
