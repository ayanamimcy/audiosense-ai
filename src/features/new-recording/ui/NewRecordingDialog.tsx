import { useCallback, useRef, useState } from 'react';
import { cn } from '@/shared/lib/cn';
import { Dialog } from '@/shared/ui/Dialog';
import { useAppDataContext } from '@/app/providers/app-data-context';
import {
  NEW_RECORDING_CLOSE_DESTINATION,
  RECORDING_NAVIGATION_EVENT,
} from '@/features/recording-draft/model/recording-draft-context';
import type { NewRecordingMode } from '../model/new-recording-context';
import { RecordingOptions, type RecordingOptionsValue } from './RecordingOptions';
import { RecordPanel, type RecordPanelBusyState } from './RecordPanel';
import { UploadPanel, type UploadPanelHandle } from './UploadPanel';

const MODES: { id: NewRecordingMode; label: string }[] = [
  { id: 'record', label: 'Record' },
  { id: 'upload', label: 'Upload files' },
];

export function NewRecordingDialog({
  initialMode,
  initialNotebookId,
  onClose,
  onSuccess,
}: {
  initialMode: NewRecordingMode;
  initialNotebookId: string;
  onClose: () => void;
  onSuccess: (taskId?: string) => void | Promise<void>;
}) {
  const { userSettings } = useAppDataContext();
  const [mode, setMode] = useState<NewRecordingMode>(initialMode);
  const [options, setOptions] = useState<RecordingOptionsValue>({
    notebookId: initialNotebookId,
    tags: '',
    provider: '',
    language: userSettings?.parseLanguage || 'auto',
  });
  const [recordState, setRecordState] = useState<RecordPanelBusyState>(null);
  const [uploadQueue, setUploadQueue] = useState({ readyCount: 0, isUploading: false });
  const uploadPanelRef = useRef<UploadPanelHandle>(null);

  const isUploading = recordState === 'uploading' || uploadQueue.isUploading;
  const isBusy = recordState !== null || uploadQueue.isUploading;

  const handleClose = useCallback(() => {
    if (isUploading) {
      window.alert('An upload is in progress. Keep this window open until it finishes.');
      return;
    }
    if (recordState === 'recording') {
      // RecordPanel listens for this event, confirms with the user and discards the take.
      const allowed = window.dispatchEvent(new CustomEvent(RECORDING_NAVIGATION_EVENT, {
        cancelable: true,
        detail: { destination: NEW_RECORDING_CLOSE_DESTINATION },
      }));
      if (!allowed) return;
    }
    onClose();
  }, [isUploading, onClose, recordState]);

  const handleQueueChange = useCallback((state: { readyCount: number; isUploading: boolean }) => {
    setUploadQueue((current) => (
      current.readyCount === state.readyCount && current.isUploading === state.isUploading ? current : state
    ));
  }, []);

  const footer = (
    <>
      <p className="flex-1 text-xs text-stone-600">
        {mode === 'record'
          ? 'Transcription starts automatically when you stop.'
          : uploadQueue.isUploading
            ? 'Keep this window open until uploads finish.'
            : 'Files are transcribed after they upload.'}
      </p>
      <button
        type="button"
        onClick={handleClose}
        className="h-9 rounded-lg px-3.5 text-sm font-medium text-stone-800 hover:bg-stone-200/60"
      >
        {mode === 'record' ? 'Close' : 'Cancel'}
      </button>
      {mode === 'upload' ? (
        <button
          type="button"
          onClick={() => uploadPanelRef.current?.start()}
          disabled={uploadQueue.readyCount === 0 || uploadQueue.isUploading}
          className="h-9 rounded-lg bg-stone-900 px-4 text-sm font-medium text-white hover:bg-stone-800 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {uploadQueue.isUploading
            ? 'Uploading…'
            : uploadQueue.readyCount > 1
              ? `Upload ${uploadQueue.readyCount} files`
              : 'Upload'}
        </button>
      ) : null}
    </>
  );

  return (
    <Dialog title="New recording" onClose={handleClose} footer={footer}>
      <div role="tablist" className="mb-4 grid grid-cols-2 gap-1 rounded-xl bg-stone-100 p-1">
        {MODES.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={mode === item.id}
            disabled={isBusy && mode !== item.id}
            onClick={() => setMode(item.id)}
            className={cn(
              'h-9 rounded-lg text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50',
              mode === item.id ? 'bg-white text-stone-900 shadow-sm' : 'text-stone-600 hover:text-stone-900',
            )}
          >
            {item.label}
          </button>
        ))}
      </div>

      {mode === 'record' ? (
        <RecordPanel options={options} onBusyChange={setRecordState} onUploadSuccess={onSuccess} />
      ) : (
        <UploadPanel
          ref={uploadPanelRef}
          options={options}
          onQueueChange={handleQueueChange}
          onUploadSuccess={onSuccess}
        />
      )}

      <RecordingOptions value={options} onChange={setOptions} disabled={isUploading} />
    </Dialog>
  );
}
