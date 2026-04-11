import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowUp,
  Copy,
  Edit2,
  List,
  Loader2,
  Menu,
  MessageSquare,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  RotateCw,
  Sparkles,
  Trash2,
  Waves,
  X,
} from 'lucide-react';
import { cn, formatTime, LANGUAGE_OPTIONS } from '../../lib/utils';
import { consumeSseStream } from '../../hooks/useSseStream';
import { apiFetch } from '../../api';
import { isVideoTask } from '../../lib/media';
import { hasTaskSummaryState, isTaskSummaryGenerating } from '../../lib/taskSummary';
import { TaskHeader } from './TaskHeader';
import { PanelButton } from './PanelButton';
import { SummaryPanel } from './SummaryPanel';
import { TranscriptPanel } from './TranscriptPanel';
import { ChatPanel } from './ChatPanel';
import { RelatedRecordings } from './RelatedRecordings';
import { TaskEditModal } from '../TaskEditModal';
import type { Task, TaskMessage } from '../../types';

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

function getInitialIsDesktop() {
  if (typeof window === 'undefined') {
    return true;
  }

  return window.matchMedia('(min-width: 1024px)').matches;
}

type Panel = 'summary' | 'transcript' | 'chat';

function MobileControlButton({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-w-0 flex-1 flex-col items-center justify-center gap-1 px-2 py-2 text-slate-500 transition-colors hover:text-slate-800"
    >
      <span className="flex h-9 w-9 items-center justify-center rounded-2xl bg-slate-100 text-slate-700">
        {icon}
      </span>
      <span className="text-[11px] font-medium">{label}</span>
    </button>
  );
}

export function TaskDetail({
  task,
  onUpdateTask,
}: {
  task: Task;
  onUpdateTask: () => void | Promise<void>;
}) {
  const [activePanel, setActivePanel] = useState<Panel>('summary');
  const [summaryInstructions, setSummaryInstructions] = useState('');
  const [summaryPromptSelection, setSummaryPromptSelection] = useState('default');
  const [isGeneratingSummary, setIsGeneratingSummary] = useState(false);
  const [messages, setMessages] = useState<TaskMessage[]>([]);
  const [messageInput, setMessageInput] = useState('');
  const [isSendingMessage, setIsSendingMessage] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [transcriptCopied, setTranscriptCopied] = useState(false);
  const [activeSegmentId, setActiveSegmentId] = useState<string | null>(null);
  const [isDesktop, setIsDesktop] = useState(getInitialIsDesktop);
  const [isMiniPlayer, setIsMiniPlayer] = useState(false);
  const [isActionSheetOpen, setIsActionSheetOpen] = useState(false);
  const [isReprocessOpen, setIsReprocessOpen] = useState(false);
  const [reprocessLanguage, setReprocessLanguage] = useState(task.language || 'auto');
  const [isChatOverlayOpen, setIsChatOverlayOpen] = useState(false);
  const [isChatSidebarOpen, setIsChatSidebarOpen] = useState(false);
  const [isMediaPlaying, setIsMediaPlaying] = useState(false);
  const [showScrollTop, setShowScrollTop] = useState(false);
  const [mediaCurrentTime, setMediaCurrentTime] = useState(0);
  const [mediaDuration, setMediaDuration] = useState(0);
  const mediaRef = useRef<HTMLMediaElement | null>(null);
  const segmentRefs = useRef(new Map<string, HTMLDivElement>());
  const contentScrollRef = useRef<HTMLDivElement | null>(null);
  const chatFabRef = useRef<HTMLButtonElement | null>(null);
  const chatFabDrag = useRef({ startX: 0, startY: 0, startRight: 16, startBottom: 0, moved: false });
  const [chatFabPos, setChatFabPos] = useState<{ right: number; bottom: number } | null>(null);
  const clampChatFabPos = useCallback((right: number, bottom: number) => ({
    right: Math.max(8, Math.min(window.innerWidth - 56, right)),
    bottom: Math.max(8, Math.min(window.innerHeight - 56, bottom)),
  }), []);

  const handleFabTouchStart = useCallback((e: React.TouchEvent) => {
    const touch = e.touches[0];
    const el = chatFabRef.current;
    if (!touch || !el) return;
    const rect = el.getBoundingClientRect();
    chatFabDrag.current = {
      startX: touch.clientX,
      startY: touch.clientY,
      startRight: window.innerWidth - rect.right,
      startBottom: window.innerHeight - rect.bottom,
      moved: false,
    };
  }, []);

  const handleFabTouchMove = useCallback((e: React.TouchEvent) => {
    const touch = e.touches[0];
    if (!touch) return;
    const drag = chatFabDrag.current;
    const dx = touch.clientX - drag.startX;
    const dy = touch.clientY - drag.startY;
    if (!drag.moved && Math.abs(dx) < 5 && Math.abs(dy) < 5) return;
    drag.moved = true;
    setChatFabPos(clampChatFabPos(drag.startRight - dx, drag.startBottom - dy));
  }, [clampChatFabPos]);

  const handleFabTouchEnd = useCallback(() => {
    if (!chatFabDrag.current.moved) {
      setIsChatOverlayOpen(true);
    }
  }, []);
  const isCompactLayout = !isDesktop;
  const isVideo = isVideoTask(task);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    const mediaQuery = window.matchMedia('(min-width: 1024px)');
    const handleChange = (event: MediaQueryListEvent) => setIsDesktop(event.matches);

    setIsDesktop(mediaQuery.matches);

    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', handleChange);
      return () => mediaQuery.removeEventListener('change', handleChange);
    }

    mediaQuery.addListener(handleChange);
    return () => mediaQuery.removeListener(handleChange);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    const handleResize = () => {
      setChatFabPos((current) => (
        current ? clampChatFabPos(current.right, current.bottom) : current
      ));
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [clampChatFabPos]);

  useEffect(() => {
    setSummaryInstructions('');
    setSummaryPromptSelection('default');
    setActivePanel(hasTaskSummaryState(task) ? 'summary' : 'transcript');
    setActiveSegmentId(null);
    setIsMiniPlayer(false);
    setIsActionSheetOpen(false);
    setIsChatOverlayOpen(false);
    setIsChatSidebarOpen(false);
    setIsMediaPlaying(false);
    setMediaCurrentTime(0);
    setMediaDuration(0);
    contentScrollRef.current?.scrollTo({ top: 0, behavior: 'auto' });
  }, [task.id]);

  useEffect(() => {
    if (!isCompactLayout) {
      setIsChatOverlayOpen(false);
      return;
    }
    setIsChatSidebarOpen(false);

    if (activePanel === 'chat') {
      setActivePanel(hasTaskSummaryState(task) ? 'summary' : 'transcript');
    }
  }, [activePanel, isCompactLayout, task]);

  useEffect(() => {
    if (task.status !== 'completed') {
      setIsChatSidebarOpen(false);
    }
  }, [task.status]);

  useEffect(() => {
    if (activePanel !== 'transcript' || !activeSegmentId) {
      return;
    }

    const element = segmentRefs.current.get(activeSegmentId);
    const container = contentScrollRef.current;
    if (!element) {
      return;
    }

    if (!isCompactLayout || !container) {
      element.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      return;
    }

    const containerRect = container.getBoundingClientRect();
    const elementRect = element.getBoundingClientRect();
    const comfortTop = containerRect.top + containerRect.height * 0.28;
    const comfortBottom = containerRect.bottom - containerRect.height * 0.28;

    if (elementRect.top >= comfortTop && elementRect.bottom <= comfortBottom) {
      return;
    }

    const nextTop =
      container.scrollTop +
      (elementRect.top - containerRect.top) -
      container.clientHeight / 2 +
      element.clientHeight / 2;

    container.scrollTo({
      top: Math.max(nextTop, 0),
      behavior: 'smooth',
    });
  }, [activePanel, activeSegmentId, isCompactLayout]);

  useEffect(() => {
    const loadMessages = async () => {
      try {
        const res = await apiFetch(`/api/tasks/${task.id}/messages`);
        if (!res.ok) {
          setMessages([]);
          return;
        }

        setMessages((await res.json()) as TaskMessage[]);
      } catch (error) {
        console.error('Failed to load messages:', error);
        setMessages([]);
      }
    };

    void loadMessages();
  }, [task.id]);

  useEffect(() => {
    const media = mediaRef.current;
    if (!media) {
      return undefined;
    }

    const syncMediaState = () => {
      setMediaCurrentTime(media.currentTime || 0);
      setMediaDuration(Number.isFinite(media.duration) ? media.duration : 0);
      setIsMediaPlaying(!media.paused && !media.ended);
    };

    const handleTimeUpdate = () => setMediaCurrentTime(media.currentTime || 0);
    const handleLoadedMetadata = () => {
      setMediaDuration(Number.isFinite(media.duration) ? media.duration : 0);
      setMediaCurrentTime(media.currentTime || 0);
    };
    const handlePlay = () => setIsMediaPlaying(true);
    const handlePause = () => setIsMediaPlaying(false);
    const handleEnded = () => {
      setIsMediaPlaying(false);
      setMediaCurrentTime(media.currentTime || 0);
    };

    syncMediaState();

    media.addEventListener('timeupdate', handleTimeUpdate);
    media.addEventListener('loadedmetadata', handleLoadedMetadata);
    media.addEventListener('durationchange', handleLoadedMetadata);
    media.addEventListener('play', handlePlay);
    media.addEventListener('pause', handlePause);
    media.addEventListener('ended', handleEnded);

    return () => {
      media.removeEventListener('timeupdate', handleTimeUpdate);
      media.removeEventListener('loadedmetadata', handleLoadedMetadata);
      media.removeEventListener('durationchange', handleLoadedMetadata);
      media.removeEventListener('play', handlePlay);
      media.removeEventListener('pause', handlePause);
      media.removeEventListener('ended', handleEnded);
    };
  }, [task.id, isCompactLayout, isVideo]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const seekTo = params.get('seekTo');
    if (!seekTo) return;

    const seconds = Number(seekTo);
    if (!Number.isFinite(seconds)) return;

    const media = mediaRef.current;
    if (media) {
      const doSeek = () => {
        media.currentTime = Math.max(seconds, 0);
        setMediaCurrentTime(seconds);
        void media.play().catch(() => {});
      };

      if (media.readyState >= 1) {
        doSeek();
      } else {
        media.addEventListener('loadedmetadata', doSeek, { once: true });
      }
    }

    window.history.replaceState({}, '', window.location.pathname);
  }, [task.id]);

  useEffect(() => {
    if (!isCompactLayout) {
      setIsMiniPlayer(false);
      return;
    }

    if (activePanel !== 'summary') {
      setIsMiniPlayer(false);
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      const scrollTop = contentScrollRef.current?.scrollTop ?? 0;
      setIsMiniPlayer(scrollTop > 72);
    });

    return () => window.cancelAnimationFrame(frame);
  }, [activePanel, isCompactLayout]);

  const isSummaryGenerating = isTaskSummaryGenerating(task);

  const handleGenerateSummary = async () => {
    setIsGeneratingSummary(true);
    try {
      const res = await apiFetch(`/api/tasks/${task.id}/summary`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instructions: summaryInstructions,
          summaryPromptId:
            summaryPromptSelection !== 'default' && summaryPromptSelection !== 'none'
              ? summaryPromptSelection
              : null,
          skipConfiguredPrompt: summaryPromptSelection === 'none',
        }),
      });

      const payload = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(payload?.error || 'Failed to generate summary.');
      }

      // Backend returns immediately — switch to summary panel and let polling pick up the result
      setActivePanel('summary');
      await onUpdateTask();
    } catch (error: any) {
      console.error('Failed to generate summary:', error);
      alert(error.message || 'Failed to generate summary.');
    } finally {
      setIsGeneratingSummary(false);
    }
  };

  const handleSendMessage = async (directMessage?: string) => {
    const message = (directMessage || messageInput).trim();
    if (!message) {
      return;
    }

    const now = Date.now();
    const optimisticUserMessage: TaskMessage = {
      id: `pending-user-${now}`,
      taskId: task.id,
      role: 'user',
      content: message,
      createdAt: now,
    };
    const optimisticAssistantMessage: TaskMessage = {
      id: `pending-assistant-${now}`,
      taskId: task.id,
      role: 'assistant',
      content: '',
      createdAt: now + 1,
      pending: true,
    };

    setMessages((prev) => [...prev, optimisticUserMessage, optimisticAssistantMessage]);
    setMessageInput('');
    if (!isCompactLayout) {
      setIsChatSidebarOpen(true);
    }
    setIsSendingMessage(true);
    try {
      const res = await apiFetch(`/api/tasks/${task.id}/chat/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message }),
      });

      if (!res.ok) {
        const payload = await res.json().catch(() => null);
        throw new Error(payload?.error || 'Failed to send message.');
      }

      let completed = false;

      await consumeSseStream(res, {
        onDelta: (payload) => {
          const delta = typeof payload?.text === 'string' ? payload.text : '';
          if (!delta) {
            return;
          }

          setMessages((prev) =>
            prev.map((item) =>
              item.id === optimisticAssistantMessage.id
                ? {
                    ...item,
                    content: `${item.content}${delta}`,
                  }
                : item,
            ),
          );
        },
        onDone: (payload) => {
          completed = true;
          if (Array.isArray(payload?.messages)) {
            setMessages(payload.messages as TaskMessage[]);
            return;
          }

          setMessages((prev) =>
            prev.map((item) =>
              item.id === optimisticAssistantMessage.id
                ? {
                    ...item,
                    pending: false,
                  }
                : item,
            ),
          );
        },
        onError: (payload) => {
          throw new Error(
            typeof payload?.error === 'string' ? payload.error : 'Failed to send message.',
          );
        },
      });

      if (!completed) {
        setMessages((prev) =>
          prev.map((item) =>
            item.id === optimisticAssistantMessage.id
              ? {
                  ...item,
                  pending: false,
                }
              : item,
          ),
        );
      }
    } catch (error: any) {
      setMessages((prev) =>
        prev.map((item) =>
          item.id === optimisticAssistantMessage.id
            ? {
                ...item,
                pending: false,
                error: true,
                content: error?.message || 'Failed to send message.',
              }
            : item,
        ),
      );
      console.error('Failed to chat with transcript:', error);
    } finally {
      setIsSendingMessage(false);
    }
  };

  const handleCopyTranscript = async () => {
    const content = buildTranscriptClipboardText(task).trim();
    if (!content) {
      return;
    }

    try {
      await navigator.clipboard.writeText(content);
      setTranscriptCopied(true);
      window.setTimeout(() => setTranscriptCopied(false), 1800);
    } catch (error) {
      console.error('Failed to copy transcript:', error);
      alert('Failed to copy transcript.');
    }
  };

  const resolveActiveSegmentId = (currentTime: number) => {
    if (currentTime < 0) {
      setActiveSegmentId(null);
      return;
    }

    const matchedSegment = task.segments.find(
      (segment) => currentTime >= segment.start && currentTime < segment.end,
    );
    setActiveSegmentId(matchedSegment?.id || null);
  };

  const handleSeekToSegment = async (segmentId: string, startTime: number) => {
    const media = mediaRef.current;
    if (!media) {
      return;
    }

    media.currentTime = Math.max(startTime, 0);
    setActiveSegmentId(segmentId);

    try {
      await media.play();
    } catch (error) {
      console.error('Failed to play selected segment:', error);
    }
  };

  const handleDeleteTask = async () => {
    if (!confirm('Are you sure you want to delete this task?')) {
      return;
    }

    try {
      const res = await apiFetch(`/api/tasks/${task.id}`, { method: 'DELETE' });
      if (!res.ok) {
        throw new Error('Failed to delete task.');
      }

      await onUpdateTask();
    } catch (error) {
      console.error('Failed to delete task:', error);
      alert('Failed to delete task.');
    }
  };

  const handleTogglePlayback = async () => {
    const media = mediaRef.current;
    if (!media) {
      return;
    }

    if (media.paused) {
      try {
        await media.play();
      } catch (error) {
        console.error('Failed to start playback:', error);
      }
      return;
    }

    media.pause();
  };

  const handleSeekBy = (deltaSeconds: number) => {
    const media = mediaRef.current;
    if (!media) {
      return;
    }

    const duration = Number.isFinite(media.duration) ? media.duration : mediaCurrentTime + deltaSeconds;
    const nextTime = Math.max(0, Math.min(media.currentTime + deltaSeconds, Math.max(duration, 0)));
    media.currentTime = nextTime;
    setMediaCurrentTime(nextTime);
  };

  const handleJumpToTranscript = () => {
    setActivePanel('transcript');

    window.requestAnimationFrame(() => {
      if (activeSegmentId) {
        const activeElement = segmentRefs.current.get(activeSegmentId);
        activeElement?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }

      contentScrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
    });
  };

  const handlePanelScroll = (event: React.UIEvent<HTMLDivElement>) => {
    const scrollTop = event.currentTarget.scrollTop;
    if (isCompactLayout) {
      setIsMiniPlayer(activePanel === 'summary' && scrollTop > 72);
      setShowScrollTop(scrollTop > 300);
    }
  };

  const renderPanelTabs = () => (
    <div
      className={cn(
        'border-b border-slate-200 bg-white flex items-center gap-2 shrink-0 overflow-x-auto custom-scrollbar',
        isCompactLayout ? 'px-3 py-2' : 'px-6 py-3',
      )}
    >
      <PanelButton
        active={activePanel === 'summary'}
        onClick={() => setActivePanel('summary')}
        icon={<Sparkles className="w-4 h-4" />}
      >
        Summary
      </PanelButton>
      <PanelButton
        active={activePanel === 'transcript'}
        onClick={() => setActivePanel('transcript')}
        icon={<Waves className="w-4 h-4" />}
      >
        Transcript
      </PanelButton>
      {isCompactLayout ? (
        <div className="ml-auto flex items-center gap-2 shrink-0">
          <button
            onClick={() => setIsEditModalOpen(true)}
            className="px-3 py-2 rounded-xl text-sm font-medium flex items-center gap-2 border border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100"
          >
            <Edit2 className="w-4 h-4" />
            Edit
          </button>
          <button
            onClick={() => void handleDeleteTask()}
            className="px-3 py-2 rounded-xl text-sm font-medium flex items-center gap-2 border border-slate-200 bg-slate-50 text-red-600 hover:bg-red-50"
          >
            <Trash2 className="w-4 h-4" />
            Delete
          </button>
        </div>
      ) : null}
      {(task.status === 'completed' || task.status === 'failed') && (
        <button
          onClick={() => setIsReprocessOpen(true)}
          className={cn(
            'px-3 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-800 bg-slate-100 rounded-lg flex items-center gap-1 shrink-0',
            isCompactLayout ? '' : 'ml-auto',
          )}
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Reprocess
        </button>
      )}
      {!isCompactLayout && task.status === 'completed' && (
        <button
          type="button"
          onClick={() => setIsChatSidebarOpen((v) => !v)}
          className={cn(
            'px-3 py-1.5 text-xs font-medium rounded-lg flex items-center gap-1 shrink-0 transition-colors',
            isChatSidebarOpen
              ? 'bg-indigo-100 text-indigo-700 hover:bg-indigo-200'
              : 'bg-slate-100 text-slate-600 hover:text-slate-800',
            isCompactLayout ? '' : task.status !== 'completed' && task.status !== 'failed' ? 'ml-auto' : '',
          )}
        >
          <MessageSquare className="w-3.5 h-3.5" />
          Chat
        </button>
      )}
    </div>
  );

  const renderPanelContent = () => {
    if (task.status === 'processing' || task.status === 'pending') {
      return (
        <div className="flex h-full flex-col items-center justify-center text-slate-500 space-y-4 p-6">
          <Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
          <p>Analyzing audio... This may take a few moments.</p>
        </div>
      );
    }

    if (task.status === 'blocked') {
      return (
        <div className="flex h-full flex-col items-center justify-center text-slate-500 space-y-4 p-6">
          <Loader2 className="w-8 h-8 animate-spin text-violet-600" />
          <div className="max-w-md space-y-2 text-center">
            <p className="font-medium text-slate-700">Waiting for the parsing service to recover.</p>
            <p className="text-sm text-slate-500 whitespace-pre-wrap">
              {task.result || 'The worker will automatically retry this task when the provider is healthy again.'}
            </p>
          </div>
        </div>
      );
    }

    if (task.status === 'failed') {
      return (
        <div
          ref={contentScrollRef}
          onScroll={handlePanelScroll}
          className={cn(
            'h-full overflow-y-auto custom-scrollbar',
            isCompactLayout ? 'px-4 py-4 pb-28' : 'p-6 pb-6',
          )}
        >
          <div className="p-4 bg-red-50 text-red-700 rounded-xl border border-red-100">
            <h3 className="font-semibold mb-1">Analysis Failed</h3>
            <p className="text-sm whitespace-pre-wrap">{task.result}</p>
          </div>
        </div>
      );
    }

    if (activePanel === 'summary') {
      return (
        <>
          <SummaryPanel
            task={task}
            summaryInstructions={summaryInstructions}
            onSummaryInstructionsChange={setSummaryInstructions}
            summaryPromptSelection={summaryPromptSelection}
            onSummaryPromptSelectionChange={setSummaryPromptSelection}
            isGenerating={isGeneratingSummary || isSummaryGenerating}
            onGenerate={() => void handleGenerateSummary()}
            onCancelSummary={async () => {
              await apiFetch(`/api/tasks/${task.id}/summary/cancel`, { method: 'POST' });
              await onUpdateTask();
            }}
            compact={isCompactLayout}
            scrollContainerRef={contentScrollRef}
            onScroll={handlePanelScroll}
          />
          {!isCompactLayout && (
            <div className="px-6 pb-6">
              <RelatedRecordings
                taskId={task.id}
                onNavigate={(id) => {
                  window.location.href = `/notebook/${id}`;
                }}
              />
            </div>
          )}
        </>
      );
    }

    if (activePanel === 'transcript') {
      return (
        <TranscriptPanel
          task={task}
          transcriptCopied={transcriptCopied}
          onCopyTranscript={() => void handleCopyTranscript()}
          activeSegmentId={activeSegmentId}
          onSeekToSegment={(segmentId, startTime) => void handleSeekToSegment(segmentId, startTime)}
          segmentRefs={segmentRefs}
          compact={isCompactLayout}
          scrollContainerRef={contentScrollRef}
          onScroll={handlePanelScroll}
        />
      );
    }

    return null;
  };

  const renderMobileDetailBar = () => {
    if (!isCompactLayout) {
      return null;
    }

    return (
      <>
        <div className="lg:hidden fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 px-3 pt-2 shadow-[0_-10px_30px_rgba(15,23,42,0.08)] backdrop-blur-sm pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
          <div className="mx-auto flex max-w-xl items-end justify-between gap-1">
            <MobileControlButton
              icon={<Menu className="w-4 h-4" />}
              label="More"
              onClick={() => setIsActionSheetOpen(true)}
            />
            <MobileControlButton
              icon={<RotateCcw className="w-4 h-4" />}
              label="-3 sec"
              onClick={() => handleSeekBy(-3)}
            />

            <button
              type="button"
              onClick={() => void handleTogglePlayback()}
              className="flex min-w-0 flex-col items-center gap-1 px-2 text-slate-800"
            >
              <span className="flex h-16 w-16 items-center justify-center rounded-full bg-slate-800 text-white shadow-[0_12px_24px_rgba(15,23,42,0.18)] transition-transform active:scale-95">
                {isMediaPlaying ? <Pause className="w-6 h-6" /> : <Play className="w-6 h-6 ml-0.5" />}
              </span>
              <span className="text-[11px] font-semibold">
                {formatTime(mediaCurrentTime)}
                {mediaDuration > 0 ? ` / ${formatTime(mediaDuration)}` : ''}
              </span>
            </button>

            <MobileControlButton
              icon={<RotateCw className="w-4 h-4" />}
              label="+3 sec"
              onClick={() => handleSeekBy(3)}
            />
            <MobileControlButton
              icon={<List className="w-4 h-4" />}
              label="Transcript"
              onClick={handleJumpToTranscript}
            />
          </div>
        </div>

        {isActionSheetOpen ? (
          <div
            className="lg:hidden fixed inset-0 z-50 bg-slate-900/45 backdrop-blur-sm"
            onClick={() => setIsActionSheetOpen(false)}
          >
            <div
              className="absolute inset-x-0 bottom-0 rounded-t-[2rem] bg-white shadow-2xl"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
                <div>
                  <p className="text-base font-semibold text-slate-900">Detail actions</p>
                  <p className="text-xs text-slate-500">Switch panels or run task actions.</p>
                </div>
                <button
                  type="button"
                  onClick={() => setIsActionSheetOpen(false)}
                  className="rounded-full bg-slate-100 p-2 text-slate-500"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="grid grid-cols-2 gap-3 p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))]">
                <button
                  type="button"
                  onClick={() => {
                    setActivePanel('summary');
                    setIsActionSheetOpen(false);
                  }}
                  className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-left"
                >
                  <Sparkles className="w-4 h-4 text-indigo-600" />
                  <p className="mt-2 text-sm font-semibold text-slate-900">Summary</p>
                  <p className="mt-1 text-xs text-slate-500">Open the generated notes.</p>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setIsChatOverlayOpen(true);
                    setIsActionSheetOpen(false);
                  }}
                  className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-left"
                >
                  <MessageSquare className="w-4 h-4 text-sky-600" />
                  <p className="mt-2 text-sm font-semibold text-slate-900">Chat</p>
                  <p className="mt-1 text-xs text-slate-500">Ask follow-up questions.</p>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    void handleCopyTranscript();
                    setIsActionSheetOpen(false);
                  }}
                  className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-left"
                >
                  <Copy className="w-4 h-4 text-emerald-600" />
                  <p className="mt-2 text-sm font-semibold text-slate-900">Copy</p>
                  <p className="mt-1 text-xs text-slate-500">Copy the full transcript.</p>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setIsEditModalOpen(true);
                    setIsActionSheetOpen(false);
                  }}
                  className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-left"
                >
                  <Edit2 className="w-4 h-4 text-slate-700" />
                  <p className="mt-2 text-sm font-semibold text-slate-900">Edit</p>
                  <p className="mt-1 text-xs text-slate-500">Rename or adjust metadata.</p>
                </button>

                {(task.status === 'completed' || task.status === 'failed') ? (
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-left space-y-2">
                    <RefreshCw className="w-4 h-4 text-amber-600" />
                    <p className="text-sm font-semibold text-slate-900">Reprocess</p>
                    <select
                      value={reprocessLanguage}
                      onChange={(e) => setReprocessLanguage(e.target.value)}
                      className="w-full px-2 py-1.5 text-xs border border-slate-200 rounded-lg bg-white focus:outline-none"
                    >
                      {LANGUAGE_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={async () => {
                        await apiFetch(`/api/tasks/${task.id}/reprocess`, {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ language: reprocessLanguage }),
                        });
                        await onUpdateTask();
                        setIsActionSheetOpen(false);
                      }}
                      className="w-full px-3 py-1.5 text-xs font-medium text-white bg-indigo-600 rounded-lg"
                    >
                      Start
                    </button>
                  </div>
                ) : (
                  <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-3 text-left">
                    <Waves className="w-4 h-4 text-slate-400" />
                    <p className="mt-2 text-sm font-semibold text-slate-700">Transcript</p>
                    <p className="mt-1 text-xs text-slate-500">Current panel: {activePanel}</p>
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => {
                    void handleDeleteTask();
                    setIsActionSheetOpen(false);
                  }}
                  className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-left"
                >
                  <Trash2 className="w-4 h-4 text-red-600" />
                  <p className="mt-2 text-sm font-semibold text-red-700">Delete</p>
                  <p className="mt-1 text-xs text-red-500">Remove this task permanently.</p>
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </>
    );
  };

  const isDesktopVideo = !isCompactLayout && isVideo;

  return (
    <div className="flex h-full min-h-0 overflow-hidden">
      <div className={cn('flex flex-1 min-w-0 overflow-hidden', isDesktopVideo ? 'flex-row' : 'flex-col')}>
        {/* Left column for desktop video: header + metadata, scrollable */}
        {isDesktopVideo ? (
          <>
            <div className="flex w-[45%] shrink-0 flex-col overflow-y-auto custom-scrollbar border-r border-slate-200">
              <TaskHeader
                task={task}
                mediaRef={mediaRef}
                onUpdateTask={onUpdateTask}
                onTimeUpdate={resolveActiveSegmentId}
                onDeleteTask={() => void handleDeleteTask()}
                variant="default"
                mobilePresentation="full"
                mobileAudioControls="native"
              />
            </div>
            <div className="flex flex-1 min-w-0 flex-col overflow-hidden">
              {renderPanelTabs()}
              <div className="flex-1 min-h-0 bg-white overflow-hidden">{renderPanelContent()}</div>
            </div>
          </>
        ) : (
          <>
            <TaskHeader
              task={task}
              mediaRef={mediaRef}
              onUpdateTask={onUpdateTask}
              onTimeUpdate={resolveActiveSegmentId}
              onDeleteTask={() => void handleDeleteTask()}
              variant={isCompactLayout ? 'mobile-player' : 'default'}
              mobilePresentation="full"
              mobileAudioControls="native"
              hidden={isCompactLayout && isMiniPlayer}
            />

            {renderPanelTabs()}

            <div className="flex-1 min-h-0 bg-white overflow-hidden">{renderPanelContent()}</div>
          </>
        )}

        {renderMobileDetailBar()}

        {isCompactLayout && showScrollTop && (
          <button
            type="button"
            onClick={() => contentScrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })}
            className="fixed z-30 left-4 bottom-[calc(var(--mobile-bottom-nav-height)+env(safe-area-inset-bottom)+1.5rem)] flex h-9 w-9 items-center justify-center rounded-full bg-white border border-slate-200 text-slate-500 shadow-lg active:scale-95 transition-transform"
            aria-label="Back to top"
          >
            <ArrowUp className="w-4 h-4" />
          </button>
        )}
      </div>

      {!isCompactLayout && isChatSidebarOpen && (
        <div className="flex w-[380px] shrink-0 flex-col border-l border-slate-200 bg-white">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2.5">
            <div className="flex items-center gap-2">
              <MessageSquare className="w-3.5 h-3.5 text-indigo-600" />
              <span className="text-sm font-semibold text-slate-900">Chat</span>
            </div>
            <button
              type="button"
              onClick={() => setIsChatSidebarOpen(false)}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
              aria-label="Close chat sidebar"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="flex-1 min-h-0">
            <ChatPanel
              task={task}
              messages={messages}
              messageInput={messageInput}
              onMessageInputChange={setMessageInput}
              isSendingMessage={isSendingMessage}
              onSendMessage={(msg) => void handleSendMessage(msg)}
            />
          </div>
        </div>
      )}

      {isEditModalOpen ? (
        <TaskEditModal
          task={task}
          onClose={() => setIsEditModalOpen(false)}
          onSaved={async () => {
            await onUpdateTask();
          }}
        />
      ) : null}

      {isCompactLayout && !isChatOverlayOpen && task.status === 'completed' && (
        <button
          ref={chatFabRef}
          type="button"
          onTouchStart={handleFabTouchStart}
          onTouchMove={handleFabTouchMove}
          onTouchEnd={handleFabTouchEnd}
          onClick={() => {
            if (!chatFabDrag.current.moved) setIsChatOverlayOpen(true);
          }}
          style={chatFabPos ? { right: chatFabPos.right, bottom: chatFabPos.bottom } : undefined}
          className={cn(
            'fixed z-40 flex h-12 w-12 items-center justify-center rounded-full bg-indigo-600 text-white shadow-[0_8px_24px_rgba(79,70,229,0.35)] touch-none',
            !chatFabPos && 'right-4 bottom-[calc(var(--mobile-bottom-nav-height)+env(safe-area-inset-bottom)+1.5rem)]',
          )}
          aria-label="Open chat"
        >
          <MessageSquare className="w-5 h-5" />
        </button>
      )}

      {isCompactLayout && isChatOverlayOpen && (
        <div className="fixed inset-0 z-50 flex flex-col bg-white">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-indigo-600" />
              <span className="text-base font-semibold text-slate-900">AI Chat</span>
            </div>
            <button
              type="button"
              onClick={() => setIsChatOverlayOpen(false)}
              className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-500"
              aria-label="Close chat"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="flex-1 min-h-0">
            <ChatPanel
              task={task}
              messages={messages}
              messageInput={messageInput}
              onMessageInputChange={setMessageInput}
              isSendingMessage={isSendingMessage}
              onSendMessage={(msg) => void handleSendMessage(msg)}
              compact
              overlay
            />
          </div>
        </div>
      )}

      {isReprocessOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/30 backdrop-blur-sm" onClick={() => setIsReprocessOpen(false)}>
          <div className="w-72 rounded-2xl border border-slate-200 bg-white p-5 shadow-xl space-y-4" onClick={(e) => e.stopPropagation()}>
            <div>
              <h3 className="text-sm font-semibold text-slate-900">Reprocess Recording</h3>
              <p className="text-xs text-slate-500 mt-1">Choose a language and re-run transcription.</p>
            </div>
            <label className="block">
              <span className="text-xs font-medium text-slate-600">Language</span>
              <select
                value={reprocessLanguage}
                onChange={(e) => setReprocessLanguage(e.target.value)}
                className="w-full mt-1 px-3 py-2 text-sm border border-slate-200 rounded-xl bg-slate-50 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                {LANGUAGE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setIsReprocessOpen(false)}
                className="flex-1 px-3 py-2 text-xs font-medium text-slate-600 bg-slate-100 rounded-xl hover:bg-slate-200 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={async () => {
                  setIsReprocessOpen(false);
                  await apiFetch(`/api/tasks/${task.id}/reprocess`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ language: reprocessLanguage }),
                  });
                  await onUpdateTask();
                }}
                className="flex-1 px-3 py-2 text-xs font-medium text-white bg-indigo-600 rounded-xl hover:bg-indigo-700 transition-colors"
              >
                Reprocess
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
