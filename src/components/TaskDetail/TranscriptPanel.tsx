import React, { useEffect, useRef, useState } from 'react';
import { Check, Copy, Search, X } from 'lucide-react';
import { cn, formatTime } from '../../lib/utils';
import { MarkdownContent } from '../MarkdownContent';
import type { Task } from '../../types';

function highlightText(text: string, query: string) {
  if (!query) return text;
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const parts = text.split(new RegExp(`(${escaped})`, 'gi'));
  if (parts.length === 1) return text;
  return parts.map((part, i) =>
    part.toLowerCase() === query.toLowerCase()
      ? <mark key={i} className="bg-yellow-200 text-yellow-900 rounded-sm px-0.5">{part}</mark>
      : part,
  );
}

export function TranscriptPanel({
  task,
  transcriptCopied,
  onCopyTranscript,
  activeSegmentId,
  onSeekToSegment,
  segmentRefs,
  compact = false,
  scrollContainerRef,
  onScroll,
}: {
  task: Task;
  transcriptCopied: boolean;
  onCopyTranscript: () => void;
  activeSegmentId: string | null;
  onSeekToSegment: (segmentId: string, startTime: number) => void;
  segmentRefs: React.MutableRefObject<Map<string, HTMLDivElement>>;
  compact?: boolean;
  scrollContainerRef?: React.RefObject<HTMLDivElement | null>;
  onScroll?: (event: React.UIEvent<HTMLDivElement>) => void;
}) {
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const canSearch = task.segments.length > 0;

  useEffect(() => {
    setIsSearchOpen(false);
    setSearchQuery('');
  }, [task.id]);

  const normalizedQuery = searchQuery.trim().toLowerCase();
  const matchingSegmentIds = normalizedQuery && canSearch
    ? new Set(
        task.segments
          .filter((s) => s.text.toLowerCase().includes(normalizedQuery) || s.speaker?.toLowerCase().includes(normalizedQuery))
          .map((s) => s.id),
      )
    : null;

  const matchCount = matchingSegmentIds?.size ?? 0;

  return (
    <div
      ref={scrollContainerRef}
      onScroll={onScroll}
      className={cn(
        'h-full overflow-y-auto custom-scrollbar',
        compact ? 'px-4 py-3 pb-28' : 'p-6 pb-6',
      )}
    >
      <div className="space-y-6">
        <div className={cn('flex items-center gap-2', compact ? 'pb-1' : '')}>
          {!compact && <div className="flex-1" />}
          {isSearchOpen ? (
            <div className={cn(
              'flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5',
              compact ? 'flex-1' : 'w-64',
            )}>
              <Search className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search transcript..."
                className="flex-1 bg-transparent text-sm text-slate-700 focus:outline-none placeholder:text-slate-400"
                autoFocus
              />
              {normalizedQuery && (
                <span className="shrink-0 text-[10px] font-medium text-slate-400">{matchCount} found</span>
              )}
              <button
                type="button"
                onClick={() => { setIsSearchOpen(false); setSearchQuery(''); }}
                className="shrink-0 text-slate-400 hover:text-slate-600"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <button
              onClick={() => { setIsSearchOpen(true); setTimeout(() => searchInputRef.current?.focus(), 0); }}
              disabled={!canSearch}
              className={cn(
                'rounded-xl font-medium flex items-center gap-2 border border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed',
                compact ? 'px-3 py-2 text-xs' : 'px-3 py-2 text-sm',
              )}
            >
              <Search className="w-4 h-4" />
              {!compact && 'Search'}
            </button>
          )}
          {!isSearchOpen && (
            <button
              onClick={onCopyTranscript}
              disabled={!task.transcript && !task.result && task.segments.length === 0}
              className={cn(
                'rounded-xl font-medium flex items-center gap-2 border border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed',
                compact ? 'px-3 py-2 text-xs' : 'px-3 py-2 text-sm',
              )}
            >
              {transcriptCopied ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
              {transcriptCopied ? 'Copied' : compact ? 'Copy' : 'Copy Transcript'}
            </button>
          )}
        </div>

        {task.segments.length > 0 ? (
          <div className="space-y-3">
            {task.segments
            .filter((segment) => !matchingSegmentIds || matchingSegmentIds.has(segment.id))
            .map((segment) => (
              <div
                key={segment.id}
                ref={(element) => {
                  if (element) {
                    segmentRefs.current.set(segment.id, element);
                  } else {
                    segmentRefs.current.delete(segment.id);
                  }
                }}
                onClick={() => onSeekToSegment(segment.id, segment.start)}
                className={cn(
                  'rounded-2xl border p-4 cursor-pointer transition-all',
                  activeSegmentId === segment.id
                    ? 'border-indigo-400 bg-indigo-50 shadow-sm shadow-indigo-100'
                    : 'border-slate-200 hover:border-indigo-200 hover:bg-slate-50',
                )}
              >
                <div className="flex items-center gap-3 flex-wrap mb-2">
                  <span className="text-xs font-medium text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">
                    {formatTime(segment.start)} - {formatTime(segment.end)}
                  </span>
                  <span className="text-xs font-medium text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full border border-indigo-100">
                    {segment.speaker || 'Speaker'}
                  </span>
                </div>
                <p className="text-sm leading-6 text-slate-700">
                  {normalizedQuery ? highlightText(segment.text, normalizedQuery) : segment.text}
                </p>
              </div>
            ))}
          </div>
        ) : (
          <MarkdownContent
            content={task.result || task.transcript || ''}
            proseClassName="prose prose-slate max-w-none prose-headings:font-semibold prose-a:text-indigo-600"
          />
        )}
      </div>
    </div>
  );
}
