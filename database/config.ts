import fs from 'fs';
import path from 'path';
import pg from 'pg';
import type { Knex } from 'knex';

export type SupportedDbType = 'sqlite3' | 'pg';

function parseBoolean(value: string | undefined) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

const configuredDbType = String(process.env.DB_TYPE || 'sqlite3').trim().toLowerCase();
export const dbType: SupportedDbType = configuredDbType === 'pg' ? 'pg' : 'sqlite3';
export const isSqliteDb = dbType === 'sqlite3';

const configuredSqliteFilename = process.env.SQLITE_FILENAME?.trim();
export const sqliteFilename = configuredSqliteFilename
  ? path.resolve(configuredSqliteFilename)
  : path.join(process.cwd(), 'database.sqlite');

if (isSqliteDb) {
  fs.mkdirSync(path.dirname(sqliteFilename), { recursive: true });
}

const configuredPoolMin = Number(process.env.DB_POOL_MIN ?? (isSqliteDb ? 1 : 0));
const configuredPoolMax = Number(process.env.DB_POOL_MAX ?? (isSqliteDb ? 1 : 5));
const poolMin = Number.isFinite(configuredPoolMin) ? configuredPoolMin : isSqliteDb ? 1 : 0;
const poolMax = Number.isFinite(configuredPoolMax) ? configuredPoolMax : isSqliteDb ? 1 : 5;

if (!isSqliteDb) {
  // Keep bigint timestamp columns compatible with the rest of the app.
  pg.types.setTypeParser(20, (value) => Number(value));
}

export const migrationsDirectory = path.resolve(process.cwd(), 'database/migrations');
export const migrationLoadExtensions = ['.cjs'];
export const autoRunMigrationsRequested = parseBoolean(process.env.AUTO_RUN_MIGRATIONS);

export function getKnexConfig(): Knex.Config {
  if (isSqliteDb) {
    return {
      client: 'sqlite3',
      connection: {
        filename: sqliteFilename,
      },
      useNullAsDefault: true,
      pool: {
        min: 1,
        max: 1,
      },
    };
  }

  return {
    client: 'pg',
    connection: process.env.DATABASE_URL || 'postgres://user:password@localhost:5432/dbname',
    pool: {
      min: Math.max(0, poolMin),
      max: Math.max(Math.max(1, poolMin), poolMax),
    },
  };
}

export function getMigrationConfig(): Knex.MigratorConfig {
  return {
    directory: migrationsDirectory,
    loadExtensions: migrationLoadExtensions,
    tableName: 'knex_migrations',
  };
}
