import 'dotenv/config';

import { v4 as uuidv4 } from 'uuid';
import { runWorkerLoop } from './application/services/worker-service.js';
import { initDb } from './db.js';
import config from './lib/config.js';
import logger from './lib/shared/logger.js';

const log = logger.child('worker');

const workerId = `worker-${uuidv4()}`;
const idleMs = config.worker.idleMs;

async function main() {
  await initDb();
  log.info('Audio worker started', { workerId });
  await runWorkerLoop(workerId, idleMs);
}

main().catch((error) => {
  log.error('Worker crashed', { error: error instanceof Error ? error.message : String(error) });
  process.exit(1);
});
