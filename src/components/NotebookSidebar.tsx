import React, { useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { ChevronDown, ChevronUp, Edit2, FileAudio, Folder, Plus, Tag, Trash2, X } from 'lucide-react';
import { apiFetch } from '../api';
import { cn } from '../lib/utils';
import type { Notebook, TagStat, Task } from '../types';

export function NotebookSidebar({
  tasks,
  notebooks,
  tags,
  selectedNotebookId,
  selectedTags,
  onSelectAll,
  onSelectNotebook,
  onClearTags,
  onToggleTag,
  onSelectTask,
  onEditTask,
  onUpdateNotebooks,
  onUpdateTasks,
}: {
  tasks: Task[];
  notebooks: Notebook[];
  tags: TagStat[];
  selectedNotebookId: string | null;
  selectedTags: string[];
  onSelectAll: () => void;
  onSelectNotebook: (id: string) => void;
  onClearTags: () => void;
  onToggleTag: (tag: string) => void;
  onSelectTask: (taskId: string) => void;
  onEditTask: (task: Task) => void;
  onUpdateNotebooks: () => void | Promise<void>;
  onUpdateTasks: () => void | Promise<void>;
}) {
  const [isCreating, setIsCreating] = useState(false);
  const [isTagsExpanded, setIsTagsExpanded] = useState(false);
  const [newName, setNewName] = useState('');

  const handleCreate = async () => {
    if (!newName.trim()) return;
    try {
      const res = await apiFetch('/api/notebooks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim() }),
      });
      if (!res.ok) throw new Error('Failed to create notebook.');
      setNewName('');
      setIsCreating(false);
      await onUpdateNotebooks();
    } catch (error) {
      console.error('Failed to create notebook:', error);
    }
  };

  const handleDelete = async (event: React.MouseEvent, id: string) => {
    event.stopPropagation();
    if (!confirm('Delete this notebook? Tasks will remain but become unassigned.')) return;
    try {
      await apiFetch(`/api/notebooks/${id}`, { method: 'DELETE' });
      if (selectedNotebookId === id) onSelectAll();
      await onUpdateNotebooks();
      await onUpdateTasks();
    } catch (error) {
      console.error('Failed to delete notebook:', error);
    }
  };

  return (
    <div className="w-full lg:w-80 lg:h-full max-h-[420px] bg-white border border-slate-200 rounded-2xl p-3 sm:p-4 flex flex-col shadow-sm lg:overflow-hidden shrink-0">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-slate-900">Notebooks</h2>
        <button onClick={() => setIsCreating(true)} className="p-1.5 text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-md transition-colors">
          <Plus className="w-5 h-5" />
        </button>
      </div>

      {isCreating && (
        <div className="mb-4 p-3 bg-slate-50 border border-slate-200 rounded-xl">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Notebook name..."
            className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 mb-2"
            autoFocus
            onKeyDown={(e) => e.key === 'Enter' && void handleCreate()}
          />
          <div className="flex justify-end gap-2">
            <button onClick={() => setIsCreating(false)} className="text-xs font-medium text-slate-500 hover:text-slate-700">Cancel</button>
            <button onClick={() => void handleCreate()} className="text-xs font-medium text-indigo-600 hover:text-indigo-700">Create</button>
          </div>
        </div>
      )}

      <div className="space-y-4 overflow-y-auto custom-scrollbar">
        <div>
          <div
            onClick={onSelectAll}
            className={cn(
              'flex items-center gap-3 p-2.5 rounded-xl cursor-pointer transition-colors',
              selectedNotebookId === null ? 'bg-indigo-50 text-indigo-700 font-medium' : 'text-slate-600 hover:bg-slate-100',
            )}
          >
            <Folder className="w-4 h-4" />
            <span className="flex-1 text-sm">All Recordings</span>
            <span className="text-xs text-slate-400 bg-slate-200/50 px-2 py-0.5 rounded-full">{tasks.length}</span>
          </div>
        </div>

        <div className="space-y-1">
          {notebooks.map((notebook) => {
            const notebookTasks = tasks.filter((t) => t.notebookId === notebook.id);
            const isSelected = selectedNotebookId === notebook.id;
            return (
              <div key={notebook.id}>
                <div
                  onClick={() => onSelectNotebook(notebook.id)}
                  className={cn(
                    'flex items-center gap-3 p-2.5 rounded-xl cursor-pointer transition-colors group',
                    isSelected ? 'bg-indigo-50 text-indigo-700 font-medium' : 'text-slate-600 hover:bg-slate-100',
                  )}
                >
                  <Folder className="w-4 h-4 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <span className="text-sm truncate block">{notebook.name}</span>
                    {notebookTasks.length > 0 && (
                      <span className="text-[10px] text-slate-400">{formatDistanceToNow(Math.max(...notebookTasks.map((t) => t.createdAt)), { addSuffix: true })}</span>
                    )}
                  </div>
                  <span className="text-xs text-slate-400 bg-slate-200/50 px-2 py-0.5 rounded-full group-hover:hidden shrink-0">{notebookTasks.length}</span>
                  <button onClick={(e) => void handleDelete(e, notebook.id)} className="hidden group-hover:block p-1 text-slate-400 hover:text-red-500 rounded hover:bg-red-50">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
                {isSelected && notebookTasks.length > 0 && (
                  <div className="ml-6 mt-1 space-y-1 border-l-2 border-slate-100 pl-2">
                    {notebookTasks.slice(0, 5).map((task) => (
                      <div
                        key={task.id}
                        onClick={() => onSelectTask(task.id)}
                        className="p-2 text-sm text-slate-600 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg cursor-pointer truncate flex items-center justify-between group transition-colors"
                      >
                        <div className="flex items-center gap-2 truncate">
                          <FileAudio className="w-3 h-3 shrink-0 text-slate-400" />
                          <span className="truncate">{task.originalName}</span>
                        </div>
                        <button onClick={(e) => { e.stopPropagation(); onEditTask(task); }} className="hidden group-hover:block p-1 text-slate-400 hover:text-indigo-600 rounded">
                          <Edit2 className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="pt-4 border-t border-slate-100">
          <button
            onClick={() => setIsTagsExpanded((current) => !current)}
            className="w-full flex items-center justify-between gap-3 text-left"
          >
            <div className="flex items-center gap-2 min-w-0">
              <Tag className="w-4 h-4 text-slate-500" />
              <span className="text-sm font-medium text-slate-700">Tags</span>
              {selectedTags.length > 0 ? (
                <span className="truncate rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-indigo-700 border border-indigo-200">
                  {selectedTags.length} selected
                </span>
              ) : null}
            </div>
            <div className="flex items-center gap-2 text-xs text-slate-400 shrink-0">
              <span>{tags.length}</span>
              {isTagsExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </div>
          </button>

          {selectedTags.length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {selectedTags.map((tag) => (
                <button
                  key={tag}
                  onClick={() => onToggleTag(tag)}
                  className="inline-flex items-center gap-1 rounded-full border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-100 transition-colors"
                >
                  <span className="truncate">#{tag}</span>
                  <X className="w-3 h-3" />
                </button>
              ))}
            </div>
          ) : null}

          {isTagsExpanded ? (
            <div className="flex flex-wrap gap-2 mt-3">
              <button
                onClick={onClearTags}
                className={cn(
                  'px-3 py-1 rounded-full text-xs font-medium border',
                  selectedTags.length === 0 ? 'bg-indigo-50 text-indigo-700 border-indigo-200' : 'bg-white text-slate-600 border-slate-200',
                )}
              >
                All
              </button>
              {tags.map((tag) => (
                <button
                  key={tag.name}
                  onClick={() => onToggleTag(tag.name)}
                  className={cn(
                    'px-3 py-1 rounded-full text-xs font-medium border',
                    selectedTags.includes(tag.name) ? 'bg-indigo-50 text-indigo-700 border-indigo-200' : 'bg-white text-slate-600 border-slate-200',
                  )}
                >
                  #{tag.name}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
