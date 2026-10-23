import { useCallback, useEffect, useMemo, useRef, useState, type SyntheticEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { apiFetch } from '@/shared/api/base';
import { cn } from '@/shared/lib/cn';
import { formatTime } from '@/shared/lib/format';
import { useIsDesktop } from '@/shared/lib/useMediaQuery';
import {
  getTaskMediaUrl,
  getTaskSubtitleUrl,
  getTaskTrackLanguage,
  hasTaskSummaryState,
  isVideoTask,
  type Task,
} from '@/entities/task';
import { TaskEditModal } from '@/features/task-edit';
import { useTaskChat } from '../model/useTaskChat';
import { ChatPanel } from './ChatPanel';
import { DetailHeader } from './DetailHeader';
import { PLAYBACK_RATES, PlayerBar } from './PlayerBar';
import { RelatedRecordings } from './RelatedRecordings';
import { ReprocessDialog } from './ReprocessDialog';
import { SummaryPanel } from './SummaryPanel';
import { TaskStatusView } from './TaskStatusView';
import { TranscriptPanel } from './TranscriptPanel';

type Tab = 'summary' | 'transcript' | 'chat';

const TABS: { id: Tab; label: string }[] = [
  { id: 'summary', label: 'Summary' },
  { id: 'transcript', label: 'Transcript' },
  { id: 'chat', label: 'Chat' },
];

/** After the user scrolls the transcript by hand, wait this long before following playback again. */
const FOLLOW_RESUME_MS = 4000;

function buildTranscriptClipboardText(task: Task) {
  if (task.segments.length > 0) {
    return task.segments
      .map((segment) => {
        const speaker = segment.speaker?.trim() ? `${segment.speaker}: ` : '';
        return `[${formatTime(segment.start)} - ${formatTime(segment.end)}] ${speaker}${segment.text}`.trim();
      })
      .join('\n\n');
  }

  return task.transcript || task.result || '';
}

export function TaskDetail({
  task,
  onUpdateTask,
  onDeleteTask,
  onBack,
}: {
  task: Task;
  onUpdateTask: () => void | Promise<void>;
  onDeleteTask: () => void | Promise<void>;
  onBack: () => void;
}) {
  const isDesktop = useIsDesktop();
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState<Tab>(() => (hasTaskSummaryState(task) ? 'summary' : 'transcript'));
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isReprocessOpen, setIsReprocessOpen] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [transcriptCopied, setTranscriptCopied] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const mediaRef = useRef<HTMLMediaElement | null>(null);
  const contentScrollRef = useRef<HTMLDivElement | null>(null);
  const segmentRefs = useRef(new Map<string, HTMLButtonElement>());
  const isFollowingRef = useRef(true);
  const followResumeTimerRef = useRef<number | undefined>(undefined);
  const chat = useTaskChat(task.id);

  const isVideo = isVideoTask(task);
  const isCompleted = task.status === 'completed';
  const hasTranscript = Boolean(task.segments.length || task.transcript || task.result);

  useEffect(() => {
    setActiveTab(hasTaskSummaryState(task) ? 'summary' : 'transcript');
    setCurrentTime(0);
    setDuration(0);
    setIsPlaying(false);
    contentScrollRef.current?.scrollTo({ top: 0 });
    // Only reset when switching recordings, not on every poll of the same one.
  }, [task.id]);

  useEffect(() => {
    if (mediaRef.current) mediaRef.current.playbackRate = playbackRate;
  }, [playbackRate, task.id]);

  const activeSegmentId = useMemo(() => {
    if (!isPlaying && currentTime === 0) return null;
    return task.segments.find((segment) => currentTime >= segment.start && currentTime < segment.end)?.id || null;
  }, [currentTime, isPlaying, task.segments]);

  const seekTo = useCallback((time: number, play = false) => {
    const media = mediaRef.current;
    if (!media) return;
    media.currentTime = Math.max(time, 0);
    setCurrentTime(media.currentTime);
    if (play) {
      void media.play().catch((error) => console.error('Failed to start playback:', error));
    }
  }, []);

  // Deep links from Ask AI citations: /notebook/:id?seekTo=123
  const seekToParam = searchParams.get('seekTo');
  useEffect(() => {
    if (!seekToParam) return;
    const seconds = Number(seekToParam);
    const media = mediaRef.current;
    if (Number.isFinite(seconds) && media) {
      const doSeek = () => {
        seekTo(seconds, true);
        setActiveTab('transcript');
      };
      if (media.readyState >= 1) {
        doSeek();
      } else {
        media.addEventListener('loadedmetadata', doSeek, { once: true });
      }
    }
    setSearchParams((params) => {
      const next = new URLSearchParams(params);
      next.delete('seekTo');
      return next;
    }, { replace: true });
  }, [seekToParam, seekTo, setSearchParams, task.id]);

  const scrollToActiveSegment = useCallback((behavior: ScrollBehavior) => {
    if (!activeSegmentId) return;
    const element = segmentRefs.current.get(activeSegmentId);
    const container = contentScrollRef.current;
    if (!element || !container) return;

    const containerRect = container.getBoundingClientRect();
    const elementRect = element.getBoundingClientRect();
    const targetOffset = containerRect.height * 0.2;
    if (Math.abs(elementRect.top - (containerRect.top + targetOffset)) < 20) return;
    container.scrollTo({
      top: Math.max(container.scrollTop + (elementRect.top - containerRect.top) - targetOffset, 0),
      behavior,
    });
  }, [activeSegmentId]);

  // Keep the spoken line in view while playing, unless the user is reading elsewhere.
  useEffect(() => {
    if (activeTab === 'transcript' && isPlaying && isFollowingRef.current) {
      scrollToActiveSegment('smooth');
    }
  }, [activeTab, isPlaying, scrollToActiveSegment]);

  useEffect(() => () => window.clearTimeout(followResumeTimerRef.current), []);

  const pauseFollowing = () => {
    isFollowingRef.current = false;
    window.clearTimeout(followResumeTimerRef.current);
    followResumeTimerRef.current = window.setTimeout(() => {
      isFollowingRef.current = true;
    }, FOLLOW_RESUME_MS);
  };

  const handleShowTranscript = () => {
    setActiveTab('transcript');
    isFollowingRef.current = true;
    window.requestAnimationFrame(() => scrollToActiveSegment('smooth'));
  };

  const handleTogglePlay = () => {
    const media = mediaRef.current;
    if (!media) return;
    if (media.paused) {
      void media.play().catch((error) => console.error('Failed to start playback:', error));
    } else {
      media.pause();
    }
  };

  const handleCycleRate = () => {
    setPlaybackRate((current) => PLAYBACK_RATES[(PLAYBACK_RATES.indexOf(current) + 1) % PLAYBACK_RATES.length]);
  };

  const handleCopyTranscript = async () => {
    const content = buildTranscriptClipboardText(task).trim();
    if (!content) return;
    try {
      await navigator.clipboard.writeText(content);
      setTranscriptCopied(true);
      window.setTimeout(() => setTranscriptCopied(false), 1800);
    } catch (error) {
      console.error('Failed to copy transcript:', error);
      alert('Failed to copy transcript.');
    }
  };

  const handleDelete = async () => {
    if (!confirm(`Delete "${task.originalName}"? This cannot be undone.`)) return;
    try {
      const res = await apiFetch(`/api/tasks/${task.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete recording.');
      await onDeleteTask();
    } catch (error) {
      console.error('Failed to delete task:', error);
      alert('Failed to delete recording.');
    }
  };

  const handleCancel = async () => {
    if (isCancelling) return;
    setIsCancelling(true);
    try {
      const res = await apiFetch(`/api/tasks/${task.id}/cancel`, { method: 'POST' });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(payload.error || 'Failed to cancel.');
      }
      await onUpdateTask();
    } catch (error) {
      console.error('Failed to cancel task:', error);
      alert(error instanceof Error ? error.message : 'Failed to cancel.');
    } finally {
      setIsCancelling(false);
    }
  };

  const reprocess = async (options: { language: string; provider?: string }) => {
    try {
      const res = await apiFetch(`/api/tasks/${task.id}/reprocess`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ language: options.language, provider: options.provider || undefined }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(payload.error || 'Failed to reprocess.');
      }
      setIsReprocessOpen(false);
      await onUpdateTask();
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Failed to reprocess.');
    }
  };

  const mediaHandlers = {
    onTimeUpdate: (event: SyntheticEvent<HTMLMediaElement>) => setCurrentTime(event.currentTarget.currentTime),
    onSeeked: (event: SyntheticEvent<HTMLMediaElement>) => setCurrentTime(event.currentTarget.currentTime),
    onLoadedMetadata: (event: SyntheticEvent<HTMLMediaElement>) => {
      const media = event.currentTarget;
      setDuration(Number.isFinite(media.duration) ? media.duration : 0);
      media.playbackRate = playbackRate;
    },
    onDurationChange: (event: SyntheticEvent<HTMLMediaElement>) => {
      const value = event.currentTarget.duration;
      setDuration(Number.isFinite(value) ? value : 0);
    },
    onPlay: () => setIsPlaying(true),
    onPause: () => setIsPlaying(false),
    onEnded: () => setIsPlaying(false),
  };

  const tabs = isCompleted ? (
    isDesktop ? (
      <div role="tablist" className="mt-4 flex gap-6 border-b border-stone-200 px-8">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              '-mb-px h-10 border-b-2 px-0.5 text-sm font-medium transition-colors',
              activeTab === tab.id ? 'border-stone-900 text-stone-900' : 'border-transparent text-stone-600 hover:text-stone-900',
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>
    ) : (
      <div role="tablist" className="mx-5 mt-4 grid grid-cols-3 gap-1 rounded-xl bg-stone-100 p-1">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              'h-9 rounded-lg text-sm font-medium transition-colors',
              activeTab === tab.id ? 'bg-white text-stone-900 shadow-sm' : 'text-stone-600',
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>
    )
  ) : null;

  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      <DetailHeader
        task={task}
        isDesktop={isDesktop}
        hasTranscript={hasTranscript}
        transcriptCopied={transcriptCopied}
        onBack={onBack}
        onCopyTranscript={() => void handleCopyTranscript()}
        onEdit={() => setIsEditOpen(true)}
        onReprocess={() => setIsReprocessOpen(true)}
        onDelete={() => void handleDelete()}
        onUpdateTask={onUpdateTask}
      />

      {isVideo ? (
        <div className={cn('mt-4 shrink-0', isDesktop ? 'px-8' : 'px-5')}>
          <video
            ref={(element) => {
              mediaRef.current = element;
            }}
            controls
            playsInline
            preload="metadata"
            src={getTaskMediaUrl(task)}
            className="max-h-[38dvh] w-full rounded-xl bg-black object-contain"
            {...mediaHandlers}
          >
            {task.segments.length > 0 ? (
              <track kind="subtitles" src={getTaskSubtitleUrl(task)} srcLang={getTaskTrackLanguage(task)} label="Transcript" default />
            ) : null}
          </video>
        </div>
      ) : (
        <audio
          ref={(element) => {
            mediaRef.current = element;
          }}
          preload="metadata"
          src={getTaskMediaUrl(task)}
          className="hidden"
          {...mediaHandlers}
        />
      )}

      {tabs}

      <div
        ref={contentScrollRef}
        onWheel={pauseFollowing}
        onTouchMove={pauseFollowing}
        className="min-h-0 flex-1 overflow-y-auto custom-scrollbar"
      >
        <div className={cn('max-w-3xl', isDesktop ? 'px-8 py-6' : 'px-5 py-5')}>
          {!isCompleted ? (
            <TaskStatusView
              task={task}
              isCancelling={isCancelling}
              onCancel={() => void handleCancel()}
              onRetry={() => void reprocess({ language: task.language || 'auto' })}
              onRetryWithOptions={() => setIsReprocessOpen(true)}
            />
          ) : activeTab === 'summary' ? (
            <>
              <SummaryPanel task={task} onUpdateTask={onUpdateTask} />
              <RelatedRecordings taskId={task.id} />
            </>
          ) : activeTab === 'transcript' ? (
            <TranscriptPanel
              task={task}
              activeSegmentId={activeSegmentId}
              onSeekToSegment={(start) => seekTo(start, true)}
              segmentRefs={segmentRefs}
            />
          ) : (
            <ChatPanel
              task={task}
              messages={chat.messages}
              messageInput={chat.messageInput}
              onMessageInputChange={chat.setMessageInput}
              isSendingMessage={chat.isSendingMessage}
              onSendMessage={(message) => void chat.sendMessage(message)}
            />
          )}
        </div>
      </div>

      {!isVideo ? (
        <PlayerBar
          variant={isDesktop ? 'desktop' : 'mobile'}
          currentTime={currentTime}
          duration={duration || task.durationSeconds || 0}
          isPlaying={isPlaying}
          playbackRate={playbackRate}
          onTogglePlay={handleTogglePlay}
          onSeek={(time) => seekTo(time)}
          onCycleRate={handleCycleRate}
          onShowTranscript={isCompleted && task.segments.length > 0 ? handleShowTranscript : undefined}
        />
      ) : null}

      {isEditOpen ? (
        <TaskEditModal task={task} onClose={() => setIsEditOpen(false)} onSaved={onUpdateTask} />
      ) : null}
      {isReprocessOpen ? (
        <ReprocessDialog task={task} onClose={() => setIsReprocessOpen(false)} onSubmit={reprocess} />
      ) : null}
    </div>
  );
}
