import React, { useEffect, useMemo, useState } from 'react';
import { Search, X } from 'lucide-react';
import { cn } from '@/shared/lib/cn';
import { formatTime } from '@/shared/lib/format';
import { MarkdownContent } from '@/shared/ui/MarkdownContent';
import type { Task } from '@/entities/task';

// Distinct in lightness as well as hue so speakers stay apart for color-blind readers.
const SPEAKER_COLORS = ['text-indigo-700', 'text-orange-700', 'text-cyan-800', 'text-purple-700', 'text-emerald-800', 'text-rose-700'];

function highlightText(text: string, query: string) {
  if (!query) return text;
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const parts = text.split(new RegExp(`(${escaped})`, 'gi'));
  if (parts.length === 1) return text;
  return parts.map((part, i) =>
    part.toLowerCase() === query.toLowerCase()
      ? <mark key={i} className="rounded-sm bg-amber-200 px-0.5 text-stone-900">{part}</mark>
      : part,
  );
}

export function TranscriptPanel({
  task,
  activeSegmentId,
  onSeekToSegment,
  segmentRefs,
}: {
  task: Task;
  activeSegmentId: string | null;
  onSeekToSegment: (startTime: number) => void;
  segmentRefs: React.MutableRefObject<Map<string, HTMLButtonElement>>;
}) {
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    setSearchQuery('');
  }, [task.id]);

  const speakerColor = useMemo(() => {
    const map = new Map<string, string>();
    for (const segment of task.segments) {
      const key = segment.speaker || '';
      if (!map.has(key)) map.set(key, SPEAKER_COLORS[map.size % SPEAKER_COLORS.length]);
    }
    return map;
  }, [task.segments]);

  const normalizedQuery = searchQuery.trim().toLowerCase();
  const visibleSegments = normalizedQuery
    ? task.segments.filter(
        (segment) =>
          segment.text.toLowerCase().includes(normalizedQuery) ||
          segment.speaker?.toLowerCase().includes(normalizedQuery),
      )
    : task.segments;

  if (task.segments.length === 0) {
    return (
      <MarkdownContent
        content={task.result || task.transcript || ''}
        proseClassName="prose prose-stone max-w-none text-[15px]"
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <label className="relative block">
        <span className="sr-only">Search transcript</span>
        <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-stone-400" />
        <input
          type="search"
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          placeholder="Search transcript"
          className="h-10 w-full rounded-lg border border-stone-200 bg-white pr-20 pl-9 text-sm text-stone-900 placeholder:text-stone-400 focus:border-stone-400 focus:outline-none focus:ring-2 focus:ring-stone-900/10"
        />
        {normalizedQuery ? (
          <span className="absolute top-1/2 right-9 -translate-y-1/2 text-xs text-stone-500">{visibleSegments.length} found</span>
        ) : null}
        {searchQuery ? (
          <button
            type="button"
            onClick={() => setSearchQuery('')}
            aria-label="Clear search"
            className="absolute top-1/2 right-2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-stone-500 hover:bg-stone-100"
          >
            <X className="h-4 w-4" />
          </button>
        ) : null}
      </label>

      <div className="flex flex-col gap-0.5">
        {visibleSegments.map((segment) => (
          <button
            key={segment.id}
            type="button"
            ref={(element) => {
              if (element) {
                segmentRefs.current.set(segment.id, element);
              } else {
                segmentRefs.current.delete(segment.id);
              }
            }}
            onClick={() => onSeekToSegment(segment.start)}
            className={cn(
              'flex gap-4 rounded-xl p-3 text-left transition-colors',
              activeSegmentId === segment.id ? 'bg-indigo-50' : 'hover:bg-stone-50',
            )}
          >
            <span className="w-12 shrink-0 pt-0.5 text-xs text-stone-500 tabular-nums">{formatTime(segment.start)}</span>
            <span className="min-w-0 flex-1">
              {segment.speaker ? (
                <span className={cn('block text-xs font-semibold', speakerColor.get(segment.speaker))}>
                  {segment.speaker}
                </span>
              ) : null}
              <span className="mt-0.5 block text-[15px] leading-relaxed text-stone-900">
                {normalizedQuery ? highlightText(segment.text, normalizedQuery) : segment.text}
              </span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
