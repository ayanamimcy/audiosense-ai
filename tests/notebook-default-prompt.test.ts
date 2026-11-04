import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb } from './helpers/setup.js';

const { db, resetDb, cleanup } = await setupTestDb();
const { saveUserSettings } = await import('../lib/settings/settings.js');
const { updateNotebookForUser } = await import('../application/services/notebooks-service.js');
const { deleteSummaryPromptForUser, updateSummaryPromptForUser } = await import(
  '../application/services/settings-service.js'
);
const {
  getDefaultSummaryPromptForNotebook,
  listSummaryPrompts,
  resolveDefaultSummaryPromptForNotebook,
} = await import('../lib/tasks/summary-prompts.js');

test.after(cleanup);

async function seed() {
  await resetDb();
  await db('users').insert({
    id: 'user-1',
    name: 'Ada',
    email: 'ada@example.com',
    passwordHash: 'salt:hash',
    createdAt: 1,
  });
  await db('workspaces').insert([
    { id: 'ws-a', userId: 'user-1', name: 'A', description: null, color: '#111111', createdAt: 2, updatedAt: 2 },
    { id: 'ws-b', userId: 'user-1', name: 'B', description: null, color: '#222222', createdAt: 3, updatedAt: 3 },
  ]);
  await saveUserSettings('user-1', { currentWorkspaceId: 'ws-a' });
  await db('notebooks').insert([
    { id: 'nb-meetings', userId: 'user-1', workspaceId: 'ws-a', name: 'Meetings', createdAt: 4 },
    { id: 'nb-lectures', userId: 'user-1', workspaceId: 'ws-a', name: 'Lectures', createdAt: 5 },
  ]);
  const prompt = (id: string, workspaceId: string, notebookIds: string[], isDefault: boolean) => ({
    id,
    userId: 'user-1',
    workspaceId,
    name: id,
    prompt: `${id} body`,
    notebookIds: JSON.stringify(notebookIds),
    isDefault: isDefault ? 1 : 0,
    createdAt: 6,
    updatedAt: 6,
  });
  await db('summary_prompts').insert([
    prompt('workspace-default', 'ws-a', [], true),
    prompt('lecture-notes', 'ws-a', ['nb-lectures'], false),
    prompt('action-items', 'ws-a', [], false),
    prompt('other-workspace', 'ws-b', [], false),
  ]);
}

async function notebookDefault(notebookId: string) {
  const row = await db('notebooks').where({ id: notebookId }).first();
  return row?.defaultSummaryPromptId ?? null;
}

test('a notebook default overrides the workspace default; others keep the workspace default', async () => {
  await seed();
  await updateNotebookForUser('user-1', 'nb-lectures', { defaultSummaryPromptId: 'lecture-notes' });

  const prompts = await listSummaryPrompts('user-1', 'ws-a');
  assert.equal((await resolveDefaultSummaryPromptForNotebook('user-1', prompts, 'nb-lectures'))?.id, 'lecture-notes');
  assert.equal((await resolveDefaultSummaryPromptForNotebook('user-1', prompts, 'nb-meetings'))?.id, 'workspace-default');
  assert.equal((await resolveDefaultSummaryPromptForNotebook('user-1', prompts, null))?.id, 'workspace-default');

  await updateNotebookForUser('user-1', 'nb-lectures', { defaultSummaryPromptId: null });
  assert.equal(await notebookDefault('nb-lectures'), null);
  assert.equal((await resolveDefaultSummaryPromptForNotebook('user-1', prompts, 'nb-lectures'))?.id, 'workspace-default');
});

test('a notebook default that is no longer available falls back to the workspace default', async () => {
  await seed();
  const prompts = await listSummaryPrompts('user-1', 'ws-a');
  assert.equal(getDefaultSummaryPromptForNotebook(prompts, 'nb-meetings', 'lecture-notes')?.id, 'workspace-default');
  assert.equal(getDefaultSummaryPromptForNotebook(prompts, 'nb-meetings', 'missing')?.id, 'workspace-default');
});

test('rejects templates from another workspace or not available in the notebook', async () => {
  await seed();
  await assert.rejects(
    updateNotebookForUser('user-1', 'nb-meetings', { defaultSummaryPromptId: 'other-workspace' }),
    /not found/,
  );
  await assert.rejects(
    updateNotebookForUser('user-1', 'nb-meetings', { defaultSummaryPromptId: 'lecture-notes' }),
    /not available/,
  );
  assert.equal(await notebookDefault('nb-meetings'), null);
});

test('deleting a template or narrowing its notebooks clears notebook defaults that used it', async () => {
  await seed();
  await updateNotebookForUser('user-1', 'nb-meetings', { defaultSummaryPromptId: 'action-items' });
  await updateNotebookForUser('user-1', 'nb-lectures', { defaultSummaryPromptId: 'action-items' });

  await updateSummaryPromptForUser('user-1', 'action-items', { notebookIds: ['nb-lectures'] });
  assert.equal(await notebookDefault('nb-meetings'), null);
  assert.equal(await notebookDefault('nb-lectures'), 'action-items');

  await deleteSummaryPromptForUser('user-1', 'action-items');
  assert.equal(await notebookDefault('nb-lectures'), null);
});

test('moving a notebook to another workspace clears its default', async () => {
  await seed();
  await updateNotebookForUser('user-1', 'nb-meetings', { defaultSummaryPromptId: 'action-items' });
  await updateNotebookForUser('user-1', 'nb-meetings', { workspaceId: 'ws-b' });
  assert.equal(await notebookDefault('nb-meetings'), null);
});
