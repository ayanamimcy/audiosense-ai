import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { format, isSameDay } from 'date-fns';
import { ArrowLeft, Edit2, FileAudio, Loader2, Search } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { cn } from './lib/utils';
import { apiJson } from './api';
import { useAppDataContext } from './contexts/AppDataContext';
import { NotebookSidebar } from './components/NotebookSidebar';
import { Calendar } from './components/Calendar';
import { TaskEditModal } from './components/TaskEditModal';
import { TaskDetail } from './components/TaskDetail';
import type { Task } from './types';

export default function NotebookView() {
  const navigate = useNavigate();
  const { id } = useParams<{ id?: string }>();
  const {
    tasks, notebooks, tags,
    fetchNotebooks, fetchTasks, fetchTags,
    selectTask, selectedTask, selectedTaskLoading,
    refreshTasksAndSelection,
  } = useAppDataContext();
  const onUpdateTasks = async () => { await fetchTasks(); await fetchTags(); };

  const [currentPeriodDate, setCurrentPeriodDate] = useState(new Date());
  const [calendarView, setCalendarView] = useState<'week' | 'month'>('week');
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [selectedNotebookId, setSelectedNotebookId] = useState<string | null>(null);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  // Server-side search state
  const [serverResults, setServerResults] = useState<Task[] | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const searchTimerRef = useRef<number | null>(null);

  // Debounced server-side search when query is non-empty
  const runServerSearch = useCallback((q: string) => {
    if (searchTimerRef.current) window.clearTimeout(searchTimerRef.current);
    if (!q.trim()) {
      setServerResults(null);
      setIsSearching(false);
      return;
    }
    setIsSearching(true);
    searchTimerRef.current = window.setTimeout(async () => {
      try {
        const results = await apiJson<Task[]>(
          `/api/search/tasks?q=${encodeURIComponent(q.trim())}`,
        );
        setServerResults(results);
      } catch {
        setServerResults(null);
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

  const handleBack = () => {
    navigate('/notebook', { replace: true });
  };

  const showingDetail = Boolean(id);
  const activeTask = selectedTask?.id === id ? selectedTask : null;
  const selectedTagsLabel = selectedTags.map((tag) => `#${tag}`).join(', ');

  // When no search query: local filter on lightweight task list.
  // When search query present: use server results (which search transcript too).
  const baseTasks = serverResults ?? tasks;

  const filteredTasks = useMemo(() => {
    return baseTasks.filter((task) => {
      const notebookMatch = selectedNotebookId ? task.notebookId === selectedNotebookId : true;
      const tagMatch = selectedTags.length > 0
        ? selectedTags.some((tag) => task.tags.includes(tag))
        : true;
      return notebookMatch && tagMatch;
    });
  }, [selectedNotebookId, selectedTags, baseTasks]);

  const visibleTasks = selectedDate
    ? filteredTasks.filter((task) => isSameDay(new Date(task.eventDate || task.createdAt), selectedDate))
    : filteredTasks;

  return (
    <div
      className={cn(
        'flex flex-col lg:flex-row gap-4 lg:gap-6 h-full',
        showingDetail ? 'overflow-hidden' : 'overflow-y-auto custom-scrollbar',
        'lg:overflow-hidden',
      )}
    >
      {/* Notebook sidebar — hidden on mobile when detail is open */}
      <div className={cn(
        showingDetail ? "hidden lg:flex" : "flex",
        "flex-col shrink-0",
      )}>
        <NotebookSidebar
          tasks={tasks}
          notebooks={notebooks}
          tags={tags}
          selectedNotebookId={selectedNotebookId}
          selectedTags={selectedTags}
          onSelectAll={() => { setSelectedNotebookId(null); setSelectedDate(null); }}
          onSelectNotebook={(id) => { setSelectedNotebookId(id); setSelectedDate(null); }}
          onClearTags={() => setSelectedTags([])}
          onToggleTag={(tag) => {
            setSelectedTags((current) => (
              current.includes(tag)
                ? current.filter((item) => item !== tag)
                : [...current, tag]
            ));
          }}
          onSelectTask={handleSelectTask}
          onEditTask={setEditingTask}
          onUpdateNotebooks={fetchNotebooks}
          onUpdateTasks={onUpdateTasks}
        />
      </div>

      {/* Right content area: either calendar+grid OR task detail (replaces in-place) */}
      <div
        className={cn(
          'lg:flex-1 flex-none bg-white border border-slate-200 rounded-2xl shadow-sm flex flex-col shrink-0',
          showingDetail
            ? 'h-full min-h-0 overflow-hidden'
            : cn(
                'h-auto p-4 sm:p-6',
                calendarView === 'week' ? 'lg:overflow-hidden' : 'lg:overflow-y-auto custom-scrollbar',
              ),
        )}
      >
        {showingDetail ? (
          /* Task detail view — replaces calendar+grid */
          <>
            <div className="flex items-center gap-3 px-4 sm:px-6 py-3 border-b border-slate-200 bg-white shrink-0">
              <button
                onClick={handleBack}
                className="flex items-center gap-1.5 text-slate-600 hover:text-slate-900 transition-colors"
              >
                <ArrowLeft className="w-4 h-4" />
                <span className="text-sm font-medium">Back</span>
              </button>
              <h2 className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-900">
                {activeTask?.originalName || (selectedTaskLoading ? 'Loading task' : 'Task unavailable')}
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
                  <h3 className="text-lg font-medium text-slate-600">Loading task</h3>
                </div>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center text-slate-400 p-8 text-center">
                  <FileAudio className="w-12 h-12 mb-4 opacity-20 text-indigo-500" />
                  <h3 className="text-lg font-medium text-slate-600">Task unavailable</h3>
                  <p className="text-sm mt-1">This task could not be loaded. It may have been removed or become inaccessible.</p>
                </div>
              )}
            </div>
          </>
        ) : (
          /* Calendar + task grid view */
          <>
            {/* Search bar */}
            <div className="mb-4">
              <div className="relative">
                {isSearching ? (
                  <Loader2 className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-indigo-500 animate-spin" />
                ) : (
                  <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                )}
                <input
                  type="text"
                  placeholder="Search tasks, tags, or transcripts..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 transition-all"
                />
              </div>
            </div>

            <Calendar
              tasks={filteredTasks}
              currentPeriodDate={currentPeriodDate}
              calendarView={calendarView}
              selectedDate={selectedDate}
              onPeriodChange={setCurrentPeriodDate}
              onViewChange={setCalendarView}
              onSelectDate={setSelectedDate}
              onSelectTask={handleSelectTask}
            />

            <div
              className={cn(
                'mt-6 pt-6 border-t border-slate-200',
                calendarView === 'week' ? 'lg:flex-1 lg:min-h-0 lg:overflow-y-auto lg:pr-1 custom-scrollbar' : 'shrink-0',
              )}
            >
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900">
                    {selectedDate ? `Tasks on ${format(selectedDate, 'MMMM d, yyyy')}` : 'All Filtered Tasks'}
                  </h3>
                  <p className="text-sm text-slate-500 mt-1">
                    {selectedNotebookId ? 'Filtered by notebook.' : 'Showing all notebooks.'} {selectedTags.length > 0 ? `Tags: ${selectedTagsLabel}` : ''} {selectedDate ? '' : 'Select a date on the calendar to narrow it down.'}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  {selectedDate && (
                    <button onClick={() => setSelectedDate(null)} className="text-xs font-medium text-indigo-600 hover:text-indigo-700">
                      Clear date filter
                    </button>
                  )}
                  <span className="text-sm text-slate-500">{visibleTasks.length} items</span>
                </div>
              </div>

              {visibleTasks.length === 0 ? (
                <div className="text-sm text-slate-500 mt-4">
                  {searchQuery ? 'No tasks match your search.' : selectedDate ? 'No tasks for the selected date.' : 'No tasks match the current notebook/tag filters.'}
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 mt-4">
                  {visibleTasks.map((task) => (
                    <div
                      key={task.id}
                      onClick={() => handleSelectTask(task.id)}
                      className="p-3 rounded-xl border border-slate-200 bg-slate-50 hover:bg-white hover:border-indigo-300 hover:shadow-sm cursor-pointer transition-all flex flex-col gap-2 relative group"
                    >
                      <button
                        onClick={(e) => { e.stopPropagation(); setEditingTask(task); }}
                        className="absolute top-2 right-2 hidden group-hover:block p-1.5 text-slate-400 hover:text-indigo-600 rounded-md bg-white/80 backdrop-blur-sm shadow-sm"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                      <div className="flex items-start gap-2 pr-6">
                        <FileAudio className="w-4 h-4 text-indigo-500 shrink-0 mt-0.5" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-slate-900 truncate">{task.originalName}</p>
                          <p className="text-xs text-slate-500">{format(task.createdAt, 'HH:mm')}</p>
                        </div>
                      </div>
                      {task.tags.length > 0 && (
                        <div className="flex flex-nowrap items-center gap-1 mt-1 overflow-hidden">
                          {task.tags.slice(0, 2).map((tag) => (
                            <span key={tag} className="text-[10px] font-medium text-slate-600 bg-slate-200/70 px-1.5 py-0.5 rounded whitespace-nowrap min-w-0 overflow-hidden text-ellipsis">
                              #{tag}
                            </span>
                          ))}
                          {task.tags.length > 2 && (
                            <span className="shrink-0 text-[10px] font-medium text-slate-400 px-1 py-0.5">
                              +{task.tags.length - 2}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>

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
