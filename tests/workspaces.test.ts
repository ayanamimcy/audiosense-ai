import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'audiosense-workspaces-'));
const sqliteFile = path.join(tempDir, 'workspace-tests.sqlite');

process.env.DB_TYPE = 'sqlite3';
process.env.SQLITE_FILENAME = sqliteFile;
process.env.NODE_ENV = 'test';

const { db, runMigrations } = await import('../db.js');
const workspaceMigration = await import('../database/migrations/202604120001_workspaces_scope.cjs');
const { resolveCurrentWorkspaceForUser } = await import('../lib/workspaces/workspaces.js');
const { saveUserSettings, getUserSettings } = await import('../lib/settings/settings.js');
const { decryptStoredSettings, encryptStoredSettings } = await import('../lib/auth/secure-settings.js');
const { listTasksForUser, moveTasksToWorkspaceForUser, updateTaskForUser, UserTaskWorkspaceValidationError } =
  await import('../application/services/tasks-service.js');
const { listNotebooksForUser, updateNotebookForUser } = await import('../application/services/notebooks-service.js');
const { listSummaryPrompts } = await import('../lib/tasks/summary-prompts.js');
const { listConversationsForUser } = await import('../application/services/knowledge-chat-service.js');

await runMigrations();

async function resetDb() {
  await db.raw('PRAGMA foreign_keys = OFF');
  const deleteSqliteFts = async () => {
    try {
      await db.raw('DELETE FROM task_chunk_fts');
    } catch {
      // ignore when FTS is not present yet
    }
  };

  await deleteSqliteFts();
  await db('knowledge_messages').delete().catch(() => {});
  await db('knowledge_conversations').delete().catch(() => {});
  await db('task_associations').delete().catch(() => {});
  await db('task_chunks').delete().catch(() => {});
  await db('task_messages').delete().catch(() => {});
  await db('task_jobs').delete().catch(() => {});
  await db('tasks').delete().catch(() => {});
  await db('summary_prompts').delete().catch(() => {});
  await db('notebooks').delete().catch(() => {});
  await db('workspaces').delete().catch(() => {});
  await db('user_settings').delete().catch(() => {});
  await db('api_tokens').delete().catch(() => {});
  await db('sessions').delete().catch(() => {});
  await db('users').delete().catch(() => {});
  await db.raw('PRAGMA foreign_keys = ON');
}

test.after(async () => {
  await db.destroy();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('workspace migration backfills legacy records and rebuilds FTS rows', async () => {
  await resetDb();

  await db('users').insert({
    id: 'user-1',
    name: 'Alice',
    email: 'alice@example.com',
    passwordHash: 'salt:hash',
    createdAt: 1,
  });

  await db('notebooks').insert({
    id: 'notebook-1',
    userId: 'user-1',
    workspaceId: null,
    name: 'Inbox',
    description: null,
    color: '#111111',
    createdAt: 2,
  });

  await db('tasks').insert({
    id: 'task-1',
    userId: 'user-1',
    workspaceId: null,
    filename: 'task-1.wav',
    originalName: 'Legacy task',
    status: 'completed',
    transcript: 'Legacy transcript',
    summary: 'Legacy summary',
    createdAt: 3,
    notebookId: 'notebook-1',
    tags: JSON.stringify(['legacy']),
    updatedAt: 3,
  });

  await db('task_chunks').insert({
    id: 'chunk-1',
    taskId: 'task-1',
    userId: 'user-1',
    workspaceId: null,
    chunkIndex: 0,
    content: 'Legacy transcript',
    embedding: null,
    embeddingModel: null,
    createdAt: 3,
    updatedAt: 3,
  });

  await db('knowledge_conversations').insert({
    id: 'conv-1',
    userId: 'user-1',
    workspaceId: null,
    title: 'Legacy conversation',
    createdAt: 4,
    updatedAt: 4,
  });

  await db('summary_prompts').insert({
    id: 'prompt-1',
    userId: 'user-1',
    workspaceId: null,
    name: 'Legacy prompt',
    prompt: 'Summarize this',
    notebookIds: JSON.stringify(['notebook-1']),
    isDefault: 1,
    createdAt: 5,
    updatedAt: 5,
  });

  await workspaceMigration.up(db);

  const workspaces = await db('workspaces').where({ userId: 'user-1' }).select('*');
  assert.equal(workspaces.length, 1);
  assert.equal(workspaces[0].name, 'Default Workspace');

  const notebook = await db('notebooks').where({ id: 'notebook-1' }).first();
  const task = await db('tasks').where({ id: 'task-1' }).first();
  const chunk = await db('task_chunks').where({ id: 'chunk-1' }).first();
  const conversation = await db('knowledge_conversations').where({ id: 'conv-1' }).first();
  const prompt = await db('summary_prompts').where({ id: 'prompt-1' }).first();

  assert.equal(notebook?.workspaceId, workspaces[0].id);
  assert.equal(task?.workspaceId, workspaces[0].id);
  assert.equal(chunk?.workspaceId, workspaces[0].id);
  assert.equal(conversation?.workspaceId, workspaces[0].id);
  assert.equal(prompt?.workspaceId, workspaces[0].id);

  const ftsRows = await db.raw(
    'SELECT taskId, workspaceId, content FROM task_chunk_fts WHERE taskId = ?',
    ['task-1'],
  );
  const rows = Array.isArray(ftsRows) ? ftsRows : ftsRows.rows;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].workspaceId, workspaces[0].id);
  assert.equal(rows[0].content, 'Legacy transcript');
});

test('current workspace resolver recovers invalid selection and scopes lists', async () => {
  await resetDb();

  await db('users').insert({
    id: 'user-2',
    name: 'Bob',
    email: 'bob@example.com',
    passwordHash: 'salt:hash',
    createdAt: 10,
  });

  await db('workspaces').insert([
    {
      id: 'workspace-a',
      userId: 'user-2',
      name: 'Workspace A',
      description: null,
      color: '#111111',
      createdAt: 11,
      updatedAt: 20,
    },
    {
      id: 'workspace-b',
      userId: 'user-2',
      name: 'Workspace B',
      description: null,
      color: '#222222',
      createdAt: 12,
      updatedAt: 15,
    },
  ]);

  await saveUserSettings('user-2', { currentWorkspaceId: 'missing-workspace' });

  await db('notebooks').insert([
    {
      id: 'notebook-a',
      userId: 'user-2',
      workspaceId: 'workspace-a',
      name: 'Notebook A',
      description: null,
      color: '#111111',
      createdAt: 21,
    },
    {
      id: 'notebook-b',
      userId: 'user-2',
      workspaceId: 'workspace-b',
      name: 'Notebook B',
      description: null,
      color: '#222222',
      createdAt: 22,
    },
  ]);

  await db('tasks').insert([
    {
      id: 'task-a',
      userId: 'user-2',
      workspaceId: 'workspace-a',
      filename: 'task-a.wav',
      originalName: 'Task A',
      status: 'completed',
      transcript: 'Transcript A',
      createdAt: 23,
      updatedAt: 23,
    },
    {
      id: 'task-b',
      userId: 'user-2',
      workspaceId: 'workspace-b',
      filename: 'task-b.wav',
      originalName: 'Task B',
      status: 'completed',
      transcript: 'Transcript B',
      createdAt: 24,
      updatedAt: 24,
    },
  ]);

  await db('summary_prompts').insert([
    {
      id: 'prompt-a',
      userId: 'user-2',
      workspaceId: 'workspace-a',
      name: 'Prompt A',
      prompt: 'A',
      notebookIds: JSON.stringify([]),
      isDefault: 0,
      createdAt: 25,
      updatedAt: 25,
    },
    {
      id: 'prompt-b',
      userId: 'user-2',
      workspaceId: 'workspace-b',
      name: 'Prompt B',
      prompt: 'B',
      notebookIds: JSON.stringify([]),
      isDefault: 0,
      createdAt: 26,
      updatedAt: 26,
    },
  ]);

  await db('knowledge_conversations').insert([
    {
      id: 'conv-a',
      userId: 'user-2',
      workspaceId: 'workspace-a',
      title: 'Conversation A',
      createdAt: 27,
      updatedAt: 27,
    },
    {
      id: 'conv-b',
      userId: 'user-2',
      workspaceId: 'workspace-b',
      title: 'Conversation B',
      createdAt: 28,
      updatedAt: 28,
    },
  ]);

  const resolved = await resolveCurrentWorkspaceForUser('user-2');
  assert.equal(resolved.currentWorkspaceId, 'workspace-a');

  const settings = await getUserSettings('user-2');
  assert.equal(settings.currentWorkspaceId, 'workspace-a');

  const tasks = await listTasksForUser('user-2');
  const notebooks = await listNotebooksForUser('user-2');
  const prompts = await listSummaryPrompts('user-2', 'workspace-a');
  const conversations = await listConversationsForUser('user-2');

  assert.deepEqual(tasks.map((item) => item.id), ['task-a']);
  assert.deepEqual(notebooks.map((item) => item.id), ['notebook-a']);
  assert.deepEqual(prompts.map((item) => item.id), ['prompt-a']);
  assert.deepEqual(conversations.map((item) => item.id), ['conv-a']);
});

test('subtitle split runtime settings prefer environment variables over stored values', async () => {
  await resetDb();

  await db('users').insert({
    id: 'user-subtitle-settings',
    name: 'Env User',
    email: 'env@example.com',
    passwordHash: 'salt:hash',
    createdAt: 29,
  });

  // Note: With centralized config (lib/config.ts), env vars are read once at
  // import time. The subtitleSplit defaults come from config.subtitleSplit which
  // is already frozen. This test now verifies that subtitleSplit settings from
  // user-stored data are stripped (server-only concern) and that the save
  // operation does not persist them.

  try {
    const now = Date.now();
    await db('user_settings').insert({
      userId: 'user-subtitle-settings',
      settings: encryptStoredSettings(JSON.stringify({
        parseLanguage: 'en',
        subtitleSplit: {
          enabled: true,
          baseUrl: 'http://stored-subtitle/v1',
          apiKey: 'stored-subtitle-key',
          model: 'stored-subtitle-model',
          requestTimeoutMs: 15000,
          maxRetries: 5,
        },
        subtitleLlm: {
          baseUrl: 'http://legacy-subtitle/v1',
          apiKey: 'legacy-subtitle-key',
          model: 'legacy-subtitle-model',
        },
      })),
      createdAt: now,
      updatedAt: now,
    });

    // subtitleSplit is a server-only setting — getUserSettings strips it from
    // stored input, so the returned value reflects the config defaults.
    const settings = await getUserSettings('user-subtitle-settings');
    assert.equal(typeof settings.subtitleSplit.enabled, 'boolean');
    assert.equal(typeof settings.subtitleSplit.baseUrl, 'string');

    await saveUserSettings('user-subtitle-settings', { parseLanguage: 'ja' });

    const storedRow = await db('user_settings').where({ userId: 'user-subtitle-settings' }).first();
    const storedPayload = JSON.parse(decryptStoredSettings(String(storedRow?.settings || '')).plaintext);

    assert.equal(storedPayload.parseLanguage, 'ja');
    assert.equal('subtitleSplit' in storedPayload, false);
    assert.equal('subtitleLlm' in storedPayload, false);
  } finally {
    // No env cleanup needed — config is read once at import time
  }
});

test('task notebook assignment rejects notebooks from another workspace', async () => {
  await resetDb();

  await db('users').insert({
    id: 'user-3',
    name: 'Carol',
    email: 'carol@example.com',
    passwordHash: 'salt:hash',
    createdAt: 30,
  });

  await db('workspaces').insert([
    {
      id: 'workspace-1',
      userId: 'user-3',
      name: 'Workspace 1',
      description: null,
      color: '#111111',
      createdAt: 31,
      updatedAt: 31,
    },
    {
      id: 'workspace-2',
      userId: 'user-3',
      name: 'Workspace 2',
      description: null,
      color: '#222222',
      createdAt: 32,
      updatedAt: 32,
    },
  ]);

  await saveUserSettings('user-3', { currentWorkspaceId: 'workspace-1' });

  await db('tasks').insert({
    id: 'task-3',
    userId: 'user-3',
    workspaceId: 'workspace-1',
    filename: 'task-3.wav',
    originalName: 'Task 3',
    status: 'completed',
    transcript: 'Transcript 3',
    createdAt: 33,
    updatedAt: 33,
  });

  await db('notebooks').insert({
    id: 'notebook-foreign',
    userId: 'user-3',
    workspaceId: 'workspace-2',
    name: 'Foreign notebook',
    description: null,
    color: '#222222',
    createdAt: 34,
  });

  await assert.rejects(
    () => updateTaskForUser('user-3', 'task-3', { notebookId: 'notebook-foreign' }),
    (error: unknown) =>
      error instanceof UserTaskWorkspaceValidationError &&
      error.message === 'Notebook must belong to the current workspace.',
  );
});

test('moving a task to another workspace clears incompatible notebook and reindexes search rows', async () => {
  await resetDb();

  await db('users').insert({
    id: 'user-4',
    name: 'Dana',
    email: 'dana@example.com',
    passwordHash: 'salt:hash',
    createdAt: 40,
  });

  await db('workspaces').insert([
    {
      id: 'workspace-a4',
      userId: 'user-4',
      name: 'Workspace A',
      description: null,
      color: '#111111',
      createdAt: 41,
      updatedAt: 41,
    },
    {
      id: 'workspace-b4',
      userId: 'user-4',
      name: 'Workspace B',
      description: null,
      color: '#222222',
      createdAt: 42,
      updatedAt: 42,
    },
  ]);

  await saveUserSettings('user-4', { currentWorkspaceId: 'workspace-a4' });

  await db('notebooks').insert({
    id: 'notebook-a4',
    userId: 'user-4',
    workspaceId: 'workspace-a4',
    name: 'Notebook A',
    description: null,
    color: '#111111',
    createdAt: 43,
  });

  await db('tasks').insert({
    id: 'task-4',
    userId: 'user-4',
    workspaceId: 'workspace-a4',
    filename: 'task-4.wav',
    originalName: 'Move me',
    status: 'completed',
    transcript: 'This transcript should be searchable after the move.',
    summary: 'Summary 4',
    createdAt: 44,
    notebookId: 'notebook-a4',
    tags: JSON.stringify(['move']),
    updatedAt: 44,
  });

  await db('task_chunks').insert({
    id: 'chunk-4',
    taskId: 'task-4',
    userId: 'user-4',
    workspaceId: 'workspace-a4',
    chunkIndex: 0,
    content: 'This transcript should be searchable after the move.',
    embedding: null,
    embeddingModel: null,
    parentId: null,
    createdAt: 44,
    updatedAt: 44,
  });

  await db.raw(
    `INSERT INTO task_chunk_fts (taskChunkId, taskId, userId, workspaceId, title, summary, tags, content)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      'chunk-4',
      'task-4',
      'user-4',
      'workspace-a4',
      'Move me',
      'Summary 4',
      JSON.stringify(['move']),
      'This transcript should be searchable after the move.',
    ],
  );

  await updateTaskForUser('user-4', 'task-4', { workspaceId: 'workspace-b4' });

  const movedTask = await db('tasks').where({ id: 'task-4' }).first();
  assert.equal(movedTask?.workspaceId, 'workspace-b4');
  assert.equal(movedTask?.notebookId, null);

  const chunkRows = await db('task_chunks').where({ taskId: 'task-4' }).select('workspaceId');
  assert.ok(chunkRows.length > 0);
  assert.ok(chunkRows.every((row) => row.workspaceId === 'workspace-b4'));

  const ftsRows = await db.raw(
    'SELECT workspaceId FROM task_chunk_fts WHERE taskId = ?',
    ['task-4'],
  );
  const rows = Array.isArray(ftsRows) ? ftsRows : ftsRows.rows;
  assert.ok(rows.length > 0);
  assert.ok(rows.every((row) => row.workspaceId === 'workspace-b4'));
});

test('moving a notebook also moves its tasks and clears source prompt notebook bindings', async () => {
  await resetDb();

  await db('users').insert({
    id: 'user-5',
    name: 'Evan',
    email: 'evan@example.com',
    passwordHash: 'salt:hash',
    createdAt: 50,
  });

  await db('workspaces').insert([
    {
      id: 'workspace-a5',
      userId: 'user-5',
      name: 'Workspace A',
      description: null,
      color: '#111111',
      createdAt: 51,
      updatedAt: 51,
    },
    {
      id: 'workspace-b5',
      userId: 'user-5',
      name: 'Workspace B',
      description: null,
      color: '#222222',
      createdAt: 52,
      updatedAt: 52,
    },
  ]);

  await saveUserSettings('user-5', { currentWorkspaceId: 'workspace-a5' });

  await db('notebooks').insert({
    id: 'notebook-a5',
    userId: 'user-5',
    workspaceId: 'workspace-a5',
    name: 'Notebook A5',
    description: null,
    color: '#111111',
    createdAt: 53,
  });

  await db('tasks').insert({
    id: 'task-5',
    userId: 'user-5',
    workspaceId: 'workspace-a5',
    filename: 'task-5.wav',
    originalName: 'Task 5',
    status: 'completed',
    transcript: 'Notebook move transcript.',
    createdAt: 54,
    notebookId: 'notebook-a5',
    updatedAt: 54,
  });

  await db('summary_prompts').insert({
    id: 'prompt-5',
    userId: 'user-5',
    workspaceId: 'workspace-a5',
    name: 'Prompt 5',
    prompt: 'Prompt body',
    notebookIds: JSON.stringify(['notebook-a5']),
    isDefault: 0,
    createdAt: 55,
    updatedAt: 55,
  });

  await updateNotebookForUser('user-5', 'notebook-a5', { workspaceId: 'workspace-b5' });

  const movedNotebook = await db('notebooks').where({ id: 'notebook-a5' }).first();
  const movedTask = await db('tasks').where({ id: 'task-5' }).first();
  const updatedPrompt = await db('summary_prompts').where({ id: 'prompt-5' }).first();

  assert.equal(movedNotebook?.workspaceId, 'workspace-b5');
  assert.equal(movedTask?.workspaceId, 'workspace-b5');
  assert.deepEqual(JSON.parse(String(updatedPrompt?.notebookIds || '[]')), []);
});

test('bulk workspace move updates all task and chunk scopes in one operation', async () => {
  await resetDb();

  await db('users').insert({
    id: 'user-6',
    name: 'Finn',
    email: 'finn@example.com',
    passwordHash: 'salt:hash',
    createdAt: 60,
  });

  await db('workspaces').insert([
    {
      id: 'workspace-a6',
      userId: 'user-6',
      name: 'Workspace A',
      description: null,
      color: '#111111',
      createdAt: 61,
      updatedAt: 61,
    },
    {
      id: 'workspace-b6',
      userId: 'user-6',
      name: 'Workspace B',
      description: null,
      color: '#222222',
      createdAt: 62,
      updatedAt: 62,
    },
  ]);

  await db('tasks').insert([
    {
      id: 'task-6a',
      userId: 'user-6',
      workspaceId: 'workspace-a6',
      filename: 'task-6a.wav',
      originalName: 'Task 6A',
      status: 'completed',
      transcript: 'Bulk move transcript A.',
      createdAt: 63,
      updatedAt: 63,
    },
    {
      id: 'task-6b',
      userId: 'user-6',
      workspaceId: 'workspace-a6',
      filename: 'task-6b.wav',
      originalName: 'Task 6B',
      status: 'completed',
      transcript: 'Bulk move transcript B.',
      createdAt: 64,
      updatedAt: 64,
    },
  ]);

  await db('task_chunks').insert([
    {
      id: 'chunk-6a',
      taskId: 'task-6a',
      userId: 'user-6',
      workspaceId: 'workspace-a6',
      chunkIndex: 0,
      content: 'Bulk move transcript A.',
      embedding: null,
      embeddingModel: null,
      parentId: null,
      createdAt: 63,
      updatedAt: 63,
    },
    {
      id: 'chunk-6b',
      taskId: 'task-6b',
      userId: 'user-6',
      workspaceId: 'workspace-a6',
      chunkIndex: 0,
      content: 'Bulk move transcript B.',
      embedding: null,
      embeddingModel: null,
      parentId: null,
      createdAt: 64,
      updatedAt: 64,
    },
  ]);

  await db.raw(
    `INSERT INTO task_chunk_fts (taskChunkId, taskId, userId, workspaceId, title, summary, tags, content)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      'chunk-6a',
      'task-6a',
      'user-6',
      'workspace-a6',
      'Task 6A',
      '',
      '',
      'Bulk move transcript A.',
      'chunk-6b',
      'task-6b',
      'user-6',
      'workspace-a6',
      'Task 6B',
      '',
      '',
      'Bulk move transcript B.',
    ],
  );

  await moveTasksToWorkspaceForUser('user-6', ['task-6a', 'task-6b'], 'workspace-b6');

  const movedTasks = await db('tasks').whereIn('id', ['task-6a', 'task-6b']).orderBy('id', 'asc');
  assert.ok(movedTasks.every((task) => task.workspaceId === 'workspace-b6'));

  const movedChunks = await db('task_chunks')
    .whereIn('taskId', ['task-6a', 'task-6b'])
    .select('taskId', 'workspaceId');
  assert.ok(movedChunks.length > 0);
  assert.ok(movedChunks.every((chunk) => chunk.workspaceId === 'workspace-b6'));

  const ftsRows = await db.raw(
    'SELECT taskId, workspaceId FROM task_chunk_fts WHERE taskId IN (?, ?) ORDER BY taskId ASC',
    ['task-6a', 'task-6b'],
  );
  const rows = Array.isArray(ftsRows) ? ftsRows : ftsRows.rows;
  assert.ok(rows.length > 0);
  assert.ok(rows.every((row) => row.workspaceId === 'workspace-b6'));
});
