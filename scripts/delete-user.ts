import 'dotenv/config';

import {
  deleteUserAuthRowById,
  findUserAuthRowByEmail,
  findUserAuthRowById,
} from '../database/repositories/users-sessions-repository.js';
import { db, initDb } from '../db.js';

function printUsage() {
  console.log(`
Delete a local AudioSense user account.

Usage:
  npm run delete:user -- --email "you@example.com"
  npm run delete:user -- --id "user-id"

Options:
  --email      Delete by login email address
  --id         Delete by user id
`.trim());
}

function parseArgs(argv: string[]) {
  const result: Record<string, string> = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      continue;
    }

    const key = token.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
      result[key] = '';
      continue;
    }

    result[key] = value;
    index += 1;
  }

  return {
    id: (result.id || '').trim(),
    email: (result.email || '').trim().toLowerCase(),
    help: 'help' in result,
  };
}

async function main() {
  const { id, email, help } = parseArgs(process.argv.slice(2));

  if (help) {
    printUsage();
    return;
  }

  if ((!id && !email) || (id && email)) {
    printUsage();
    throw new Error('Provide exactly one of --id or --email.');
  }

  await initDb();

  const user = id ? await findUserAuthRowById(id) : await findUserAuthRowByEmail(email);
  if (!user) {
    throw new Error('User not found.');
  }

  await deleteUserAuthRowById(String(user.id));
  console.log(`Deleted user ${String(user.email)} (${String(user.id)}).`);
}

main()
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'Failed to delete user.';
    console.error(message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.destroy();
  });
