import React from 'react';
import { Check, Copy, Loader2, SendHorizontal } from 'lucide-react';
import { cn } from '../../lib/utils';
import { MarkdownContent } from '../MarkdownContent';
import { useAppDataContext } from '../../contexts/AppDataContext';
import type { TaskMessage } from '../../types';

export function ChatPanel({
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
  messages: TaskMessage[];
  messageInput: string;
  onMessageInputChange: (value: string) => void;
  isSendingMessage: boolean;
  onSendMessage: () => void;
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
  const canSendMessage = isChatEnabled && !isSendingMessage && messageInput.trim().length > 0;
  const resolvedScrollRef = scrollContainerRef || internalScrollRef;
  const isNearBottomRef = React.useRef(true);
  const [copiedId, setCopiedId] = React.useState<string | null>(null);

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
              placeholder={isChatEnabled ? 'Ask about this transcript...' : 'Configure LLM API first to enable chat.'}
              disabled={!isChatEnabled || isSendingMessage}
              className="min-h-[44px] flex-1 resize-none border-0 bg-transparent px-0 py-[10px] text-[16px] leading-6 text-slate-900 focus:outline-none disabled:text-slate-400"
            />
            <button
              type="button"
              onClick={onSendMessage}
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
            placeholder={isChatEnabled ? 'Ask about this transcript...' : 'Configure LLM API first to enable chat.'}
            disabled={!isChatEnabled || isSendingMessage}
            className="flex-1 min-h-24 px-4 py-3 rounded-2xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-slate-50"
          />
          <button
            onClick={onSendMessage}
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
          <div className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-slate-500">
            还没有对话。你可以直接问"这段录音的结论是什么？"或"列出所有 action items"。
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
