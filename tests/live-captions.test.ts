/**
 * Live captions end to end on the Node side: a browser-like client, the real session code, a fake
 * local audio runtime (/ws/live protocol) and a fake LLM for translations.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import WebSocket, { WebSocketServer } from 'ws';

// --- fake local audio runtime -------------------------------------------------------------
type RuntimeMode = 'normal' | 'busy';
let runtimeMode: RuntimeMode = 'normal';
let runtimeStartConfig: Record<string, unknown> | null = null;
let runtimeAudioBytes = 0;

const runtimeHttp = http.createServer();
const runtimeWss = new WebSocketServer({ server: runtimeHttp, path: '/ws/live' });
runtimeWss.on('connection', (socket) => {
  const send = (type: string, data: Record<string, unknown> = {}) => socket.send(JSON.stringify({ type, data }));
  if (runtimeMode === 'busy') {
    send('error', { message: 'Another Live Mode session is already active' });
    socket.close();
    return;
  }
  send('connected', { mode: 'live' });
  let sentInterim = false;
  let sentFirstSentence = false;
  socket.on('message', (data, isBinary) => {
    if (isBinary) {
      runtimeAudioBytes += (data as Buffer).length;
      if (!sentInterim) {
        sentInterim = true;
        send('realtime', { text: '今日の会議' });
      }
      if (!sentFirstSentence && runtimeAudioBytes >= 32000) {
        sentFirstSentence = true;
        send('sentence', { text: '今日の会議を始めます。', language: 'ja' });
      }
      return;
    }
    const message = JSON.parse(String(data));
    if (message.type === 'start') runtimeStartConfig = message.data.config;
    if (message.type === 'stop') {
      // The real runtime flushes the utterance in progress before "stopped".
      setTimeout(() => {
        send('sentence', { text: '我们先看一下预算。', language: 'zh' });
        send('stopped');
      }, 100);
    }
  });
});
await new Promise<void>((resolve) => runtimeHttp.listen(0, '127.0.0.1', resolve));

// --- fake LLM -------------------------------------------------------------------------------
const llmRequests: Array<{ messages: Array<{ role: string; content: string }> }> = [];
const llmServer = http.createServer((req, res) => {
  let body = '';
  req.on('data', (chunk) => { body += chunk; });
  req.on('end', () => {
    const request = JSON.parse(body);
    llmRequests.push(request);
    const user = request.messages.at(-1).content as string;
    const sentence = user.split('\n').at(-1);
    const target = user.includes('into Japanese') ? 'ja' : 'zh';
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: `[${target}] ${sentence}` } }] }));
  });
});
await new Promise<void>((resolve) => llmServer.listen(0, '127.0.0.1', resolve));

// --- app under test -------------------------------------------------------------------------
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'audiosense-live-'));
process.env.UPLOAD_DIR = path.join(tempDir, 'uploads');
fs.mkdirSync(process.env.UPLOAD_DIR);
process.env.LOCAL_AUDIO_ENGINE_ENABLED = 'true';
process.env.LOCAL_AUDIO_ENGINE_URL = `http://127.0.0.1:${(runtimeHttp.address() as AddressInfo).port}`;

const { setupTestDb } = await import('./helpers/setup.js');
const { db, resetDb, cleanup } = await setupTestDb();
const { createUser, createSession, getSessionCookieName } = await import('../lib/auth/auth.js');
const { saveUserSettings } = await import('../lib/settings/settings.js');
const { attachLiveCaptionServer } = await import('../lib/live/live-caption-server.js');
const { hasActiveLiveSession, insertLiveSession, LIVE_SESSION_STALE_MS } =
  await import('../database/repositories/live-sessions-repository.js');
const { claimNextJob } = await import('../lib/tasks/task-queue.js');

const appServer = http.createServer((_req, res) => { res.statusCode = 404; res.end(); });
attachLiveCaptionServer(appServer);
await new Promise<void>((resolve) => appServer.listen(0, '127.0.0.1', resolve));
const appHost = `127.0.0.1:${(appServer.address() as AddressInfo).port}`;

test.after(async () => {
  await new Promise<void>((resolve) => appServer.close(() => resolve()));
  runtimeWss.close();
  await new Promise<void>((resolve) => runtimeHttp.close(() => resolve()));
  await new Promise<void>((resolve) => llmServer.close(() => resolve()));
  await cleanup();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test.beforeEach(async () => {
  await resetDb();
  runtimeMode = 'normal';
  runtimeStartConfig = null;
  runtimeAudioBytes = 0;
  llmRequests.length = 0;
});

async function loggedInUser() {
  const user = await createUser({ name: 'Live', email: `live-${Date.now()}@example.com`, password: 'password123' });
  await saveUserSettings(user.id, {
    llm: { baseUrl: `http://127.0.0.1:${(llmServer.address() as AddressInfo).port}`, apiKey: 'stub', model: 'stub' },
  });
  return { user, cookie: `${getSessionCookieName()}=${await createSession(user.id)}` };
}

function connect(cookie: string | null, origin = `http://${appHost}`) {
  return new WebSocket(`ws://${appHost}/api/live/ws`, {
    headers: { ...(cookie ? { Cookie: cookie } : {}), Origin: origin },
  });
}

function collect(socket: WebSocket) {
  const messages: Array<Record<string, any>> = [];
  const waiters: Array<{ type: string; resolve: (message: Record<string, any>) => void }> = [];
  socket.on('message', (data) => {
    const message = JSON.parse(String(data));
    messages.push(message);
    for (const waiter of [...waiters]) {
      if (waiter.type === message.type) {
        waiters.splice(waiters.indexOf(waiter), 1);
        waiter.resolve(message);
      }
    }
  });
  const waitFor = (type: string, timeoutMs = 5000) => {
    const existing = messages.find((message) => message.type === type);
    if (existing) return Promise.resolve(existing);
    return new Promise<Record<string, any>>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timed out waiting for ${type}; got ${JSON.stringify(messages)}`)), timeoutMs);
      waiters.push({ type, resolve: (message) => { clearTimeout(timer); resolve(message); } });
    });
  };
  return { messages, waitFor };
}

function rejectionStatus(socket: WebSocket) {
  return new Promise<number>((resolve) => {
    socket.on('unexpected-response', (_req, res) => resolve(res.statusCode || 0));
    socket.on('error', () => {});
  });
}

const pcm = (seconds: number) => Buffer.alloc(Math.round(seconds * 16000) * 2, 1);

test('a session streams captions, translates them Chinese<->Japanese and saves the meeting', async () => {
  const { user, cookie } = await loggedInUser();
  const socket = connect(cookie);
  const { messages, waitFor } = collect(socket);
  await new Promise((resolve) => socket.once('open', resolve));

  socket.send(JSON.stringify({ type: 'start', language: 'auto', translate: true, title: 'Weekly sync' }));
  // The browser streams audio right after "start", without waiting for "ready".
  for (let index = 0; index < 5; index += 1) socket.send(pcm(0.1));
  assert.equal((await waitFor('ready')).translate, true);
  assert.deepEqual(runtimeStartConfig, { language: '' });
  assert.equal(await hasActiveLiveSession(), true, 'the worker is paused during the session');
  for (let index = 0; index < 25; index += 1) socket.send(pcm(0.1));

  assert.equal((await waitFor('partial')).text, '今日の会議');
  const first = await waitFor('final');
  assert.deepEqual([first.text, first.language], ['今日の会議を始めます。', 'ja']);

  socket.send(JSON.stringify({ type: 'stop' }));
  const saved = await waitFor('saved', 10000);
  await waitFor('ended');

  const finals = messages.filter((message) => message.type === 'final');
  assert.deepEqual(finals.map((message) => message.text), ['今日の会議を始めます。', '我们先看一下预算。'],
    'the sentence flushed on stop is delivered');
  const translations = new Map(messages.filter((message) => message.type === 'translation').map((message) => [message.id, message]));
  assert.equal(translations.get(finals[0].id)?.text, '[zh] 今日の会議を始めます。');
  assert.equal(translations.get(finals[1].id)?.text, '[ja] 我们先看一下预算。');
  assert.ok(llmRequests[1].messages.at(-1)!.content.includes('今日の会議を始めます。'), 'previous caption is context');

  const task = await db('tasks').where({ id: saved.taskId }).first();
  assert.equal(task.userId, user.id);
  assert.equal(task.originalName, 'Weekly sync');
  assert.equal(task.sourceType, 'live');
  assert.equal(task.status, 'pending');
  const wav = fs.readFileSync(path.join(process.env.UPLOAD_DIR!, task.filename));
  assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
  assert.equal(wav.readUInt32LE(24), 16000);
  assert.equal(wav.readUInt32LE(40), 96000);
  assert.equal(wav.length, 44 + 96000);
  // Audio sent before the runtime connection was up is in the recording, not in the captions.
  assert.ok(runtimeAudioBytes >= 25 * 3200 && runtimeAudioBytes <= 96000, String(runtimeAudioBytes));
  assert.equal(await hasActiveLiveSession(), false, 'the worker resumes after the session');
});

test('the meeting is still recorded when the runtime refuses the session', async () => {
  runtimeMode = 'busy';
  const { cookie } = await loggedInUser();
  const socket = connect(cookie);
  const { waitFor } = collect(socket);
  await new Promise((resolve) => socket.once('open', resolve));

  socket.send(JSON.stringify({ type: 'start', language: 'ja', translate: false }));
  const notice = await waitFor('notice');
  assert.equal(notice.code, 'captions_unavailable');
  assert.match(notice.message, /already active/);

  for (let index = 0; index < 30; index += 1) socket.send(pcm(0.1));
  socket.send(JSON.stringify({ type: 'stop' }));
  const saved = await waitFor('saved', 10000);
  const task = await db('tasks').where({ id: saved.taskId }).first();
  assert.equal(task.language, 'ja');
});

test('closing the tab without stopping still saves the recording', async () => {
  const { user, cookie } = await loggedInUser();
  const socket = connect(cookie);
  const { waitFor } = collect(socket);
  await new Promise((resolve) => socket.once('open', resolve));
  socket.send(JSON.stringify({ type: 'start', language: 'auto', translate: false }));
  await waitFor('ready');
  for (let index = 0; index < 30; index += 1) socket.send(pcm(0.1));
  await waitFor('final');
  socket.close();

  const deadline = Date.now() + 10000;
  let tasks: unknown[] = [];
  while (Date.now() < deadline && tasks.length === 0) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    tasks = await db('tasks').where({ userId: user.id, sourceType: 'live' });
  }
  assert.equal(tasks.length, 1);
});

test('unauthenticated and cross-site connections are refused', async () => {
  assert.equal(await rejectionStatus(connect(null)), 401);
  const { cookie } = await loggedInUser();
  assert.equal(await rejectionStatus(connect(cookie, 'https://evil.example')), 403);
});

test('the worker starts no new jobs while a live session heartbeats', async () => {
  const { user } = await loggedInUser();
  const now = Date.now();
  await db('tasks').insert({
    id: 'task-queued', userId: user.id, filename: 'x.wav', originalName: 'x.wav', status: 'pending', createdAt: now, updatedAt: now,
  });
  await db('task_jobs').insert({
    id: 'job-queued', taskId: 'task-queued', userId: user.id, status: 'queued', provider: 'local-python',
    attemptCount: 0, runAfter: now - 1000, createdAt: now, updatedAt: now,
  });

  await insertLiveSession({ id: 'live-1', userId: user.id, startedAt: now });
  assert.equal(await claimNextJob('worker-1'), null);

  // A session that stopped heartbeating (its server died) no longer holds the queue.
  await db('live_sessions').where({ id: 'live-1' }).update({ heartbeatAt: now - LIVE_SESSION_STALE_MS - 1 });
  assert.equal((await claimNextJob('worker-1'))?.id, 'job-queued');
});
