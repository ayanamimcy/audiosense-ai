import React, { useEffect, useRef } from 'react';
import { Check, Clock, Copy, Loader2, MessageSquarePlus } from 'lucide-react';
import { cn } from '@/shared/lib/cn';
import { MarkdownContent } from '@/shared/ui/MarkdownContent';
import type { KnowledgeMessage, MentionCandidate, MentionRef } from '@/entities/knowledge';
import { MentionInput } from './MentionInput';

function formatTimestamp(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

const SUGGESTED_QUESTIONS = [
  'What were the conclusions of the last meeting?',
  'What action items do I have?',
  'Summarize recent discussions.',
];

export function KnowledgeChatPanel({
  messages,
  isStreaming,
  messageInput,
  onMessageInputChange,
  onSend,
  mentions,
  onRemoveMention,
  mentionCandidates,
  isMentionMenuOpen,
  isMentionLoading,
  onMentionTrigger,
  onMentionClose,
  onMentionSelect,
  llmConfigured,
  onSelectTask,
  onOpenHistory,
  onNewConversation,
}: {
  messages: KnowledgeMessage[];
  isStreaming: boolean;
  messageInput: string;
  onMessageInputChange: (value: string) => void;
  onSend: (message?: string) => void;
  mentions: MentionRef[];
  onRemoveMention: (id: string) => void;
  mentionCandidates: MentionCandidate[];
  isMentionMenuOpen: boolean;
  isMentionLoading: boolean;
  onMentionTrigger: (query: string) => void;
  onMentionClose: () => void;
  onMentionSelect: (candidate: MentionCandidate) => void;
  llmConfigured: boolean;
  onSelectTask: (taskId: string, seekTo?: number) => void;
  onOpenHistory: () => void;
  onNewConversation: () => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const isNearBottomRef = useRef(true);
  const [copiedId, setCopiedId] = React.useState<string | null>(null);

  const handleScrollCapture = () => {
    const el = scrollRef.current;
    if (!el) return;
    isNearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  useEffect(() => {
    if (isNearBottomRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  const handleCopy = (msg: KnowledgeMessage) => {
    void navigator.clipboard.writeText(msg.content).then(() => {
      setCopiedId(msg.id);
      setTimeout(() => setCopiedId(null), 1500);
    });
  };

  const handleSend = (message?: string) => {
    if (message) {
      onMessageInputChange(message);
      setTimeout(() => onSend(message), 0);
    } else {
      onSend();
    }
  };

  return (
    <div className="flex h-full flex-col bg-white">
      {/* Mobile only: the desktop column has its own conversation list */}
      <div className="flex items-center justify-between px-4 pt-1 pb-2 lg:hidden">
        <h1 className="text-base font-semibold text-stone-900">Ask AI</h1>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onNewConversation}
            className="flex h-10 w-10 items-center justify-center rounded-lg text-stone-600 hover:bg-stone-100"
            aria-label="New conversation"
          >
            <MessageSquarePlus className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={onOpenHistory}
            className="flex h-10 w-10 items-center justify-center rounded-lg text-stone-600 hover:bg-stone-100"
            aria-label="Conversation history"
          >
            <Clock className="h-5 w-5" />
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto custom-scrollbar" ref={scrollRef} onScroll={handleScrollCapture}>
        <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col px-4 py-6 lg:px-6 lg:py-8">
          {messages.length === 0 ? (
            <div className="my-auto flex flex-col gap-6 py-8">
              <div>
                <p className="text-xl font-semibold text-stone-900">Ask across your recordings</p>
                <p className="mt-1 text-sm text-stone-600">
                  Answers cite the recordings and timestamps they come from. Type @ to focus on a notebook or recording.
                </p>
              </div>
              {llmConfigured ? (
                <div className="flex flex-wrap gap-2">
                  {SUGGESTED_QUESTIONS.map((question) => (
                    <button
                      key={question}
                      type="button"
                      onClick={() => handleSend(question)}
                      className="rounded-full border border-stone-200 bg-white px-3.5 py-2 text-sm text-stone-700 hover:bg-stone-50"
                    >
                      {question}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ) : (
            <div className="flex flex-col gap-6">
              {messages.map((message) => (
                message.role === 'user' ? (
                  <div key={message.id} className="max-w-[85%] self-end rounded-2xl rounded-br-md bg-stone-100 px-3.5 py-2.5">
                    {message.mentions.length > 0 ? (
                      <div className="mb-1.5 flex flex-wrap gap-1">
                        {message.mentions.map((mention) => (
                          <span key={`${mention.type}-${mention.id}`} className="rounded-md bg-white px-1.5 py-0.5 text-[11px] text-stone-700">
                            @{mention.name}
                          </span>
                        ))}
                      </div>
                    ) : null}
                    <p className="whitespace-pre-wrap text-[15px] text-stone-900">{message.content}</p>
                  </div>
                ) : (
                  <div key={message.id}>
                    {message.pending && !message.content ? (
                      <div className="flex items-center gap-2 text-sm text-stone-500">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Searching your recordings…
                      </div>
                    ) : (
                      <MarkdownContent
                        content={message.content}
                        proseClassName={cn(
                          'prose prose-stone max-w-none text-[15px] leading-relaxed prose-p:my-2 prose-headings:my-3',
                          message.error && 'text-red-700',
                        )}
                      />
                    )}

                    {message.content && !message.pending && !message.error ? (
                      <button
                        type="button"
                        onClick={() => handleCopy(message)}
                        className="mt-2 inline-flex items-center gap-1 text-xs text-stone-500 hover:text-stone-800"
                      >
                        {copiedId === message.id ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                        {copiedId === message.id ? 'Copied' : 'Copy'}
                      </button>
                    ) : null}

                    {message.metadata?.sources && message.metadata.sources.length > 0 && !message.pending ? (
                      <div className="mt-3 rounded-xl border border-stone-200 p-3">
                        <p className="mb-2 text-xs font-semibold text-stone-600">
                          Sources
                          {message.metadata.retrieval ? (
                            <span className="ml-2 font-normal text-stone-500">
                              {message.metadata.retrieval.mode} · {message.metadata.retrieval.chunkCount} passages
                            </span>
                          ) : null}
                        </p>
                        <ul className="flex flex-col gap-1">
                          {message.metadata.sources.map((source) => (
                            <li key={source.id} className="flex flex-wrap items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => onSelectTask(source.id)}
                                className="max-w-full truncate rounded-md px-1.5 py-1 text-left text-sm text-stone-900 hover:bg-stone-100"
                              >
                                {source.originalName}
                              </button>
                              {source.citations?.filter((citation) => citation.startTime != null).map((citation, index) => (
                                <button
                                  key={index}
                                  type="button"
                                  onClick={() => onSelectTask(source.id, citation.startTime ?? undefined)}
                                  title={citation.content}
                                  className="rounded-md bg-indigo-50 px-1.5 py-0.5 text-xs text-indigo-800 tabular-nums hover:bg-indigo-100"
                                >
                                  {formatTimestamp(citation.startTime!)}
                                </button>
                              ))}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </div>
                )
              ))}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>
      </div>

      <div className="mx-auto w-full max-w-3xl px-4 pt-2 pb-4 lg:px-6">
        <MentionInput
          value={messageInput}
          onChange={onMessageInputChange}
          onSend={() => handleSend()}
          mentions={mentions}
          onRemoveMention={onRemoveMention}
          mentionCandidates={mentionCandidates}
          isMentionMenuOpen={isMentionMenuOpen}
          isMentionLoading={isMentionLoading}
          onMentionTrigger={onMentionTrigger}
          onMentionClose={onMentionClose}
          onMentionSelect={onMentionSelect}
          disabled={!llmConfigured}
          isSending={isStreaming}
        />
      </div>
    </div>
  );
}
