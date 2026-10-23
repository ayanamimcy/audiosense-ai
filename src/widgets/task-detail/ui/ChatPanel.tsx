import React from 'react';
import { ArrowUp, Check, Copy, Loader2 } from 'lucide-react';
import { cn } from '@/shared/lib/cn';
import { MarkdownContent } from '@/shared/ui/MarkdownContent';
import { useAppDataContext } from '@/app/providers/app-data-context';
import { SUMMARY_GENERATING_SENTINEL, type Task, type TaskMessage } from '@/entities/task';

function buildSuggestedQuestions(task: Task): string[] {
  if (!task.transcript) return [];

  const hasSummary = Boolean(task.summary && task.summary !== SUMMARY_GENERATING_SENTINEL);
  const hasSpeakers = (task.speakerCount ?? 0) > 1;
  const questions = hasSummary
    ? ['What decisions were made?', 'List the action items with owners.']
    : ['Summarize the key points.', 'What topics were discussed?'];
  questions.push(hasSpeakers ? 'What did each speaker focus on?' : 'Anything important I should not miss?');
  return questions;
}

export function ChatPanel({
  task,
  messages,
  messageInput,
  onMessageInputChange,
  isSendingMessage,
  onSendMessage,
}: {
  task: Task;
  messages: TaskMessage[];
  messageInput: string;
  onMessageInputChange: (value: string) => void;
  isSendingMessage: boolean;
  onSendMessage: (message?: string) => void;
}) {
  const { capabilities } = useAppDataContext();
  const textareaRef = React.useRef<HTMLTextAreaElement | null>(null);
  const messagesEndRef = React.useRef<HTMLDivElement | null>(null);
  const [copiedId, setCopiedId] = React.useState<string | null>(null);
  const isChatEnabled = Boolean(capabilities?.llm.configured);
  const suggestedQuestions = React.useMemo(() => buildSuggestedQuestions(task), [task]);
  const canSendMessage = isChatEnabled && !isSendingMessage && messageInput.trim().length > 0;

  React.useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages]);

  React.useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = '0px';
    const nextHeight = Math.min(Math.max(textarea.scrollHeight, 40), 120);
    textarea.style.height = `${nextHeight}px`;
    textarea.style.overflowY = textarea.scrollHeight > 120 ? 'auto' : 'hidden';
  }, [messageInput]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && canSendMessage) {
      event.preventDefault();
      onSendMessage();
    }
  };

  const handleCopyMessage = (message: TaskMessage) => {
    void navigator.clipboard.writeText(message.content).then(() => {
      setCopiedId(message.id);
      window.setTimeout(() => setCopiedId(null), 1500);
    });
  };

  return (
    <div className="flex flex-col gap-5">
      {messages.length === 0 ? (
        <div className="py-2">
          <p className="text-[15px] font-medium text-stone-900">Ask anything about this recording</p>
          <p className="mt-1 text-sm text-stone-600">
            {isChatEnabled ? 'Answers are based on the transcript.' : 'Set up an AI model in Settings to enable chat.'}
          </p>
        </div>
      ) : (
        messages.map((message) => (
          message.role === 'user' ? (
            <div
              key={message.id}
              className="max-w-[85%] self-end whitespace-pre-wrap rounded-2xl rounded-br-md bg-stone-100 px-3.5 py-2.5 text-[15px] text-stone-900"
            >
              {message.content}
            </div>
          ) : (
            <div key={message.id} className="max-w-full">
              {message.pending && !message.content ? (
                <div className="flex items-center gap-2 text-sm text-stone-500">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Thinking…
                </div>
              ) : (
                <MarkdownContent
                  content={message.content}
                  proseClassName={cn(
                    'prose prose-stone max-w-none text-[15px] prose-p:my-1.5 prose-headings:my-2',
                    message.error && 'text-red-700',
                  )}
                  tableVariant={message.error ? 'error' : 'default'}
                />
              )}
              {message.content && !message.pending && !message.error ? (
                <button
                  type="button"
                  onClick={() => handleCopyMessage(message)}
                  className="mt-1.5 inline-flex items-center gap-1 text-xs text-stone-500 hover:text-stone-800"
                >
                  {copiedId === message.id ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                  {copiedId === message.id ? 'Copied' : 'Copy'}
                </button>
              ) : null}
            </div>
          )
        ))
      )}

      {isChatEnabled && messages.length === 0 && suggestedQuestions.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {suggestedQuestions.map((question) => (
            <button
              key={question}
              type="button"
              disabled={isSendingMessage}
              onClick={() => onSendMessage(question)}
              className="rounded-full border border-stone-200 bg-white px-3 py-1.5 text-sm text-stone-700 hover:bg-stone-50 disabled:opacity-50"
            >
              {question}
            </button>
          ))}
        </div>
      ) : null}

      <div className="flex items-end gap-2 rounded-xl border border-stone-300 bg-white py-1.5 pr-1.5 pl-3.5 focus-within:border-stone-400 focus-within:ring-2 focus-within:ring-stone-900/10">
        <label className="sr-only" htmlFor="task-chat-input">Ask about this recording</label>
        <textarea
          id="task-chat-input"
          ref={textareaRef}
          rows={1}
          value={messageInput}
          onChange={(event) => onMessageInputChange(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={isChatEnabled ? 'Ask about this recording…' : 'Chat is unavailable until an AI model is configured.'}
          disabled={!isChatEnabled}
          className="min-h-10 flex-1 resize-none border-0 bg-transparent py-2 text-base leading-6 text-stone-900 placeholder:text-stone-400 focus:outline-none disabled:text-stone-400 sm:text-[15px]"
        />
        <button
          type="button"
          onClick={() => onSendMessage()}
          disabled={!canSendMessage}
          aria-label={isSendingMessage ? 'Sending message' : 'Send message'}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-stone-900 text-white disabled:bg-stone-200 disabled:text-stone-400"
        >
          {isSendingMessage ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
        </button>
      </div>
      <div ref={messagesEndRef} />
    </div>
  );
}
