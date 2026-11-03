import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

// A stub OpenAI-compatible embeddings endpoint, so we can count how many requests indexing makes.
const DIMENSIONS = 4;
const embeddingRequests: Array<string | string[]> = [];
const embeddingServer = http.createServer((req, res) => {
  let body = '';
  req.on('data', (chunk) => { body += chunk; });
  req.on('end', () => {
    const { input } = JSON.parse(body) as { input: string | string[] };
    embeddingRequests.push(input);
    const inputs = Array.isArray(input) ? input : [input];
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({
      data: inputs.map((text, index) => ({ index, embedding: [text.length, 1, 0, index + 1] })),
    }));
  });
});
await new Promise<void>((resolve) => embeddingServer.listen(0, '127.0.0.1', resolve));
const { port } = embeddingServer.address() as AddressInfo;

process.env.EMBEDDING_API_BASE_URL = `http://127.0.0.1:${port}`;
process.env.EMBEDDING_API_KEY = 'test-key';
process.env.EMBEDDING_DIMENSIONS = String(DIMENSIONS);

const { setupTestDb } = await import('./helpers/setup.js');
const { db, resetDb, cleanup } = await setupTestDb();
const { updateTaskForUser } = await import('../application/services/tasks-service.js');
const { reindexTask, scheduleTaskReindex, hasEmbeddingContextChanged } = await import('../lib/search/search-index.js');

test.after(async () => {
  await cleanup();
  await new Promise<void>((resolve) => embeddingServer.close(() => resolve()));
});
test.beforeEach(async () => {
  await resetDb();
  embeddingRequests.length = 0;
});

const TRANSCRIPT = Array.from({ length: 12 }, (_, index) => `Sentence number ${index} talks about the quarterly roadmap.`).join(' ');

async function insertIndexedTask() {
  const now = Date.now();
  await db('users').insert({ id: 'user-idx', name: 'Idx', email: 'idx@example.com', passwordHash: 'salt:hash', createdAt: now });
  await db('workspaces').insert({ id: 'ws-idx', userId: 'user-idx', name: 'WS', description: null, color: '#111111', createdAt: now, updatedAt: now });
  await db('notebooks').insert({ id: 'nb-idx', userId: 'user-idx', workspaceId: 'ws-idx', name: 'NB', description: null, color: '#111111', createdAt: now });
  await db('tasks').insert({
    id: 'task-idx',
    userId: 'user-idx',
    workspaceId: 'ws-idx',
    filename: 'idx.wav',
    originalName: 'Weekly sync',
    status: 'completed',
    transcript: TRANSCRIPT,
    summary: 'Roadmap review',
    tags: JSON.stringify(['meeting']),
    createdAt: now,
    updatedAt: now,
  });
  await reindexTask(await db('tasks').where({ id: 'task-idx' }).first());
  embeddingRequests.length = 0;
}

async function chunkIds() {
  return (await db('task_chunks').where({ taskId: 'task-idx' }).orderBy('id')).map((row) => row.id as string);
}

async function ftsRows() {
  const result = await db.raw('SELECT title, summary, tags, content FROM task_chunk_fts WHERE taskId = ?', ['task-idx']);
  return (Array.isArray(result) ? result : result.rows) as Array<{ title: string; summary: string; tags: string; content: string }>;
}

async function waitFor(predicate: () => Promise<boolean>, timeoutMs = 3000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('Timed out waiting for condition.');
}

test('reindexing embeds all child chunks in one batched request', async () => {
  await insertIndexedTask();
  await reindexTask(await db('tasks').where({ id: 'task-idx' }).first());

  const children = await db('task_chunks').where({ taskId: 'task-idx' }).whereNotNull('parentId');
  assert.ok(children.length > 1);
  assert.ok(children.every((row) => row.embedding));
  assert.equal(embeddingRequests.length, 1);
  assert.ok(Array.isArray(embeddingRequests[0]));
  assert.equal(embeddingRequests[0].length, children.length);
});

test('renaming a recording updates keyword search immediately without embedding in the request', async () => {
  await insertIndexedTask();
  const before = await chunkIds();

  await updateTaskForUser('user-idx', 'task-idx', { originalName: 'Weekly product sync' });

  assert.equal(embeddingRequests.length, 0, 'the PATCH must not wait for embeddings');
  assert.deepEqual(await chunkIds(), before, 'chunks are not rebuilt synchronously');
  const rows = await ftsRows();
  assert.ok(rows.length > 0);
  assert.ok(rows.every((row) => row.title === 'Weekly product sync'));
});

test('changing notebook or date leaves the search index untouched', async () => {
  await insertIndexedTask();
  const before = await chunkIds();

  await updateTaskForUser('user-idx', 'task-idx', { notebookId: 'nb-idx', eventDate: Date.now() });
  await new Promise((resolve) => setTimeout(resolve, 50));

  assert.equal(embeddingRequests.length, 0);
  assert.deepEqual(await chunkIds(), before);
});

test('background reindex collapses repeated edits into one run', async () => {
  await insertIndexedTask();
  const before = await chunkIds();

  scheduleTaskReindex('task-idx', 30);
  scheduleTaskReindex('task-idx', 30);
  scheduleTaskReindex('task-idx', 30);

  await waitFor(async () => {
    const after = await chunkIds();
    return after.length > 0 && after.every((id) => !before.includes(id));
  });
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(embeddingRequests.length, 1);
});

test('embedding context only changes for the parts that are embedded', () => {
  const base = { originalName: 'Title', summary: 'Short summary', tags: JSON.stringify(['a', 'b']) };
  assert.equal(hasEmbeddingContextChanged(base, { ...base }), false);
  assert.equal(hasEmbeddingContextChanged(base, { ...base, originalName: 'Title 2' }), true);
  assert.equal(hasEmbeddingContextChanged(base, { ...base, tags: JSON.stringify(['a', 'c']) }), true);

  const longSummary = 'x'.repeat(400);
  const longBase = { ...base, summary: longSummary };
  assert.equal(hasEmbeddingContextChanged(longBase, { ...longBase, summary: `${longSummary} tail edit` }), false);

  const manyTags = { ...base, tags: JSON.stringify(['1', '2', '3', '4', '5', '6']) };
  assert.equal(hasEmbeddingContextChanged(manyTags, { ...manyTags, tags: JSON.stringify(['1', '2', '3', '4', '5', '7']) }), false);
});
