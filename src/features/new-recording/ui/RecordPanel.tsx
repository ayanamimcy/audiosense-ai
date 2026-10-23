import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, Download, Loader2, Mic, RefreshCw, Square, Trash2 } from 'lucide-react';
import { apiFetch } from '@/shared/api/base';
import { formatTime } from '@/shared/lib/format';
import { cn } from '@/shared/lib/cn';
import { useAppDataContext } from '@/app/providers/app-data-context';
import { RECORDING_NAVIGATION_EVENT, useRecordingDraft } from '@/features/recording-draft/model/recording-draft-context';
import { buildUploadMetadata, type RecordingOptionsValue } from './RecordingOptions';

export type RecordPanelBusyState = 'recording' | 'uploading' | null;

function formatFileSize(bytes: number) {
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function RecordPanel({
  options,
  onBusyChange,
  onUploadSuccess,
}: {
  options: RecordingOptionsValue;
  onBusyChange: (state: RecordPanelBusyState) => void;
  onUploadSuccess: (taskId?: string) => void | Promise<void>;
}) {
  const { userSettings } = useAppDataContext();
  const { pendingRecording, setPendingRecording } = useRecordingDraft();
  const [isRecording, setIsRecording] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [recordingUrl, setRecordingUrl] = useState('');
  const [uploadError, setUploadError] = useState('');
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const discardRecordingRef = useRef(false);
  const uploadAttemptRef = useRef(0);
  const uploadAbortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    onBusyChange(isRecording ? 'recording' : isUploading ? 'uploading' : null);
  }, [isRecording, isUploading, onBusyChange]);

  useEffect(() => {
    if (!pendingRecording) {
      setRecordingUrl('');
      return;
    }

    const url = URL.createObjectURL(pendingRecording);
    setRecordingUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [pendingRecording]);

  const clearRecordingTimer = () => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const uploadRecording = async (file: File, signal: AbortSignal) => {
    const formData = new FormData();
    formData.append('audio', file);
    for (const [key, value] of Object.entries(buildUploadMetadata(options, userSettings, 'record'))) {
      formData.append(key, value);
    }

    const res = await apiFetch('/api/upload', { method: 'POST', body: formData, signal });
    const payload = await res.json().catch(() => null);
    if (!res.ok) {
      throw new Error(payload?.error || 'Failed to queue recording.');
    }

    const taskId = payload && typeof payload === 'object' && 'taskId' in payload
      ? String((payload as { taskId?: string }).taskId || '')
      : '';
    if (!taskId) {
      throw new Error('The server did not confirm the recording task. Check your recordings before retrying.');
    }
    return taskId;
  };

  const queueRecording = useCallback(async (file: File) => {
    if (uploadAbortControllerRef.current) return;
    const attempt = uploadAttemptRef.current + 1;
    uploadAttemptRef.current = attempt;
    const controller = new AbortController();
    uploadAbortControllerRef.current = controller;
    setIsUploading(true);
    setUploadError('');

    let taskId: string;
    try {
      taskId = await uploadRecording(file, controller.signal);
    } catch (error: unknown) {
      if (attempt !== uploadAttemptRef.current) return;
      uploadAbortControllerRef.current = null;
      console.error('Upload error:', error);
      setUploadError(
        error instanceof Error && error.name !== 'AbortError'
          ? error.message
          : 'Upload was interrupted.',
      );
      setIsUploading(false);
      return;
    }

    if (attempt !== uploadAttemptRef.current) return;
    uploadAbortControllerRef.current = null;
    setPendingRecording(null);
    setUploadError('');
    setIsUploading(false);
    setRecordingTime(0);

    try {
      await onUploadSuccess(taskId);
    } catch (error) {
      console.error('Recording uploaded, but the task list could not be refreshed:', error);
      window.alert('Recording uploaded successfully, but the task list could not be refreshed. Please refresh the page.');
    }
  }, [onUploadSuccess, options, userSettings]);

  const discardPendingRecording = useCallback(() => {
    discardRecordingRef.current = true;
    uploadAttemptRef.current += 1;
    uploadAbortControllerRef.current?.abort();
    uploadAbortControllerRef.current = null;
    chunksRef.current = [];
    setPendingRecording(null);
    setUploadError('');
    setIsUploading(false);
    setRecordingTime(0);
  }, [setPendingRecording]);

  const startRecording = async () => {
    if (pendingRecording || isUploading) {
      window.alert('Upload, download, or discard the current recording before starting a new one.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
          sampleRate: 16000,
        },
      });

      let mimeType = 'audio/webm;codecs=opus';
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        mimeType = 'audio/webm';
        if (!MediaRecorder.isTypeSupported(mimeType)) {
          mimeType = 'audio/mp4';
        }
      }

      const mediaRecorder = new MediaRecorder(stream, {
        mimeType,
        audioBitsPerSecond: 128000,
      });

      mediaRecorderRef.current = mediaRecorder;
      discardRecordingRef.current = false;
      chunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        clearRecordingTimer();
        setIsRecording(false);
        if (discardRecordingRef.current) {
          discardRecordingRef.current = false;
          chunksRef.current = [];
          return;
        }
        if (chunksRef.current.length === 0) {
          setIsUploading(false);
          return;
        }

        const blob = new Blob(chunksRef.current, { type: mimeType });
        const ext = mimeType.includes('mp4') ? 'm4a' : 'webm';
        const file = new File([blob], `recording-${Date.now()}.${ext}`, { type: mimeType });
        chunksRef.current = [];
        setPendingRecording(file);
        void queueRecording(file);
      };

      mediaRecorder.start(1000);
      setIsRecording(true);
      setRecordingTime(0);
      clearRecordingTimer();
      timerRef.current = window.setInterval(() => {
        setRecordingTime((prev) => prev + 1);
      }, 1000);
    } catch (error: unknown) {
      console.error('Error accessing microphone:', error);
      const err = error instanceof Error ? error : null;
      if (err && (err.name === 'NotAllowedError' || err.message?.includes('Permission'))) {
        alert('Microphone access was denied. Please allow microphone access in your browser settings to use this feature.');
      } else {
        alert(err?.message || 'Could not access microphone.');
      }
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
      clearRecordingTimer();
    }
  };

  const confirmDiscard = () => {
    if (window.confirm('Discard this recording? It cannot be recovered afterwards.')) {
      discardPendingRecording();
    }
  };

  useEffect(() => {
    if (!isRecording) return;

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = true;
    };
    const handleNavigationAttempt = (event: Event) => {
      const confirmed = window.confirm('A recording is in progress. Leaving now will discard it.');
      if (!confirmed) {
        event.preventDefault();
        return;
      }

      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        discardRecordingRef.current = true;
        mediaRecorderRef.current.stop();
      }
      discardPendingRecording();
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    window.addEventListener(RECORDING_NAVIGATION_EVENT, handleNavigationAttempt);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      window.removeEventListener(RECORDING_NAVIGATION_EVENT, handleNavigationAttempt);
    };
  }, [discardPendingRecording, isRecording]);

  useEffect(() => {
    return () => {
      clearRecordingTimer();
      uploadAttemptRef.current += 1;
      uploadAbortControllerRef.current?.abort();
      discardRecordingRef.current = true;
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
      }
    };
  }, []);

  if (pendingRecording) {
    return (
      <div className="flex flex-col items-center rounded-xl border border-stone-200 px-4 py-6 text-center">
        {isUploading ? (
          <Loader2 className="mb-3 h-8 w-8 animate-spin text-stone-500" />
        ) : uploadError ? (
          <AlertCircle className="mb-3 h-8 w-8 text-amber-600" />
        ) : null}
        <p className="text-sm font-medium text-stone-900">{pendingRecording.name}</p>
        <p className="mt-0.5 text-xs text-stone-500">{formatFileSize(pendingRecording.size)}</p>
        {recordingUrl ? (
          <audio className="mt-4 w-full" controls src={recordingUrl} preload="metadata" />
        ) : null}
        <p className={cn('mt-4 text-sm', uploadError ? 'text-amber-800' : 'text-stone-600')}>
          {isUploading
            ? 'Uploading recording — keep this window open.'
            : uploadError
              ? `Upload failed: ${uploadError}`
              : 'Recording is ready to upload.'}
        </p>
        {!isUploading && uploadError ? (
          <p className="mt-1 text-xs text-stone-500">
            The recording is kept in this tab until you upload or discard it. If the upload reached the server before the
            connection dropped, check your recordings before retrying.
          </p>
        ) : null}
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          {!isUploading ? (
            <button
              type="button"
              onClick={() => void queueRecording(pendingRecording)}
              className="inline-flex h-9 items-center gap-2 rounded-lg bg-stone-900 px-4 text-sm font-medium text-white hover:bg-stone-800"
            >
              <RefreshCw className="h-4 w-4" />
              Retry upload
            </button>
          ) : null}
          <a
            href={recordingUrl}
            download={pendingRecording.name}
            className="inline-flex h-9 items-center gap-2 rounded-lg border border-stone-200 bg-white px-4 text-sm font-medium text-stone-800 hover:bg-stone-50"
          >
            <Download className="h-4 w-4" />
            Download
          </a>
          {!isUploading ? (
            <button
              type="button"
              onClick={confirmDiscard}
              className="inline-flex h-9 items-center gap-2 rounded-lg px-4 text-sm font-medium text-red-700 hover:bg-red-50"
            >
              <Trash2 className="h-4 w-4" />
              Discard
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center rounded-xl border border-stone-200 px-4 py-7">
      <div className="flex items-center gap-2.5">
        {isRecording ? <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-red-600" aria-hidden="true" /> : null}
        <span className="text-4xl font-light tabular-nums tracking-wide text-stone-900">{formatTime(recordingTime)}</span>
      </div>
      <button
        type="button"
        onClick={isRecording ? stopRecording : () => void startRecording()}
        aria-label={isRecording ? 'Stop recording' : 'Start recording'}
        className={cn(
          'mt-6 flex h-16 w-16 items-center justify-center rounded-full text-white shadow-lg transition-transform hover:scale-105 active:scale-95',
          isRecording ? 'bg-red-600 shadow-red-600/25' : 'bg-stone-900 shadow-stone-900/20',
        )}
      >
        {isRecording ? <Square className="h-6 w-6 fill-current" /> : <Mic className="h-6 w-6" />}
      </button>
      <p className="mt-3 text-sm text-stone-600">
        {isRecording ? 'Recording — press stop to transcribe' : 'Press to start recording'}
      </p>
    </div>
  );
}
