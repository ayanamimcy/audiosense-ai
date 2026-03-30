import 'dotenv/config';

import knex from 'knex';
import path from 'path';

const TABLES = [
  'users',
  'sessions',
  'user_settings',
  'provider_health',
  'notebooks',
  'tasks',
  'task_messages',
  'task_jobs',
  'summary_prompts',
  'task_chunks',
] as const;

function parseArgs(argv: string[]) {
  const values: Record<string, string> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      values[key] = 'true';
      continue;
    }
    values[key] = next;
    index += 1;
  }

  return {
    from: values.from || process.env.SQLITE_SOURCE_FILENAME || process.env.SQLITE_FILENAME || '',
    to: values.to || process.env.PG_TARGET_DATABASE_URL || process.env.DATABASE_URL || '',
    truncate: values.truncate === 'true',
  };
}

async function truncateTarget(target: ReturnType<typeof knex>) {
  await target.raw(`
    TRUNCATE TABLE
      task_chunks,
      summary_prompts,
      task_jobs,
      task_messages,
      tasks,
      notebooks,
      provider_health,
      user_settings,
      sessions,
      users
    RESTART IDENTITY CASCADE
  `);
}

async function insertInBatches(
  target: ReturnType<typeof knex>,
  tableName: string,
  rows: Array<Record<string, unknown>>,
) {
  const batchSize = 200;
  for (let index = 0; index < rows.length; index += batchSize) {
    await target(tableName).insert(rows.slice(index, index + batchSize));
  }
}

async function ensureTargetReady(target: ReturnType<typeof knex>) {
  const hasMigrationsTable = await target.schema.hasTable('knex_migrations');
  const hasLockTable = await target.schema.hasTable('knex_migrations_lock');
  if (!hasMigrationsTable || !hasLockTable) {
    throw new Error('Target PostgreSQL database has not been migrated yet. Run `npm run db:migrate` first.');
  }
}

async function main() {
  const { from, to, truncate } = parseArgs(process.argv.slice(2));
  if (!from) {
    throw new Error('Missing source SQLite database. Use --from /path/to/database.sqlite');
  }
  if (!to) {
    throw new Error('Missing target PostgreSQL URL. Use --to postgres://...');
  }

  const source = knex({
    client: 'sqlite3',
    connection: { filename: path.resolve(from) },
    useNullAsDefault: true,
    pool: { min: 1, max: 1 },
  });
  const target = knex({
    client: 'pg',
    connection: to,
    pool: { min: 0, max: 2 },
  });

  try {
    await ensureTargetReady(target);

    const existingUsers = await target('users').count<{ count: string }>('id as count').first();
    if (Number(existingUsers?.count || 0) > 0 && !truncate) {
      throw new Error(
        'Target PostgreSQL database is not empty. Re-run with --truncate to wipe target tables before import.',
      );
    }

    await target.transaction(async (trx) => {
      if (truncate) {
        await truncateTarget(trx as unknown as ReturnType<typeof knex>);
      }

      for (const tableName of TABLES) {
        const hasSourceTable = await source.schema.hasTable(tableName);
        if (!hasSourceTable) {
          continue;
        }

        const rows = (await source(tableName).select('*')) as Array<Record<string, unknown>>;
        if (!rows.length) {
          continue;
        }

        await insertInBatches(trx as unknown as ReturnType<typeof knex>, tableName, rows);
        console.log(`Imported ${rows.length} rows into ${tableName}.`);
      }
    });

    console.log('SQLite -> PostgreSQL import completed.');
    console.log('If needed, run `npm run db:reindex-search` against PostgreSQL after the import.');
  } finally {
    await Promise.all([source.destroy(), target.destroy()]);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Failed to migrate SQLite data to PostgreSQL.');
  process.exitCode = 1;
});
