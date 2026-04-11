import { computeAssociationsForTask } from './association-service.js';
import { isEmbeddingsConfigured } from './embeddings.js';

export function triggerAssociationAnalysis(userId: string, taskId: string) {
  if (!isEmbeddingsConfigured()) return;

  // Fire-and-forget async
  void computeAssociationsForTask(userId, taskId).catch((error) => {
    console.error(`Background association analysis failed for task ${taskId}:`, error);
  });
}
