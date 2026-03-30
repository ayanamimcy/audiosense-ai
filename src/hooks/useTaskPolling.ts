import { useEffect } from 'react';
import type { AuthUser, Task } from '../types';

export function useTaskPolling(
  currentUser: AuthUser | null,
  tasks: Task[],
  selectedTaskId: string | null,
  refreshTasksAndSelection: (preferredTaskId?: string | null) => Promise<void>,
) {
  const hasActiveTasks = tasks.some((task) => task.status === 'pending' || task.status === 'processing');

  useEffect(() => {
    if (!currentUser || !hasActiveTasks) {
      return;
    }

    const interval = window.setInterval(() => {
      void refreshTasksAndSelection(selectedTaskId).catch((error) => {
        console.error('Failed to poll active tasks:', error);
      });
    }, 5000);

    return () => window.clearInterval(interval);
  }, [currentUser, hasActiveTasks, selectedTaskId]);
}
