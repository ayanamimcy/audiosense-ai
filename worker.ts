import 'dotenv/config';

import { v4 as uuidv4 } from 'uuid';
import { initDb } from './db.js';
import { runWorkerCycle } from './lib/task-queue.js';

const workerId = `worker-${uuidv4()}`;
const idleMs = Number(process.env.WORKER_IDLE_MS || 3000);

async function main() {
  await initDb();
  console.log(`Audio worker started: ${workerId}`);

  while (true) {
    const processed = await runWorkerCycle(workerId);
    if (!processed) {
      await new Promise((resolve) => setTimeout(resolve, idleMs));
    }
  }
}

main().catch((error) => {
  console.error('Worker crashed:', error);
  process.exit(1);
});
