import { useEffect, useRef, useState } from 'react';
import { Check, Folder, Pencil, Plus, Trash2, X } from 'lucide-react';
import { apiJson } from '@/shared/api/base';
import { cn } from '@/shared/lib/cn';
import type { Notebook, TagStat, Task } from '@/types';

export function DashboardSidebar({
  notebooks,
  tasks,
  tags,
  activeNotebookFilter,
  activeTagFilter,
  onToggleTagFilter,
  onSelectNotebook,
  onClearNotebookFilter,
  onSelectTask,
  onNotebooksChanged,
}: {
  notebooks: Notebook[];
  tasks: Task[];
  tags: TagStat[];
  activeNotebookFilter: string | null;
  activeTagFilter: string | null;
  onToggleTagFilter: (tag: string) => void;
  onSelectNotebook: (notebookId: string) => void;
  onClearNotebookFilter: () => void;
  onSelectTask: (taskId: string) => void;
  onNotebooksChanged: () => Promise<void>;
}) {
  const [isCreating, setIsCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [editingNotebookId, setEditingNotebookId] = useState<string | null>(null);
  const [editingNotebookName, setEditingNotebookName] = useState('');
  const editInputRef = useRef<HTMLInputElement | null>(null);

  const pendingTask = tasks.find((t) => t.status === 'pending' || t.status === 'processing' || t.status === 'blocked');

  const notebookStats = notebooks
    .map((nb) => {
      const count = tasks.filter((t) => t.notebookId === nb.id).length;
      return { ...nb, taskCount: count };
    })
    .sort((a, b) => b.taskCount - a.taskCount);

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) return;
    try {
      await apiJson('/api/notebooks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      setNewName('');
      setIsCreating(false);
      await onNotebooksChanged();
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Failed to create notebook.');
    }
  };

  const handleDelete = async (notebookId: string) => {
    if (!confirm('Delete this notebook? Recordings will be unassigned.')) return;
    try {
      await apiJson(`/api/notebooks/${notebookId}`, { method: 'DELETE' });
      await onNotebooksChanged();
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Failed to delete notebook.');
    }
  };

  useEffect(() => {
    if (editingNotebookId) {
      editInputRef.current?.focus();
      editInputRef.current?.select();
    }
  }, [editingNotebookId]);

  const startRename = (notebook: Notebook) => {
    setEditingNotebookId(notebook.id);
    setEditingNotebookName(notebook.name);
  };

  const cancelRename = () => {
    setEditingNotebookId(null);
    setEditingNotebookName('');
  };

  const handleRename = async (notebook: Notebook) => {
    const name = editingNotebookName.trim();
    if (!name) {
      cancelRename();
      return;
    }

    if (name === notebook.name) {
      cancelRename();
      return;
    }

    try {
      await apiJson(`/api/notebooks/${notebook.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      cancelRename();
      await onNotebooksChanged();
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Failed to rename notebook.');
    }
  };

  return (
    <div className="hidden lg:flex w-72 shrink-0 flex-col gap-4 overflow-y-auto custom-scrollbar">
      {/* Quick Actions */}
      {pendingTask && (
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <h4 className="text-xs font-semibold text-slate-900 mb-3">Quick Actions</h4>
          <button
            type="button"
            onClick={() => onSelectTask(pendingTask.id)}
            className="w-full text-left text-xs font-medium text-indigo-600 hover:text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-lg px-3 py-2 transition-colors truncate"
          >
            Review: {pendingTask.originalName}
          </button>
        </div>
      )}

      {/* Notebooks */}
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex items-center justify-between mb-3">
          <h4 className="text-xs font-semibold text-slate-900">Notebooks</h4>
          <button
            type="button"
            onClick={() => setIsCreating(true)}
            className="text-slate-400 hover:text-indigo-600 transition-colors"
            title="New notebook"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>

        {isCreating && (
          <div className="flex items-center gap-2 mb-3">
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void handleCreate(); if (e.key === 'Escape') setIsCreating(false); }}
              placeholder="Notebook name..."
              className="flex-1 min-w-0 text-xs px-2 py-1.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
              autoFocus
            />
            <button type="button" onClick={() => void handleCreate()} className="text-xs text-indigo-600 font-medium shrink-0">Add</button>
          </div>
        )}

        <div className="space-y-0.5">
          <button
            type="button"
            onClick={onClearNotebookFilter}
            className={cn(
              'w-full flex items-center gap-2 px-2 py-1.5 rounded-lg transition-colors text-left',
              !activeNotebookFilter ? 'bg-indigo-50 text-indigo-700' : 'hover:bg-slate-50 text-slate-600',
            )}
          >
            <Folder className="w-3.5 h-3.5 shrink-0" />
            <span className="flex-1 text-xs font-medium">All Recordings</span>
            <span className="text-[10px] text-slate-400 shrink-0">{tasks.length}</span>
          </button>
          {notebookStats.map((nb) => (
            editingNotebookId === nb.id ? (
              <div
                key={nb.id}
                className="flex items-center gap-1 px-2 py-1.5 rounded-lg border border-indigo-200 bg-indigo-50"
              >
                <input
                  ref={editInputRef}
                  type="text"
                  value={editingNotebookName}
                  onChange={(event) => setEditingNotebookName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      void handleRename(nb);
                    }
                    if (event.key === 'Escape') {
                      cancelRename();
                    }
                  }}
                  onBlur={() => void handleRename(nb)}
                  className="flex-1 min-w-0 rounded-lg border border-indigo-200 bg-white px-2 py-1 text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                <button
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => void handleRename(nb)}
                  className="shrink-0 rounded p-1 text-indigo-600 transition-colors hover:bg-white"
                  title="Save notebook name"
                >
                  <Check className="w-3 h-3" />
                </button>
                <button
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={cancelRename}
                  className="shrink-0 rounded p-1 text-slate-400 transition-colors hover:bg-white hover:text-slate-600"
                  title="Cancel rename"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ) : (
              <div
                key={nb.id}
                className={cn(
                  'flex items-center gap-2 px-2 py-1.5 rounded-lg transition-colors group',
                  activeNotebookFilter === nb.id ? 'bg-indigo-50' : 'hover:bg-slate-50',
                )}
              >
                <button
                  type="button"
                  onClick={() => onSelectNotebook(nb.id)}
                  className="flex items-center gap-2 flex-1 min-w-0 text-left"
                >
                  <Folder className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                  <span className="flex-1 text-xs text-slate-700 truncate">{nb.name}</span>
                  <span className="text-[10px] text-slate-400 shrink-0">{nb.taskCount}</span>
                </button>
                <div className="hidden items-center gap-0.5 shrink-0 group-hover:flex">
                  <button
                    type="button"
                    onClick={() => startRename(nb)}
                    className="p-0.5 text-slate-300 hover:text-indigo-500 transition-colors"
                    title="Rename notebook"
                  >
                    <Pencil className="w-3 h-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDelete(nb.id)}
                    className="p-0.5 text-slate-300 hover:text-red-500 transition-colors"
                    title="Delete notebook"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              </div>
            )
          ))}
          {notebookStats.length === 0 && !isCreating && (
            <p className="text-xs text-slate-400 py-1">No notebooks yet.</p>
          )}
        </div>
      </div>

      {/* Popular Tags */}
      {tags.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <h4 className="text-xs font-semibold text-slate-900 mb-3">Popular Tags</h4>
          <div className="flex flex-wrap gap-1.5">
            {tags.slice(0, 15).map((tag) => (
              <button
                key={tag.name}
                type="button"
                onClick={() => onToggleTagFilter(tag.name)}
                className={cn(
                  'text-[10px] px-2 py-0.5 rounded-full border transition-colors',
                  activeTagFilter === tag.name
                    ? 'bg-indigo-50 text-indigo-700 border-indigo-200'
                    : 'text-slate-500 bg-slate-50 border-slate-200 hover:bg-indigo-50 hover:text-indigo-600',
                )}
              >
                #{tag.name} <span className="text-slate-400">{tag.count}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
