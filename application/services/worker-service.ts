import { getTranscriptionQueueState, runRecoveryCycle, runWorkerCycle } from '../../lib/tasks/task-queue.js';

export async function runWorkerLoop(workerId: string, idleMs: number) {
  while (true) {
    const queueState = await getTranscriptionQueueState();
    const processed = queueState.paused
      ? await runRecoveryCycle(workerId)
      : await runWorkerCycle(workerId);

    if (!processed) {
      await new Promise((resolve) => setTimeout(resolve, idleMs));
    }
  }
}
