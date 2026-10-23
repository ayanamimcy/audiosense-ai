import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react';
import { Check, Upload, X } from 'lucide-react';
import { cn } from '@/shared/lib/cn';
import { useAppDataContext } from '@/app/providers/app-data-context';
import { chunkedUpload, directUploadWithProgress, isLargeFile, type UploadProgress } from '@/features/upload-file';
import { buildUploadMetadata, type RecordingOptionsValue } from './RecordingOptions';

const MEDIA_FILE_ACCEPT = 'audio/*,video/*,.m4a,.mp3,.wav,.ogg,.webm,.aac,.mp4,.m4v,.mov,.flac';
const MEDIA_FILE_EXTENSIONS = ['.m4a', '.mp3', '.wav', '.ogg', '.webm', '.aac', '.mp4', '.m4v', '.mov', '.flac'];

function isLikelyMediaFile(file: File) {
  const mimeType = file.type.toLowerCase();
  if (mimeType.startsWith('audio/') || mimeType.startsWith('video/')) {
    return true;
  }

  const lowerName = file.name.toLowerCase();
  return MEDIA_FILE_EXTENSIONS.some((extension) => lowerName.endsWith(extension));
}

function formatMegabytes(bytes: number) {
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

type QueueItemState =
  | { kind: 'ready' }
  | { kind: 'uploading'; phase: UploadProgress['phase']; percent: number }
  | { kind: 'done'; taskId?: string }
  | { kind: 'failed'; error: string };

interface QueueItem {
  id: string;
  file: File;
  state: QueueItemState;
}

function describeProgress(item: QueueItem) {
  const { state } = item;
  if (state.kind === 'ready') return formatMegabytes(item.file.size);
  if (state.kind === 'done') return 'Queued for transcription';
  if (state.kind === 'failed') return state.error;
  if (state.phase === 'hashing') return `Preparing · ${state.percent}%`;
  if (state.phase === 'merging') return 'Finishing upload…';
  return `Uploading · ${state.percent}% of ${formatMegabytes(item.file.size)}`;
}

export interface UploadPanelHandle {
  start: () => void;
}

/**
 * Files are staged first so notebook/tags/provider can be set before anything is sent;
 * the dialog's primary button calls `start()` through the ref.
 */
export function UploadPanel({
  ref,
  options,
  onQueueChange,
  onUploadSuccess,
}: {
  ref?: Ref<UploadPanelHandle>;
  options: RecordingOptionsValue;
  onQueueChange: (state: { readyCount: number; isUploading: boolean }) => void;
  onUploadSuccess: (taskId?: string) => void | Promise<void>;
}) {
  const { userSettings } = useAppDataContext();
  const [items, setItems] = useState<QueueItem[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const readyCount = items.filter((item) => item.state.kind === 'ready' || item.state.kind === 'failed').length;

  useEffect(() => {
    onQueueChange({ readyCount, isUploading });
  }, [readyCount, isUploading, onQueueChange]);

  const updateItem = (id: string, state: QueueItemState) => {
    setItems((current) => current.map((item) => (item.id === id ? { ...item, state } : item)));
  };

  const addFiles = (files: File[]) => {
    const validFiles = files.filter(isLikelyMediaFile);
    const invalidFiles = files.filter((file) => !isLikelyMediaFile(file));
    if (invalidFiles.length > 0) {
      alert(`Skipped unsupported files: ${invalidFiles.map((file) => file.name).join(', ')}`);
    }
    setItems((current) => [
      ...current,
      ...validFiles.map((file) => ({
        id: `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2, 8)}`,
        file,
        state: { kind: 'ready' } as QueueItemState,
      })),
    ]);
  };

  const uploadOne = async (item: QueueItem) => {
    const metadata = buildUploadMetadata(options, userSettings, 'upload');
    updateItem(item.id, { kind: 'uploading', phase: 'uploading', percent: 0 });

    if (isLargeFile(item.file)) {
      return chunkedUpload(item.file, metadata, (progress) => {
        updateItem(item.id, { kind: 'uploading', phase: progress.phase, percent: progress.percent });
      });
    }

    const formData = new FormData();
    formData.append('audio', item.file);
    for (const [key, value] of Object.entries(metadata)) {
      formData.append(key, value);
    }
    return directUploadWithProgress(formData, (percent) => {
      updateItem(item.id, { kind: 'uploading', phase: 'uploading', percent });
    });
  };

  const startUploads = async () => {
    const pending = items.filter((item) => item.state.kind === 'ready' || item.state.kind === 'failed');
    if (pending.length === 0 || isUploading) return;

    setIsUploading(true);
    let latestTaskId: string | undefined;
    let failures = 0;

    try {
      for (const item of pending) {
        try {
          const taskId = await uploadOne(item);
          updateItem(item.id, { kind: 'done', taskId });
          if (taskId) latestTaskId = taskId;
        } catch (error: unknown) {
          failures += 1;
          console.error('Upload error:', error);
          updateItem(item.id, {
            kind: 'failed',
            error: error instanceof Error ? error.message : 'Upload failed.',
          });
        }
      }
    } finally {
      setIsUploading(false);
    }

    // Keep the dialog open when something failed so the user can retry it.
    if (failures === 0 && latestTaskId) {
      await onUploadSuccess(latestTaskId);
    }
  };

  useImperativeHandle(ref, () => ({ start: () => void startUploads() }));

  return (
    <div className="flex flex-col gap-3">
      <div
        className={cn(
          'flex flex-col items-center gap-1.5 rounded-xl border-[1.5px] border-dashed px-4 py-7 text-center transition-colors',
          isDragging ? 'border-stone-900 bg-stone-50' : 'border-stone-300',
          isUploading && 'pointer-events-none opacity-60',
        )}
        onDragOver={(event) => {
          event.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setIsDragging(false);
          addFiles(Array.from(event.dataTransfer.files));
        }}
      >
        <Upload className="h-6 w-6 text-stone-500" />
        <p className="font-medium text-stone-900">Drop audio or video files here</p>
        <p className="text-sm text-stone-600">
          or{' '}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="font-medium text-stone-900 underline underline-offset-2"
          >
            browse
          </button>
          {' '}· MP3, WAV, M4A, MP4, MOV and more
        </p>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={MEDIA_FILE_ACCEPT}
          className="hidden"
          onChange={(event) => {
            addFiles(Array.from(event.target.files || []));
            event.target.value = '';
          }}
        />
      </div>

      {items.length > 0 ? (
        <ul className="divide-y divide-stone-200 rounded-xl border border-stone-200">
          {items.map((item) => (
            <li key={item.id} className="flex items-center gap-3 px-3.5 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-stone-900">{item.file.name}</p>
                {item.state.kind === 'uploading' ? (
                  <div className="mt-2 h-1 rounded-full bg-stone-100">
                    <div
                      className="h-1 rounded-full bg-stone-900 transition-[width] duration-300"
                      style={{ width: `${item.state.percent}%` }}
                    />
                  </div>
                ) : null}
                <p
                  className={cn(
                    'mt-1 truncate text-xs',
                    item.state.kind === 'failed' ? 'text-red-700' : 'text-stone-500',
                  )}
                >
                  {describeProgress(item)}
                </p>
              </div>
              {item.state.kind === 'done' ? (
                <Check className="h-4 w-4 shrink-0 text-emerald-700" aria-label="Uploaded" />
              ) : item.state.kind !== 'uploading' && !isUploading ? (
                <button
                  type="button"
                  onClick={() => setItems((current) => current.filter((entry) => entry.id !== item.id))}
                  aria-label={`Remove ${item.file.name}`}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-stone-500 hover:bg-stone-100"
                >
                  <X className="h-4 w-4" />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
