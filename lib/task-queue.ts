import { v4 as uuidv4 } from 'uuid';
import {
  findTaskJobRowById,
  findNextQueuedTaskJob,
  insertTaskJobRow,
  markTaskJobProcessing,
  updateTaskJobRowById,
} from '../database/repositories/task-jobs-repository.js';
import { findTaskRowById, updateTaskRowById } from '../database/repositories/tasks-repository.js';
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

  await insertTaskJobRow(job);
  await updateTaskRowById(input.taskId, {
    status: 'pending',
    provider: job.provider,
    updatedAt: now,
  });

  return job;
}

export async function claimNextJob(workerId: string) {
  const now = Date.now();
  const candidate = await findNextQueuedTaskJob(now);

  if (!candidate) {
    return null;
  }

  const updated = await markTaskJobProcessing(candidate.id, workerId, now);

  if (!updated) {
    return null;
  }

  return await findTaskJobRowById(candidate.id) || null;
}

export async function completeJob(jobId: string) {
  await updateTaskJobRowById(jobId, {
    status: 'completed',
    updatedAt: Date.now(),
  });
}

export async function failJob(job: TaskJobRow, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const nextAttemptCount = Number(job.attemptCount || 0) + 1;
  const shouldRetry = nextAttemptCount < 3;
  const now = Date.now();

  await updateTaskJobRowById(job.id, {
    status: shouldRetry ? 'queued' : 'failed',
    attemptCount: nextAttemptCount,
    lastError: message,
    lockedAt: null,
    workerId: null,
    runAfter: shouldRetry ? now + nextAttemptCount * 15000 : job.runAfter,
    updatedAt: now,
  });

  if (!shouldRetry) {
    const task = await findTaskRowById(job.taskId);
    await updateTaskRowById(job.taskId, {
      status: 'failed',
      result: message,
      updatedAt: now,
      metadata: JSON.stringify({
        ...parseJsonField<Record<string, unknown>>(
          task?.metadata,
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
