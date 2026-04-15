import { useEffect, useRef } from 'react';
import { isTaskSummaryGenerating, isTaskTagSuggestionGenerating } from '@/entities/task';
import type { AuthUser } from '@/entities/user';
import type { Task } from '@/entities/task';

const POLL_INTERVAL_MS = 5000;

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

    const runTick = () => {
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
    };

    let intervalId: number | null = null;
    const clearTimer = () => {
      if (intervalId !== null) {
        window.clearInterval(intervalId);
        intervalId = null;
      }
    };
    const startTimer = () => {
      if (intervalId === null) {
        intervalId = window.setInterval(runTick, POLL_INTERVAL_MS);
      }
    };

    // Only run when the tab is visible. Hidden tabs don't need fresh data and cost battery/bandwidth.
    // When the tab becomes visible again, run once immediately to catch up.
    const handleVisibilityChange = () => {
      if (document.hidden) {
        clearTimer();
      } else {
        runTick();
        startTimer();
      }
    };

    if (!document.hidden) {
      startTimer();
    }
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      clearTimer();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [currentUser, shouldPoll, shouldPollList, shouldPollDetail, fetchTasks, fetchTaskDetail]);
}
