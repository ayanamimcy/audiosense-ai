/**
 * Shared test setup — creates a temporary SQLite database with all migrations applied.
 *
 * Usage:
 *   import { setupTestDb } from './helpers/setup.js';
 *   const { db, resetDb, cleanup } = await setupTestDb();
 */

import fs from 'fs';
import os from 'os';
import path from 'path';

export async function setupTestDb() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'audiosense-test-'));
  const sqliteFile = path.join(tempDir, 'test.sqlite');

  process.env.DB_TYPE = 'sqlite3';
  process.env.SQLITE_FILENAME = sqliteFile;
  process.env.NODE_ENV = 'test';

  const { db, runMigrations } = await import('../../db.js');
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

  async function cleanup() {
    await db.destroy();
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  }

  return { db, resetDb, cleanup };
}
