import React, { useState } from 'react';
import { format } from 'date-fns';
import { Book, ChevronDown, ChevronUp, Loader2, RefreshCw, Search, Tag, Trash2, X } from 'lucide-react';
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
  const [tagFilters, setTagFilters] = useState<string[]>([]);
  const [isTagFiltersExpanded, setIsTagFiltersExpanded] = useState(false);

  // Batch mode state
  const [isBatchMode, setIsBatchMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [batchAction, setBatchAction] = useState<'notebook' | 'tags' | null>(null);
  const [batchNotebookId, setBatchNotebookId] = useState('');
  const [batchTags, setBatchTags] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);

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

    const matchesTag = tagFilters.length === 0
      ? true
      : tagFilters.some((tag) => task.tags.includes(tag));
    return matchesSearch && matchesTag;
  });

  const toggleTagFilter = (tag: string) => {
    setTagFilters((current) => (
      current.includes(tag)
        ? current.filter((item) => item !== tag)
        : [...current, tag]
    ));
  };

  // Batch helpers
  const toggleSelection = (id: string) => {
    setSelectedIds((prev) => prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]);
  };

  const toggleSelectAll = () => {
    if (selectedIds.length === filteredTasks.length && filteredTasks.length > 0) {
      setSelectedIds([]);
    } else {
      setSelectedIds(filteredTasks.map((t) => t.id));
    }
  };

  const exitBatchMode = () => {
    setIsBatchMode(false);
    setSelectedIds([]);
    setBatchAction(null);
    setBatchNotebookId('');
    setBatchTags('');
  };

  /** Run a batch operation with allSettled; exit on full success, keep failed items selected. */
  const runBatch = async (
    ids: string[],
    operation: (id: string) => Promise<unknown>,
    label: string,
  ) => {
    setIsProcessing(true);
    try {
      const results = await Promise.allSettled(ids.map(operation));
      const failedIds = ids.filter((_, i) => results[i].status === 'rejected');
      const successCount = ids.length - failedIds.length;

      await onRefresh();

      if (failedIds.length === 0) {
        exitBatchMode();
      } else {
        // Keep only failed items selected for retry
        setSelectedIds(failedIds);
        setBatchAction(null);
        alert(`${label}: ${successCount} succeeded, ${failedIds.length} failed. Failed items remain selected.`);
      }
    } finally {
      setIsProcessing(false);
    }
  };

  const handleBatchDelete = async () => {
    if (!confirm(`Are you sure you want to delete ${selectedIds.length} tasks?`)) return;
    await runBatch(
      selectedIds,
      (id) => apiFetch(`/api/tasks/${id}`, { method: 'DELETE' }),
      'Delete',
    );
  };

  const handleBatchNotebook = async () => {
    await runBatch(
      selectedIds,
      (id) => apiFetch(`/api/tasks/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notebookId: batchNotebookId || null }),
      }),
      'Notebook update',
    );
  };

  const handleBatchTags = async () => {
    await runBatch(
      selectedIds,
      (id) => apiFetch(`/api/tasks/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tags: batchTags }),
      }),
      'Tags update',
    );
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 flex flex-col h-full min-h-[400px] relative overflow-hidden">
      <div className="flex items-center justify-between mb-4 px-2">
        <h2 className="text-lg font-semibold text-slate-900">Recent Tasks</h2>
        <div className="flex items-center gap-3">
          {isBatchMode ? (
            <>
              <button onClick={toggleSelectAll} className="text-xs font-medium text-indigo-600 hover:text-indigo-700">
                {selectedIds.length === filteredTasks.length && filteredTasks.length > 0 ? 'Deselect All' : 'Select All'}
              </button>
              <button onClick={exitBatchMode} className="text-xs font-medium text-slate-500 hover:text-slate-700">
                Cancel
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => setIsBatchMode(true)}
                className="text-xs font-medium text-indigo-600 hover:text-indigo-700 bg-indigo-50 px-2 py-1 rounded-md"
              >
                Select
              </button>
              <button onClick={() => void onRefresh()} className="p-1.5 text-slate-400 hover:text-slate-600 rounded-md hover:bg-slate-100">
                <RefreshCw className="w-4 h-4" />
              </button>
            </>
          )}
        </div>
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

        {!isBatchMode && (
          <div className="rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-2">
            <button
              onClick={() => setIsTagFiltersExpanded((current) => !current)}
              className="w-full flex items-center justify-between gap-3 text-left"
            >
              <div className="flex items-center gap-2 min-w-0">
                <Tag className="w-4 h-4 text-slate-500" />
                <span className="text-sm font-medium text-slate-700">Tags</span>
                {tagFilters.length > 0 ? (
                  <span className="truncate rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-indigo-700 border border-indigo-200">
                    {tagFilters.length} selected
                  </span>
                ) : null}
              </div>
              <div className="flex items-center gap-2 text-xs text-slate-400 shrink-0">
                <span>{Math.min(tags.length, 8)}</span>
                {isTagFiltersExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </div>
            </button>

            {tagFilters.length > 0 ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {tagFilters.map((tag) => (
                  <button
                    key={tag}
                    onClick={() => toggleTagFilter(tag)}
                    className="inline-flex items-center gap-1 rounded-full border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-100 transition-colors"
                  >
                    <span className="truncate">#{tag}</span>
                    <X className="w-3 h-3" />
                  </button>
                ))}
              </div>
            ) : null}

            {isTagFiltersExpanded ? (
              <div className="flex flex-wrap gap-2 mt-3">
                <button
                  onClick={() => setTagFilters([])}
                  className={cn(
                    'px-3 py-1 rounded-full text-xs font-medium border transition-colors',
                    tagFilters.length === 0 ? 'bg-indigo-50 text-indigo-700 border-indigo-200' : 'bg-white text-slate-600 border-slate-200',
                  )}
                >
                  All
                </button>
                {tags.slice(0, 8).map((tag) => (
                  <button
                    key={tag.name}
                    onClick={() => toggleTagFilter(tag.name)}
                    className={cn(
                      'px-3 py-1 rounded-full text-xs font-medium border transition-colors',
                      tagFilters.includes(tag.name) ? 'bg-indigo-50 text-indigo-700 border-indigo-200' : 'bg-white text-slate-600 border-slate-200',
                    )}
                  >
                    #{tag.name}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        )}
      </div>

      <div className={cn(
        "flex-1 overflow-y-auto pr-2 space-y-2 custom-scrollbar",
        isBatchMode && selectedIds.length > 0 ? "pb-28 lg:pb-20" : "",
      )}>
        {filteredTasks.length === 0 ? (
          <div className="text-center py-8 text-slate-500 text-sm">{searchQuery || tagFilters.length > 0 ? 'No matching tasks found.' : 'No tasks yet.'}</div>
        ) : (
          filteredTasks.map((task) => {
            const notebook = notebooks.find((item) => item.id === task.notebookId);

            return (
              <div
                key={task.id}
                onClick={() => isBatchMode ? toggleSelection(task.id) : onSelectTask(task.id)}
                className={cn(
                  'p-3 rounded-xl border cursor-pointer transition-all flex items-start gap-3',
                  selectedTaskId === task.id && !isBatchMode
                    ? 'border-indigo-500 bg-indigo-50/50'
                    : isBatchMode && selectedIds.includes(task.id)
                    ? 'border-indigo-400 bg-indigo-50/30 ring-1 ring-indigo-400'
                    : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50',
                )}
              >
                {isBatchMode ? (
                  <div className="mt-1 shrink-0">
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(task.id)}
                      readOnly
                      className="w-4 h-4 text-indigo-600 rounded border-slate-300 focus:ring-indigo-500"
                    />
                  </div>
                ) : (
                  <div className="mt-1">
                    {task.status === 'completed' && <div className="w-2.5 h-2.5 rounded-full bg-emerald-500" />}
                    {task.status === 'processing' && <div className="w-2.5 h-2.5 rounded-full bg-amber-500 animate-pulse" />}
                    {task.status === 'pending' && <div className="w-2.5 h-2.5 rounded-full bg-slate-300" />}
                    {task.status === 'failed' && <div className="w-2.5 h-2.5 rounded-full bg-red-500" />}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-900 truncate">{task.originalName}</p>
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    <span className="text-xs text-slate-500">{format(task.createdAt, 'MMM d, HH:mm')}</span>
                    <span className="text-xs text-slate-400 capitalize">&bull; {task.status}</span>
                    {notebook && <span className="text-xs text-indigo-600">&bull; {notebook.name}</span>}
                    {task.provider && <span className="text-xs text-slate-500">&bull; {task.provider}</span>}
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
                {!isBatchMode && (
                  <button
                    onClick={(event) => void handleDelete(event, task.id)}
                    className="p-1.5 text-slate-400 hover:text-red-500 rounded-md hover:bg-red-50 transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Batch Action Bar — fixed on mobile so it's always visible, absolute on desktop */}
      {isBatchMode && selectedIds.length > 0 && (
        <div className="batch-action-bar fixed left-0 right-0 lg:absolute lg:bottom-0 lg:left-0 lg:right-0 bg-white border-t border-slate-200 p-3 shadow-[0_-10px_20px_rgba(0,0,0,0.05)] z-40 lg:z-10">
          {isProcessing ? (
            <div className="flex items-center justify-center py-2 gap-2 text-indigo-600">
              <Loader2 className="w-5 h-5 animate-spin" />
              <span className="text-sm font-medium">Processing {selectedIds.length} tasks...</span>
            </div>
          ) : batchAction === 'notebook' ? (
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-medium text-slate-500">Assign to Notebook</span>
                <button onClick={() => setBatchAction(null)} className="text-slate-400 hover:text-slate-600">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="flex items-center gap-2">
                <select
                  value={batchNotebookId}
                  onChange={(e) => setBatchNotebookId(e.target.value)}
                  className="flex-1 px-3 py-1.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
                >
                  <option value="">None (Remove from notebook)</option>
                  {notebooks.map((nb) => (
                    <option key={nb.id} value={nb.id}>{nb.name}</option>
                  ))}
                </select>
                <button
                  onClick={() => void handleBatchNotebook()}
                  className="px-3 py-1.5 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700"
                >
                  Apply
                </button>
              </div>
            </div>
          ) : batchAction === 'tags' ? (
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-medium text-slate-500">Set Tags (comma separated)</span>
                <button onClick={() => setBatchAction(null)} className="text-slate-400 hover:text-slate-600">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={batchTags}
                  onChange={(e) => setBatchTags(e.target.value)}
                  placeholder="e.g. meeting, important"
                  className="flex-1 px-3 py-1.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                <button
                  onClick={() => void handleBatchTags()}
                  className="px-3 py-1.5 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700"
                >
                  Apply
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-indigo-600 bg-indigo-50 px-2 py-1 rounded-md">
                {selectedIds.length} selected
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setBatchAction('notebook')}
                  className="p-2 text-slate-600 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                  title="Assign Notebook"
                >
                  <Book className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setBatchAction('tags')}
                  className="p-2 text-slate-600 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                  title="Set Tags"
                >
                  <Tag className="w-4 h-4" />
                </button>
                <div className="w-px h-4 bg-slate-200 mx-1" />
                <button
                  onClick={() => void handleBatchDelete()}
                  className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                  title="Delete Selected"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
