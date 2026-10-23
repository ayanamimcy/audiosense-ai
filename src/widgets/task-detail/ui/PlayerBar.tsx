import { ListMusic, Pause, Play, RotateCcw, RotateCw } from 'lucide-react';
import { cn } from '@/shared/lib/cn';
import { formatTime } from '@/shared/lib/format';

export const PLAYBACK_RATES = [1, 1.25, 1.5, 2, 0.75];
const SKIP_SECONDS = 5;

export function PlayerBar({
  variant,
  currentTime,
  duration,
  isPlaying,
  playbackRate,
  onTogglePlay,
  onSeek,
  onCycleRate,
  onShowTranscript,
}: {
  variant: 'desktop' | 'mobile';
  currentTime: number;
  duration: number;
  isPlaying: boolean;
  playbackRate: number;
  onTogglePlay: () => void;
  onSeek: (time: number) => void;
  onCycleRate: () => void;
  onShowTranscript?: () => void;
}) {
  const max = duration > 0 ? duration : 0;
  const seekBy = (delta: number) => onSeek(Math.max(0, Math.min(currentTime + delta, max || currentTime + delta)));
  const rateLabel = `${playbackRate}×`;

  const slider = (
    <input
      type="range"
      min={0}
      max={max || 1}
      step={0.1}
      value={Math.min(currentTime, max || 1)}
      disabled={!max}
      onChange={(event) => onSeek(Number(event.target.value))}
      aria-label="Playback position"
      className={cn(
        'h-1 min-w-0 flex-1 cursor-pointer disabled:cursor-default',
        variant === 'desktop' ? 'accent-white' : 'accent-stone-900',
      )}
    />
  );

  if (variant === 'desktop') {
    return (
      <div className="mx-4 mb-4 flex shrink-0 items-center gap-3 rounded-2xl bg-stone-900 px-4 py-2.5 text-white">
        <button
          type="button"
          onClick={() => seekBy(-SKIP_SECONDS)}
          aria-label={`Back ${SKIP_SECONDS} seconds`}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-stone-300 hover:bg-white/10 hover:text-white"
        >
          <RotateCcw className="h-[18px] w-[18px]" />
        </button>
        <button
          type="button"
          onClick={onTogglePlay}
          aria-label={isPlaying ? 'Pause' : 'Play'}
          className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-stone-900"
        >
          {isPlaying ? <Pause className="h-4 w-4 fill-current" /> : <Play className="ml-0.5 h-4 w-4 fill-current" />}
        </button>
        <button
          type="button"
          onClick={() => seekBy(SKIP_SECONDS)}
          aria-label={`Forward ${SKIP_SECONDS} seconds`}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-stone-300 hover:bg-white/10 hover:text-white"
        >
          <RotateCw className="h-[18px] w-[18px]" />
        </button>
        <span className="text-xs text-stone-300 tabular-nums">{formatTime(currentTime)}</span>
        {slider}
        <span className="text-xs text-stone-300 tabular-nums">{formatTime(duration)}</span>
        <button
          type="button"
          onClick={onCycleRate}
          aria-label={`Playback speed ${rateLabel}`}
          className="h-7 min-w-11 rounded-md border border-stone-600 px-2 text-xs font-medium text-white hover:bg-white/10"
        >
          {rateLabel}
        </button>
      </div>
    );
  }

  return (
    <div className="shrink-0 border-t border-stone-200 bg-white px-5 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
      <div className="flex items-center gap-2.5 text-xs text-stone-600 tabular-nums">
        <span>{formatTime(currentTime)}</span>
        {slider}
        <span>{formatTime(duration)}</span>
      </div>
      <div className="mt-1 flex items-center justify-between">
        <button
          type="button"
          onClick={onCycleRate}
          aria-label={`Playback speed ${rateLabel}`}
          className="h-11 w-11 text-[13px] font-semibold text-stone-900"
        >
          {rateLabel}
        </button>
        <button
          type="button"
          onClick={() => seekBy(-SKIP_SECONDS)}
          aria-label={`Back ${SKIP_SECONDS} seconds`}
          className="flex h-11 w-11 items-center justify-center text-stone-900"
        >
          <RotateCcw className="h-[22px] w-[22px]" />
        </button>
        <button
          type="button"
          onClick={onTogglePlay}
          aria-label={isPlaying ? 'Pause' : 'Play'}
          className="flex h-14 w-14 items-center justify-center rounded-full bg-stone-900 text-white active:scale-95"
        >
          {isPlaying ? <Pause className="h-5 w-5 fill-current" /> : <Play className="ml-0.5 h-5 w-5 fill-current" />}
        </button>
        <button
          type="button"
          onClick={() => seekBy(SKIP_SECONDS)}
          aria-label={`Forward ${SKIP_SECONDS} seconds`}
          className="flex h-11 w-11 items-center justify-center text-stone-900"
        >
          <RotateCw className="h-[22px] w-[22px]" />
        </button>
        {onShowTranscript ? (
          <button
            type="button"
            onClick={onShowTranscript}
            aria-label="Show current line in transcript"
            className="flex h-11 w-11 items-center justify-center text-indigo-700"
          >
            <ListMusic className="h-5 w-5" />
          </button>
        ) : (
          <span className="h-11 w-11" aria-hidden="true" />
        )}
      </div>
    </div>
  );
}
