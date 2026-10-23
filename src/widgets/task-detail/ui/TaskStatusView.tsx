import { Check, CircleStop, Loader2, RefreshCw } from 'lucide-react';
import { cn } from '@/shared/lib/cn';
import { useAppDataContext } from '@/app/providers/app-data-context';
import type { Task } from '@/entities/task';

type StepState = 'done' | 'current' | 'waiting' | 'upcoming';

function Step({ state, label, detail }: { state: StepState; label: string; detail?: string }) {
  return (
    <li className={cn('flex items-center gap-3', state === 'upcoming' && 'text-stone-500')}>
      <span
        className={cn(
          'flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full',
          state === 'done' && 'bg-stone-900 text-white',
          state === 'current' && 'text-amber-700',
          state === 'waiting' && 'text-violet-700',
          state === 'upcoming' && 'border-2 border-stone-300',
        )}
      >
        {state === 'done' ? <Check className="h-3 w-3" strokeWidth={3} /> : null}
        {state === 'current' || state === 'waiting' ? <Loader2 className="h-5 w-5 animate-spin" /> : null}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block">{label}</span>
        {detail ? <span className="mt-0.5 block whitespace-pre-wrap text-sm text-stone-600">{detail}</span> : null}
      </span>
    </li>
  );
}

/** Shown instead of the Summary/Transcript tabs while a recording is not usable yet. */
export function TaskStatusView({
  task,
  isCancelling,
  onCancel,
  onRetry,
  onRetryWithOptions,
}: {
  task: Task;
  isCancelling: boolean;
  onCancel: () => void;
  onRetry: () => void;
  onRetryWithOptions: () => void;
}) {
  const { userSettings } = useAppDataContext();

  if (task.status === 'failed') {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-5">
        <p className="font-semibold text-red-800">Transcription failed</p>
        <p className="mt-1 text-sm text-red-900">Your audio is safe. Try again, or retry with another provider or language.</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex h-9 items-center gap-2 rounded-lg bg-stone-900 px-4 text-sm font-medium text-white hover:bg-stone-800"
          >
            <RefreshCw className="h-4 w-4" />
            Retry
          </button>
          <button
            type="button"
            onClick={onRetryWithOptions}
            className="h-9 rounded-lg border border-stone-200 bg-white px-4 text-sm font-medium text-stone-900 hover:bg-stone-50"
          >
            Retry with other settings…
          </button>
        </div>
        {task.result ? (
          <details className="mt-4 text-sm text-red-900">
            <summary className="cursor-pointer">Technical details</summary>
            <pre className="mt-2 whitespace-pre-wrap break-words font-mono text-xs">{task.result}</pre>
          </details>
        ) : null}
      </div>
    );
  }

  if (task.status === 'cancelled') {
    return (
      <div className="rounded-xl border border-stone-200 p-5">
        <p className="font-semibold text-stone-900">Processing was cancelled</p>
        <p className="mt-1 text-sm text-stone-600">Run it again whenever you are ready.</p>
        <button
          type="button"
          onClick={onRetryWithOptions}
          className="mt-4 inline-flex h-9 items-center gap-2 rounded-lg bg-stone-900 px-4 text-sm font-medium text-white hover:bg-stone-800"
        >
          <RefreshCw className="h-4 w-4" />
          Process again
        </button>
      </div>
    );
  }

  const transcribeState: StepState =
    task.status === 'processing' ? 'current' : task.status === 'blocked' ? 'waiting' : 'upcoming';
  const transcribeDetail =
    task.status === 'pending'
      ? 'Queued — starts as soon as a worker is free.'
      : task.status === 'blocked'
        ? task.result || 'Waiting for the transcription service to recover. It retries automatically.'
        : undefined;

  return (
    <div className="rounded-xl border border-stone-200 p-5">
      <p className="mb-4 font-semibold text-stone-900">Processing — you can leave this page</p>
      <ol className="flex flex-col gap-3.5">
        <Step state="done" label="Uploaded" />
        <Step
          state={task.status === 'pending' ? 'current' : transcribeState}
          label={task.status === 'blocked' ? 'Waiting for transcription service' : 'Transcribing'}
          detail={transcribeDetail}
        />
        {userSettings?.enableDiarization !== false ? <Step state="upcoming" label="Identify speakers" /> : null}
        {userSettings?.autoGenerateSummary ? <Step state="upcoming" label="Write summary" /> : null}
      </ol>
      <button
        type="button"
        onClick={onCancel}
        disabled={isCancelling}
        className="mt-5 inline-flex h-9 items-center gap-2 rounded-lg border border-stone-200 bg-white px-4 text-sm font-medium text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isCancelling ? <Loader2 className="h-4 w-4 animate-spin" /> : <CircleStop className="h-4 w-4" />}
        {isCancelling ? 'Cancelling…' : 'Cancel'}
      </button>
    </div>
  );
}
