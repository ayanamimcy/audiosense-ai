import { Clock, FileAudio } from 'lucide-react';

function formatTimestamp(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function CitationBadge({
  sourceIndex,
  sourceName,
  taskId,
  startTime,
  onNavigate,
}: {
  sourceIndex: number;
  sourceName: string;
  taskId: string;
  startTime: number | null;
  onNavigate: (taskId: string, seekTo?: number) => void;
}) {
  const hasTimestamp = startTime != null && Number.isFinite(startTime);

  return (
    <button
      type="button"
      onClick={() => onNavigate(taskId, hasTimestamp ? startTime : undefined)}
      className="inline-flex items-center gap-1 px-1.5 py-0.5 mx-0.5 rounded-md bg-indigo-50 border border-indigo-200 text-xs text-indigo-700 hover:bg-indigo-100 hover:border-indigo-300 transition-colors align-baseline cursor-pointer"
      title={`${sourceName}${hasTimestamp ? ` @ ${formatTimestamp(startTime)}` : ''}`}
    >
      {hasTimestamp ? (
        <>
          <Clock className="w-3 h-3" />
          <span>{formatTimestamp(startTime)}</span>
        </>
      ) : (
        <>
          <FileAudio className="w-3 h-3" />
          <span>Source {sourceIndex}</span>
        </>
      )}
    </button>
  );
}
