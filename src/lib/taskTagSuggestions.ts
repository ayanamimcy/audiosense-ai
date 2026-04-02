import type { Task } from '../types';

type TagSuggestionTaskLike = Pick<Task, 'metadata' | 'status' | 'transcript'>;

function getTagSuggestionStatus(task?: TagSuggestionTaskLike | null) {
  const status = task?.metadata?.tagSuggestionStatus;
  return status === 'generating' || status === 'failed' ? status : null;
}

export function getTaskTagSuggestions(task?: TagSuggestionTaskLike | null) {
  const items = task?.metadata?.tagSuggestionItems;
  if (!Array.isArray(items)) {
    return [];
  }

  return items
    .map((item) => String(item || '').trim())
    .filter(Boolean);
}

export function isTaskTagSuggestionGenerating(task?: TagSuggestionTaskLike | null) {
  return getTagSuggestionStatus(task) === 'generating';
}

export function getTaskTagSuggestionError(task?: TagSuggestionTaskLike | null) {
  if (getTagSuggestionStatus(task) !== 'failed') {
    return null;
  }

  const error = task?.metadata?.tagSuggestionError;
  if (typeof error === 'string' && error.trim()) {
    return error.trim();
  }

  return 'Tag suggestion generation failed. Please try again.';
}

export function hasTaskTagSuggestionState(task?: TagSuggestionTaskLike | null) {
  return isTaskTagSuggestionGenerating(task)
    || Boolean(getTaskTagSuggestionError(task))
    || getTaskTagSuggestions(task).length > 0;
}

export function canTaskGenerateTagSuggestions(task?: TagSuggestionTaskLike | null) {
  return task?.status === 'completed' && Boolean(task.transcript);
}
