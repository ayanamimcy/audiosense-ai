import { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { useAppDataContext } from '@/app/providers/app-data-context';
import { cn } from '@/shared/lib/cn';
import { LANGUAGE_OPTIONS } from '@/shared/lib/constants';
import type { UserSettings } from '@/entities/settings';

export interface RecordingOptionsValue {
  notebookId: string;
  tags: string;
  provider: string;
  language: string;
}

export function buildUploadMetadata(
  options: RecordingOptionsValue,
  userSettings: UserSettings | null,
  sourceType: 'upload' | 'record',
): Record<string, string> {
  const meta: Record<string, string> = {
    language: options.language,
    diarization: String(userSettings?.enableDiarization !== false),
    sourceType,
  };
  if (options.notebookId) meta.notebookId = options.notebookId;
  if (options.tags.trim()) meta.tags = options.tags;
  if (options.provider) meta.provider = options.provider;
  return meta;
}

export const fieldClassName =
  'h-10 w-full rounded-lg border border-stone-200 bg-white px-3 text-sm text-stone-900 focus:border-stone-400 focus:outline-none focus:ring-2 focus:ring-stone-900/10 disabled:bg-stone-50';

export function RecordingOptions({
  value,
  onChange,
  disabled = false,
}: {
  value: RecordingOptionsValue;
  onChange: (next: RecordingOptionsValue) => void;
  disabled?: boolean;
}) {
  const { notebooks, capabilities, userSettings } = useAppDataContext();
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);
  const providers = capabilities?.transcription.providers || [];
  const defaultProviderLabel =
    providers.find((item) => item.id === userSettings?.defaultProvider)?.label || 'Default provider';
  const providerLabel = value.provider
    ? providers.find((item) => item.id === value.provider)?.label || value.provider
    : defaultProviderLabel;
  const languageLabel = LANGUAGE_OPTIONS.find((option) => option.value === value.language)?.label || value.language;

  return (
    <div className="mt-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-stone-700">Notebook</span>
          <select
            value={value.notebookId}
            disabled={disabled}
            onChange={(event) => onChange({ ...value, notebookId: event.target.value })}
            className={fieldClassName}
          >
            <option value="">Inbox</option>
            {notebooks.map((notebook) => (
              <option key={notebook.id} value={notebook.id}>{notebook.name}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-stone-700">
            Tags <span className="font-normal text-stone-500">(optional)</span>
          </span>
          <input
            type="text"
            value={value.tags}
            disabled={disabled}
            onChange={(event) => onChange({ ...value, tags: event.target.value })}
            placeholder="meeting, interview"
            className={fieldClassName}
          />
        </label>
      </div>

      <button
        type="button"
        onClick={() => setIsAdvancedOpen((current) => !current)}
        aria-expanded={isAdvancedOpen}
        className="mt-3 flex w-full items-center gap-2 py-2 text-left text-sm text-stone-700"
      >
        <ChevronRight className={cn('h-4 w-4 shrink-0 transition-transform', isAdvancedOpen && 'rotate-90')} />
        <span className="font-medium">Transcription</span>
        <span className="ml-auto truncate text-stone-500">{providerLabel} · {languageLabel}</span>
      </button>

      {isAdvancedOpen ? (
        <div className="grid gap-3 pb-1 pl-6 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-stone-700">Provider</span>
            <select
              value={value.provider}
              disabled={disabled}
              onChange={(event) => onChange({ ...value, provider: event.target.value })}
              className={fieldClassName}
            >
              <option value="">Default ({defaultProviderLabel})</option>
              {providers.map((item) => (
                <option key={item.id} value={item.id} disabled={!item.configured}>
                  {item.label}{item.configured ? '' : ' (not set up)'}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-stone-700">Language</span>
            <select
              value={value.language}
              disabled={disabled}
              onChange={(event) => onChange({ ...value, language: event.target.value })}
              className={fieldClassName}
            >
              {LANGUAGE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
        </div>
      ) : null}
    </div>
  );
}
