import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb } from './helpers/setup.js';

const { db, resetDb, cleanup } = await setupTestDb();
const { cancelTaskForUser, UserTaskCancellationError } =
  await import('../application/services/tasks-service.js');
const { completeJob } = await import('../lib/tasks/task-queue.js');

test.after(cleanup);
test.beforeEach(resetDb);

async function insertActiveTask(status: 'pending' | 'processing' | 'blocked' = 'processing') {
  const now = Date.now();
  await db('users').insert({
    id: 'user-cancel',
    name: 'Cancel User',
    email: 'cancel@example.com',
    passwordHash: 'salt:hash',
    createdAt: now,
  });
  await db('tasks').insert({
    id: 'task-cancel',
    userId: 'user-cancel',
    filename: 'cancel.wav',
    originalName: 'cancel.wav',
    status,
    metadata: JSON.stringify({ originalMimeType: 'audio/wav' }),
    createdAt: now,
    updatedAt: now,
  });
  await db('task_jobs').insert({
    id: 'job-cancel',
    taskId: 'task-cancel',
    userId: 'user-cancel',
    status: status === 'pending' ? 'queued' : status,
    provider: 'openai-compatible',
    attemptCount: 0,
    runAfter: now,
    lockedAt: status === 'processing' ? now : null,
    workerId: status === 'processing' ? 'worker-1' : null,
    createdAt: now,
    updatedAt: now,
  });
}

test('cancelling an active task marks both task and queue job cancelled', async () => {
  await insertActiveTask('processing');

  const response = await cancelTaskForUser('user-cancel', 'task-cancel');
  assert.equal(response.status, 'cancelled');

  const task = await db('tasks').where({ id: 'task-cancel' }).first();
  const job = await db('task_jobs').where({ id: 'job-cancel' }).first();
  assert.equal(task.status, 'cancelled');
  assert.equal(task.result, 'Transcription was cancelled.');
  assert.equal(job.status, 'cancelled');
  assert.equal(job.workerId, null);
  assert.equal(job.lockedAt, null);

  const metadata = JSON.parse(task.metadata);
  assert.equal(typeof metadata.cancellationRequestedAt, 'number');
  assert.equal(typeof metadata.cancelledAt, 'number');
});

test('a stale worker completion cannot overwrite a cancelled job', async () => {
  await insertActiveTask('processing');
  const staleJob = await db('task_jobs').where({ id: 'job-cancel' }).first();

  await cancelTaskForUser('user-cancel', 'task-cancel');
  await completeJob(staleJob);

  const task = await db('tasks').where({ id: 'task-cancel' }).first();
  const job = await db('task_jobs').where({ id: 'job-cancel' }).first();
  assert.equal(task.status, 'cancelled');
  assert.equal(job.status, 'cancelled');
});

test('repeating cancellation cleans up an active job without changing terminal task state', async () => {
  await insertActiveTask('processing');
  await cancelTaskForUser('user-cancel', 'task-cancel');

  await db('task_jobs').where({ id: 'job-cancel' }).update({
    status: 'processing',
    workerId: 'stale-worker',
    lockedAt: Date.now(),
  });

  const response = await cancelTaskForUser('user-cancel', 'task-cancel');
  const job = await db('task_jobs').where({ id: 'job-cancel' }).first();
  assert.equal(response.status, 'cancelled');
  assert.equal(job.status, 'cancelled');
  assert.equal(job.workerId, null);
});

test('completed tasks reject cancellation', async () => {
  await insertActiveTask('processing');
  await db('tasks').where({ id: 'task-cancel' }).update({ status: 'completed' });

  await assert.rejects(
    cancelTaskForUser('user-cancel', 'task-cancel'),
    UserTaskCancellationError,
  );
});
