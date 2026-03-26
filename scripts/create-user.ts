import 'dotenv/config';

import { createUser } from '../lib/auth.js';
import { db, initDb } from '../db.js';

function printUsage() {
  console.log(`
Create a local AudioSense user account.

Usage:
  npm run create:user -- --name "Your Name" --email "you@example.com" --password "supersecret"

Options:
  --name       Display name for the account
  --email      Login email address
  --password   Plain-text password (minimum 8 characters)
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
    name: (result.name || '').trim(),
    email: (result.email || '').trim().toLowerCase(),
    password: result.password || '',
    help: 'help' in result,
  };
}

async function main() {
  const { name, email, password, help } = parseArgs(process.argv.slice(2));

  if (help) {
    printUsage();
    return;
  }

  if (!name || !email || password.length < 8) {
    printUsage();
    throw new Error('Missing required arguments. Name, email, and password (min 8 chars) are required.');
  }

  await initDb();
  const user = await createUser({ name, email, password });

  console.log(`Created user ${user.email} (${user.id}).`);
}

main()
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'Failed to create user.';
    console.error(message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.destroy();
  });
