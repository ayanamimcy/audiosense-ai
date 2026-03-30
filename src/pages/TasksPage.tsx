import React, { useState } from 'react';
import { format } from 'date-fns';
import { RefreshCw, Search, Trash2 } from 'lucide-react';
import { apiFetch } from '../api';
import { cn } from '../lib/utils';
import { useAppDataContext } from '../contexts/AppDataContext';

export function TasksPage({
  onSelectTask,
  onRefresh,
}: {
  onSelectTask: (taskId: string) => void;
  onRefresh: () => void | Promise<void>;
}) {
  const { tasks, notebooks, tags, selectedTaskId } = useAppDataContext();
  const [searchQuery, setSearchQuery] = useState('');
  const [tagFilter, setTagFilter] = useState('');

  const handleDelete = async (event: React.MouseEvent, id: string) => {
    event.stopPropagation();
    if (!confirm('Are you sure you want to delete this task?')) {
      return;
    }

    await apiFetch(`/api/tasks/${id}`, { method: 'DELETE' });
    await onRefresh();
  };

  const filteredTasks = tasks.filter((task) => {
    const query = searchQuery.trim().toLowerCase();
    const matchesSearch =
      !query ||
      task.originalName.toLowerCase().includes(query) ||
      task.tags.some((tag) => tag.toLowerCase().includes(query));

    const matchesTag = !tagFilter || task.tags.includes(tagFilter);
    return matchesSearch && matchesTag;
  });

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 flex flex-col h-full min-h-[400px]">
      <div className="flex items-center justify-between mb-4 px-2">
        <h2 className="text-lg font-semibold text-slate-900">Recent Tasks</h2>
        <button onClick={() => void onRefresh()} className="p-1.5 text-slate-400 hover:text-slate-600 rounded-md hover:bg-slate-100">
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      <div className="mb-4 px-2 space-y-3">
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search task or tag..."
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 transition-all"
          />
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setTagFilter('')}
            className={cn(
              'px-3 py-1 rounded-full text-xs font-medium border transition-colors',
              !tagFilter ? 'bg-indigo-50 text-indigo-700 border-indigo-200' : 'bg-white text-slate-600 border-slate-200',
            )}
          >
            All
          </button>
          {tags.slice(0, 8).map((tag) => (
            <button
              key={tag.name}
              onClick={() => setTagFilter((current) => (current === tag.name ? '' : tag.name))}
              className={cn(
                'px-3 py-1 rounded-full text-xs font-medium border transition-colors',
                tagFilter === tag.name ? 'bg-indigo-50 text-indigo-700 border-indigo-200' : 'bg-white text-slate-600 border-slate-200',
              )}
            >
              #{tag.name}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto pr-2 space-y-2 custom-scrollbar">
        {filteredTasks.length === 0 ? (
          <div className="text-center py-8 text-slate-500 text-sm">{searchQuery || tagFilter ? 'No matching tasks found.' : 'No tasks yet.'}</div>
        ) : (
          filteredTasks.map((task) => {
            const notebook = notebooks.find((item) => item.id === task.notebookId);

            return (
              <div
                key={task.id}
                onClick={() => onSelectTask(task.id)}
                className={cn(
                  'p-3 rounded-xl border cursor-pointer transition-all flex items-start gap-3',
                  selectedTaskId === task.id ? 'border-indigo-500 bg-indigo-50/50' : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50',
                )}
              >
                <div className="mt-1">
                  {task.status === 'completed' && <div className="w-2.5 h-2.5 rounded-full bg-emerald-500" />}
                  {task.status === 'processing' && <div className="w-2.5 h-2.5 rounded-full bg-amber-500 animate-pulse" />}
                  {task.status === 'pending' && <div className="w-2.5 h-2.5 rounded-full bg-slate-300" />}
                  {task.status === 'failed' && <div className="w-2.5 h-2.5 rounded-full bg-red-500" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-900 truncate">{task.originalName}</p>
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    <span className="text-xs text-slate-500">{format(task.createdAt, 'MMM d, HH:mm')}</span>
                    <span className="text-xs text-slate-400 capitalize">• {task.status}</span>
                    {notebook && <span className="text-xs text-indigo-600">• {notebook.name}</span>}
                    {task.provider && <span className="text-xs text-slate-500">• {task.provider}</span>}
                  </div>
                  {task.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {task.tags.slice(0, 3).map((tag) => (
                        <span key={tag} className="text-[10px] font-medium text-slate-600 bg-slate-100 px-2 py-0.5 rounded-full">
                          #{tag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <button
                  onClick={(event) => void handleDelete(event, task.id)}
                  className="p-1.5 text-slate-400 hover:text-red-500 rounded-md hover:bg-red-50 transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
