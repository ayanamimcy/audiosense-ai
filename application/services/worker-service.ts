import { runWorkerCycle } from '../../lib/task-queue.js';

export async function runWorkerLoop(workerId: string, idleMs: number) {
  while (true) {
    const processed = await runWorkerCycle(workerId);
    if (!processed) {
      await new Promise((resolve) => setTimeout(resolve, idleMs));
    }
  }
}
