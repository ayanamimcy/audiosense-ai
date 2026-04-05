import { useEffect, useRef } from 'react';
import { isTaskSummaryGenerating } from '../lib/taskSummary';
import { isTaskTagSuggestionGenerating } from '../lib/taskTagSuggestions';
import type { AuthUser, Task } from '../types';

/**
 * Polls for task list updates when there are active (pending/processing/blocked) tasks
 * or when the selected task has a summary being generated.
 * Only refreshes data — never forces a new selection.
 */
export function useTaskPolling(
  currentUser: AuthUser | null,
  tasks: Task[],
  selectedTaskId: string | null,
  selectedTask: Task | null,
  fetchTasks: () => Promise<Task[]>,
  fetchTaskDetail: (taskId: string) => Promise<Task>,
) {
  const hasActiveTasks = tasks.some(
    (task) => task.status === 'pending' || task.status === 'processing' || task.status === 'blocked',
  );
  const hasPendingSummary = isTaskSummaryGenerating(selectedTask);
  const hasPendingTagSuggestions = isTaskTagSuggestionGenerating(selectedTask);
  const shouldPoll = hasActiveTasks || hasPendingSummary || hasPendingTagSuggestions;

  const selectedTaskIdRef = useRef(selectedTaskId);
  selectedTaskIdRef.current = selectedTaskId;

  useEffect(() => {
    if (!currentUser || !shouldPoll) {
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
  }, [currentUser, shouldPoll]);
}
