import React, { useMemo, useState } from 'react';
import { format, isSameDay } from 'date-fns';
import { Edit2, FileAudio } from 'lucide-react';
import { cn } from './lib/utils';
import { useAppDataContext } from './contexts/AppDataContext';
import { NotebookSidebar } from './components/NotebookSidebar';
import { Calendar } from './components/Calendar';
import { TaskEditModal } from './components/TaskEditModal';
import type { Task } from './types';

export default function NotebookView({
  onSelectTask,
}: {
  onSelectTask: (taskId: string) => void;
}) {
  const { tasks, notebooks, tags, fetchNotebooks, fetchTasks, fetchTags } = useAppDataContext();
  const onUpdateTasks = async () => { await fetchTasks(); await fetchTags(); };

  const [currentPeriodDate, setCurrentPeriodDate] = useState(new Date());
  const [calendarView, setCalendarView] = useState<'week' | 'month'>('week');
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [selectedNotebookId, setSelectedNotebookId] = useState<string | null>(null);
  const [selectedTag, setSelectedTag] = useState('');
  const [editingTask, setEditingTask] = useState<Task | null>(null);

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

  return (
    <div className="flex flex-col lg:flex-row gap-4 lg:gap-6 h-full lg:overflow-hidden overflow-y-auto custom-scrollbar">
      <NotebookSidebar
        tasks={tasks}
        notebooks={notebooks}
        tags={tags}
        selectedNotebookId={selectedNotebookId}
        selectedTag={selectedTag}
        onSelectAll={() => { setSelectedNotebookId(null); setSelectedDate(null); }}
        onSelectNotebook={(id) => { setSelectedNotebookId(id); setSelectedDate(null); }}
        onSelectTag={setSelectedTag}
        onSelectTask={onSelectTask}
        onEditTask={setEditingTask}
        onUpdateNotebooks={fetchNotebooks}
        onUpdateTasks={onUpdateTasks}
      />

      <div
        className={cn(
          'lg:flex-1 flex-none h-auto bg-white border border-slate-200 rounded-2xl p-4 sm:p-6 flex flex-col shadow-sm shrink-0',
          calendarView === 'week' ? 'lg:overflow-hidden' : 'lg:overflow-y-auto custom-scrollbar',
        )}
      >
        <Calendar
          tasks={filteredTasks}
          currentPeriodDate={currentPeriodDate}
          calendarView={calendarView}
          selectedDate={selectedDate}
          onPeriodChange={setCurrentPeriodDate}
          onViewChange={setCalendarView}
          onSelectDate={setSelectedDate}
          onSelectTask={onSelectTask}
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
                {selectedNotebookId ? 'Filtered by notebook.' : 'Showing all notebooks.'} {selectedTag ? `Tag: #${selectedTag}` : ''} {selectedDate ? '' : 'Select a date on the calendar to narrow it down.'}
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
        <TaskEditModal
          task={editingTask}
          onClose={() => setEditingTask(null)}
          onSaved={onUpdateTasks}
        />
      )}
    </div>
  );
}
