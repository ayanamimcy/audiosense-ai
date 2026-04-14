import { computeAssociationsForTask } from './association-service.js';
import { isEmbeddingsConfigured } from '../ai/embeddings.js';
import logger from '../shared/logger.js';

const log = logger.child('background-analysis');

export function triggerAssociationAnalysis(userId: string, taskId: string) {
  if (!isEmbeddingsConfigured()) return;

  // Fire-and-forget async
  void computeAssociationsForTask(userId, taskId).catch((error) => {
    log.error('Background association analysis failed', { taskId, error: error instanceof Error ? error.message : String(error) });
  });
}
