import 'dotenv/config';

import { db, ensureDatabaseReady } from '../db.js';
import { reindexTask } from '../lib/search/search-index.js';
import type { TaskRow } from '../lib/tasks/task-types.js';

async function main() {
  await ensureDatabaseReady();

  const tasks = (await db('tasks')
    .where({ status: 'completed' })
    .whereNotNull('transcript')
    .select('*')
    .orderBy('createdAt', 'asc')) as TaskRow[];

  for (const task of tasks) {
    await reindexTask(task);
    console.log(`Reindexed task ${task.id}`);
  }

  console.log(`Reindexed ${tasks.length} tasks.`);
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Failed to rebuild search index.');
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.destroy();
  });
