import { Fragment } from 'react';
import { CitationBadge } from './CitationBadge';
import type { KnowledgeSourceMeta } from '@/types';

const CITATION_REGEX = /\[Source\s+(\d+)(?:\s*@\s*(\d+):(\d{2}))?\]/g;

function parseTimestamp(minutes: string, seconds: string): number {
  return Number(minutes) * 60 + Number(seconds);
}

export function renderContentWithCitations(
  content: string,
  sources: KnowledgeSourceMeta[] | undefined,
  onNavigate: (taskId: string, seekTo?: number) => void,
): { processedContent: string; citations: Map<string, { sourceIndex: number; taskId: string; sourceName: string; startTime: number | null }> } {
  if (!sources || sources.length === 0) {
    return { processedContent: content, citations: new Map() };
  }

  const citations = new Map<string, { sourceIndex: number; taskId: string; sourceName: string; startTime: number | null }>();

  const processedContent = content.replace(CITATION_REGEX, (match, indexStr, minStr, secStr) => {
    const sourceIndex = Number(indexStr);
    const source = sources.find((s) => s.sourceIndex === sourceIndex);
    if (!source) return match;

    const startTime = minStr != null ? parseTimestamp(minStr, secStr) : null;
    const key = `cite-${sourceIndex}-${startTime ?? 'none'}`;

    citations.set(key, {
      sourceIndex,
      taskId: source.id,
      sourceName: source.originalName,
      startTime,
    });

    return `<!--citation:${key}-->`;
  });

  return { processedContent, citations };
}

export function CitationInlineRenderer({
  content,
  sources,
  onNavigate,
}: {
  content: string;
  sources: KnowledgeSourceMeta[] | undefined;
  onNavigate: (taskId: string, seekTo?: number) => void;
}) {
  if (!sources || sources.length === 0) {
    return <>{content}</>;
  }

  const parts = content.split(/(<!--citation:cite-\d+-(?:\d+|none)-->)/g);

  return (
    <>
      {parts.map((part, i) => {
        const citationMatch = part.match(/<!--citation:(cite-\d+-(?:\d+|none))-->/);
        if (!citationMatch) return <Fragment key={i}>{part}</Fragment>;

        const key = citationMatch[1];
        const sourceIndex = Number(key.split('-')[1]);
        const source = sources.find((s) => s.sourceIndex === sourceIndex);
        if (!source) return <Fragment key={i}>{part}</Fragment>;

        const timeStr = key.split('-')[2];
        const startTime = timeStr === 'none' ? null : Number(timeStr);

        return (
          <CitationBadge
            key={i}
            sourceIndex={sourceIndex}
            sourceName={source.originalName}
            taskId={source.id}
            startTime={startTime}
            onNavigate={onNavigate}
          />
        );
      })}
    </>
  );
}
