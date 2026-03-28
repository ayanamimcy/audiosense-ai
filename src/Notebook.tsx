import React, { useMemo, useState } from 'react';
import {
  addMonths,
  addWeeks,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  isToday,
  startOfMonth,
  startOfWeek,
  subMonths,
  subWeeks,
} from 'date-fns';
import { ChevronLeft, ChevronRight, Edit2, FileAudio, Folder, Plus, Tag, Trash2, X } from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { apiFetch } from './api';
import type { Notebook, TagStat, Task } from './types';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface NotebookProps {
  tasks: Task[];
  notebooks: Notebook[];
  tags: TagStat[];
  onSelectTask: (taskId: string) => void;
  onUpdateNotebooks: () => void | Promise<void>;
  onUpdateTasks: () => void | Promise<void>;
}

export default function NotebookView({
  tasks,
  notebooks,
  tags,
  onSelectTask,
  onUpdateNotebooks,
  onUpdateTasks,
}: NotebookProps) {
  const [currentPeriodDate, setCurrentPeriodDate] = useState(new Date());
  const [calendarView, setCalendarView] = useState<'week' | 'month'>('week');
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [selectedNotebookId, setSelectedNotebookId] = useState<string | null>(null);
  const [selectedTag, setSelectedTag] = useState('');
  const [isCreatingNotebook, setIsCreatingNotebook] = useState(false);
  const [newNotebookName, setNewNotebookName] = useState('');
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [editTaskName, setEditTaskName] = useState('');
  const [editTaskNotebookId, setEditTaskNotebookId] = useState<string | null>(null);
  const [editTaskDate, setEditTaskDate] = useState('');
  const [editTaskTags, setEditTaskTags] = useState('');

  const monthStart = startOfMonth(currentPeriodDate);
  const monthEnd = endOfMonth(monthStart);
  const monthGridStart = startOfWeek(monthStart, { weekStartsOn: 1 });
  const monthGridEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });
  const weekStart = startOfWeek(currentPeriodDate, { weekStartsOn: 1 });
  const weekEnd = endOfWeek(currentPeriodDate, { weekStartsOn: 1 });
  const days = eachDayOfInterval(
    calendarView === 'week'
      ? { start: weekStart, end: weekEnd }
      : { start: monthGridStart, end: monthGridEnd },
  );
  const calendarWeekCount = Math.ceil(days.length / 7);
  const calendarTitle =
    calendarView === 'week'
      ? `${format(weekStart, 'yyyy年MM月d日')} - ${format(weekEnd, isSameMonth(weekStart, weekEnd) ? 'd日' : 'MM月d日')}`
      : format(currentPeriodDate, 'yyyy年MM月');

  const filteredTasks = useMemo(() => {
    return tasks.filter((task) => {
      const notebookMatch = selectedNotebookId ? task.notebookId === selectedNotebookId : true;
      const tagMatch = selectedTag ? task.tags.includes(selectedTag) : true;
      return notebookMatch && tagMatch;
    });
  }, [selectedNotebookId, selectedTag, tasks]);

  const visibleTasks = selectedDate
    ? filteredTasks.filter((task) => isSameDay(new Date(task.eventDate || task.createdAt), selectedDate))
    : filteredTasks;

  const handleSelectAllTasks = () => {
    setSelectedNotebookId(null);
    setSelectedDate(null);
  };

  const handleSelectNotebook = (notebookId: string) => {
    setSelectedNotebookId(notebookId);
    setSelectedDate(null);
  };

  const handleCreateNotebook = async () => {
    if (!newNotebookName.trim()) {
      return;
    }

    try {
      const res = await apiFetch('/api/notebooks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newNotebookName.trim() }),
      });

      if (!res.ok) {
        throw new Error('Failed to create notebook.');
      }

      setNewNotebookName('');
      setIsCreatingNotebook(false);
      await onUpdateNotebooks();
    } catch (error) {
      console.error('Failed to create notebook:', error);
    }
  };

  const handleDeleteNotebook = async (event: React.MouseEvent, id: string) => {
    event.stopPropagation();
    if (!confirm('Delete this notebook? Tasks will remain but become unassigned.')) {
      return;
    }

    try {
      await apiFetch(`/api/notebooks/${id}`, { method: 'DELETE' });
      if (selectedNotebookId === id) {
        setSelectedNotebookId(null);
      }
      await onUpdateNotebooks();
      await onUpdateTasks();
    } catch (error) {
      console.error('Failed to delete notebook:', error);
    }
  };

  const handleEditTask = (task: Task) => {
    setEditingTask(task);
    setEditTaskName(task.originalName);
    setEditTaskNotebookId(task.notebookId || null);
    setEditTaskDate(format(new Date(task.eventDate || task.createdAt), 'yyyy-MM-dd'));
    setEditTaskTags(task.tags.join(', '));
  };

  const handleSaveTaskEdit = async () => {
    if (!editingTask || !editTaskName.trim()) {
      return;
    }

    const eventDateTimestamp = editTaskDate ? new Date(editTaskDate).getTime() : editingTask.eventDate || editingTask.createdAt;

    try {
      const res = await apiFetch(`/api/tasks/${editingTask.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          originalName: editTaskName.trim(),
          notebookId: editTaskNotebookId,
          eventDate: eventDateTimestamp,
          tags: editTaskTags,
        }),
      });

      if (!res.ok) {
        throw new Error('Failed to update task.');
      }

      setEditingTask(null);
      await onUpdateTasks();
    } catch (error) {
      console.error('Failed to update task:', error);
    }
  };

  return (
    <div className="flex flex-col lg:flex-row gap-4 lg:gap-6 h-full lg:overflow-hidden overflow-y-auto custom-scrollbar">
      <div className="w-full lg:w-80 lg:h-full max-h-[420px] bg-white border border-slate-200 rounded-2xl p-3 sm:p-4 flex flex-col shadow-sm lg:overflow-hidden shrink-0">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-slate-900">Notebooks</h2>
          <button onClick={() => setIsCreatingNotebook(true)} className="p-1.5 text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-md transition-colors">
            <Plus className="w-5 h-5" />
          </button>
        </div>

        {isCreatingNotebook && (
          <div className="mb-4 p-3 bg-slate-50 border border-slate-200 rounded-xl">
            <input
              type="text"
              value={newNotebookName}
              onChange={(event) => setNewNotebookName(event.target.value)}
              placeholder="Notebook name..."
              className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 mb-2"
              autoFocus
              onKeyDown={(event) => event.key === 'Enter' && void handleCreateNotebook()}
            />
            <div className="flex justify-end gap-2">
              <button onClick={() => setIsCreatingNotebook(false)} className="text-xs font-medium text-slate-500 hover:text-slate-700">
                Cancel
              </button>
              <button onClick={() => void handleCreateNotebook()} className="text-xs font-medium text-indigo-600 hover:text-indigo-700">
                Create
              </button>
            </div>
          </div>
        )}

        <div className="space-y-4 overflow-y-auto custom-scrollbar">
          <div>
            <div
              onClick={handleSelectAllTasks}
              className={cn(
                'flex items-center gap-3 p-2.5 rounded-xl cursor-pointer transition-colors',
                selectedNotebookId === null ? 'bg-indigo-50 text-indigo-700 font-medium' : 'text-slate-600 hover:bg-slate-100',
              )}
            >
              <Folder className="w-4 h-4" />
              <span className="flex-1 text-sm">All Tasks</span>
              <span className="text-xs text-slate-400 bg-slate-200/50 px-2 py-0.5 rounded-full">{tasks.length}</span>
            </div>
          </div>

          <div className="space-y-1">
            {notebooks.map((notebook) => {
              const notebookTasks = tasks.filter((task) => task.notebookId === notebook.id);
              const isSelected = selectedNotebookId === notebook.id;

              return (
                <div key={notebook.id}>
                  <div
                    onClick={() => handleSelectNotebook(notebook.id)}
                    className={cn(
                      'flex items-center gap-3 p-2.5 rounded-xl cursor-pointer transition-colors group',
                      isSelected ? 'bg-indigo-50 text-indigo-700 font-medium' : 'text-slate-600 hover:bg-slate-100',
                    )}
                  >
                    <Folder className="w-4 h-4" />
                    <span className="flex-1 text-sm truncate">{notebook.name}</span>
                    <span className="text-xs text-slate-400 bg-slate-200/50 px-2 py-0.5 rounded-full group-hover:hidden">{notebookTasks.length}</span>
                    <button
                      onClick={(event) => void handleDeleteNotebook(event, notebook.id)}
                      className="hidden group-hover:block p-1 text-slate-400 hover:text-red-500 rounded hover:bg-red-50"
                    >
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
                          <button onClick={(event) => { event.stopPropagation(); handleEditTask(task); }} className="hidden group-hover:block p-1 text-slate-400 hover:text-indigo-600 rounded">
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
            <div className="flex items-center gap-2 mb-2 text-sm font-medium text-slate-700">
              <Tag className="w-4 h-4" />
              Tags
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => setSelectedTag('')}
                className={cn(
                  'px-3 py-1 rounded-full text-xs font-medium border',
                  !selectedTag ? 'bg-indigo-50 text-indigo-700 border-indigo-200' : 'bg-white text-slate-600 border-slate-200',
                )}
              >
                All
              </button>
              {tags.map((tag) => (
                <button
                  key={tag.name}
                  onClick={() => setSelectedTag((current) => (current === tag.name ? '' : tag.name))}
                  className={cn(
                    'px-3 py-1 rounded-full text-xs font-medium border',
                    selectedTag === tag.name ? 'bg-indigo-50 text-indigo-700 border-indigo-200' : 'bg-white text-slate-600 border-slate-200',
                  )}
                >
                  #{tag.name}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div
        className={cn(
          'lg:flex-1 flex-none h-auto bg-white border border-slate-200 rounded-2xl p-4 sm:p-6 flex flex-col shadow-sm shrink-0',
          calendarView === 'week' ? 'lg:overflow-hidden' : 'lg:overflow-y-auto custom-scrollbar',
        )}
      >
        <div className="flex items-start justify-between gap-4 mb-6 shrink-0 flex-wrap">
          <div>
            <h2 className="text-xl font-bold text-slate-900">{calendarTitle}</h2>
            <p className="text-sm text-slate-500 mt-1">按 Notebook 和 Tag 浏览你的音频内容</p>
          </div>
          <div className="flex items-center gap-3 ml-auto">
            <div className="flex bg-slate-100 rounded-full border border-slate-200 p-1">
              <button
                onClick={() => setCalendarView('week')}
                className={cn(
                  'px-3 py-1.5 text-xs font-medium rounded-full transition-colors',
                  calendarView === 'week' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900',
                )}
              >
                Week
              </button>
              <button
                onClick={() => setCalendarView('month')}
                className={cn(
                  'px-3 py-1.5 text-xs font-medium rounded-full transition-colors',
                  calendarView === 'month' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900',
                )}
              >
                Month
              </button>
            </div>
            <div className="flex bg-slate-100 rounded-full border border-slate-200 p-1">
              <button
                onClick={() =>
                  setCurrentPeriodDate(
                    calendarView === 'week' ? subWeeks(currentPeriodDate, 1) : subMonths(currentPeriodDate, 1),
                  )
                }
                className="p-1.5 hover:bg-white rounded-full text-slate-600 transition-colors shadow-sm"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                onClick={() =>
                  setCurrentPeriodDate(
                    calendarView === 'week' ? addWeeks(currentPeriodDate, 1) : addMonths(currentPeriodDate, 1),
                  )
                }
                className="p-1.5 hover:bg-white rounded-full text-slate-600 transition-colors shadow-sm"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

        <div
          className={cn(
            'grid grid-cols-7 gap-px bg-slate-200 border border-slate-200 rounded-xl overflow-hidden shrink-0',
            calendarView === 'week' ? 'min-h-[142px]' : 'min-h-[500px] flex-grow',
          )}
          style={{
            gridTemplateRows:
              calendarView === 'week'
                ? 'auto minmax(100px, auto)'
                : `auto repeat(${calendarWeekCount}, minmax(0, 1fr))`,
          }}
        >
          {['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'].map((day) => (
            <div key={day} className="bg-slate-50 p-2.5 sm:p-3 text-[11px] sm:text-xs font-semibold text-slate-500 text-center tracking-wider">
              {day}
            </div>
          ))}
          {days.map((day) => {
            const isSelected = selectedDate ? isSameDay(day, selectedDate) : false;
            const isCurrentMonth = isSameMonth(day, currentPeriodDate);
            const calendarTasks = filteredTasks.filter((task) => isSameDay(new Date(task.eventDate || task.createdAt), day));

            return (
              <div
                key={day.toISOString()}
                onClick={() => setSelectedDate((current) => (current && isSameDay(current, day) ? null : day))}
                className={cn(
                  'bg-white p-2 sm:p-3 cursor-pointer transition-colors relative group border-t border-slate-200',
                  calendarView === 'week' ? 'min-h-[100px]' : 'min-h-[100px]',
                  !isCurrentMonth && 'text-slate-400 bg-slate-50/50',
                  isSelected && 'bg-indigo-50/30 ring-1 ring-inset ring-indigo-500/20',
                  !isSelected && 'hover:bg-slate-50',
                )}
              >
                <div
                  className={cn(
                    'w-7 h-7 flex items-center justify-center rounded-full text-sm mb-2',
                    isSelected ? 'bg-indigo-600 text-white font-bold shadow-sm' : isToday(day) ? 'bg-indigo-100 text-indigo-700 font-semibold' : 'text-slate-700',
                  )}
                >
                  {format(day, 'd')}
                </div>
                {calendarTasks.length > 0 && (
                  <div className="flex flex-col gap-1">
                    {calendarTasks.slice(0, 3).map((task) => (
                      <div key={task.id} onClick={(event) => { event.stopPropagation(); onSelectTask(task.id); }} className="flex items-center gap-1.5 p-0.5 rounded hover:bg-slate-100 transition-colors">
                        <div className={cn('w-1.5 h-1.5 rounded-full shrink-0', task.status === 'completed' ? 'bg-emerald-500' : task.status === 'processing' ? 'bg-amber-500' : task.status === 'failed' ? 'bg-red-500' : 'bg-slate-400')} />
                        <span className="text-[11px] text-slate-600 truncate font-medium">{task.originalName}</span>
                      </div>
                    ))}
                    {calendarTasks.length > 3 && <span className="text-[10px] text-slate-500 pl-3">+{calendarTasks.length - 3} more</span>}
                  </div>
                )}
              </div>
            );
          })}
        </div>

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
                {selectedNotebookId ? 'Filtered by notebook.' : 'Showing all notebooks.'} {selectedTag ? `Tag: #${selectedTag}` : ''} {selectedDate ? '' : 'Select a date on the calendar to narrow it down.'}
              </p>
            </div>
            <div className="flex items-center gap-3">
              {selectedDate && (
                <button
                  onClick={() => setSelectedDate(null)}
                  className="text-xs font-medium text-indigo-600 hover:text-indigo-700"
                >
                  Clear date filter
                </button>
              )}
              <span className="text-sm text-slate-500">{visibleTasks.length} items</span>
            </div>
          </div>

          {visibleTasks.length === 0 ? (
            <div className="text-sm text-slate-500 mt-4">
              {selectedDate ? 'No tasks for the selected date.' : 'No tasks match the current notebook/tag filters.'}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 mt-4">
              {visibleTasks.map((task) => (
                <div
                  key={task.id}
                  onClick={() => onSelectTask(task.id)}
                  className="p-3 rounded-xl border border-slate-200 bg-slate-50 hover:bg-white hover:border-indigo-300 hover:shadow-sm cursor-pointer transition-all flex flex-col gap-2 relative group"
                >
                  <button
                    onClick={(event) => { event.stopPropagation(); handleEditTask(task); }}
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
                    <div className="flex flex-wrap gap-1 mt-1">
                      {task.tags.slice(0, 3).map((tag) => (
                        <span key={tag} className="text-[10px] font-medium text-slate-600 bg-slate-200/70 px-1.5 py-0.5 rounded">
                          #{tag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {editingTask && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-slate-900">Edit Task</h3>
              <button onClick={() => setEditingTask(null)} className="text-slate-400 hover:text-slate-600 transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Task Name</label>
                <input
                  type="text"
                  value={editTaskName}
                  onChange={(event) => setEditTaskName(event.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Notebook</label>
                <select
                  value={editTaskNotebookId || ''}
                  onChange={(event) => setEditTaskNotebookId(event.target.value || null)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
                >
                  <option value="">None</option>
                  {notebooks.map((notebook) => (
                    <option key={notebook.id} value={notebook.id}>
                      {notebook.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Date</label>
                <input
                  type="date"
                  value={editTaskDate}
                  onChange={(event) => setEditTaskDate(event.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Tags</label>
                <input
                  type="text"
                  value={editTaskTags}
                  onChange={(event) => setEditTaskTags(event.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
                  placeholder="meeting, research"
                />
              </div>
            </div>
            <div className="px-6 py-4 bg-slate-50 border-t border-slate-100 flex justify-end gap-3">
              <button onClick={() => setEditingTask(null)} className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-800 transition-colors">
                Cancel
              </button>
              <button onClick={() => void handleSaveTaskEdit()} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg transition-colors shadow-sm">
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
