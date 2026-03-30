import { db, dbType, isSqliteDb as sqliteDbFlag, sqliteFilename } from './database/client.js';
import {
  createMigrationFilePath,
  ensureDatabaseReady,
  getMigrationReadiness,
  getMigrationStatus,
  rollbackMigration,
  runMigrations,
} from './database/bootstrap.js';

export { db, dbType, sqliteFilename };
export {
  createMigrationFilePath,
  ensureDatabaseReady,
  getMigrationReadiness,
  getMigrationStatus,
  rollbackMigration,
  runMigrations,
};

export function isSqliteDb() {
  return sqliteDbFlag;
}

export const initDb = ensureDatabaseReady;
