import React from 'react';
import { Check, Copy } from 'lucide-react';
import { cn, formatTime } from '../../lib/utils';
import { MarkdownContent } from '../MarkdownContent';
import type { Task } from '../../types';

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
        <div className={cn('flex items-center justify-between', compact ? 'pb-1' : '')}>
          {compact ? <div /> : <p className="text-sm text-slate-500"></p>}
          <button
            onClick={onCopyTranscript}
            disabled={!task.transcript && !task.result && task.segments.length === 0}
            className={cn(
              'rounded-xl font-medium flex items-center gap-2 border border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed',
              compact ? 'px-3 py-2 text-xs' : 'px-3 py-2 text-sm',
            )}
          >
            {transcriptCopied ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
            {transcriptCopied ? 'Copied' : 'Copy Transcript'}
          </button>
        </div>

        {task.segments.length > 0 ? (
          <div className="space-y-3">
            {task.segments.map((segment) => (
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
                <p className="text-sm leading-6 text-slate-700">{segment.text}</p>
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
