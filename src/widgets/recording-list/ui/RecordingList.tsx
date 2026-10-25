import { useState } from 'react';
import { Link } from 'react-router-dom';
import { format, isThisWeek, isToday, isYesterday } from 'date-fns';
import { cn } from '@/shared/lib/cn';
import { useAppDataContext } from '@/app/providers/app-data-context';
import {
  TASK_STATUS_TONE_CLASS,
  formatTaskDuration,
  getTaskStatusBadge,
  type Task,
} from '@/entities/task';

const PAGE_SIZE = 50;

function getTimeGroup(timestamp: number): string {
  const date = new Date(timestamp);
  if (isToday(date)) return 'Today';
  if (isYesterday(date)) return 'Yesterday';
  if (isThisWeek(date)) return 'Earlier this week';
  return format(date, 'MMMM yyyy');
}

/** Summaries are Markdown; a one-line preview reads better without heading and list markers. */
function toPlainSnippet(markdown: string) {
  return markdown
    .replace(/^\s{0,3}#{1,6}\s+[^\n]*\n+/, '')
    .replace(/[#*_`>]+/g, '')
    .replace(/^\s*[-+]\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function formatRowTime(timestamp: number) {
  const date = new Date(timestamp);
  if (isToday(date) || isYesterday(date)) return format(date, 'HH:mm');
  if (isThisWeek(date)) return format(date, 'EEE');
  return format(date, 'MMM d');
}

export function RecordingList({
  tasks,
  grouped,
  selectedTaskId,
  checkedIds,
  showNotebook,
  linkSearch,
  emptyMessage,
  onToggleChecked,
}: {
  tasks: Task[];
  /** Group by date (off for search results, which are ordered by relevance). */
  grouped: boolean;
  selectedTaskId: string | null;
  checkedIds: Set<string>;
  showNotebook: boolean;
  /** Query string kept on row links so filters survive opening a recording. */
  linkSearch: string;
  emptyMessage: string;
  onToggleChecked: (taskId: string) => void;
}) {
  const { notebooks } = useAppDataContext();
  const [limit, setLimit] = useState(PAGE_SIZE);
  const notebookNames = new Map(notebooks.map((notebook) => [notebook.id, notebook.name]));
  const hasChecked = checkedIds.size > 0;

  if (tasks.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-stone-300 px-4 py-8 text-center text-sm text-stone-600">
        {emptyMessage}
      </p>
    );
  }

  const visible = tasks.slice(0, limit);

  return (
    <div className="flex flex-col">
      {visible.map((task, index) => {
        const group = grouped ? getTimeGroup(task.createdAt) : null;
        const showGroupHeader = grouped && (index === 0 || getTimeGroup(visible[index - 1].createdAt) !== group);
        const isSelected = task.id === selectedTaskId;
        const isChecked = checkedIds.has(task.id);
        const badge = getTaskStatusBadge(task.status);
        const meta = [
          formatRowTime(task.createdAt),
          formatTaskDuration(task.durationSeconds),
          showNotebook ? (task.notebookId ? notebookNames.get(task.notebookId) : 'Inbox') : null,
        ].filter(Boolean).join(' · ');

        return (
          <div key={task.id}>
            {showGroupHeader ? (
              <div className="px-2 pt-4 pb-1.5 text-xs font-semibold text-stone-500 first:pt-1">{group}</div>
            ) : null}
            <div
              className={cn(
                'group flex items-start rounded-xl transition-colors',
                isSelected ? 'bg-white shadow-[0_0_0_1px_var(--color-stone-200),0_1px_2px_rgba(28,25,23,0.05)]' : 'hover:bg-white/70',
              )}
            >
              <label className="flex h-11 w-9 shrink-0 cursor-pointer items-center justify-center">
                <span className="sr-only">Select {task.originalName}</span>
                <input
                  type="checkbox"
                  checked={isChecked}
                  onChange={() => onToggleChecked(task.id)}
                  className={cn(
                    'h-4 w-4 cursor-pointer rounded border-stone-300 accent-stone-900 transition-opacity',
                    isChecked || hasChecked || isSelected
                      ? 'opacity-100'
                      : 'opacity-40 group-hover:opacity-100 focus-visible:opacity-100',
                  )}
                />
              </label>
              <Link
                to={{ pathname: `/notebook/${task.id}`, search: linkSearch }}
                aria-current={isSelected ? 'page' : undefined}
                className="min-w-0 flex-1 py-2.5 pr-3"
              >
                <span className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-stone-900">{task.originalName}</span>
                  {badge ? (
                    <span className={cn('shrink-0 rounded-md px-1.5 py-px text-[11px] font-semibold', TASK_STATUS_TONE_CLASS[badge.tone])}>
                      {badge.label}
                    </span>
                  ) : null}
                </span>
                <span className="mt-0.5 block truncate text-xs text-stone-500">{meta}</span>
                {task.summarySnippet ? (
                  <span className="mt-1 block truncate text-[13px] text-stone-600">{toPlainSnippet(task.summarySnippet)}</span>
                ) : null}
              </Link>
            </div>
          </div>
        );
      })}
      {tasks.length > limit ? (
        <button
          type="button"
          onClick={() => setLimit((current) => current + PAGE_SIZE)}
          className="mt-2 h-10 rounded-lg text-sm font-medium text-stone-700 hover:bg-white"
        >
          Show more ({tasks.length - limit})
        </button>
      ) : null}
    </div>
  );
}
