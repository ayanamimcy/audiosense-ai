import React, { useEffect, useRef, useState } from 'react';
import { Loader2, MessageSquare, RefreshCw, Sparkles, Waves } from 'lucide-react';
import { formatTime } from '../../lib/utils';
import { consumeSseStream } from '../../hooks/useSseStream';
import { apiFetch } from '../../api';
import { TaskHeader } from './TaskHeader';
import { PanelButton } from './PanelButton';
import { SummaryPanel } from './SummaryPanel';
import { TranscriptPanel } from './TranscriptPanel';
import { ChatPanel } from './ChatPanel';
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
  const [transcriptCopied, setTranscriptCopied] = useState(false);
  const [activeSegmentId, setActiveSegmentId] = useState<string | null>(null);
  const mediaRef = useRef<HTMLMediaElement | null>(null);
  const segmentRefs = useRef(new Map<string, HTMLDivElement>());

  useEffect(() => {
    setSummaryInstructions('');
    setSummaryPromptSelection('default');
    setActivePanel(task.summary ? 'summary' : 'transcript');
    setActiveSegmentId(null);
  }, [task.id]);

  useEffect(() => {
    if (activePanel !== 'transcript' || !activeSegmentId) {
      return;
    }

    const element = segmentRefs.current.get(activeSegmentId);
    element?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [activePanel, activeSegmentId]);

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

  return (
    <div className="flex flex-col h-full">
      <TaskHeader
        task={task}
        mediaRef={mediaRef}
        onUpdateTask={onUpdateTask}
        onTimeUpdate={resolveActiveSegmentId}
      />

      <div className="border-b border-slate-200 bg-white px-6 py-3 flex items-center gap-2 shrink-0 overflow-x-auto">
        <PanelButton active={activePanel === 'summary'} onClick={() => setActivePanel('summary')} icon={<Sparkles className="w-4 h-4" />}>
          Summary
        </PanelButton>
        <PanelButton active={activePanel === 'transcript'} onClick={() => setActivePanel('transcript')} icon={<Waves className="w-4 h-4" />}>
          Transcript
        </PanelButton>
        <PanelButton active={activePanel === 'chat'} onClick={() => setActivePanel('chat')} icon={<MessageSquare className="w-4 h-4" />}>
          Chat
        </PanelButton>
        {(task.status === 'completed' || task.status === 'failed') && (
          <button
            onClick={async () => {
              await apiFetch(`/api/tasks/${task.id}/reprocess`, { method: 'POST' });
              await onUpdateTask();
            }}
            className="ml-auto px-3 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-800 bg-slate-100 rounded-lg flex items-center gap-1"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Reprocess
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-6 pb-6 bg-white custom-scrollbar">
        {task.status === 'processing' || task.status === 'pending' ? (
          <div className="flex flex-col items-center justify-center h-full text-slate-500 space-y-4">
            <Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
            <p>Analyzing audio... This may take a few moments.</p>
          </div>
        ) : task.status === 'failed' ? (
          <div className="p-4 bg-red-50 text-red-700 rounded-xl border border-red-100">
            <h3 className="font-semibold mb-1">Analysis Failed</h3>
            <p className="text-sm whitespace-pre-wrap">{task.result}</p>
          </div>
        ) : (
          <>
            {activePanel === 'summary' && (
              <SummaryPanel
                task={task}
                summaryInstructions={summaryInstructions}
                onSummaryInstructionsChange={setSummaryInstructions}
                summaryPromptSelection={summaryPromptSelection}
                onSummaryPromptSelectionChange={setSummaryPromptSelection}
                isGenerating={isGeneratingSummary}
                onGenerate={() => void handleGenerateSummary()}
              />
            )}

            {activePanel === 'transcript' && (
              <TranscriptPanel
                task={task}
                transcriptCopied={transcriptCopied}
                onCopyTranscript={() => void handleCopyTranscript()}
                activeSegmentId={activeSegmentId}
                onSeekToSegment={(segmentId, startTime) => void handleSeekToSegment(segmentId, startTime)}
                segmentRefs={segmentRefs}
              />
            )}

            {activePanel === 'chat' && (
              <ChatPanel
                messages={messages}
                messageInput={messageInput}
                onMessageInputChange={setMessageInput}
                isSendingMessage={isSendingMessage}
                onSendMessage={() => void handleSendMessage()}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}
