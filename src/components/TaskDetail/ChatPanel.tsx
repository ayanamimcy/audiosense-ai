import React from 'react';
import { Check, Copy, Loader2, MessageSquare, SendHorizontal } from 'lucide-react';
import { cn } from '../../lib/utils';
import { MarkdownContent } from '../MarkdownContent';
import { useAppDataContext } from '../../contexts/AppDataContext';
import type { Task, TaskMessage } from '../../types';

function buildSuggestedQuestions(task?: Task | null): string[] {
  if (!task || !task.transcript) return [];

  const questions: string[] = [];
  const hasSummary = Boolean(task.summary && task.summary !== '__generating__');
  const hasSpeakers = (task.speakerCount ?? 0) > 1;

  if (hasSummary) {
    questions.push('What are the key decisions made in this recording?');
    questions.push('List all action items mentioned.');
    if (hasSpeakers) {
      questions.push('What were the main points of disagreement?');
    }
  } else {
    questions.push('Summarize the key points of this recording.');
    questions.push('What topics were discussed?');
  }

  if (hasSpeakers && questions.length < 3) {
    questions.push(`What did each speaker focus on?`);
  }

  if (!hasSummary && questions.length < 3) {
    questions.push('Are there any important details I should pay attention to?');
  }

  return questions.slice(0, 3);
}

export function ChatPanel({
  task,
  messages,
  messageInput,
  onMessageInputChange,
  isSendingMessage,
  onSendMessage,
  compact = false,
  overlay = false,
  scrollContainerRef,
  onScroll,
}: {
  task?: Task | null;
  messages: TaskMessage[];
  messageInput: string;
  onMessageInputChange: (value: string) => void;
  isSendingMessage: boolean;
  onSendMessage: (message?: string) => void;
  compact?: boolean;
  overlay?: boolean;
  scrollContainerRef?: React.RefObject<HTMLDivElement | null>;
  onScroll?: (event: React.UIEvent<HTMLDivElement>) => void;
}) {
  const { capabilities } = useAppDataContext();
  const compactTextareaRef = React.useRef<HTMLTextAreaElement | null>(null);
  const internalScrollRef = React.useRef<HTMLDivElement | null>(null);
  const messagesEndRef = React.useRef<HTMLDivElement | null>(null);
  const isChatEnabled = Boolean(capabilities?.llm.configured);
  const suggestedQuestions = React.useMemo(() => buildSuggestedQuestions(task), [task]);
  const canSendMessage = isChatEnabled && !isSendingMessage && messageInput.trim().length > 0;
  const resolvedScrollRef = scrollContainerRef || internalScrollRef;
  const isNearBottomRef = React.useRef(true);
  const [copiedId, setCopiedId] = React.useState<string | null>(null);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && canSendMessage) {
      e.preventDefault();
      onSendMessage();
    }
  };

  const handleScrollCapture = React.useCallback(() => {
    const el = resolvedScrollRef.current;
    if (!el) return;
    isNearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }, [resolvedScrollRef]);

  React.useEffect(() => {
    if (isNearBottomRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  const handleCopyMessage = (message: TaskMessage) => {
    void navigator.clipboard.writeText(message.content).then(() => {
      setCopiedId(message.id);
      setTimeout(() => setCopiedId(null), 1500);
    });
  };

  React.useLayoutEffect(() => {
    if (!compact) {
      return;
    }

    const textarea = compactTextareaRef.current;
    if (!textarea) {
      return;
    }

    const minHeight = 44;
    const maxHeight = 92;

    textarea.style.height = '0px';
    const nextHeight = Math.min(Math.max(textarea.scrollHeight, minHeight), maxHeight);
    textarea.style.height = `${nextHeight}px`;
    textarea.style.overflowY = textarea.scrollHeight > maxHeight ? 'auto' : 'hidden';
  }, [compact, messageInput]);

  const renderComposer = () => {
    if (compact) {
      return (
        <div className={cn(
          'absolute inset-x-4 z-50',
          overlay
            ? 'bottom-[calc(0.75rem+env(safe-area-inset-bottom))]'
            : 'bottom-[calc(2.35rem+env(safe-area-inset-bottom))]',
        )}>
          <div className="flex items-end gap-2 rounded-[1.5rem] border border-slate-200 bg-white/95 px-3 py-2 shadow-[0_10px_28px_rgba(15,23,42,0.12)] backdrop-blur-sm">
            <textarea
              ref={compactTextareaRef}
              rows={1}
              value={messageInput}
              onChange={(event) => onMessageInputChange(event.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={isChatEnabled ? 'Ask about this transcript...' : 'Configure LLM API first to enable chat.'}
              disabled={!isChatEnabled || isSendingMessage}
              className="min-h-[44px] flex-1 resize-none border-0 bg-transparent px-0 py-[10px] text-[16px] leading-6 text-slate-900 focus:outline-none disabled:text-slate-400"
            />
            <button
              type="button"
              onClick={() => onSendMessage()}
              disabled={!canSendMessage}
              aria-label={isSendingMessage ? 'Sending message' : 'Send message'}
              className={cn(
                'mb-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-colors',
                canSendMessage
                  ? 'bg-indigo-600 text-white shadow-[0_8px_18px_rgba(79,70,229,0.22)] active:bg-indigo-700'
                  : 'bg-slate-100 text-slate-400',
              )}
            >
              {isSendingMessage ? <Loader2 className="h-4 w-4 animate-spin" /> : <SendHorizontal className="h-4 w-4" />}
            </button>
          </div>
        </div>
      );
    }

    return (
      <div className="mt-4 border-t border-slate-200 pt-4">
        <div className="flex gap-3">
          <textarea
            value={messageInput}
            onChange={(event) => onMessageInputChange(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={isChatEnabled ? 'Ask about this transcript...' : 'Configure LLM API first to enable chat.'}
            disabled={!isChatEnabled || isSendingMessage}
            className="flex-1 min-h-24 px-4 py-3 rounded-2xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-slate-50"
          />
          <button
            onClick={() => onSendMessage()}
            disabled={!canSendMessage}
            className="self-end px-4 py-3 rounded-2xl bg-indigo-600 text-white font-medium hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSendingMessage ? 'Sending...' : 'Send'}
          </button>
        </div>
      </div>
    );
  };

  return (
    <div
      className={cn(
        'flex flex-col h-full min-h-0',
        compact
          ? overlay
            ? 'relative px-4 pt-4 pb-[calc(0.5rem+env(safe-area-inset-bottom))]'
            : 'relative px-4 pt-4 pb-[calc(3.35rem+env(safe-area-inset-bottom))]'
          : 'p-6 pb-6',
      )}
    >
      <div
        ref={resolvedScrollRef}
        onScroll={(e) => { handleScrollCapture(); onScroll?.(e); }}
        className={cn(
          'flex-1 space-y-3 overflow-y-auto custom-scrollbar pr-1',
          compact
            ? overlay
              ? 'pb-[calc(5rem+env(safe-area-inset-bottom))]'
              : 'pb-[calc(6.85rem+env(safe-area-inset-bottom))]'
            : '',
        )}
      >
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-6 px-4">
            <div className="text-center">
              <MessageSquare className="w-8 h-8 text-indigo-300 mx-auto mb-3" />
              <p className="text-sm font-medium text-slate-700">Ask anything about this recording</p>
              <p className="text-xs text-slate-400 mt-1">AI will answer based on the transcript content.</p>
            </div>
            {isChatEnabled && suggestedQuestions.length > 0 && (
              <div className="w-full max-w-sm space-y-2">
                <p className="text-xs font-medium text-slate-400 uppercase tracking-wider">Suggestions</p>
                {suggestedQuestions.map((q) => (
                  <button
                    key={q}
                    type="button"
                    disabled={isSendingMessage}
                    onClick={() => onSendMessage(q)}
                    className="w-full text-left rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-700 hover:bg-indigo-50 hover:border-indigo-200 hover:text-indigo-700 transition-colors disabled:opacity-50"
                  >
                    {q}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          messages.map((message) => (
            <div
              key={message.id}
              className={cn(
                'max-w-[90%] rounded-2xl px-4 py-3 border shadow-sm',
                message.role === 'user'
                  ? 'ml-auto bg-slate-900 text-white border-slate-800 shadow-slate-900/10'
                  : 'bg-slate-50 text-slate-800 border-slate-200',
              )}
            >
              <p
                className={cn(
                  'text-xs mb-1 font-medium',
                  message.role === 'user'
                    ? 'text-white/65'
                    : message.error
                      ? 'text-red-500'
                      : 'text-slate-500',
                )}
              >
                {message.role === 'user' ? 'You' : 'Assistant'}
              </p>
              {message.pending && !message.content ? (
                <div className="flex items-center gap-2 text-sm text-slate-500">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Thinking...
                </div>
              ) : (
                <MarkdownContent
                  content={message.content}
                  proseClassName={cn(
                    'prose prose-sm max-w-none prose-p:my-0 prose-headings:my-2 prose-pre:rounded-xl prose-pre:px-4 prose-pre:py-3',
                    message.role === 'user'
                      ? 'prose-invert prose-strong:text-white prose-code:text-white prose-li:text-white/95'
                      : message.error
                        ? 'prose-red max-w-none text-red-600'
                        : 'prose-slate',
                  )}
                  tableVariant={
                    message.role === 'user'
                      ? 'inverse'
                      : message.error
                        ? 'error'
                        : 'default'
                  }
                />
              )}
              {message.role === 'assistant' && message.content && !message.pending && !message.error && (
                <button
                  type="button"
                  onClick={() => handleCopyMessage(message)}
                  className="mt-2 flex items-center gap-1 text-xs text-slate-400 hover:text-slate-600 transition-colors"
                >
                  {copiedId === message.id ? (
                    <><Check className="w-3 h-3" /> Copied</>
                  ) : (
                    <><Copy className="w-3 h-3" /> Copy</>
                  )}
                </button>
              )}
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>
      {renderComposer()}
    </div>
  );
}
