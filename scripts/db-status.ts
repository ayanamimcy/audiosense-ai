import 'dotenv/config';

import { db, getMigrationReadiness, getMigrationStatus } from '../db.js';

async function main() {
  const { completed, pending } = await getMigrationStatus();
  const readiness = await getMigrationReadiness();
  const formatMigration = (entry: string | { file?: string; name?: string }) =>
    typeof entry === 'string' ? entry : entry.file || entry.name || JSON.stringify(entry);

  console.log(`Database ready: ${readiness.ready ? 'yes' : 'no'}`);
  console.log(`Completed migrations: ${completed.length}`);
  for (const migration of completed) {
    console.log(`- ${formatMigration(migration as string | { file?: string; name?: string })}`);
  }

  console.log(`Pending migrations: ${pending.length}`);
  for (const migration of pending) {
    console.log(`- ${formatMigration(migration as string | { file?: string; name?: string })}`);
  }

  if (!readiness.ready) {
    console.log(readiness.message);
    process.exitCode = 1;
  }
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Failed to inspect migration status.');
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.destroy();
  });
