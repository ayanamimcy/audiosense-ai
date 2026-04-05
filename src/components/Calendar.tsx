import React from 'react';
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
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '../lib/utils';
import type { Task } from '../types';

export function Calendar({
  tasks,
  currentPeriodDate,
  calendarView,
  selectedDate,
  onPeriodChange,
  onViewChange,
  onSelectDate,
  onSelectTask,
}: {
  tasks: Task[];
  currentPeriodDate: Date;
  calendarView: 'week' | 'month';
  selectedDate: Date | null;
  onPeriodChange: (date: Date) => void;
  onViewChange: (view: 'week' | 'month') => void;
  onSelectDate: (date: Date | null) => void;
  onSelectTask: (taskId: string) => void;
}) {
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
      ? `${format(weekStart, 'MMM d, yyyy')} - ${format(weekEnd, isSameMonth(weekStart, weekEnd) ? 'd' : 'MMM d')}`
      : format(currentPeriodDate, 'MMMM yyyy');

  return (
    <>
      <div className="flex items-start justify-between gap-4 mb-6 shrink-0 flex-wrap">
        <div>
          <h2 className="text-xl font-bold text-slate-900">{calendarTitle}</h2>
          <p className="text-sm text-slate-500 mt-1">Browse your audio content by notebook and tag</p>
        </div>
        <div className="flex items-center gap-3 ml-auto">
          <div className="flex bg-slate-100 rounded-full border border-slate-200 p-1">
            <button
              onClick={() => onViewChange('week')}
              className={cn(
                'px-3 py-1.5 text-xs font-medium rounded-full transition-colors',
                calendarView === 'week' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900',
              )}
            >
              Week
            </button>
            <button
              onClick={() => onViewChange('month')}
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
              onClick={() => onPeriodChange(calendarView === 'week' ? subWeeks(currentPeriodDate, 1) : subMonths(currentPeriodDate, 1))}
              className="p-1.5 hover:bg-white rounded-full text-slate-600 transition-colors shadow-sm"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              onClick={() => onPeriodChange(calendarView === 'week' ? addWeeks(currentPeriodDate, 1) : addMonths(currentPeriodDate, 1))}
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
          const calendarTasks = tasks.filter((task) => isSameDay(new Date(task.eventDate || task.createdAt), day));

          return (
            <div
              key={day.toISOString()}
              onClick={() => onSelectDate(selectedDate && isSameDay(selectedDate, day) ? null : day)}
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
                    <div key={task.id} onClick={(e) => { e.stopPropagation(); onSelectTask(task.id); }} className="flex items-center gap-1.5 p-0.5 rounded hover:bg-slate-100 transition-colors">
                      <div
                        className={cn(
                          'w-1.5 h-1.5 rounded-full shrink-0',
                          task.status === 'completed'
                            ? 'bg-emerald-500'
                            : task.status === 'processing'
                              ? 'bg-amber-500'
                              : task.status === 'blocked'
                                ? 'bg-violet-500'
                                : task.status === 'failed'
                                  ? 'bg-red-500'
                                  : 'bg-slate-400',
                        )}
                      />
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
    </>
  );
}
