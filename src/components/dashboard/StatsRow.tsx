import { FileAudio, Inbox, Loader2 } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { Task } from '../../types';

export function StatsRow({
  tasks,
  activeFilter,
  onFilterChange,
}: {
  tasks: Task[];
  activeFilter: string | null;
  onFilterChange: (filter: string | null) => void;
}) {
  const inboxCount = tasks.filter((t) => !t.notebookId).length;
  const pendingCount = tasks.filter((t) => t.status === 'pending' || t.status === 'processing').length;
  const completedCount = tasks.filter((t) => t.status === 'completed').length;

  const stats = [
    { id: 'inbox', label: 'Inbox', count: inboxCount, icon: <Inbox className="w-4 h-4" />, color: 'text-indigo-600 bg-indigo-50 border-indigo-200' },
    { id: 'pending', label: 'Pending', count: pendingCount, icon: <Loader2 className="w-4 h-4" />, color: 'text-amber-600 bg-amber-50 border-amber-200' },
    { id: 'completed', label: 'Completed', count: completedCount, icon: <FileAudio className="w-4 h-4" />, color: 'text-emerald-600 bg-emerald-50 border-emerald-200' },
  ];

  return (
    <div className="grid grid-cols-3 gap-3">
      {stats.map((stat) => (
        <button
          key={stat.id}
          type="button"
          onClick={() => onFilterChange(activeFilter === stat.id ? null : stat.id)}
          className={cn(
            'flex items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors',
            activeFilter === stat.id ? stat.color : 'border-slate-200 bg-white hover:bg-slate-50',
          )}
        >
          <span className={cn('shrink-0', activeFilter === stat.id ? '' : 'text-slate-400')}>{stat.icon}</span>
          <div className="min-w-0">
            <p className="text-[11px] text-slate-500 font-medium">{stat.label}</p>
            <p className="text-lg font-bold text-slate-800 leading-tight">{stat.count}</p>
          </div>
        </button>
      ))}
    </div>
  );
}
