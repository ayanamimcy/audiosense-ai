import type { Task } from './types';

export const SUMMARY_GENERATING_SENTINEL = '__generating__';

type SummaryTaskLike = Pick<Task, 'summary' | 'metadata'>;

function getSummaryGenerationStatus(task?: SummaryTaskLike | null) {
  const status = task?.metadata?.summaryGenerationStatus;
  return status === 'generating' || status === 'failed' ? status : null;
}

export function isTaskSummaryGenerating(task?: SummaryTaskLike | null) {
  return task?.summary === SUMMARY_GENERATING_SENTINEL
    || getSummaryGenerationStatus(task) === 'generating';
}

export function getTaskSummaryGenerationError(task?: SummaryTaskLike | null) {
  if (getSummaryGenerationStatus(task) !== 'failed') {
    return null;
  }

  const error = task?.metadata?.summaryGenerationError;
  if (typeof error === 'string' && error.trim()) {
    return error.trim();
  }

  return 'Summary generation failed. Please try again.';
}

export function hasTaskSummaryState(task?: SummaryTaskLike | null) {
  return Boolean(task?.summary)
    || isTaskSummaryGenerating(task)
    || Boolean(getTaskSummaryGenerationError(task));
}
