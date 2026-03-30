import 'dotenv/config';

import { db, runMigrations } from '../db.js';

async function main() {
  const result = await runMigrations();

  if (!result.applied.length) {
    console.log('Database is already up to date.');
    return;
  }

  console.log(`Applied migration batch ${result.batchNo}:`);
  for (const migration of result.applied) {
    console.log(`- ${migration}`);
  }
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Failed to run migrations.');
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.destroy();
  });
