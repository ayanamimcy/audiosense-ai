import 'dotenv/config';

import { listUserAuthRows } from '../database/repositories/users-sessions-repository.js';
import { db, initDb } from '../db.js';

async function main() {
  await initDb();

  const users = await listUserAuthRows();

  if (!users.length) {
    console.log('No users found.');
    return;
  }

  console.table(
    users.map((user) => ({
      id: user.id,
      name: user.name,
      email: user.email,
      createdAt: new Date(Number(user.createdAt)).toISOString(),
    })),
  );
}

main()
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'Failed to list users.';
    console.error(message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.destroy();
  });
