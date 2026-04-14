import fs from 'fs';
import path from 'path';
import pg from 'pg';
import type { Knex } from 'knex';
import config from '../lib/config.js';

export type SupportedDbType = 'sqlite3' | 'pg';

export const dbType: SupportedDbType = config.db.type;
export const isSqliteDb = config.db.isSqlite;
export const sqliteFilename = config.db.sqliteFilename;

if (isSqliteDb) {
  fs.mkdirSync(path.dirname(sqliteFilename), { recursive: true });
}

if (!isSqliteDb) {
  // Keep bigint timestamp columns compatible with the rest of the app.
  pg.types.setTypeParser(20, (value) => Number(value));
}

export const migrationsDirectory = path.resolve(process.cwd(), 'database/migrations');
export const migrationLoadExtensions = ['.cjs'];
export const autoRunMigrationsRequested = config.db.autoRunMigrations;

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
    connection: config.db.databaseUrl,
    pool: {
      min: Math.max(0, config.db.poolMin),
      max: Math.max(Math.max(1, config.db.poolMin), config.db.poolMax),
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
