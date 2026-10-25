import config from '../../lib/config.js';
import logger from '../../lib/shared/logger.js';
import {
  getTranscriptionQueueState,
  reclaimExpiredJobs,
  runRecoveryCycle,
  runWorkerCycle,
} from '../../lib/tasks/task-queue.js';

const log = logger.child('worker-loop');

export async function runWorkerLoop(workerId: string, idleMs: number) {
  // Sweep for abandoned jobs about as often as a live worker heartbeats, so a crash
  // is noticed within roughly leaseMs + heartbeatMs.
  const reclaimEveryMs = Math.max(1000, Math.min(config.worker.heartbeatMs, config.worker.leaseMs));
  let lastReclaimAt = 0;

  while (true) {
    if (Date.now() - lastReclaimAt >= reclaimEveryMs) {
      lastReclaimAt = Date.now();
      try {
        await reclaimExpiredJobs();
      } catch (error) {
        log.error('Failed to reclaim expired jobs', {
          workerId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const queueState = await getTranscriptionQueueState();
    const processed = queueState.paused
      ? await runRecoveryCycle(workerId)
      : await runWorkerCycle(workerId);

    if (!processed) {
      await new Promise((resolve) => setTimeout(resolve, idleMs));
    }
  }
}
