import React, { useState } from 'react';
import { format } from 'date-fns';
import { Book, Check, ChevronDown, Edit2, Maximize2, Sparkles, Tag, Trash2, Users, Waves } from 'lucide-react';
import { cn } from '../../lib/utils';
import { apiFetch } from '../../api';
import { useAppDataContext } from '../../contexts/AppDataContext';
import { getTaskMediaUrl, getTaskSubtitleUrl, getTaskTrackLanguage, isVideoTask } from '../../lib/media';
import { StatCard } from './StatCard';
import { TaskTagSuggestionPanel } from './TaskTagSuggestionPanel';
import type { Task } from '../../types';

type TaskHeaderVariant = 'default' | 'mobile-player';
type MobilePresentation = 'full' | 'mini';

export function TaskHeader({
  task,
  mediaRef,
  onUpdateTask,
  onTimeUpdate,
  variant = 'default',
  mobilePresentation = 'full',
  mobileAudioControls = 'native',
  onExpandMini,
  onDeleteTask,
  hidden = false,
}: {
  task: Task;
  mediaRef: React.RefObject<HTMLMediaElement | null>;
  onUpdateTask: () => void | Promise<void>;
  onTimeUpdate: (currentTime: number) => void;
  variant?: TaskHeaderVariant;
  mobilePresentation?: MobilePresentation;
  mobileAudioControls?: 'native' | 'bottom-bar';
  onExpandMini?: () => void;
  onDeleteTask?: () => void | Promise<void>;
  hidden?: boolean;
}) {
  const { notebooks, capabilities } = useAppDataContext();
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(task.originalName);
  const [editTags, setEditTags] = useState(task.tags.join(', '));
  const [editNotebookId, setEditNotebookId] = useState(task.notebookId || '');
  const [editDate, setEditDate] = useState(format(new Date(task.eventDate || task.createdAt), 'yyyy-MM-dd'));
  const [isMetadataVisible, setIsMetadataVisible] = useState(false);
  const [isMobileMetadataExpanded, setIsMobileMetadataExpanded] = useState(false);
  const [isTagsExpanded, setIsTagsExpanded] = useState(false);

  React.useEffect(() => {
    setEditName(task.originalName);
    setEditTags(task.tags.join(', '));
    setEditNotebookId(task.notebookId || '');
    setEditDate(format(new Date(task.eventDate || task.createdAt), 'yyyy-MM-dd'));
    setIsEditing(false);
    setIsTagsExpanded(false);
    setIsMetadataVisible(false);
    setIsMobileMetadataExpanded(false);
  }, [task.id]);

  const notebook = notebooks.find((item) => item.id === task.notebookId);
  const isVideo = isVideoTask(task);
  const mediaUrl = getTaskMediaUrl(task);
  const subtitleUrl = task.segments.length > 0 ? getTaskSubtitleUrl(task) : null;
  const trackLanguage = getTaskTrackLanguage(task);
  const isMini = variant === 'mobile-player' && mobilePresentation === 'mini';
  const useBottomAudioBar = variant === 'mobile-player' && mobileAudioControls === 'bottom-bar' && !isVideo;
  const hasExtraMobileMetadata = Boolean(
    task.language || task.provider || task.durationSeconds || notebook || task.tags.length > 0,
  );

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

  const renderMedia = () => {
    if (isVideo) {
      return (
        <video
          ref={mediaRef as React.RefObject<HTMLVideoElement>}
          controls
          playsInline
          preload="metadata"
          src={mediaUrl}
          className={cn(
            'w-full bg-slate-950',
            variant === 'mobile-player'
              ? isMini
                ? 'aspect-video object-cover'
                : 'h-full object-contain'
              : 'w-full aspect-video object-contain',
          )}
          onTimeUpdate={(event) => onTimeUpdate(event.currentTarget.currentTime)}
          onSeeked={(event) => onTimeUpdate(event.currentTarget.currentTime)}
          onLoadedMetadata={(event) => onTimeUpdate(event.currentTarget.currentTime)}
          onEnded={() => onTimeUpdate(-1)}
        >
          {subtitleUrl && (
            <track kind="subtitles" src={subtitleUrl} srcLang={trackLanguage} label="Transcript" default />
          )}
        </video>
      );
    }

    return (
      <audio
        ref={mediaRef as React.RefObject<HTMLAudioElement>}
        controls={!useBottomAudioBar}
        preload="metadata"
        src={mediaUrl}
        className={cn(
          'w-full shrink-0',
          useBottomAudioBar ? 'sr-only pointer-events-none absolute opacity-0' : '',
          variant === 'mobile-player'
            ? isMini
              ? 'h-10'
              : 'h-11'
            : 'h-10 sm:w-72',
        )}
        onTimeUpdate={(event) => onTimeUpdate(event.currentTarget.currentTime)}
        onSeeked={(event) => onTimeUpdate(event.currentTarget.currentTime)}
        onLoadedMetadata={(event) => onTimeUpdate(event.currentTarget.currentTime)}
        onEnded={() => onTimeUpdate(-1)}
      />
    );
  };

  if (variant === 'mobile-player') {
    if (useBottomAudioBar) {
      return <div className="h-0 overflow-hidden shrink-0" />;
    }

    return (
      <div className={cn('shrink-0 border-b border-slate-200 bg-white', hidden && 'h-0 overflow-hidden border-none')}>
        <div className={cn(isVideo ? 'h-[clamp(12rem,30dvh,16rem)] bg-slate-950' : 'px-3 py-2')}>
          {renderMedia()}
        </div>

        <div className="space-y-2.5 px-3 py-3">
          <div className="flex items-start gap-2">
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
              <span
                className={cn(
                  'rounded-full border px-2 py-0.5 text-xs font-medium capitalize whitespace-nowrap',
                  task.status === 'completed'
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                    : task.status === 'processing'
                      ? 'border-amber-200 bg-amber-50 text-amber-700'
                      : task.status === 'blocked'
                        ? 'border-violet-200 bg-violet-50 text-violet-700'
                      : task.status === 'failed'
                        ? 'border-red-200 bg-red-50 text-red-700'
                        : 'border-slate-200 bg-slate-100 text-slate-700',
                )}
              >
                {task.status}
              </span>
              <span className="whitespace-nowrap text-xs text-slate-500">
                {format(new Date(task.eventDate || task.createdAt), 'MMM d, yyyy')}
              </span>
              {isMobileMetadataExpanded && task.language ? (
                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[13px] font-medium text-slate-600">
                  {task.language}
                </span>
              ) : null}
              {isMobileMetadataExpanded && task.provider ? (
                <span className="rounded-full border border-indigo-100 bg-indigo-50 px-2.5 py-1 text-[13px] font-medium text-indigo-600">
                  {task.provider}
                </span>
              ) : null}
              {isMobileMetadataExpanded && task.durationSeconds ? (
                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[13px] font-medium text-slate-600">
                  {task.durationSeconds.toFixed(1)}s
                </span>
              ) : null}
              {isMobileMetadataExpanded && notebook ? (
                <span className="inline-flex items-center gap-1 rounded-full border border-indigo-100 bg-indigo-50 px-2.5 py-1 text-[13px] font-medium text-indigo-600">
                  <Book className="w-3 h-3" />
                  {notebook.name}
                </span>
              ) : null}
              {isMobileMetadataExpanded
                ? task.tags.map((tag) => (
                    <span
                      key={tag}
                      className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[13px] font-medium text-slate-600"
                    >
                      #{tag}
                    </span>
                  ))
                : null}
            </div>

            {hasExtraMobileMetadata ? (
              <button
                type="button"
                onClick={() => setIsMobileMetadataExpanded((current) => !current)}
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 shadow-sm transition-colors hover:bg-slate-50"
                aria-label={isMobileMetadataExpanded ? 'Collapse metadata' : 'Expand metadata'}
                aria-expanded={isMobileMetadataExpanded}
              >
                <ChevronDown
                  className={cn(
                    'h-4 w-4 transition-transform',
                    isMobileMetadataExpanded ? 'rotate-180' : '',
                  )}
                />
              </button>
            ) : null}
          </div>

          <TaskTagSuggestionPanel
            task={task}
            onUpdateTask={onUpdateTask}
            compact
            mode="inline"
          />
        </div>
      </div>
    );
  }

  return (
    <div className="border-b border-slate-200 bg-slate-50/60 flex flex-col shrink-0">
      {isVideo && (
        <div className="w-full bg-slate-950">
          {renderMedia()}
        </div>
      )}
      <div className="p-4 lg:p-5 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        {!isVideo && (
          <div className="shrink-0">
            {renderMedia()}
          </div>
        )}
        <div className="flex-1 min-w-[200px]">
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
                <div className="flex items-center gap-2 shrink-0">
                  {onDeleteTask ? (
                    <button
                      onClick={() => void onDeleteTask()}
                      className="px-3 py-1.5 text-xs font-medium text-red-600 bg-white border border-slate-200 hover:bg-red-50 rounded-lg flex items-center gap-1.5 transition-colors shadow-sm"
                    >
                      <Trash2 className="w-3.5 h-3.5" /> Delete
                    </button>
                  ) : null}
                  <button onClick={() => setIsEditing(true)} className="px-3 py-1.5 text-xs font-medium text-slate-600 bg-white border border-slate-200 hover:bg-slate-50 hover:text-indigo-600 rounded-lg flex items-center gap-1.5 transition-colors shadow-sm">
                    <Edit2 className="w-3.5 h-3.5" /> Edit
                  </button>
                </div>
              </div>
              <div className="flex items-center flex-wrap gap-3 mt-3">
                <span
                  className={cn(
                    'px-2.5 py-0.5 rounded-full text-xs font-medium capitalize border',
                    task.status === 'completed'
                      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                      : task.status === 'processing'
                        ? 'bg-amber-50 text-amber-700 border-amber-200'
                        : task.status === 'blocked'
                          ? 'bg-violet-50 text-violet-700 border-violet-200'
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
                  <div className={cn(
                    'flex items-center gap-1',
                    isTagsExpanded ? 'flex-wrap' : 'flex-nowrap overflow-hidden',
                  )}>
                    <Tag className="w-3 h-3 text-slate-400 shrink-0" />
                    {(isTagsExpanded ? task.tags : task.tags.slice(0, 3)).map((tag) => (
                      <span key={tag} className={cn(
                        'text-xs text-slate-600 bg-slate-200/50 px-2 py-0.5 rounded-md border border-slate-200 whitespace-nowrap',
                        !isTagsExpanded && 'min-w-0 overflow-hidden text-ellipsis',
                      )}>
                        #{tag}
                      </span>
                    ))}
                    {task.tags.length > 3 && (
                      <button
                        type="button"
                        onClick={() => setIsTagsExpanded((v) => !v)}
                        className="shrink-0 text-xs text-slate-500 hover:text-slate-700 px-1.5 py-0.5 rounded-md border border-slate-200 bg-white transition-colors whitespace-nowrap"
                      >
                        {isTagsExpanded ? 'Show less' : `+${task.tags.length - 3}`}
                      </button>
                    )}
                  </div>
                )}
                <TaskTagSuggestionPanel
                  task={task}
                  onUpdateTask={onUpdateTask}
                  mode="desktop-popover"
                />
              </div>
            </div>
          )}
        </div>
      </div>

      </div>
      <div className="rounded-xl border border-slate-200 bg-white mx-6 mb-4">
        <button
          type="button"
          onClick={() => setIsMetadataVisible((current) => !current)}
          className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left"
          aria-expanded={isMetadataVisible}
        >
          <span className="text-xs font-medium text-slate-600">Details</span>
          <ChevronDown
            className={cn(
              'w-3.5 h-3.5 text-slate-400 transition-transform',
              isMetadataVisible ? 'rotate-180' : '',
            )}
          />
        </button>

        {isMetadataVisible ? (
          <div className="border-t border-slate-200 p-4">
            <div className="grid gap-3 md:grid-cols-3">
              <StatCard icon={<Users className="w-4 h-4 text-indigo-600" />} label="Speakers" value={String(task.speakerCount || 0)} />
              <StatCard icon={<Waves className="w-4 h-4 text-emerald-600" />} label="Segments" value={String(task.segments.length || 0)} />
              <StatCard icon={<Sparkles className="w-4 h-4 text-amber-600" />} label="LLM" value={capabilities?.llm.configured ? capabilities.llm.model : 'Not configured'} />
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
