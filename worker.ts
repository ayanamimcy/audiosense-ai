import 'dotenv/config';

import { v4 as uuidv4 } from 'uuid';
import { runWorkerLoop } from './application/services/worker-service.js';
import { initDb } from './db.js';

const workerId = `worker-${uuidv4()}`;
const idleMs = Number(process.env.WORKER_IDLE_MS || 3000);

async function main() {
  await initDb();
  console.log(`Audio worker started: ${workerId}`);
  await runWorkerLoop(workerId, idleMs);
}

main().catch((error) => {
  console.error('Worker crashed:', error);
  process.exit(1);
});
