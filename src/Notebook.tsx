import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Book, FileAudio, Loader2, Plus, RefreshCw, Search, Tag, Trash2, X } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { cn } from './lib/utils';
import { apiFetch, apiJson } from './api';
import { useAppDataContext } from './contexts/AppDataContext';
import { TaskEditModal } from './components/TaskEditModal';
import { TaskDetail } from './components/TaskDetail';
import { StatsRow } from './components/dashboard/StatsRow';
import { InboxList } from './components/dashboard/InboxList';
import { DashboardSidebar } from './components/dashboard/DashboardSidebar';
import type { Task } from './types';

export default function NotebookView() {
  const navigate = useNavigate();
  const { id } = useParams<{ id?: string }>();
  const {
    tasks, notebooks, tags,
    fetchNotebooks, fetchTasks, fetchTags,
    selectTask, selectedTask, selectedTaskLoading, selectedTaskId,
    refreshTasksAndSelection,
  } = useAppDataContext();
  const onUpdateTasks = async () => { await fetchTasks(); await fetchTags(); };

  const [statsFilter, setStatsFilter] = useState<string | null>(null);
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [mobileNotebookEdit, setMobileNotebookEdit] = useState(false);
  const [mobileNewNotebook, setMobileNewNotebook] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [isBatchMode, setIsBatchMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [batchAction, setBatchAction] = useState<'notebook' | 'tags' | null>(null);
  const [batchNotebookId, setBatchNotebookId] = useState('');
  const [batchTags, setBatchTags] = useState('');
  const [isProcessingBatch, setIsProcessingBatch] = useState(false);

  // Server-side search state
  const [serverResults, setServerResults] = useState<Task[] | null>(null);
  const [searchError, setSearchError] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const searchTimerRef = useRef<number | null>(null);

  const runServerSearch = useCallback((q: string) => {
    if (searchTimerRef.current) window.clearTimeout(searchTimerRef.current);
    if (!q.trim()) {
      setServerResults(null);
      setSearchError(false);
      setIsSearching(false);
      return;
    }
    setIsSearching(true);
    setSearchError(false);
    searchTimerRef.current = window.setTimeout(async () => {
      try {
        const results = await apiJson<Task[]>(
          `/api/search/tasks?q=${encodeURIComponent(q.trim())}`,
        );
        setServerResults(results);
        setSearchError(false);
      } catch {
        setServerResults([]);
        setSearchError(true);
      } finally {
        setIsSearching(false);
      }
    }, 350);
  }, []);

  useEffect(() => {
    runServerSearch(searchQuery);
    return () => { if (searchTimerRef.current) window.clearTimeout(searchTimerRef.current); };
  }, [searchQuery, runServerSearch]);

  useEffect(() => {
    if (id) {
      void selectTask(id);
      return;
    }
    void selectTask(null);
  }, [id]);

  const handleSelectTask = (taskId: string) => {
    navigate(`/notebook/${taskId}`);
  };

  const [notebookFilter, setNotebookFilter] = useState<string | null>(null);

  const handleSelectNotebook = (notebookId: string) => {
    setNotebookFilter((current) => current === notebookId ? null : notebookId);
    setStatsFilter(null);
  };

  const handleBack = () => {
    navigate('/notebook', { replace: true });
  };

  const showingDetail = Boolean(id);
  const activeTask = selectedTask?.id === id ? selectedTask : null;
  const hasActiveSearch = Boolean(searchQuery.trim());
  const baseTasks = hasActiveSearch ? (serverResults ?? []) : tasks;

  const filteredTasks = useMemo(() => {
    let result = baseTasks;

    if (notebookFilter) {
      result = result.filter((t) => t.notebookId === notebookFilter);
    } else if (statsFilter === 'inbox') {
      result = result.filter((t) => !t.notebookId);
    } else if (statsFilter === 'pending') {
      result = result.filter((t) => t.status === 'pending' || t.status === 'processing');
    } else if (statsFilter === 'completed') {
      result = result.filter((t) => t.status === 'completed');
    }

    if (tagFilter) {
      result = result.filter((t) => t.tags.includes(tagFilter));
    }

    return result;
  }, [baseTasks, statsFilter, notebookFilter, tagFilter]);

  const toggleSelection = (taskId: string) => {
    setSelectedIds((current) => (
      current.includes(taskId)
        ? current.filter((id) => id !== taskId)
        : [...current, taskId]
    ));
  };

  const toggleSelectAll = () => {
    if (selectedIds.length === filteredTasks.length && filteredTasks.length > 0) {
      setSelectedIds([]);
      return;
    }

    setSelectedIds(filteredTasks.map((task) => task.id));
  };

  const exitBatchMode = () => {
    setIsBatchMode(false);
    setSelectedIds([]);
    setBatchAction(null);
    setBatchNotebookId('');
    setBatchTags('');
  };

  const handleDeleteTask = async (taskId: string) => {
    if (!confirm('Are you sure you want to delete this recording?')) {
      return;
    }

    await apiFetch(`/api/tasks/${taskId}`, { method: 'DELETE' });
    await onUpdateTasks();
  };

  const runBatch = async (
    ids: string[],
    operation: (id: string) => Promise<unknown>,
    label: string,
  ) => {
    setIsProcessingBatch(true);
    try {
      const results = await Promise.allSettled(ids.map(operation));
      const failedIds = ids.filter((_, index) => results[index].status === 'rejected');
      const successCount = ids.length - failedIds.length;

      await onUpdateTasks();

      if (failedIds.length === 0) {
        exitBatchMode();
      } else {
        setSelectedIds(failedIds);
        setBatchAction(null);
        alert(`${label}: ${successCount} succeeded, ${failedIds.length} failed. Failed items remain selected.`);
      }
    } finally {
      setIsProcessingBatch(false);
    }
  };

  const handleBatchDelete = async () => {
    if (!confirm(`Are you sure you want to delete ${selectedIds.length} recordings?`)) {
      return;
    }

    await runBatch(
      selectedIds,
      (taskId) => apiFetch(`/api/tasks/${taskId}`, { method: 'DELETE' }),
      'Delete',
    );
  };

  const handleBatchNotebook = async () => {
    await runBatch(
      selectedIds,
      (taskId) => apiFetch(`/api/tasks/${taskId}`, {
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
      (taskId) => apiFetch(`/api/tasks/${taskId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tags: batchTags }),
      }),
      'Tags update',
    );
  };

  return (
    <div className={cn(
      'relative flex flex-col h-full',
      showingDetail ? 'overflow-hidden' : 'overflow-y-auto custom-scrollbar lg:overflow-hidden',
    )}>
      {showingDetail ? (
        <div className="flex-1 min-h-0 flex flex-col bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
          <div className="flex items-center gap-3 px-4 sm:px-6 py-3 border-b border-slate-200 bg-white shrink-0">
            <button
              onClick={handleBack}
              className="flex items-center gap-1.5 text-slate-600 hover:text-slate-900 transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              <span className="text-sm font-medium">Back</span>
            </button>
            <h2 className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-900">
              {activeTask?.originalName || (selectedTaskLoading ? 'Loading...' : 'Unavailable')}
            </h2>
          </div>
          <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
            {activeTask ? (
              <TaskDetail
                task={activeTask}
                onUpdateTask={async () => {
                  await refreshTasksAndSelection(activeTask.id);
                  await fetchTags();
                }}
              />
            ) : selectedTaskLoading ? (
              <div className="flex-1 flex flex-col items-center justify-center text-slate-400 p-8 text-center">
                <Loader2 className="w-10 h-10 mb-4 animate-spin text-indigo-500" />
                <h3 className="text-lg font-medium text-slate-600">Loading</h3>
              </div>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-slate-400 p-8 text-center">
                <FileAudio className="w-12 h-12 mb-4 opacity-20 text-indigo-500" />
                <h3 className="text-lg font-medium text-slate-600">Unavailable</h3>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="flex gap-6 h-full overflow-hidden">
          {/* Main content */}
          <div className={cn(
            'flex-1 min-w-0 overflow-y-auto custom-scrollbar space-y-5 pr-1',
            isBatchMode && selectedIds.length > 0 ? 'pb-28 lg:pb-24' : '',
          )}>
            <div className="flex items-center justify-between gap-3">
              <div>
                <h1 className="text-lg font-semibold text-slate-900">Workspace</h1>
                <p className="text-xs text-slate-500 mt-0.5">Browse, organize, and batch-manage your recordings.</p>
              </div>
              <div className="flex items-center gap-2">
                {isBatchMode ? (
                  <>
                    <button
                      type="button"
                      onClick={toggleSelectAll}
                      className="rounded-lg bg-indigo-50 px-2.5 py-1.5 text-xs font-medium text-indigo-700 transition-colors hover:bg-indigo-100"
                    >
                      {selectedIds.length === filteredTasks.length && filteredTasks.length > 0 ? 'Deselect all' : 'Select all'}
                    </button>
                    <button
                      type="button"
                      onClick={exitBatchMode}
                      className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700"
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => setIsBatchMode(true)}
                      className="rounded-lg bg-indigo-50 px-2.5 py-1.5 text-xs font-medium text-indigo-700 transition-colors hover:bg-indigo-100"
                    >
                      Select
                    </button>
                    <button
                      type="button"
                      onClick={() => void onUpdateTasks()}
                      className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
                      aria-label="Refresh recordings"
                    >
                      <RefreshCw className="w-4 h-4" />
                    </button>
                  </>
                )}
              </div>
            </div>

            {/* Search */}
            <div className="relative">
              {isSearching ? (
                <Loader2 className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-indigo-500 animate-spin" />
              ) : (
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              )}
              <input
                type="text"
                placeholder="Search recordings, tags, or transcripts..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-3 py-2.5 bg-white border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 transition-all shadow-sm"
              />
            </div>

            {/* Stats */}
            <StatsRow tasks={tasks} activeFilter={statsFilter} onFilterChange={(f) => { setStatsFilter(f); setNotebookFilter(null); }} />

            {/* Mobile-only: Notebook + Tag filters */}
            <div className="lg:hidden space-y-3">
              <div className="flex items-center gap-1.5 flex-wrap">
                <button
                  type="button"
                  onClick={() => { setNotebookFilter(null); setStatsFilter(null); }}
                  className={cn(
                    'px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors',
                    !notebookFilter && !statsFilter ? 'bg-indigo-50 text-indigo-700 border-indigo-200' : 'bg-white text-slate-500 border-slate-200',
                  )}
                >
                  All
                </button>
                {notebooks.map((nb) => (
                  <button
                    key={nb.id}
                    type="button"
                    onClick={() => mobileNotebookEdit ? undefined : handleSelectNotebook(nb.id)}
                    className={cn(
                      'inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors',
                      notebookFilter === nb.id ? 'bg-indigo-50 text-indigo-700 border-indigo-200' : 'bg-white text-slate-500 border-slate-200',
                    )}
                  >
                    {nb.name}
                    {mobileNotebookEdit && (
                      <span
                        role="button"
                        onClick={async (e) => {
                          e.stopPropagation();
                          if (!confirm(`Delete "${nb.name}"?`)) return;
                          await apiJson(`/api/notebooks/${nb.id}`, { method: 'DELETE' });
                          if (notebookFilter === nb.id) setNotebookFilter(null);
                          await fetchNotebooks();
                          await fetchTasks();
                        }}
                        className="text-red-400 hover:text-red-600 ml-0.5"
                      >
                        <X className="w-3 h-3" />
                      </span>
                    )}
                  </button>
                ))}
                {mobileNotebookEdit ? (
                  <div className="inline-flex items-center gap-1">
                    <input
                      type="text"
                      value={mobileNewNotebook}
                      onChange={(e) => setMobileNewNotebook(e.target.value)}
                      onKeyDown={async (e) => {
                        if (e.key === 'Enter' && mobileNewNotebook.trim()) {
                          await apiJson('/api/notebooks', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ name: mobileNewNotebook.trim() }),
                          });
                          setMobileNewNotebook('');
                          await fetchNotebooks();
                        }
                        if (e.key === 'Escape') setMobileNotebookEdit(false);
                      }}
                      placeholder="New..."
                      className="w-20 px-2 py-0.5 text-[11px] border border-slate-200 rounded-full focus:outline-none focus:ring-1 focus:ring-indigo-500"
                      autoFocus
                    />
                    <button
                      type="button"
                      onClick={() => setMobileNotebookEdit(false)}
                      className="text-[11px] text-slate-400"
                    >
                      Done
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setMobileNotebookEdit(true)}
                    className="w-6 h-6 flex items-center justify-center rounded-full border border-dashed border-slate-300 text-slate-400 hover:text-indigo-600 hover:border-indigo-300 transition-colors"
                    title="Manage notebooks"
                  >
                    <Plus className="w-3 h-3" />
                  </button>
                )}
              </div>
              {tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {tags.slice(0, 8).map((tag) => (
                    <button
                      key={tag.name}
                      type="button"
                      onClick={() => setTagFilter((c) => c === tag.name ? null : tag.name)}
                      className={cn(
                        'px-2 py-0.5 rounded-full text-[10px] border transition-colors',
                        tagFilter === tag.name ? 'bg-indigo-50 text-indigo-700 border-indigo-200' : 'text-slate-500 bg-slate-50 border-slate-200',
                      )}
                    >
                      #{tag.name}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Active filter indicator */}
            {(notebookFilter || tagFilter) && (
              <div className="flex items-center gap-2 flex-wrap">
                {notebookFilter && (
                  <span className="inline-flex items-center gap-1 text-xs text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">
                    Notebook: <span className="font-medium text-slate-700">{notebooks.find((n) => n.id === notebookFilter)?.name}</span>
                    <button type="button" onClick={() => setNotebookFilter(null)} className="text-slate-400 hover:text-slate-600 ml-0.5">&times;</button>
                  </span>
                )}
                {tagFilter && (
                  <span className="inline-flex items-center gap-1 text-xs text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">
                    Tag: <span className="font-medium text-slate-700">#{tagFilter}</span>
                    <button type="button" onClick={() => setTagFilter(null)} className="text-slate-400 hover:text-slate-600 ml-0.5">&times;</button>
                  </span>
                )}
              </div>
            )}

            {searchError && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                Search failed. Showing no results.
              </div>
            )}

            {/* Inbox list */}
            <InboxList
              tasks={filteredTasks}
              title={notebookFilter ? notebooks.find((n) => n.id === notebookFilter)?.name || 'Notebook' : statsFilter === 'inbox' ? 'Inbox' : statsFilter === 'pending' ? 'Pending' : statsFilter === 'completed' ? 'Completed' : 'All Recordings'}
              onSelectTask={handleSelectTask}
              selectedTaskId={selectedTaskId}
              isBatchMode={isBatchMode}
              selectedIds={selectedIds}
              onToggleSelection={toggleSelection}
              onDeleteTask={(taskId) => void handleDeleteTask(taskId)}
              emptyStateMessage={hasActiveSearch || notebookFilter || tagFilter || statsFilter ? 'No matching recordings found.' : 'No recordings yet.'}
            />

          </div>

          {/* Right sidebar — desktop only */}
          <DashboardSidebar
            notebooks={notebooks}
            tasks={tasks}
            tags={tags}
            activeNotebookFilter={notebookFilter}
            activeTagFilter={tagFilter}
            onToggleTagFilter={(tag) => setTagFilter((c) => c === tag ? null : tag)}
            onSelectNotebook={handleSelectNotebook}
            onClearNotebookFilter={() => setNotebookFilter(null)}
            onSelectTask={handleSelectTask}
            onNotebooksChanged={async () => { await fetchNotebooks(); await fetchTasks(); }}
          />
        </div>
      )}

      {isBatchMode && selectedIds.length > 0 ? (
        <div className="fixed inset-x-3 bottom-[calc(var(--mobile-bottom-nav-height)+env(safe-area-inset-bottom)+0.75rem)] z-40 rounded-2xl border border-slate-200 bg-white p-3 shadow-[0_16px_40px_rgba(15,23,42,0.14)] lg:absolute lg:inset-x-0 lg:bottom-0 lg:z-10 lg:rounded-none lg:border-x-0 lg:border-b-0 lg:shadow-[0_-10px_20px_rgba(0,0,0,0.05)]">
          {isProcessingBatch ? (
            <div className="flex items-center justify-center gap-2 py-2 text-indigo-600">
              <Loader2 className="w-5 h-5 animate-spin" />
              <span className="text-sm font-medium">Processing {selectedIds.length} recordings...</span>
            </div>
          ) : batchAction === 'notebook' ? (
            <div className="flex flex-col gap-2">
              <div className="mb-1 flex items-center justify-between">
                <span className="text-xs font-medium text-slate-500">Assign to Notebook</span>
                <button type="button" onClick={() => setBatchAction(null)} className="text-slate-400 hover:text-slate-600">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="flex items-center gap-2">
                <select
                  value={batchNotebookId}
                  onChange={(event) => setBatchNotebookId(event.target.value)}
                  className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="">None (Remove from notebook)</option>
                  {notebooks.map((notebook) => (
                    <option key={notebook.id} value={notebook.id}>
                      {notebook.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => void handleBatchNotebook()}
                  className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700"
                >
                  Apply
                </button>
              </div>
            </div>
          ) : batchAction === 'tags' ? (
            <div className="flex flex-col gap-2">
              <div className="mb-1 flex items-center justify-between">
                <span className="text-xs font-medium text-slate-500">Set Tags (comma separated)</span>
                <button type="button" onClick={() => setBatchAction(null)} className="text-slate-400 hover:text-slate-600">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={batchTags}
                  onChange={(event) => setBatchTags(event.target.value)}
                  placeholder="e.g. meeting, important"
                  className="flex-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                <button
                  type="button"
                  onClick={() => void handleBatchTags()}
                  className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700"
                >
                  Apply
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <span className="rounded-md bg-indigo-50 px-2 py-1 text-sm font-medium text-indigo-600">
                {selectedIds.length} selected
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setBatchAction('notebook')}
                  className="rounded-lg p-2 text-slate-600 transition-colors hover:bg-indigo-50 hover:text-indigo-600"
                  title="Assign Notebook"
                >
                  <Book className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setBatchAction('tags')}
                  className="rounded-lg p-2 text-slate-600 transition-colors hover:bg-indigo-50 hover:text-indigo-600"
                  title="Set Tags"
                >
                  <Tag className="w-4 h-4" />
                </button>
                <div className="mx-1 h-4 w-px bg-slate-200" />
                <button
                  type="button"
                  onClick={() => void handleBatchDelete()}
                  className="rounded-lg p-2 text-red-600 transition-colors hover:bg-red-50"
                  title="Delete Selected"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </div>
      ) : null}

      {editingTask && (
        <TaskEditModal
          task={editingTask}
          onClose={() => setEditingTask(null)}
          onSaved={onUpdateTasks}
        />
      )}
    </div>
  );
}
