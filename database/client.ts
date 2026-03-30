import knex from 'knex';
import { dbType, getKnexConfig, isSqliteDb, sqliteFilename } from './config.js';

export const db = knex(getKnexConfig());

export { dbType, isSqliteDb, sqliteFilename };
