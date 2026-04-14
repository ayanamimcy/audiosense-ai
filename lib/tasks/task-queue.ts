import { v4 as uuidv4 } from 'uuid';
import logger from '../shared/logger.js';
import {
  findQueueStateRow,
  updateQueueStateRow,
  upsertQueueStateRow,
} from '../../database/repositories/queue-state-repository.js';

const log = logger.child('task-queue');
import {
  findTaskJobRowById,
  findNextQueuedTaskJob,
  insertTaskJobRow,
  markTaskJobProcessing,
  updateTaskJobRowById,
} from '../../database/repositories/task-jobs-repository.js';
import { findTaskRowById, updateTaskRowById } from '../../database/repositories/tasks-repository.js';
import { asProcessingError, type ProcessingError } from '../audio-engine/errors.js';
import { checkTranscriptionProviderHealth } from '../audio-engine/providers/index.js';
import { isProviderCircuitOpen, resetProviderCircuit } from '../audio-engine/routing.js';
import { processQueuedJob } from './task-processor.js';
import { getUserSettings } from '../settings/settings.js';
import { parseJsonField, type QueueStateRow, type TaskJobRow } from './task-types.js';
import config from '../config.js';

const DEFAULT_PROVIDER = config.transcription.defaultProvider;
const DEFAULT_QUEUE_NAME = 'transcription';
const MAX_JOB_ATTEMPTS = 3;
const RETRY_DELAY_MS = 15_000;
export const QUEUE_RECOVERY_POLL_MS = 10_000;

function buildDefaultQueueState(now = Date.now()): QueueStateRow {
  return {
    queueName: DEFAULT_QUEUE_NAME,
    paused: false,
    reason: null,
    blockedJobId: null,
    blockedTaskId: null,
    provider: null,
    lastError: null,
    resumeCheckAfter: null,
    updatedAt: now,
  };
}

async function getOrCreateQueueState() {
  const existing = await findQueueStateRow(DEFAULT_QUEUE_NAME);
  if (existing) {
    return existing;
  }

  const row = buildDefaultQueueState();
  await upsertQueueStateRow(row);
  return row;
}

async function pauseQueueForJob(
  job: TaskJobRow,
  message: string,
  reason: string,
  resumeCheckAfter: number | null,
) {
  await upsertQueueStateRow({
    ...(await getOrCreateQueueState()),
    queueName: DEFAULT_QUEUE_NAME,
    paused: true,
    reason,
    blockedJobId: job.id,
    blockedTaskId: job.taskId,
    provider: job.provider,
    lastError: message,
    resumeCheckAfter,
    updatedAt: Date.now(),
  });
}

async function clearQueuePause(jobId?: string) {
  const queueState = await getOrCreateQueueState();
  if (!queueState.paused) {
    return;
  }
  if (jobId && queueState.blockedJobId && queueState.blockedJobId !== jobId) {
    return;
  }

  await updateQueueStateRow(DEFAULT_QUEUE_NAME, {
    paused: false,
    reason: null,
    blockedJobId: null,
    blockedTaskId: null,
    provider: null,
    lastError: null,
    resumeCheckAfter: null,
    updatedAt: Date.now(),
  });
}

async function markTaskBlocked(job: TaskJobRow, message: string, now: number) {
  const task = await findTaskRowById(job.taskId);
  await updateTaskRowById(job.taskId, {
    status: 'blocked',
    result: message,
    updatedAt: now,
    metadata: JSON.stringify({
      ...parseJsonField<Record<string, unknown>>(task?.metadata, {}),
      blockedAt: now,
      blockedReason: message,
      blockedProvider: job.provider,
    }),
  });
}

async function markTaskFailed(job: TaskJobRow, message: string, now: number) {
  const task = await findTaskRowById(job.taskId);
  await updateTaskRowById(job.taskId, {
    status: 'failed',
    result: message,
    updatedAt: now,
    metadata: JSON.stringify({
      ...parseJsonField<Record<string, unknown>>(task?.metadata, {}),
      failedAt: now,
      jobError: message,
    }),
  });
}

async function markTaskQueued(job: TaskJobRow, message: string | null, now: number) {
  const task = await findTaskRowById(job.taskId);
  const metadata = parseJsonField<Record<string, unknown>>(task?.metadata, {});
  delete metadata.blockedAt;
  delete metadata.blockedReason;
  delete metadata.blockedProvider;

  await updateTaskRowById(job.taskId, {
    status: 'pending',
    result: message,
    updatedAt: now,
    metadata: JSON.stringify(metadata),
  });
}

export async function getTranscriptionQueueState() {
  return getOrCreateQueueState();
}

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
  const queueState = await getOrCreateQueueState();

  let candidate: TaskJobRow | null = null;
  if (queueState.paused) {
    if (!queueState.blockedJobId) {
      return null;
    }

    const blockedJob = await findTaskJobRowById(queueState.blockedJobId);
    if (!blockedJob || blockedJob.status !== 'queued' || Number(blockedJob.runAfter || 0) > now) {
      return null;
    }
    candidate = blockedJob;
  } else {
    candidate = (await findNextQueuedTaskJob(now)) || null;
  }

  if (!candidate) {
    return null;
  }

  const updated = await markTaskJobProcessing(candidate.id, workerId, now);
  if (!updated) {
    return null;
  }

  return (await findTaskJobRowById(candidate.id)) || null;
}

export async function completeJob(job: TaskJobRow) {
  await updateTaskJobRowById(job.id, {
    status: 'completed',
    updatedAt: Date.now(),
  });

  await clearQueuePause(job.id);
}

export async function failJob(job: TaskJobRow, error: unknown) {
  const normalized = asProcessingError(error, job.provider);
  const message = normalized.message;
  const nextAttemptCount = Number(job.attemptCount || 0) + 1;
  const shouldRetry = nextAttemptCount < MAX_JOB_ATTEMPTS;
  const now = Date.now();

  if (normalized.category === 'service') {
    const retryAt = now + nextAttemptCount * RETRY_DELAY_MS;
    await pauseQueueForJob(
      job,
      message,
      shouldRetry ? 'service_retry' : 'waiting_for_recovery',
      shouldRetry ? null : now + QUEUE_RECOVERY_POLL_MS,
    );

    await updateTaskJobRowById(job.id, {
      status: shouldRetry ? 'queued' : 'blocked',
      attemptCount: nextAttemptCount,
      lastError: message,
      lockedAt: null,
      workerId: null,
      runAfter: shouldRetry ? retryAt : job.runAfter,
      updatedAt: now,
    });

    if (shouldRetry) {
      await markTaskQueued(job, message, now);
    } else {
      await markTaskBlocked(job, message, now);
    }
    return;
  }

  await clearQueuePause(job.id);

  await updateTaskJobRowById(job.id, {
    status: shouldRetry ? 'queued' : 'failed',
    attemptCount: nextAttemptCount,
    lastError: message,
    lockedAt: null,
    workerId: null,
    runAfter: shouldRetry ? now + nextAttemptCount * RETRY_DELAY_MS : job.runAfter,
    updatedAt: now,
  });

  if (shouldRetry) {
    await markTaskQueued(job, message, now);
    return;
  }

  await markTaskFailed(job, message, now);
}

async function maybeRequeueBlockedJob(queueState: QueueStateRow) {
  if (!queueState.blockedJobId) {
    return false;
  }

  const blockedJob = await findTaskJobRowById(queueState.blockedJobId);
  if (!blockedJob || blockedJob.status !== 'blocked') {
    return false;
  }

  const userSettings = blockedJob.userId ? await getUserSettings(blockedJob.userId) : null;
  const provider = queueState.provider || blockedJob.provider;
  if (!provider) {
    return false;
  }

  const health = await checkTranscriptionProviderHealth(provider, userSettings || undefined);
  if (!health.ok) {
    await updateQueueStateRow(DEFAULT_QUEUE_NAME, {
      lastError: health.detail || queueState.lastError,
      resumeCheckAfter: Date.now() + QUEUE_RECOVERY_POLL_MS,
      updatedAt: Date.now(),
    });
    return false;
  }

  if (!health.checkedRemotely && (await isProviderCircuitOpen(provider))) {
    await updateQueueStateRow(DEFAULT_QUEUE_NAME, {
      resumeCheckAfter: Date.now() + QUEUE_RECOVERY_POLL_MS,
      updatedAt: Date.now(),
    });
    return false;
  }

  await resetProviderCircuit(provider);

  const now = Date.now();
  await updateTaskJobRowById(blockedJob.id, {
    status: 'queued',
    attemptCount: 0,
    lastError: null,
    lockedAt: null,
    workerId: null,
    runAfter: now,
    updatedAt: now,
  });
  await markTaskQueued(blockedJob, null, now);
  await updateQueueStateRow(DEFAULT_QUEUE_NAME, {
    reason: 'replaying_blocked_job',
    lastError: null,
    resumeCheckAfter: null,
    updatedAt: now,
  });
  return true;
}

export async function runRecoveryCycle(workerId: string) {
  const queueState = await getOrCreateQueueState();
  if (!queueState.paused) {
    return false;
  }

  const blockedJob = queueState.blockedJobId
    ? await findTaskJobRowById(queueState.blockedJobId)
    : null;

  if (blockedJob?.status === 'queued') {
    if (Number(blockedJob.runAfter || 0) > Date.now()) {
      return false;
    }
    return runWorkerCycle(workerId);
  }

  if (!blockedJob) {
    await clearQueuePause();
    return false;
  }

  if (blockedJob.status === 'processing') {
    return false;
  }

  if (blockedJob.status !== 'blocked') {
    return false;
  }

  if (queueState.resumeCheckAfter && queueState.resumeCheckAfter > Date.now()) {
    return false;
  }

  const requeued = await maybeRequeueBlockedJob(queueState);
  if (!requeued) {
    return false;
  }

  return runWorkerCycle(workerId);
}

export async function runWorkerCycle(workerId: string) {
  const job = await claimNextJob(workerId);
  if (!job) {
    return false;
  }

  try {
    await processQueuedJob(job);
    await completeJob(job);
  } catch (error) {
    log.error('Worker failed job', { workerId, jobId: job.id, error: error instanceof Error ? error.message : String(error) });
    await failJob(job, error as ProcessingError);
  }

  return true;
}
