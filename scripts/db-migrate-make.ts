import fs from 'fs';
import path from 'path';

import { createMigrationFilePath } from '../db.js';

function parseName(argv: string[]) {
  const inline = argv.find((value) => value.startsWith('--name='));
  if (inline) {
    return inline.slice('--name='.length).trim();
  }

  const flagIndex = argv.findIndex((value) => value === '--name');
  if (flagIndex >= 0) {
    return String(argv[flagIndex + 1] || '').trim();
  }

  return String(argv[0] || '').trim();
}

const TEMPLATE = `'use strict';

exports.up = async function up(knex) {
  // TODO: implement migration
};

exports.down = async function down(knex) {
  // TODO: implement rollback
};
`;

async function main() {
  const name = parseName(process.argv.slice(2));
  if (!name) {
    throw new Error('Migration name is required. Example: npm run db:migrate:make -- add_task_priority');
  }

  const targetPath = createMigrationFilePath(name);
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, TEMPLATE, 'utf8');
  console.log(`Created migration: ${targetPath}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Failed to create migration file.');
  process.exitCode = 1;
});
