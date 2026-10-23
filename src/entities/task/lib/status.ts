import type { Task, TaskStatus } from '../model/types';

export type TaskStatusTone = 'active' | 'failed' | 'muted';

/**
 * Completed tasks need no badge — status is only surfaced when it asks for attention.
 */
export function getTaskStatusBadge(status: TaskStatus): { label: string; tone: TaskStatusTone } | null {
  switch (status) {
    case 'pending':
      return { label: 'Queued', tone: 'active' };
    case 'processing':
      return { label: 'Processing', tone: 'active' };
    case 'blocked':
      return { label: 'Waiting', tone: 'active' };
    case 'failed':
      return { label: 'Failed', tone: 'failed' };
    case 'cancelled':
      return { label: 'Cancelled', tone: 'muted' };
    default:
      return null;
  }
}

export const TASK_STATUS_TONE_CLASS: Record<TaskStatusTone, string> = {
  active: 'bg-amber-100 text-amber-900',
  failed: 'bg-red-100 text-red-800',
  muted: 'bg-stone-100 text-stone-600',
};

export function isTaskActive(task: Pick<Task, 'status'>) {
  return task.status === 'pending' || task.status === 'processing' || task.status === 'blocked';
}

export function formatTaskDuration(seconds?: number | null) {
  if (!seconds || seconds <= 0) return null;
  if (seconds < 60) return `${Math.round(seconds)} sec`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}
