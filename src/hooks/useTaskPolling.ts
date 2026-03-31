import { useEffect, useRef } from 'react';
import type { AuthUser, Task } from '../types';

/**
 * Polls for task list updates when there are active (pending/processing) tasks.
 * Only refreshes the task list and the currently-selected task detail — never
 * forces a new selection, so it won't hijack the mobile view.
 */
export function useTaskPolling(
  currentUser: AuthUser | null,
  tasks: Task[],
  selectedTaskId: string | null,
  fetchTasks: () => Promise<Task[]>,
  fetchTaskDetail: (taskId: string) => Promise<Task>,
) {
  const hasActiveTasks = tasks.some((task) => task.status === 'pending' || task.status === 'processing');
  const selectedTaskIdRef = useRef(selectedTaskId);
  selectedTaskIdRef.current = selectedTaskId;

  useEffect(() => {
    if (!currentUser || !hasActiveTasks) {
      return;
    }

    const interval = window.setInterval(() => {
      // Refresh the task list silently (no selection change)
      void fetchTasks().catch((error) => {
        console.error('Failed to poll active tasks:', error);
      });
      // If a task is selected, refresh its detail too
      const currentSelectedId = selectedTaskIdRef.current;
      if (currentSelectedId) {
        void fetchTaskDetail(currentSelectedId).catch((error) => {
          console.error('Failed to refresh selected task:', error);
        });
      }
    }, 5000);

    return () => window.clearInterval(interval);
  }, [currentUser, hasActiveTasks]);
}
