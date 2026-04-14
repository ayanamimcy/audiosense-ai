import fs from 'fs';
import path from 'path';
import { db } from './client.js';
import config from '../lib/config.js';
import {
  autoRunMigrationsRequested,
  getMigrationConfig,
  migrationsDirectory,
  migrationLoadExtensions,
} from './config.js';

function listMigrationFiles() {
  if (!fs.existsSync(migrationsDirectory)) {
    return [];
  }

  return fs
    .readdirSync(migrationsDirectory)
    .filter((filename) => migrationLoadExtensions.some((extension) => filename.endsWith(extension)))
    .sort();
}

async function getAppliedMigrationNames() {
  const hasMigrationTable = await db.schema.hasTable('knex_migrations');
  if (!hasMigrationTable) {
    return [];
  }

  const rows = (await db('knex_migrations').select('name').orderBy('id', 'asc')) as Array<{ name: string }>;
  return rows.map((row) => row.name);
}

export async function getMigrationReadiness() {
  const migrationFiles = listMigrationFiles();
  const hasMigrationTable = await db.schema.hasTable('knex_migrations');
  const hasLockTable = await db.schema.hasTable('knex_migrations_lock');

  if (!migrationFiles.length) {
    return {
      ready: true,
      applied: [] as string[],
      pending: [] as string[],
      message: 'No migration files found.',
    };
  }

  if (!hasMigrationTable || !hasLockTable) {
    return {
      ready: false,
      applied: [] as string[],
      pending: migrationFiles,
      message: 'Database schema is not initialized. Run `npm run db:migrate` before starting the app.',
    };
  }

  const applied = await getAppliedMigrationNames();
  const appliedSet = new Set(applied);
  const pending = migrationFiles.filter((filename) => !appliedSet.has(filename));

  if (pending.length > 0) {
    return {
      ready: false,
      applied,
      pending,
      message: `Database schema is out of date. Pending migrations: ${pending.join(', ')}. Run \`npm run db:migrate\`.`,
    };
  }

  return {
    ready: true,
    applied,
    pending: [] as string[],
    message: 'Database schema is up to date.',
  };
}

export async function runMigrations() {
  const [batchNo, log] = await db.migrate.latest(getMigrationConfig());
  return {
    batchNo,
    applied: log,
  };
}

export async function rollbackMigration(all = false) {
  const [batchNo, log] = await db.migrate.rollback(getMigrationConfig(), all);
  return {
    batchNo,
    rolledBack: log,
  };
}

export async function getMigrationStatus() {
  const [completed, pending] = await db.migrate.list(getMigrationConfig());
  return {
    completed,
    pending,
  };
}

export async function ensureDatabaseReady() {
  if (autoRunMigrationsRequested) {
    if (config.server.isProduction) {
      throw new Error(
        'AUTO_RUN_MIGRATIONS is disabled in production. Run `npm run db:migrate` during deployment instead.',
      );
    }
    await runMigrations();
    return;
  }

  const readiness = await getMigrationReadiness();
  if (!readiness.ready) {
    throw new Error(readiness.message);
  }
}

export function createMigrationFilePath(name: string) {
  const safeName = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'migration';
  const now = new Date();
  const timestamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
    String(now.getHours()).padStart(2, '0'),
    String(now.getMinutes()).padStart(2, '0'),
    String(now.getSeconds()).padStart(2, '0'),
  ].join('');

  return path.join(migrationsDirectory, `${timestamp}_${safeName}.cjs`);
}
