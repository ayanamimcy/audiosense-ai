/**
 * Keyword search across SQLite (default) and PostgreSQL.
 * Set TEST_POSTGRES_URL (a database with the vector extension available) to run against PostgreSQL.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

const postgresUrl = process.env.TEST_POSTGRES_URL || '';
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'audiosense-keyword-'));
if (postgresUrl) {
  process.env.DB_TYPE = 'pg';
  process.env.DATABASE_URL = postgresUrl;
} else {
  process.env.DB_TYPE = 'sqlite3';
  process.env.SQLITE_FILENAME = path.join(tempDir, 'keyword.sqlite');
}
process.env.NODE_ENV = 'test';
// No embeddings: these tests are about keyword search only.
process.env.EMBEDDING_API_KEY = '';
process.env.LLM_API_KEY = '';

const { db, runMigrations, isSqliteDb } = await import('../db.js');
await runMigrations();
const { reindexTask, refreshTaskSearchMetadata, searchTasksByText, searchChunksHybrid, mergeKeywordHits } =
  await import('../lib/search/search-index.js');
const cjkMigration = await import('../database/migrations/202611030001_cjk_keyword_search.cjs');

// A stub LLM whose "query rewrite" is unrelated to the question.
const llmServer = http.createServer((req, res) => {
  req.resume();
  req.on('end', () => {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'unrelated rewritten words' } }] }));
  });
});
await new Promise<void>((resolve) => llmServer.listen(0, '127.0.0.1', resolve));
const llmUrl = `http://127.0.0.1:${(llmServer.address() as AddressInfo).port}`;

test.after(async () => {
  await new Promise<void>((resolve) => llmServer.close(() => resolve()));
  await db.destroy();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

const USER = 'user-kw';
const WS = 'ws-kw';

async function resetData() {
  if (isSqliteDb()) {
    await db.raw('DELETE FROM task_chunk_fts');
  }
  await db('task_chunks').delete();
  await db('tasks').delete();
  await db('workspaces').delete();
  await db('users').delete();
  await db('users').insert({ id: USER, name: 'KW', email: 'kw@example.com', passwordHash: 'salt:hash', createdAt: 1 });
  await db('workspaces').insert({ id: WS, userId: USER, name: 'WS', description: null, color: '#111111', createdAt: 1, updatedAt: 1 });
}

let createdAt = 100;
async function addTask(id: string, fields: { originalName: string; transcript: string; summary?: string; tags?: string[] }) {
  createdAt += 1;
  await db('tasks').insert({
    id,
    userId: USER,
    workspaceId: WS,
    filename: `${id}.wav`,
    originalName: fields.originalName,
    status: 'completed',
    transcript: fields.transcript,
    summary: fields.summary || null,
    tags: JSON.stringify(fields.tags || []),
    createdAt,
    updatedAt: createdAt,
  });
  await reindexTask(await db('tasks').where({ id }).first());
}

async function seed() {
  await resetData();
  await addTask('task-roadmap', {
    originalName: '周一例会',
    transcript: '大家好，今天我们讨论一下第三季度的产品路线图。会议结论是先优化说话人分离。The roadmap review covers diarization.',
    summary: '确认了下季度的优先级',
    tags: ['会议', '路线图'],
  });
  await addTask('task-weather', {
    originalName: 'Podcast episode',
    transcript: '今天的天气很好，我们去公园散步。Then we talked about hiking gear.',
  });
}

const ids = (hits: Array<{ taskId: string }>) => hits.map((hit) => hit.taskId).sort();

test('search box: Chinese substrings of any length match inside unspaced text', async () => {
  await seed();
  assert.deepEqual(ids(await searchTasksByText(USER, WS, '会议', 'all')), ['task-roadmap']);
  assert.deepEqual(ids(await searchTasksByText(USER, WS, '产品路线图', 'all')), ['task-roadmap']);
  assert.deepEqual(ids(await searchTasksByText(USER, WS, '天气', 'all')), ['task-weather']);
  assert.deepEqual(ids(await searchTasksByText(USER, WS, '今天', 'all')), ['task-roadmap', 'task-weather']);
  // Characters that are not adjacent in the text do not match.
  assert.deepEqual(ids(await searchTasksByText(USER, WS, '路图', 'all')), []);
});

test('search box: every term must match', async () => {
  await seed();
  assert.deepEqual(ids(await searchTasksByText(USER, WS, '今天 天气', 'all')), ['task-weather']);
  assert.deepEqual(ids(await searchTasksByText(USER, WS, '今天 路线图', 'all')), ['task-roadmap']);
  assert.deepEqual(ids(await searchTasksByText(USER, WS, '天气 路线图', 'all')), []);
});

test('English and mixed text still match, case-insensitively', async () => {
  await seed();
  assert.deepEqual(ids(await searchTasksByText(USER, WS, 'ROADMAP', 'all')), ['task-roadmap']);
  assert.deepEqual(ids(await searchTasksByText(USER, WS, 'hiking gear', 'all')), ['task-weather']);
  assert.deepEqual(ids(await searchTasksByText(USER, WS, 'podcast', 'all')), ['task-weather']);
});

test('titles, summaries and tags are searchable', async () => {
  await seed();
  assert.deepEqual(ids(await searchTasksByText(USER, WS, '例会', 'all')), ['task-roadmap']);
  assert.deepEqual(ids(await searchTasksByText(USER, WS, '优先级', 'all')), ['task-roadmap']);
});

test('a natural-language Chinese question finds the recording (Ask AI mode)', async () => {
  await seed();
  const hits = await searchTasksByText(USER, WS, '上周会议的结论是什么？', 'any');
  assert.equal(hits[0]?.taskId, 'task-roadmap');
  assert.ok(!ids(hits).includes('task-weather'));

  const english = await searchTasksByText(USER, WS, 'What did we decide about the roadmap?', 'any');
  assert.equal(english[0]?.taskId, 'task-roadmap');
});

test('snippets show the original text without index separators', async () => {
  await seed();
  const [hit] = await searchTasksByText(USER, WS, '路线图', 'all');
  assert.ok(hit.snippet.includes('[路线图]') || hit.snippet.includes('路线图'), hit.snippet);
  assert.ok(!hit.snippet.includes('​'));
});

test('renaming a recording makes the new Chinese title searchable', async () => {
  await seed();
  await db('tasks').where({ id: 'task-weather' }).update({ originalName: '周末散步录音' });
  await refreshTaskSearchMetadata(await db('tasks').where({ id: 'task-weather' }).first());
  assert.deepEqual(ids(await searchTasksByText(USER, WS, '散步录音', 'all')), ['task-weather']);
});

test('a poor query rewrite does not drop what the original query found', async () => {
  await seed();
  const settings = { llm: { baseUrl: llmUrl, apiKey: 'stub', model: 'stub' } };
  const result = await searchChunksHybrid(USER, WS, '路线图', { retrievalMode: 'fts', settings });
  assert.ok(result.taskRanking.some((item) => item.taskId === 'task-roadmap'));
});

test('mergeKeywordHits keeps each recording once with its best score', () => {
  const merged = mergeKeywordHits(
    [{ taskId: 'a', score: 2, snippet: 'a1' }, { taskId: 'b', score: 1, snippet: 'b1' }],
    [{ taskId: 'b', score: 5, snippet: 'b2' }, { taskId: 'c', score: 3, snippet: 'c2' }],
  );
  assert.deepEqual(merged.map((hit) => [hit.taskId, hit.snippet]), [['b', 'b2'], ['c', 'c2'], ['a', 'a1']]);
});

test('the migration converts an existing SQLite index to the CJK format', { skip: !isSqliteDb() }, async () => {
  await seed();
  // Simulate an index written before this change: plain text, no separators.
  await cjkMigration.down(db);
  assert.deepEqual(ids(await searchTasksByText(USER, WS, '会议', 'all')), []);
  await cjkMigration.up(db);
  assert.deepEqual(ids(await searchTasksByText(USER, WS, '会议', 'all')), ['task-roadmap']);
});
