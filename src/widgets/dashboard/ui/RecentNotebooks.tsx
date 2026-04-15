import { formatDistanceToNow } from 'date-fns';
import { Folder } from 'lucide-react';
import type { Notebook, Task } from '@/types';

export function RecentNotebooks({
  notebooks,
  tasks,
  onSelectNotebook,
}: {
  notebooks: Notebook[];
  tasks: Task[];
  onSelectNotebook: (notebookId: string) => void;
}) {
  const notebookStats = notebooks.map((nb) => {
    const nbTasks = tasks.filter((t) => t.notebookId === nb.id);
    const latestCreatedAt = nbTasks.length > 0 ? Math.max(...nbTasks.map((t) => t.createdAt)) : nb.createdAt;
    return { ...nb, taskCount: nbTasks.length, latestCreatedAt };
  }).sort((a, b) => b.latestCreatedAt - a.latestCreatedAt);

  if (notebookStats.length === 0) {
    return null;
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-slate-900">Recent Notebooks</h3>
        <span className="text-[11px] text-slate-400">{notebooks.length} total</span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {notebookStats.slice(0, 6).map((nb) => (
          <button
            key={nb.id}
            type="button"
            onClick={() => onSelectNotebook(nb.id)}
            className="flex items-center gap-2.5 p-2.5 rounded-xl border border-slate-200 bg-white hover:border-indigo-200 hover:bg-indigo-50/30 transition-colors text-left"
          >
            <Folder className="w-4 h-4 text-slate-400 shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-slate-800 truncate">{nb.name}</p>
              <p className="text-[10px] text-slate-400">
                {nb.taskCount} &bull; {formatDistanceToNow(nb.latestCreatedAt, { addSuffix: true })}
              </p>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
