import { useState } from 'react';
import { format, formatDistanceToNow, isToday, isYesterday, isThisWeek } from 'date-fns';
import { FileAudio } from 'lucide-react';
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
}: {
  tasks: Task[];
  title?: string;
  onSelectTask: (taskId: string) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const sorted = [...tasks].sort((a, b) => b.createdAt - a.createdAt);
  const visible = showAll ? sorted : sorted.slice(0, PAGE_SIZE);

  if (sorted.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-200 p-6 text-center text-sm text-slate-400">
        No recordings yet.
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
                onClick={() => onSelectTask(task.id)}
                className={cn(
                  'w-full text-left flex items-center gap-3 p-2.5 rounded-xl transition-colors hover:bg-slate-50',
                  !task.notebookId && 'border-l-2 border-l-indigo-400',
                )}
              >
                <FileAudio className="w-4 h-4 text-indigo-400 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-slate-800 truncate">{task.originalName}</span>
                    <span className={cn(
                      'shrink-0 w-1.5 h-1.5 rounded-full',
                      task.status === 'completed' ? 'bg-emerald-500'
                        : task.status === 'processing' ? 'bg-amber-500'
                        : task.status === 'pending' ? 'bg-indigo-400'
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
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
