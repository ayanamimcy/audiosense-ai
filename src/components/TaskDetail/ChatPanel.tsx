import React from 'react';
import { Loader2 } from 'lucide-react';
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
  scrollContainerRef,
  onScroll,
}: {
  messages: TaskMessage[];
  messageInput: string;
  onMessageInputChange: (value: string) => void;
  isSendingMessage: boolean;
  onSendMessage: () => void;
  compact?: boolean;
  scrollContainerRef?: React.RefObject<HTMLDivElement | null>;
  onScroll?: (event: React.UIEvent<HTMLDivElement>) => void;
}) {
  const { capabilities } = useAppDataContext();
  return (
    <div className={cn('flex flex-col h-full min-h-0', compact ? 'px-4 py-4 pb-28' : 'p-6 pb-6')}>
      <div
        ref={scrollContainerRef}
        onScroll={onScroll}
        className="flex-1 space-y-3 overflow-y-auto custom-scrollbar pr-1"
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
              {message.pending ? (
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
            </div>
          ))
        )}
      </div>

      <div className="mt-4 border-t border-slate-200 pt-4">
        <div className="flex gap-3">
          <textarea
            value={messageInput}
            onChange={(event) => onMessageInputChange(event.target.value)}
            placeholder={capabilities?.llm.configured ? 'Ask about this transcript...' : 'Configure LLM API first to enable chat.'}
            disabled={!capabilities?.llm.configured || isSendingMessage}
            className="flex-1 min-h-24 px-4 py-3 rounded-2xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-slate-50"
          />
          <button
            onClick={onSendMessage}
            disabled={!capabilities?.llm.configured || isSendingMessage || !messageInput.trim()}
            className="self-end px-4 py-3 rounded-2xl bg-indigo-600 text-white font-medium hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSendingMessage ? 'Sending...' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  );
}
