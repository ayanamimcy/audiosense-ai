import fs from 'fs';
import knex, { type Knex } from 'knex';
import path from 'path';

const dbType = process.env.DB_TYPE || 'sqlite3';
const isSqlite = dbType === 'sqlite3';
const configuredSqliteFilename = process.env.SQLITE_FILENAME?.trim();
const sqliteFilename = configuredSqliteFilename
  ? path.resolve(configuredSqliteFilename)
  : path.join(process.cwd(), 'database.sqlite');

if (isSqlite) {
  fs.mkdirSync(path.dirname(sqliteFilename), { recursive: true });
}

const config = {
  sqlite3: {
    client: 'sqlite3',
    connection: {
      filename: sqliteFilename,
    },
    useNullAsDefault: true,
  },
  pg: {
    client: 'pg',
    connection: process.env.DATABASE_URL || 'postgres://user:password@localhost:5432/dbname',
  },
};

export const db = knex(config[dbType as keyof typeof config] || config.sqlite3);

async function ensureColumn(
  tableName: string,
  columnName: string,
  alter: (table: Knex.AlterTableBuilder) => void,
) {
  const hasColumn = await db.schema.hasColumn(tableName, columnName);
  if (!hasColumn) {
    await db.schema.alterTable(tableName, alter);
  }
}

async function ensureIndex(
  tableName: string,
  indexName: string,
  columns: string[],
  unique = false,
) {
  try {
    await db.schema.alterTable(tableName, (table) => {
      if (unique) {
        table.unique(columns, { indexName });
      } else {
        table.index(columns, indexName);
      }
    });
  } catch {
    // Ignore duplicate-index creation across repeated boots.
  }
}

async function ensureSqliteFts() {
  if (!isSqlite) {
    return;
  }

  await db.raw(
    `CREATE VIRTUAL TABLE IF NOT EXISTS task_chunk_fts USING fts5(
      taskChunkId UNINDEXED,
      taskId UNINDEXED,
      userId UNINDEXED,
      title,
      summary,
      tags,
      content
    )`,
  );
}

export async function initDb() {
  const hasUsers = await db.schema.hasTable('users');
  if (!hasUsers) {
    await db.schema.createTable('users', (table) => {
      table.string('id').primary();
      table.string('name').notNullable();
      table.string('email').notNullable().unique();
      table.string('passwordHash').notNullable();
      table.bigInteger('createdAt').notNullable();
    });
  }

  const hasSessions = await db.schema.hasTable('sessions');
  if (!hasSessions) {
    await db.schema.createTable('sessions', (table) => {
      table.string('id').primary();
      table.string('userId').notNullable().references('id').inTable('users').onDelete('CASCADE');
      table.string('tokenHash').notNullable().unique();
      table.bigInteger('expiresAt').notNullable();
      table.bigInteger('createdAt').notNullable();
      table.bigInteger('lastSeenAt').notNullable();
    });
  }

  const hasUserSettings = await db.schema.hasTable('user_settings');
  if (!hasUserSettings) {
    await db.schema.createTable('user_settings', (table) => {
      table.string('userId').primary().references('id').inTable('users').onDelete('CASCADE');
      table.text('settings').notNullable();
      table.bigInteger('createdAt').notNullable();
      table.bigInteger('updatedAt').notNullable();
    });
  }

  const hasProviderHealth = await db.schema.hasTable('provider_health');
  if (!hasProviderHealth) {
    await db.schema.createTable('provider_health', (table) => {
      table.string('provider').primary();
      table.integer('failureCount').notNullable().defaultTo(0);
      table.integer('successCount').notNullable().defaultTo(0);
      table.bigInteger('circuitOpenUntil');
      table.bigInteger('lastFailureAt');
      table.text('lastError');
      table.bigInteger('updatedAt').notNullable();
    });
  }

  const hasNotebooks = await db.schema.hasTable('notebooks');
  if (!hasNotebooks) {
    await db.schema.createTable('notebooks', (table) => {
      table.string('id').primary();
      table.string('userId').references('id').inTable('users').onDelete('CASCADE');
      table.string('name').notNullable();
      table.string('description');
      table.string('color');
      table.bigInteger('createdAt').notNullable();
    });
  } else {
    await ensureColumn('notebooks', 'userId', (table) => {
      table.string('userId').references('id').inTable('users').onDelete('CASCADE');
    });
    await ensureColumn('notebooks', 'description', (table) => {
      table.string('description');
    });
    await ensureColumn('notebooks', 'color', (table) => {
      table.string('color');
    });
  }

  const hasTasks = await db.schema.hasTable('tasks');
  if (!hasTasks) {
    await db.schema.createTable('tasks', (table) => {
      table.string('id').primary();
      table.string('userId').references('id').inTable('users').onDelete('CASCADE');
      table.string('filename').notNullable();
      table.string('originalName').notNullable();
      table.string('status').notNullable();
      table.text('result');
      table.text('transcript');
      table.text('summary');
      table.text('summaryPrompt');
      table.text('segments');
      table.text('speakers');
      table.text('metadata');
      table.bigInteger('createdAt').notNullable();
      table.string('notebookId').references('id').inTable('notebooks').onDelete('SET NULL');
      table.bigInteger('eventDate');
      table.text('tags');
      table.string('language');
      table.string('provider');
      table.string('sourceType');
      table.float('durationSeconds');
      table.bigInteger('startedAt');
      table.bigInteger('completedAt');
      table.bigInteger('updatedAt');
    });
  } else {
    await ensureColumn('tasks', 'userId', (table) => {
      table.string('userId').references('id').inTable('users').onDelete('CASCADE');
    });
    await ensureColumn('tasks', 'transcript', (table) => {
      table.text('transcript');
    });
    await ensureColumn('tasks', 'summary', (table) => {
      table.text('summary');
    });
    await ensureColumn('tasks', 'summaryPrompt', (table) => {
      table.text('summaryPrompt');
    });
    await ensureColumn('tasks', 'segments', (table) => {
      table.text('segments');
    });
    await ensureColumn('tasks', 'speakers', (table) => {
      table.text('speakers');
    });
    await ensureColumn('tasks', 'metadata', (table) => {
      table.text('metadata');
    });
    await ensureColumn('tasks', 'language', (table) => {
      table.string('language');
    });
    await ensureColumn('tasks', 'provider', (table) => {
      table.string('provider');
    });
    await ensureColumn('tasks', 'sourceType', (table) => {
      table.string('sourceType');
    });
    await ensureColumn('tasks', 'durationSeconds', (table) => {
      table.float('durationSeconds');
    });
    await ensureColumn('tasks', 'startedAt', (table) => {
      table.bigInteger('startedAt');
    });
    await ensureColumn('tasks', 'completedAt', (table) => {
      table.bigInteger('completedAt');
    });
    await ensureColumn('tasks', 'updatedAt', (table) => {
      table.bigInteger('updatedAt');
    });
  }

  const hasMessages = await db.schema.hasTable('task_messages');
  if (!hasMessages) {
    await db.schema.createTable('task_messages', (table) => {
      table.string('id').primary();
      table.string('taskId').notNullable().references('id').inTable('tasks').onDelete('CASCADE');
      table.string('role').notNullable();
      table.text('content').notNullable();
      table.bigInteger('createdAt').notNullable();
    });
  }

  const hasJobs = await db.schema.hasTable('task_jobs');
  if (!hasJobs) {
    await db.schema.createTable('task_jobs', (table) => {
      table.string('id').primary();
      table.string('taskId').notNullable().references('id').inTable('tasks').onDelete('CASCADE');
      table.string('userId').references('id').inTable('users').onDelete('CASCADE');
      table.string('status').notNullable();
      table.string('provider').notNullable();
      table.integer('attemptCount').notNullable().defaultTo(0);
      table.text('payload');
      table.text('lastError');
      table.bigInteger('runAfter').notNullable();
      table.bigInteger('lockedAt');
      table.string('workerId');
      table.bigInteger('createdAt').notNullable();
      table.bigInteger('updatedAt').notNullable();
    });
  }

  const hasTaskChunks = await db.schema.hasTable('task_chunks');
  if (!hasTaskChunks) {
    await db.schema.createTable('task_chunks', (table) => {
      table.string('id').primary();
      table.string('taskId').notNullable().references('id').inTable('tasks').onDelete('CASCADE');
      table.string('userId').references('id').inTable('users').onDelete('CASCADE');
      table.integer('chunkIndex').notNullable();
      table.text('content').notNullable();
      table.text('embedding');
      table.string('embeddingModel');
      table.bigInteger('createdAt').notNullable();
      table.bigInteger('updatedAt').notNullable();
    });
  } else {
    await ensureColumn('task_chunks', 'embedding', (table) => {
      table.text('embedding');
    });
    await ensureColumn('task_chunks', 'embeddingModel', (table) => {
      table.string('embeddingModel');
    });
  }

  await ensureIndex('notebooks', 'idx_notebooks_user_created', ['userId', 'createdAt']);
  await ensureIndex('tasks', 'idx_tasks_user_created', ['userId', 'createdAt']);
  await ensureIndex('tasks', 'idx_tasks_user_notebook', ['userId', 'notebookId']);
  await ensureIndex('task_messages', 'idx_task_messages_task_created', ['taskId', 'createdAt']);
  await ensureIndex('task_jobs', 'idx_task_jobs_status_run_after', ['status', 'runAfter']);
  await ensureIndex('sessions', 'idx_sessions_user_expires', ['userId', 'expiresAt']);
  await ensureIndex('task_chunks', 'idx_task_chunks_task_index', ['taskId', 'chunkIndex']);
  await ensureIndex('task_chunks', 'idx_task_chunks_user', ['userId']);

  await ensureSqliteFts();
}

export function isSqliteDb() {
  return isSqlite;
}
