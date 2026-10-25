import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb } from './helpers/setup.js';

const { db, resetDb, cleanup } = await setupTestDb();
const { reclaimExpiredJobs, completeJob, failJob } = await import('../lib/tasks/task-queue.js');
const {
  findExpiredProcessingTaskJobs,
  refreshTaskJobLease,
  updateExpiredTaskJob,
} = await import('../database/repositories/task-jobs-repository.js');
const { createServiceError } = await import('../lib/audio-engine/errors.js');

test.after(cleanup);
test.beforeEach(resetDb);

const LEASE_MS = 60_000;

async function insertProcessingJob({
  lockedAt,
  attemptCount = 0,
  workerId = 'worker-dead',
}: {
  lockedAt: number | null;
  attemptCount?: number;
  workerId?: string;
}) {
  const now = Date.now();
  await db('users').insert({
    id: 'user-recovery',
    name: 'Recovery User',
    email: 'recovery@example.com',
    passwordHash: 'salt:hash',
    createdAt: now,
  });
  await db('tasks').insert({
    id: 'task-recovery',
    userId: 'user-recovery',
    filename: 'long.wav',
    originalName: 'long.wav',
    status: 'processing',
    metadata: JSON.stringify({}),
    createdAt: now,
    updatedAt: now,
  });
  await db('task_jobs').insert({
    id: 'job-recovery',
    taskId: 'task-recovery',
    userId: 'user-recovery',
    status: 'processing',
    provider: 'openai-compatible',
    attemptCount,
    runAfter: now,
    lockedAt,
    workerId,
    createdAt: now,
    updatedAt: now,
  });
  return db('task_jobs').where({ id: 'job-recovery' }).first();
}

async function readState() {
  const job = await db('task_jobs').where({ id: 'job-recovery' }).first();
  const task = await db('tasks').where({ id: 'task-recovery' }).first();
  return { job, task };
}

test('a job whose worker stopped heartbeating is put back in the queue', async () => {
  const now = Date.now();
  await insertProcessingJob({ lockedAt: now - LEASE_MS - 1_000 });

  const reclaimed = await reclaimExpiredJobs(now, LEASE_MS);
  assert.equal(reclaimed, 1);

  const { job, task } = await readState();
  assert.equal(job.status, 'queued');
  assert.equal(job.attemptCount, 1, 'the crash counts as an attempt');
  assert.equal(job.workerId, null);
  assert.equal(job.lockedAt, null);
  assert.equal(Number(job.runAfter), now);
  assert.match(job.lastError, /worker-dead stopped responding/);
  assert.equal(task.status, 'pending');
});

test('a job with a fresh lease is left alone', async () => {
  const now = Date.now();
  await insertProcessingJob({ lockedAt: now - 5_000 });

  assert.equal(await reclaimExpiredJobs(now, LEASE_MS), 0);
  const { job, task } = await readState();
  assert.equal(job.status, 'processing');
  assert.equal(job.workerId, 'worker-dead');
  assert.equal(task.status, 'processing');
});

test('a job that keeps killing workers fails after the attempt limit instead of looping', async () => {
  const now = Date.now();
  await insertProcessingJob({ lockedAt: now - LEASE_MS - 1_000, attemptCount: 2 });

  assert.equal(await reclaimExpiredJobs(now, LEASE_MS), 1);
  const { job, task } = await readState();
  assert.equal(job.status, 'failed');
  assert.equal(job.attemptCount, 3);
  assert.equal(task.status, 'failed');
  assert.match(task.result, /Gave up after 3 attempts/);
});

test('a worker that lost its lease cannot complete the job afterwards', async () => {
  const now = Date.now();
  const claimed = await insertProcessingJob({ lockedAt: now - LEASE_MS - 1_000 });
  await reclaimExpiredJobs(now, LEASE_MS);

  // The reclaimed job is picked up by a healthy worker.
  await db('task_jobs').where({ id: 'job-recovery' }).update({ status: 'processing', workerId: 'worker-new', lockedAt: now });

  assert.equal(await completeJob(claimed), false, 'zombie worker completion is rejected');
  await failJob(claimed, createServiceError('late failure from zombie', 'openai-compatible'));

  const { job } = await readState();
  assert.equal(job.status, 'processing');
  assert.equal(job.workerId, 'worker-new');
  assert.doesNotMatch(String(job.lastError), /zombie/);
  const queueState = await db('queue_state').where({ queueName: 'transcription' }).first();
  assert.ok(!queueState?.paused, 'a zombie failure must not pause the queue');
});

test('the owning worker still completes its job normally', async () => {
  const now = Date.now();
  const claimed = await insertProcessingJob({ lockedAt: now, workerId: 'worker-live' });

  assert.equal(await completeJob(claimed), true);
  const { job } = await readState();
  assert.equal(job.status, 'completed');
});

test('a heartbeat that lands during a sweep wins over the stale snapshot', async () => {
  const now = Date.now();
  await insertProcessingJob({ lockedAt: now - LEASE_MS - 1_000, workerId: 'worker-slow' });

  const [snapshot] = await findExpiredProcessingTaskJobs(now - LEASE_MS);
  assert.ok(snapshot);
  // The worker was only slow, not dead: its heartbeat refreshes the lease…
  assert.equal(await refreshTaskJobLease('job-recovery', 'worker-slow', now), 1);
  // …so the reclaimer's compare-and-set on the old lease value must not apply.
  assert.equal(await updateExpiredTaskJob(snapshot, { status: 'queued', workerId: null, lockedAt: null }), 0);

  const { job } = await readState();
  assert.equal(job.status, 'processing');
  assert.equal(job.workerId, 'worker-slow');
});

test('a heartbeat reports a lost lease once the job was reclaimed', async () => {
  const now = Date.now();
  await insertProcessingJob({ lockedAt: now - LEASE_MS - 1_000 });
  await reclaimExpiredJobs(now, LEASE_MS);

  assert.equal(await refreshTaskJobLease('job-recovery', 'worker-dead', now), 0);
});

test('two sweeps racing on the same job reclaim it only once', async () => {
  const now = Date.now();
  await insertProcessingJob({ lockedAt: now - LEASE_MS - 1_000 });

  const results = await Promise.all([reclaimExpiredJobs(now, LEASE_MS), reclaimExpiredJobs(now, LEASE_MS)]);
  assert.equal(results[0] + results[1], 1);
  const { job } = await readState();
  assert.equal(job.attemptCount, 1);
});
