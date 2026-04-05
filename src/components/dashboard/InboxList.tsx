import { useState } from 'react';
import { format, formatDistanceToNow, isToday, isYesterday, isThisWeek } from 'date-fns';
import { FileAudio, Trash2 } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { Task } from '../../types';

const PAGE_SIZE = 15;

function getTimeGroup(timestamp: number): string {
  const date = new Date(timestamp);
  if (isToday(date)) return 'Today';
  if (isYesterday(date)) return 'Yesterday';
  if (isThisWeek(date)) return 'This Week';
  return format(date, 'MMMM yyyy');
}

export function InboxList({
  tasks,
  title = 'Inbox',
  onSelectTask,
  selectedTaskId,
  isBatchMode = false,
  selectedIds = [],
  onToggleSelection,
  onDeleteTask,
  emptyStateMessage = 'No recordings yet.',
}: {
  tasks: Task[];
  title?: string;
  onSelectTask: (taskId: string) => void;
  selectedTaskId?: string | null;
  isBatchMode?: boolean;
  selectedIds?: string[];
  onToggleSelection?: (taskId: string) => void;
  onDeleteTask?: (taskId: string) => void;
  emptyStateMessage?: string;
}) {
  const [showAll, setShowAll] = useState(false);
  const sorted = [...tasks].sort((a, b) => b.createdAt - a.createdAt);
  const visible = showAll ? sorted : sorted.slice(0, PAGE_SIZE);

  if (sorted.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-200 p-6 text-center text-sm text-slate-400">
        {emptyStateMessage}
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
        {sorted.length > PAGE_SIZE && (
          <button
            type="button"
            onClick={() => setShowAll((v) => !v)}
            className="text-xs font-medium text-indigo-600 hover:text-indigo-700"
          >
            {showAll ? 'Show less' : `View all ${sorted.length}`}
          </button>
        )}
      </div>
      <div className="space-y-1">
        {visible.map((task, index) => {
          const group = getTimeGroup(task.createdAt);
          const prevGroup = index > 0 ? getTimeGroup(visible[index - 1].createdAt) : null;
          const showHeader = group !== prevGroup;

          return (
            <div key={task.id}>
              {showHeader && (
                <div className="pt-2 pb-1 first:pt-0">
                  <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">{group}</span>
                </div>
              )}
              <button
                type="button"
                onClick={() => isBatchMode ? onToggleSelection?.(task.id) : onSelectTask(task.id)}
                className={cn(
                  'w-full text-left flex items-center gap-3 p-2.5 rounded-xl border transition-colors',
                  selectedTaskId === task.id && !isBatchMode
                    ? 'border-indigo-500 bg-indigo-50/50'
                    : isBatchMode && selectedIds.includes(task.id)
                      ? 'border-indigo-400 bg-indigo-50/30 ring-1 ring-indigo-400'
                      : 'border-transparent hover:bg-slate-50',
                  !task.notebookId && 'border-l-2 border-l-indigo-400',
                )}
              >
                {isBatchMode ? (
                  <div className="mt-0.5 shrink-0">
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(task.id)}
                      readOnly
                      className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                    />
                  </div>
                ) : (
                  <FileAudio className="w-4 h-4 text-indigo-400 shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-slate-800 truncate">{task.originalName}</span>
                    <span className={cn(
                      'shrink-0 w-1.5 h-1.5 rounded-full',
                      task.status === 'completed' ? 'bg-emerald-500'
                        : task.status === 'processing' ? 'bg-amber-500'
                        : task.status === 'pending' ? 'bg-indigo-400'
                        : task.status === 'blocked' ? 'bg-violet-500'
                        : task.status === 'failed' ? 'bg-red-500'
                        : 'bg-slate-300',
                    )} />
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-[11px] text-slate-400">{formatDistanceToNow(task.createdAt, { addSuffix: true })}</span>
                    {task.durationSeconds ? <span className="text-[11px] text-slate-400">&bull; {Math.round(task.durationSeconds / 60)}m</span> : null}
                    {task.tags.length > 0 && (
                      <span className="text-[10px] text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">#{task.tags[0]}</span>
                    )}
                  </div>
                  {task.summarySnippet && (
                    <p className="text-[11px] text-slate-400 mt-0.5 line-clamp-1">{task.summarySnippet}</p>
                  )}
                </div>
                {!isBatchMode && onDeleteTask ? (
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onDeleteTask(task.id);
                    }}
                    className="shrink-0 rounded-md p-1.5 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-500"
                    aria-label="Delete recording"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                ) : null}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
