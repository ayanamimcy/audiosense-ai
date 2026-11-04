import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, ArrowRight, Loader2, Minus, Plus, Radio, Square } from 'lucide-react';
import { cn } from '@/shared/lib/cn';
import { formatTime } from '@/shared/lib/format';
import { Field, ToggleRow, inputClassName, primaryButtonClassName, secondaryButtonClassName } from '@/shared/ui/form';
import { useAppDataContext } from '@/app/providers/app-data-context';
import { useLiveCaptions, type LiveCaption, type LiveNotice, type LiveStartOptions } from '@/features/live-captions/model/useLiveCaptions';

const FONT_SIZES = [
  { original: 'text-base', translation: 'text-sm' },
  { original: 'text-lg', translation: 'text-[15px]' },
  { original: 'text-2xl', translation: 'text-lg' },
  { original: 'text-3xl', translation: 'text-xl' },
];

const NOTICE_TEXT: Record<LiveNotice, (message?: string) => string> = {
  batch_running: () =>
    'A transcription job is still running. Captions start once it finishes; new jobs wait until you stop.',
  translation_unavailable: () => 'Translation is off: set up an AI model in Settings to translate captions.',
  captions_unavailable: (message) =>
    `Live captions are unavailable${message ? ` (${message})` : ''}. Audio is still recorded and transcribed when you stop.`,
  runtime_error: (message) => `Transcription error${message ? `: ${message}` : ''}.`,
  save_failed: (message) => `The recording could not be saved${message ? `: ${message}` : ''}.`,
};

function defaultTitle() {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  return `Meeting ${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

function useElapsed(startedAt: number | null, running: boolean) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!running) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [running]);
  return startedAt ? Math.max(0, (now - startedAt) / 1000) : 0;
}

function CaptionBlock({ caption, size }: { caption: LiveCaption; size: (typeof FONT_SIZES)[number] }) {
  return (
    <div className="flex gap-4">
      <span className="w-12 shrink-0 pt-1.5 text-xs text-stone-400 tabular-nums">{formatTime(caption.offsetMs / 1000)}</span>
      <div className="min-w-0 flex-1">
        <p className={cn('leading-relaxed text-stone-900', size.original)} lang={caption.language || undefined}>
          {caption.text}
        </p>
        {caption.translationState === 'done' && caption.translation ? (
          <p className={cn('mt-1 leading-relaxed text-indigo-800', size.translation)}>{caption.translation}</p>
        ) : caption.translationState === 'pending' ? (
          <p className={cn('mt-1 text-stone-400', size.translation)} aria-label="Translating">…</p>
        ) : caption.translationState === 'failed' ? (
          <p className="mt-1 text-xs text-amber-700">Translation failed</p>
        ) : null}
      </div>
    </div>
  );
}

export function LiveCaptionsPage() {
  const { notebooks, capabilities } = useAppDataContext();
  const live = useLiveCaptions();
  const llmConfigured = Boolean(capabilities?.llm.configured);
  const [options, setOptions] = useState<LiveStartOptions>(() => ({
    includeTab: true,
    includeMicrophone: true,
    language: 'auto',
    translate: true,
    notebookId: null,
    title: defaultTitle(),
  }));
  const [fontSize, setFontSize] = useState(1);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const followRef = useRef(true);

  const isActive = live.status === 'connecting' || live.status === 'live' || live.status === 'stopping';
  const elapsed = useElapsed(live.startedAt, live.status === 'live');
  const size = FONT_SIZES[fontSize];
  const showTranslations = live.translating || live.captions.some((caption) => caption.translationState !== 'pending');
  const captions = useMemo(
    () => (showTranslations ? live.captions : live.captions.map((caption) => ({ ...caption, translationState: 'off' as const }))),
    [live.captions, showTranslations],
  );

  // Keep the newest caption in view unless the user scrolled up to read.
  useEffect(() => {
    const element = scrollRef.current;
    if (element && followRef.current) element.scrollTop = element.scrollHeight;
  }, [captions, live.partial]);

  // Closing the tab mid-meeting: the server saves the audio, but warn anyway.
  useEffect(() => {
    if (!isActive) return undefined;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = true;
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isActive]);

  const handleStart = () => {
    void live.start({ ...options, translate: options.translate && llmConfigured });
  };

  // A new session is a new meeting: give it a fresh default title.
  const handleStartAgain = () => {
    const next = { ...options, title: defaultTitle() };
    setOptions(next);
    void live.start({ ...next, translate: next.translate && llmConfigured });
  };

  const setup = (
    <div className="mx-auto w-full max-w-2xl px-5 py-6 lg:px-8">
      <h1 className="text-xl font-semibold text-stone-900">Live captions</h1>
      <p className="mt-1 text-sm text-stone-600">
        Captions for an online meeting in your browser, with Chinese ⇄ Japanese translation. The meeting is saved as a
        recording when you stop, with a full transcript and summary.
      </p>

      <div className="mt-6 rounded-xl border border-stone-200 bg-white px-4">
        <ToggleRow
          label="Meeting audio"
          description="Share the meeting's browser tab. In Chrome's picker, choose the tab and turn on “Also share tab audio”."
          checked={options.includeTab}
          onChange={(checked) => setOptions((current) => ({ ...current, includeTab: checked }))}
        />
        <ToggleRow
          label="My microphone"
          description="Caption what you say too. Use headphones so the meeting is not picked up twice."
          checked={options.includeMicrophone}
          onChange={(checked) => setOptions((current) => ({ ...current, includeMicrophone: checked }))}
        />
        <ToggleRow
          label="Translate Chinese ⇄ Japanese"
          description={llmConfigured
            ? 'Each finished sentence is translated: Japanese into Chinese, Chinese into Japanese.'
            : 'Set up an AI model in Settings to translate captions.'}
          checked={options.translate && llmConfigured}
          disabled={!llmConfigured}
          onChange={(checked) => setOptions((current) => ({ ...current, translate: checked }))}
        />
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Field label="Spoken language">
          <select
            value={options.language}
            onChange={(event) => setOptions((current) => ({ ...current, language: event.target.value as LiveStartOptions['language'] }))}
            className={inputClassName}
          >
            <option value="auto">Detect automatically</option>
            <option value="ja">Japanese</option>
            <option value="zh">Chinese</option>
          </select>
        </Field>
        <Field label="Save to notebook">
          <select
            value={options.notebookId || ''}
            onChange={(event) => setOptions((current) => ({ ...current, notebookId: event.target.value || null }))}
            className={inputClassName}
          >
            <option value="">Inbox</option>
            {notebooks.map((notebook) => (
              <option key={notebook.id} value={notebook.id}>{notebook.name}</option>
            ))}
          </select>
        </Field>
        <Field label="Recording title" className="sm:col-span-2">
          <input
            type="text"
            value={options.title}
            onChange={(event) => setOptions((current) => ({ ...current, title: event.target.value }))}
            className={inputClassName}
          />
        </Field>
      </div>

      <button
        type="button"
        onClick={handleStart}
        disabled={!options.includeTab && !options.includeMicrophone}
        className={cn(primaryButtonClassName, 'mt-5')}
      >
        <Radio className="h-4 w-4" />
        Start live captions
      </button>
    </div>
  );

  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      {live.status !== 'idle' ? (
        <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-stone-200 px-5 py-3 lg:px-8">
          {live.status === 'live' ? (
            <span className="inline-flex items-center gap-2 text-sm font-medium text-stone-900">
              <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-red-600" aria-hidden="true" />
              Live · <span className="tabular-nums">{formatTime(elapsed)}</span>
            </span>
          ) : live.status === 'ended' ? (
            <span className="text-sm font-medium text-stone-700">Session ended</span>
          ) : (
            <span className="inline-flex items-center gap-2 text-sm text-stone-600">
              <Loader2 className="h-4 w-4 animate-spin" />
              {live.status === 'connecting' ? 'Connecting…' : 'Finishing the last sentence and saving…'}
            </span>
          )}
          <div className="ml-auto flex items-center gap-2">
            <div className="flex items-center rounded-lg border border-stone-200">
              <button
                type="button"
                onClick={() => setFontSize((current) => Math.max(0, current - 1))}
                disabled={fontSize === 0}
                aria-label="Smaller text"
                className="flex h-8 w-8 items-center justify-center text-stone-600 hover:bg-stone-50 disabled:opacity-40"
              >
                <Minus className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => setFontSize((current) => Math.min(FONT_SIZES.length - 1, current + 1))}
                disabled={fontSize === FONT_SIZES.length - 1}
                aria-label="Larger text"
                className="flex h-8 w-8 items-center justify-center border-l border-stone-200 text-stone-600 hover:bg-stone-50 disabled:opacity-40"
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>
            {live.status === 'live' || live.status === 'connecting' ? (
              <button type="button" onClick={live.stop} className={cn(primaryButtonClassName, 'bg-red-700 hover:bg-red-800')}>
                <Square className="h-3.5 w-3.5 fill-current" />
                Stop
              </button>
            ) : live.status === 'ended' ? (
              <button type="button" onClick={handleStartAgain} className={secondaryButtonClassName}>
                <Radio className="h-4 w-4" />
                Start again
              </button>
            ) : null}
          </div>
        </header>
      ) : null}

      {live.error || live.notices.length > 0 || (live.status === 'ended' && live.savedTaskId) ? (
        <div className="flex shrink-0 flex-col gap-2 px-5 pt-3 lg:px-8">
          {live.error ? (
            <p className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              {live.error}
            </p>
          ) : null}
          {live.notices.map((notice) => (
            <p key={notice.code} className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              {NOTICE_TEXT[notice.code](notice.message)}
            </p>
          ))}
          {live.status === 'ended' && live.savedTaskId ? (
            <p className="flex flex-wrap items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
              Saved as a recording. The full transcript, speakers and summary are being generated.
              <Link to={`/notebook/${live.savedTaskId}`} className="inline-flex items-center gap-1 font-medium underline underline-offset-2">
                Open recording
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </p>
          ) : null}
        </div>
      ) : null}

      <div
        ref={scrollRef}
        onScroll={(event) => {
          const element = event.currentTarget;
          followRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80;
        }}
        className="relative min-h-0 flex-1 overflow-y-auto custom-scrollbar"
      >
        {live.status === 'idle' ? setup : (
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-5 py-6 lg:px-8">
            {captions.map((caption) => <CaptionBlock key={caption.id} caption={caption} size={size} />)}
            {live.partial ? (
              <div className="flex gap-4">
                <span className="w-12 shrink-0" />
                <p className={cn('min-w-0 flex-1 leading-relaxed text-stone-400', size.original)}>{live.partial}</p>
              </div>
            ) : null}
            {live.status === 'live' && captions.length === 0 && !live.partial ? (
              <p className="py-10 text-center text-sm text-stone-500">Listening… captions appear as people speak.</p>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
