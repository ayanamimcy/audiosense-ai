/**
 * Chaos experiment: does a transcription job survive its worker dying mid-job?
 *
 *   npm run chaos:worker -- [--scenario kill|pause|all] [--lease-ms 4000] [--provider-delay-ms 6000]
 *
 * Everything runs locally and in isolation: a throwaway SQLite database, a fake
 * OpenAI-compatible transcription server that answers slowly, and real `worker.ts`
 * processes started as children.
 *
 * Scenarios
 *   kill   SIGKILL the worker while the provider call is in flight, start a new worker,
 *          and check the job is recovered and completed exactly once.
 *   pause  SIGSTOP the worker until its lease expires, let a second worker take the job
 *          over, then SIGCONT the first one ("zombie") and check it cannot overwrite or
 *          duplicate the result.
 */
import { spawn, type ChildProcess } from 'child_process';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import type { AddressInfo } from 'net';

type Scenario = 'kill' | 'pause';

function readArg(name: string, fallback: string) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const scenarioArg = readArg('scenario', 'all');
const scenarios: Scenario[] = scenarioArg === 'all' ? ['kill', 'pause'] : [scenarioArg as Scenario];
const LEASE_MS = Number(readArg('lease-ms', '4000'));
const HEARTBEAT_MS = Math.max(250, Math.floor(LEASE_MS / 4));
const PROVIDER_DELAY_MS = Number(readArg('provider-delay-ms', '6000'));
const TIMEOUT_MS = 60_000;
const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'audiosense-chaos-'));
const uploadDir = path.join(tempDir, 'uploads');
fs.mkdirSync(uploadDir, { recursive: true });

// --- Fake slow transcription provider --------------------------------------------------

let providerRequests = 0;
const fakeProvider = http.createServer((req, res) => {
  if (req.method !== 'POST' || !req.url?.endsWith('/audio/transcriptions')) {
    res.writeHead(404).end();
    return;
  }
  providerRequests += 1;
  const requestNumber = providerRequests;
  req.resume();
  req.on('end', () => {
    setTimeout(() => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        text: `会議の録音です。リクエスト${requestNumber}。`,
        language: 'ja',
        duration: 4,
        segments: [
          { id: 0, start: 0, end: 2, text: '会議の録音です。' },
          { id: 1, start: 2, end: 4, text: `リクエスト${requestNumber}。` },
        ],
      }));
    }, PROVIDER_DELAY_MS);
  });
});

function writeSilentWav(filePath: string, seconds = 4, sampleRate = 16000) {
  const dataSize = seconds * sampleRate * 2;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);
  fs.writeFileSync(filePath, Buffer.concat([header, Buffer.alloc(dataSize)]));
}

// --- Helpers --------------------------------------------------------------------------

const startedAt = Date.now();
const elapsed = () => `${((Date.now() - startedAt) / 1000).toFixed(1).padStart(5)}s`;
const timeline: string[] = [];
function note(message: string) {
  const line = `${elapsed()}  ${message}`;
  timeline.push(line);
  console.log(line);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor<T>(label: string, check: () => Promise<T | null | undefined | false>, intervalMs = 150) {
  const deadline = Date.now() + TIMEOUT_MS;
  while (Date.now() < deadline) {
    const value = await check();
    if (value) return value;
    await sleep(intervalMs);
  }
  throw new Error(`Timed out waiting for: ${label}`);
}

// --- Main ----------------------------------------------------------------------------

await new Promise<void>((resolve) => fakeProvider.listen(0, '127.0.0.1', resolve));
const providerPort = (fakeProvider.address() as AddressInfo).port;

const childEnv: NodeJS.ProcessEnv = {
  ...process.env,
  NODE_ENV: 'test',
  DB_TYPE: 'sqlite3',
  SQLITE_FILENAME: path.join(tempDir, 'chaos.sqlite'),
  UPLOAD_DIR: uploadDir,
  TRANSCRIPTION_PROVIDER: 'openai-compatible',
  OPENAI_TRANSCRIPTION_API_BASE_URL: `http://127.0.0.1:${providerPort}`,
  OPENAI_TRANSCRIPTION_API_KEY: 'chaos-test-key',
  LOCAL_AUDIO_ENGINE_ENABLED: 'false',
  WORKER_IDLE_MS: '200',
  WORKER_LEASE_MS: String(LEASE_MS),
  WORKER_HEARTBEAT_MS: String(HEARTBEAT_MS),
  USER_SETTINGS_ENCRYPTION_KEY: 'chaos-only-key-0123456789abcdef01234567',
  LOG_LEVEL: process.env.LOG_LEVEL || 'info',
};
Object.assign(process.env, childEnv);

const { db, runMigrations } = await import('../../db.js');
const { enqueueTaskJob } = await import('../../lib/tasks/task-queue.js');
await runMigrations();

await db('users').insert({ id: 'chaos-user', name: 'Chaos', email: 'chaos@example.com', passwordHash: 'x:y', createdAt: Date.now() });
await db('workspaces').insert({ id: 'chaos-ws', userId: 'chaos-user', name: 'Chaos', createdAt: Date.now(), updatedAt: Date.now() });

const workerLog = fs.createWriteStream(path.join(tempDir, 'workers.log'));
const workers: ChildProcess[] = [];

function startWorker(name: string) {
  const child = spawn(process.execPath, ['--import', 'tsx', 'worker.ts'], {
    cwd: repoRoot,
    env: childEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  workers.push(child);
  const forward = (chunk: Buffer) => {
    for (const line of chunk.toString().split('\n').filter(Boolean)) {
      workerLog.write(`[${name}] ${line}\n`);
      if (/Reclaimed job|lease lost|dropped job|no longer owned/i.test(line)) {
        note(`${name}: ${line.replace(/^\S+\s+\[\w+\s*\]\s+/, '')}`);
      }
    }
  };
  child.stdout?.on('data', forward);
  child.stderr?.on('data', forward);
  return child;
}

async function readJob(jobId: string) {
  return db('task_jobs').where({ id: jobId }).first();
}

async function runScenario(scenario: Scenario) {
  const now = Date.now();
  const taskId = `task-${scenario}`;
  const fileName = `${taskId}.wav`;
  writeSilentWav(path.join(uploadDir, fileName));
  await db('tasks').insert({
    id: taskId,
    userId: 'chaos-user',
    workspaceId: 'chaos-ws',
    filename: fileName,
    originalName: `${scenario} scenario.wav`,
    status: 'pending',
    metadata: JSON.stringify({ originalMimeType: 'audio/wav', diarization: false }),
    createdAt: now,
    updatedAt: now,
  });
  providerRequests = 0;
  const job = await enqueueTaskJob({ taskId, userId: 'chaos-user', provider: 'openai-compatible' });
  note(`[${scenario}] queued job ${job.id.slice(0, 8)}`);

  const workerA = startWorker(`${scenario}:worker-A`);
  const claimed = await waitFor('worker A to claim the job', async () => {
    const row = await readJob(job.id);
    return row?.status === 'processing' && providerRequests > 0 ? row : null;
  });
  note(`[${scenario}] worker A claimed the job and called the provider (${claimed.workerId.slice(0, 15)})`);

  const interruptedAt = Date.now();
  if (scenario === 'kill') {
    workerA.kill('SIGKILL');
    note(`[${scenario}] SIGKILL worker A mid-transcription`);
  } else {
    workerA.kill('SIGSTOP');
    note(`[${scenario}] SIGSTOP worker A (frozen, still holds a lease that will expire)`);
  }

  const workerB = startWorker(`${scenario}:worker-B`);
  note(`[${scenario}] started worker B`);

  const reclaimed = await waitFor('the expired lease to be reclaimed', async () => {
    const row = await readJob(job.id);
    return row && row.workerId !== claimed.workerId && (row.status === 'queued' || row.status === 'processing' || row.status === 'completed')
      ? row
      : null;
  });
  const reclaimedAt = Date.now();
  note(`[${scenario}] job taken over after ${((reclaimedAt - interruptedAt) / 1000).toFixed(1)}s (status ${reclaimed.status})`);

  if (scenario === 'pause') {
    // Wait until B is mid-flight, then wake A up while its old provider response is pending.
    await waitFor('worker B to call the provider', async () => providerRequests >= 2);
    workerA.kill('SIGCONT');
    note(`[${scenario}] SIGCONT worker A (zombie wakes up)`);
  }

  const finished = await waitFor('the job to finish', async () => {
    const row = await readJob(job.id);
    return row && ['completed', 'failed'].includes(row.status) ? row : null;
  });
  const completedAt = Date.now();
  note(`[${scenario}] job ${finished.status} ${((completedAt - interruptedAt) / 1000).toFixed(1)}s after the interruption`);

  if (scenario === 'pause') {
    // Give the zombie time to finish its stale request and try to write.
    await sleep(PROVIDER_DELAY_MS + 1500);
  }

  const task = await db('tasks').where({ id: taskId }).first();
  const jobs = await db('task_jobs').where({ taskId });
  const finalJob = await readJob(job.id);
  const transcript = String(task.transcript || '');
  // Each fake provider response is tagged with its request number; only the takeover's may survive.
  const resultTags = transcript.match(/リクエスト\d+/g) || [];
  const parentChunks = await db('task_chunks').where({ taskId }).whereNull('parentId').select('chunkIndex');
  const chunkIndexes = parentChunks.map((row: { chunkIndex: number }) => row.chunkIndex);

  const checks: [string, boolean][] = [
    ['task ends completed', task.status === 'completed'],
    ['job ends completed', finalJob.status === 'completed'],
    ['still exactly one job row for the task', jobs.length === 1],
    ['interruption counted as one attempt', Number(finalJob.attemptCount) === 1],
    ['transcript written once, from the worker that took over', resultTags.length === 1 && resultTags[0] === 'リクエスト2'],
    ['search index not duplicated', chunkIndexes.length > 0 && new Set(chunkIndexes).size === chunkIndexes.length],
  ];

  for (const child of [workerA, workerB]) child.kill('SIGKILL');

  return {
    scenario,
    takeoverSeconds: (reclaimedAt - interruptedAt) / 1000,
    recoverySeconds: (completedAt - interruptedAt) / 1000,
    providerCalls: providerRequests,
    checks,
  };
}

let exitCode = 0;
try {
  console.log(`lease ${LEASE_MS}ms · heartbeat ${HEARTBEAT_MS}ms · provider delay ${PROVIDER_DELAY_MS}ms · ${tempDir}\n`);
  const results = [];
  for (const scenario of scenarios) {
    results.push(await runScenario(scenario));
    console.log('');
  }

  console.log('Results');
  for (const result of results) {
    console.log(`\n  ${result.scenario}: takeover ${result.takeoverSeconds.toFixed(1)}s, recovered ${result.recoverySeconds.toFixed(1)}s, provider calls ${result.providerCalls}`);
    for (const [label, ok] of result.checks) {
      console.log(`    ${ok ? 'PASS' : 'FAIL'}  ${label}`);
      if (!ok) exitCode = 1;
    }
  }
  console.log(`\nWorker logs: ${path.join(tempDir, 'workers.log')}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  console.error(`Worker logs: ${path.join(tempDir, 'workers.log')}`);
  exitCode = 1;
} finally {
  for (const child of workers) {
    try {
      child.kill('SIGCONT');
      child.kill('SIGKILL');
    } catch {
      // already gone
    }
  }
  fakeProvider.close();
  await db.destroy();
  process.exit(exitCode);
}
