import React, { useState } from 'react';
import { format } from 'date-fns';
import { Book, Check, Edit2, Sparkles, Tag, Users, Waves } from 'lucide-react';
import { cn } from '../../lib/utils';
import { apiFetch } from '../../api';
import { useAppDataContext } from '../../contexts/AppDataContext';
import { getTaskMediaUrl, getTaskSubtitleUrl, getTaskTrackLanguage, isVideoTask } from '../../lib/media';
import { StatCard } from './StatCard';
import type { Task } from '../../types';

export function TaskHeader({
  task,
  mediaRef,
  onUpdateTask,
  onTimeUpdate,
}: {
  task: Task;
  mediaRef: React.RefObject<HTMLMediaElement | null>;
  onUpdateTask: () => void | Promise<void>;
  onTimeUpdate: (currentTime: number) => void;
}) {
  const { notebooks, capabilities } = useAppDataContext();
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(task.originalName);
  const [editTags, setEditTags] = useState(task.tags.join(', '));
  const [editNotebookId, setEditNotebookId] = useState(task.notebookId || '');
  const [editDate, setEditDate] = useState(format(new Date(task.eventDate || task.createdAt), 'yyyy-MM-dd'));

  // Reset edit state when task changes
  React.useEffect(() => {
    setEditName(task.originalName);
    setEditTags(task.tags.join(', '));
    setEditNotebookId(task.notebookId || '');
    setEditDate(format(new Date(task.eventDate || task.createdAt), 'yyyy-MM-dd'));
    setIsEditing(false);
  }, [task.id]);

  const notebook = notebooks.find((item) => item.id === task.notebookId);
  const isVideo = isVideoTask(task);
  const mediaUrl = getTaskMediaUrl(task);
  const subtitleUrl = task.segments.length > 0 ? getTaskSubtitleUrl(task) : null;
  const trackLanguage = getTaskTrackLanguage(task);

  const handleSave = async () => {
    const tagsArray = editTags
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean);

    const [year, month, day] = editDate.split('-');
    const eventDateTimestamp =
      year && month && day ? new Date(Number(year), Number(month) - 1, Number(day)).getTime() : task.eventDate || task.createdAt;

    try {
      const res = await apiFetch(`/api/tasks/${task.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          originalName: editName.trim(),
          tags: tagsArray,
          notebookId: editNotebookId || null,
          eventDate: eventDateTimestamp,
        }),
      });

      if (!res.ok) {
        throw new Error('Failed to update task.');
      }

      setIsEditing(false);
      await onUpdateTask();
    } catch (error) {
      console.error('Failed to update task', error);
    }
  };

  return (
    <div className="p-6 border-b border-slate-200 bg-slate-50/60 flex flex-col gap-4 shrink-0">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex-1 min-w-[280px]">
          {isEditing ? (
            <div className="space-y-3 bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Name</label>
                <input
                  type="text"
                  value={editName}
                  onChange={(event) => setEditName(event.target.value)}
                  className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Tags</label>
                <input
                  type="text"
                  value={editTags}
                  onChange={(event) => setEditTags(event.target.value)}
                  placeholder="meeting, action items"
                  className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">Notebook</label>
                  <select
                    value={editNotebookId}
                    onChange={(event) => setEditNotebookId(event.target.value)}
                    className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="">None</option>
                    {notebooks.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">Date</label>
                  <input
                    type="date"
                    value={editDate}
                    onChange={(event) => setEditDate(event.target.value)}
                    className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button onClick={() => setIsEditing(false)} className="px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg">
                  Cancel
                </button>
                <button onClick={() => void handleSave()} className="px-3 py-1.5 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg flex items-center gap-1">
                  <Check className="w-4 h-4" /> Save
                </button>
              </div>
            </div>
          ) : (
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-4">
                <h2 className="text-xl font-semibold text-slate-900 truncate">{task.originalName}</h2>
                <button onClick={() => setIsEditing(true)} className="px-3 py-1.5 text-xs font-medium text-slate-600 bg-white border border-slate-200 hover:bg-slate-50 hover:text-indigo-600 rounded-lg flex items-center gap-1.5 transition-colors shadow-sm shrink-0">
                  <Edit2 className="w-3.5 h-3.5" /> Edit Task
                </button>
              </div>
              <div className="flex items-center flex-wrap gap-3 mt-3">
                <span
                  className={cn(
                    'px-2.5 py-0.5 rounded-full text-xs font-medium capitalize border',
                    task.status === 'completed'
                      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                      : task.status === 'processing'
                        ? 'bg-amber-50 text-amber-700 border-amber-200'
                        : task.status === 'failed'
                          ? 'bg-red-50 text-red-700 border-red-200'
                          : 'bg-slate-100 text-slate-700 border-slate-200',
                  )}
                >
                  {task.status}
                </span>
                <span className="text-sm text-slate-500">{format(new Date(task.eventDate || task.createdAt), 'MMM d, yyyy')}</span>
                {task.language && <span className="text-xs font-medium text-slate-600 bg-slate-100 px-2 py-0.5 rounded-full">{task.language}</span>}
                {task.provider && <span className="text-xs font-medium text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full border border-indigo-100">{task.provider}</span>}
                {task.durationSeconds ? <span className="text-xs font-medium text-slate-600 bg-slate-100 px-2 py-0.5 rounded-full">{task.durationSeconds.toFixed(1)}s</span> : null}
                {notebook && (
                  <span className="flex items-center gap-1 text-xs font-medium text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-md border border-indigo-100">
                    <Book className="w-3 h-3" />
                    {notebook.name}
                  </span>
                )}
                {task.tags.length > 0 && (
                  <div className="flex items-center gap-1 flex-wrap">
                    <Tag className="w-3 h-3 text-slate-400" />
                    {task.tags.map((tag) => (
                      <span key={tag} className="text-xs text-slate-600 bg-slate-200/50 px-2 py-0.5 rounded-md border border-slate-200">
                        #{tag}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {isVideo ? (
          <video
            ref={mediaRef as React.RefObject<HTMLVideoElement>}
            controls
            src={mediaUrl}
            className="w-full sm:w-[26rem] shrink-0 aspect-video rounded-2xl bg-slate-950 border border-slate-200 shadow-sm"
            onTimeUpdate={(event) => onTimeUpdate(event.currentTarget.currentTime)}
            onSeeked={(event) => onTimeUpdate(event.currentTarget.currentTime)}
            onLoadedMetadata={(event) => onTimeUpdate(event.currentTarget.currentTime)}
            onEnded={() => onTimeUpdate(-1)}
          >
            {subtitleUrl && (
              <track kind="subtitles" src={subtitleUrl} srcLang={trackLanguage} label="Transcript" default />
            )}
          </video>
        ) : (
          <audio
            ref={mediaRef as React.RefObject<HTMLAudioElement>}
            controls
            src={mediaUrl}
            className="h-10 w-full sm:w-72 shrink-0"
            onTimeUpdate={(event) => onTimeUpdate(event.currentTarget.currentTime)}
            onSeeked={(event) => onTimeUpdate(event.currentTarget.currentTime)}
            onLoadedMetadata={(event) => onTimeUpdate(event.currentTarget.currentTime)}
            onEnded={() => onTimeUpdate(-1)}
          />
        )}
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <StatCard icon={<Users className="w-4 h-4 text-indigo-600" />} label="Speakers" value={String(task.speakers.length || 0)} />
        <StatCard icon={<Waves className="w-4 h-4 text-emerald-600" />} label="Segments" value={String(task.segments.length || 0)} />
        <StatCard icon={<Sparkles className="w-4 h-4 text-amber-600" />} label="LLM" value={capabilities?.llm.configured ? capabilities.llm.model : 'Not configured'} />
      </div>
    </div>
  );
}
