import { useEffect, useRef } from 'react';
import { isTaskSummaryGenerating } from '../lib/taskSummary';
import { isTaskTagSuggestionGenerating } from '../lib/taskTagSuggestions';
import type { AuthUser, Task } from '../types';

/**
 * Polls list and detail independently so the workspace list view only refreshes
 * the task list, while the task detail view only refreshes the active task detail.
 */
export function useTaskPolling(
  currentUser: AuthUser | null,
  tasks: Task[],
  selectedTaskId: string | null,
  selectedTask: Task | null,
  options: {
    pollList: boolean;
    pollDetail: boolean;
  },
  fetchTasks: () => Promise<Task[]>,
  fetchTaskDetail: (taskId: string) => Promise<Task>,
) {
  const hasActiveTasks = tasks.some(
    (task) => task.status === 'pending' || task.status === 'processing' || task.status === 'blocked',
  );
  const hasActiveSelectedTask = Boolean(
    selectedTask && (
      selectedTask.status === 'pending' ||
      selectedTask.status === 'processing' ||
      selectedTask.status === 'blocked'
    ),
  );
  const hasPendingSummary = isTaskSummaryGenerating(selectedTask);
  const hasPendingTagSuggestions = isTaskTagSuggestionGenerating(selectedTask);
  const shouldPollList = options.pollList && hasActiveTasks;
  const shouldPollDetail = options.pollDetail && (
    hasActiveSelectedTask ||
    hasPendingSummary ||
    hasPendingTagSuggestions
  );
  const shouldPoll = shouldPollList || shouldPollDetail;

  const selectedTaskIdRef = useRef(selectedTaskId);
  selectedTaskIdRef.current = selectedTaskId;

  useEffect(() => {
    if (!currentUser || !shouldPoll) {
      return;
    }

    const interval = window.setInterval(() => {
      if (shouldPollList) {
        void fetchTasks().catch((error) => {
          console.error('Failed to poll active tasks:', error);
        });
      }

      if (shouldPollDetail) {
        const currentSelectedId = selectedTaskIdRef.current;
        if (!currentSelectedId) {
          return;
        }

        void fetchTaskDetail(currentSelectedId).catch((error) => {
          console.error('Failed to refresh selected task:', error);
        });
      }
    }, 5000);

    return () => window.clearInterval(interval);
  }, [currentUser, shouldPoll, shouldPollList, shouldPollDetail, fetchTasks, fetchTaskDetail]);
}
