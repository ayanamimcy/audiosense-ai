import React, { useEffect, useRef } from 'react';
import { Check, Clock, Copy, FileAudio, Loader2, MessageSquarePlus, Sparkles } from 'lucide-react';
import { cn } from '../../lib/utils';
import { MarkdownContent } from '../MarkdownContent';
import { MentionInput } from './MentionInput';
import type { KnowledgeMessage, KnowledgeSourceMeta, MentionCandidate, MentionRef } from '../../types';

function formatTimestamp(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function findCitationTimestamp(sourceIndex: number, sources?: KnowledgeSourceMeta[]): number | null {
  if (!sources) return null;
  const source = sources.find((s) => s.sourceIndex === sourceIndex);
  if (!source?.citations?.length) return null;
  return source.citations[0].startTime;
}

const SUGGESTED_QUESTIONS = [
  { emoji: '\u{1F4A1}', text: 'What were the conclusions of the last meeting?' },
  { emoji: '\u2705', text: 'What action items do I have?' },
  { emoji: '\u{1F4CA}', text: 'Summarize recent discussions.' },
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
    <div className="flex flex-col h-full bg-white rounded-2xl border border-slate-200 shadow-sm">
      {/* Header bar */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100">
        <div className="flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-indigo-500" />
          <h1 className="text-base font-semibold text-slate-900">Knowledge AI</h1>
        </div>
        {/* Mobile only: new + history buttons (sidebar handles this on PC) */}
        <div className="flex items-center gap-1 lg:hidden">
          <button
            type="button"
            onClick={onNewConversation}
            className="p-2 text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
            title="New conversation"
          >
            <MessageSquarePlus className="w-5 h-5" />
          </button>
          <button
            type="button"
            onClick={onOpenHistory}
            className="p-2 text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
            title="History"
          >
            <Clock className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto custom-scrollbar p-6" ref={scrollRef} onScroll={handleScrollCapture}>
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-8 px-4">
            <div className="text-center">
              <div className="flex items-center justify-center gap-1 mb-4">
                <Sparkles className="w-6 h-6 text-pink-400" />
                <Sparkles className="w-7 h-7 text-indigo-500" />
              </div>
              <p className="text-base font-semibold text-slate-800">Unlock insights from your recordings</p>
            </div>
            {llmConfigured && (
              <div className="w-full max-w-sm space-y-2 mt-auto">
                <p className="text-xs font-medium text-slate-400">e.g.</p>
                {SUGGESTED_QUESTIONS.map((q) => (
                  <button
                    key={q.text}
                    type="button"
                    onClick={() => handleSend(q.text)}
                    className="w-full text-left rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-700 hover:bg-indigo-50 hover:text-indigo-700 transition-colors"
                  >
                    <span className="mr-2">{q.emoji}</span>
                    {q.text}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {messages.map((message) => (
              <div key={message.id}>
                <div
                  className={cn(
                    'max-w-[85%] rounded-2xl px-4 py-3 border shadow-sm',
                    message.role === 'user'
                      ? 'ml-auto bg-slate-900 text-white border-slate-800'
                      : 'bg-slate-50 text-slate-800 border-slate-200',
                  )}
                >
                  <p className={cn(
                    'text-xs mb-1 font-medium',
                    message.role === 'user' ? 'text-white/65' : message.error ? 'text-red-500' : 'text-slate-500',
                  )}>
                    {message.role === 'user' ? 'You' : 'Assistant'}
                  </p>

                  {message.role === 'user' && message.mentions.length > 0 && (
                    <div className="flex flex-wrap gap-1 mb-2">
                      {message.mentions.map((m) => (
                        <span key={`${m.type}-${m.id}`} className="text-[10px] px-2 py-0.5 rounded-full bg-white/15 text-white/80">
                          @{m.name}
                        </span>
                      ))}
                    </div>
                  )}

                  {message.pending && !message.content ? (
                    <div className="flex items-center gap-2 text-sm text-slate-500">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Thinking...
                    </div>
                  ) : (
                    <MarkdownContent
                      content={message.content}
                      proseClassName={cn(
                        'prose prose-sm max-w-none prose-p:my-0 prose-headings:my-2',
                        message.role === 'user'
                          ? 'prose-invert prose-strong:text-white prose-code:text-white prose-li:text-white/95'
                          : message.error
                            ? 'prose-red text-red-600'
                            : 'prose-slate',
                      )}
                    />
                  )}

                  {message.role === 'assistant' && message.content && !message.pending && !message.error && (
                    <button
                      type="button"
                      onClick={() => handleCopy(message)}
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

                {message.role === 'assistant' && message.metadata?.sources && message.metadata.sources.length > 0 && !message.pending && (
                  <div className="mt-2 ml-0 max-w-[85%]">
                    <p className="text-[11px] font-medium text-slate-400 mb-1.5 px-1">
                      Sources ({message.metadata.sources.length})
                      {message.metadata.retrieval && (
                        <span className="ml-2 font-normal">
                          {message.metadata.retrieval.mode} &middot; {message.metadata.retrieval.chunkCount} chunks
                        </span>
                      )}
                    </p>
                    <div className="space-y-1.5">
                      {message.metadata.sources.map((source) => (
                        <div key={source.id} className="flex flex-wrap items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => onSelectTask(source.id)}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-slate-200 bg-white text-xs text-slate-700 hover:bg-indigo-50 hover:border-indigo-200 hover:text-indigo-700 transition-colors"
                          >
                            <FileAudio className="w-3 h-3 text-slate-400" />
                            <span className="max-w-[200px] truncate">{source.originalName}</span>
                          </button>
                          {source.citations?.filter((c) => c.startTime != null).map((citation, ci) => (
                            <button
                              key={ci}
                              type="button"
                              onClick={() => onSelectTask(source.id, citation.startTime ?? undefined)}
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-indigo-50 border border-indigo-200 text-[11px] text-indigo-700 hover:bg-indigo-100 transition-colors"
                              title={citation.content}
                            >
                              <Clock className="w-3 h-3" />
                              {formatTimestamp(citation.startTime!)}
                            </button>
                          ))}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Input area */}
      <div className="p-4 pt-2">
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
        <p className="text-[11px] text-slate-400 text-center mt-2">Content generated by AI</p>
      </div>
    </div>
  );
}
