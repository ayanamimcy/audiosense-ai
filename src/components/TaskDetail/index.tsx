import React, { useEffect, useRef, useState } from 'react';
import { Edit2, Loader2, MessageSquare, RefreshCw, Sparkles, Trash2, Waves } from 'lucide-react';
import { cn, formatTime } from '../../lib/utils';
import { consumeSseStream } from '../../hooks/useSseStream';
import { apiFetch } from '../../api';
import { TaskHeader } from './TaskHeader';
import { PanelButton } from './PanelButton';
import { SummaryPanel } from './SummaryPanel';
import { TranscriptPanel } from './TranscriptPanel';
import { ChatPanel } from './ChatPanel';
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
  const mediaRef = useRef<HTMLMediaElement | null>(null);
  const segmentRefs = useRef(new Map<string, HTMLDivElement>());
  const contentScrollRef = useRef<HTMLDivElement | null>(null);
  const isCompactLayout = !isDesktop;

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
    setSummaryInstructions('');
    setSummaryPromptSelection('default');
    setActivePanel(task.summary ? 'summary' : 'transcript');
    setActiveSegmentId(null);
    setIsMiniPlayer(false);
    contentScrollRef.current?.scrollTo({ top: 0, behavior: 'auto' });
  }, [task.id, task.summary]);

  useEffect(() => {
    if (activePanel !== 'transcript' || !activeSegmentId || isCompactLayout) {
      return;
    }

    const element = segmentRefs.current.get(activeSegmentId);
    element?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
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
    if (!isCompactLayout) {
      setIsMiniPlayer(false);
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      const scrollTop = contentScrollRef.current?.scrollTop ?? 0;
      setIsMiniPlayer(scrollTop > 72);
    });

    return () => window.cancelAnimationFrame(frame);
  }, [activePanel, isCompactLayout]);

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

      setActivePanel('summary');
      setSummaryInstructions('');
      await onUpdateTask();
    } catch (error: any) {
      console.error('Failed to generate summary:', error);
      alert(error.message || 'Failed to generate summary.');
    } finally {
      setIsGeneratingSummary(false);
    }
  };

  const handleSendMessage = async () => {
    const message = messageInput.trim();
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
    setActivePanel('chat');
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

  const handlePanelScroll = (event: React.UIEvent<HTMLDivElement>) => {
    if (!isCompactLayout) {
      return;
    }

    setIsMiniPlayer(event.currentTarget.scrollTop > 72);
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
      <PanelButton
        active={activePanel === 'chat'}
        onClick={() => setActivePanel('chat')}
        icon={<MessageSquare className="w-4 h-4" />}
      >
        Chat
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
          onClick={async () => {
            await apiFetch(`/api/tasks/${task.id}/reprocess`, { method: 'POST' });
            await onUpdateTask();
          }}
          className={cn(
            'px-3 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-800 bg-slate-100 rounded-lg flex items-center gap-1 shrink-0',
            isCompactLayout ? '' : 'ml-auto',
          )}
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Reprocess
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
        <SummaryPanel
          task={task}
          summaryInstructions={summaryInstructions}
          onSummaryInstructionsChange={setSummaryInstructions}
          summaryPromptSelection={summaryPromptSelection}
          onSummaryPromptSelectionChange={setSummaryPromptSelection}
          isGenerating={isGeneratingSummary}
          onGenerate={() => void handleGenerateSummary()}
          compact={isCompactLayout}
          scrollContainerRef={contentScrollRef}
          onScroll={handlePanelScroll}
        />
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

    return (
      <ChatPanel
        messages={messages}
        messageInput={messageInput}
        onMessageInputChange={setMessageInput}
        isSendingMessage={isSendingMessage}
        onSendMessage={() => void handleSendMessage()}
        compact={isCompactLayout}
        scrollContainerRef={contentScrollRef}
        onScroll={handlePanelScroll}
      />
    );
  };

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden">
      <TaskHeader
        task={task}
        mediaRef={mediaRef}
        onUpdateTask={onUpdateTask}
        onTimeUpdate={resolveActiveSegmentId}
        onDeleteTask={() => void handleDeleteTask()}
        variant={isCompactLayout ? 'mobile-player' : 'default'}
        mobilePresentation={isCompactLayout && isMiniPlayer ? 'mini' : 'full'}
        onExpandMini={() => setIsMiniPlayer(false)}
      />

      {renderPanelTabs()}

      <div className="flex-1 min-h-0 bg-white overflow-hidden">{renderPanelContent()}</div>

      {isEditModalOpen ? (
        <TaskEditModal
          task={task}
          onClose={() => setIsEditModalOpen(false)}
          onSaved={async () => {
            await onUpdateTask();
          }}
        />
      ) : null}
    </div>
  );
}
