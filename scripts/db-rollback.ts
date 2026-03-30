import 'dotenv/config';

import { db, rollbackMigration } from '../db.js';

const rollbackAll = process.argv.includes('--all');

async function main() {
  const result = await rollbackMigration(rollbackAll);

  if (!result.rolledBack.length) {
    console.log('No migrations were rolled back.');
    return;
  }

  console.log(`Rolled back migration batch ${result.batchNo}:`);
  for (const migration of result.rolledBack) {
    console.log(`- ${migration}`);
  }
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Failed to roll back migrations.');
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.destroy();
  });
