import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, Download, Loader2, Mic, RefreshCw, Square, Trash2 } from 'lucide-react';
import { apiFetch } from '@/api';
import { formatTime, LANGUAGE_OPTIONS } from '@/lib/utils';
import { useAppDataContext } from '@/contexts/AppDataContext';
import { RECORDING_NAVIGATION_EVENT, useRecordingDraft } from '@/features/recording-draft/model/recording-draft-context';

function formatFileSize(bytes: number) {
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function RecordPage({
  onUploadSuccess,
}: {
  onUploadSuccess: (taskId?: string) => void | Promise<void>;
}) {
  const { notebooks, tags: allTags, capabilities, userSettings } = useAppDataContext();
  const { pendingRecording, setPendingRecording } = useRecordingDraft();
  const [isRecording, setIsRecording] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [selectedNotebookId, setSelectedNotebookId] = useState('');
  const [tags, setTags] = useState('');
  const [provider, setProvider] = useState('');
  const [language, setLanguage] = useState(userSettings?.parseLanguage || 'auto');
  const [recordingUrl, setRecordingUrl] = useState('');
  const [uploadError, setUploadError] = useState('');
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const discardRecordingRef = useRef(false);
  const uploadAttemptRef = useRef(0);
  const uploadAbortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setLanguage(userSettings?.parseLanguage || 'auto');
  }, [userSettings?.parseLanguage]);

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
    formData.append('language', language);
    formData.append('diarization', String(userSettings?.enableDiarization !== false));
    formData.append('sourceType', 'record');
    if (selectedNotebookId) {
      formData.append('notebookId', selectedNotebookId);
    }
    if (tags.trim()) {
      formData.append('tags', tags);
    }
    if (provider) {
      formData.append('provider', provider);
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
    setTags('');

    try {
      await onUploadSuccess(taskId);
    } catch (error) {
      console.error('Recording uploaded, but the task list could not be refreshed:', error);
      window.alert('Recording uploaded successfully, but the task list could not be refreshed. Please refresh the page.');
    }
  }, [language, onUploadSuccess, provider, selectedNotebookId, tags, userSettings?.enableDiarization]);

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
  }, []);

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
    if (window.confirm('Discard this recording? It cannot be recovered after you leave this page.')) {
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

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
      <h2 className="text-lg font-semibold text-slate-900 mb-4">Record Audio</h2>
      <div className="flex flex-col items-center justify-center p-8 bg-slate-50 rounded-xl border border-slate-200 min-h-[240px]">
        {pendingRecording ? (
          <div className="flex w-full max-w-md flex-col items-center text-center">
            {isUploading ? (
              <Loader2 className="mb-4 h-10 w-10 animate-spin text-indigo-500" />
            ) : uploadError ? (
              <AlertCircle className="mb-4 h-10 w-10 text-amber-500" />
            ) : null}
            <p className="text-sm font-semibold text-slate-800">{pendingRecording.name}</p>
            <p className="mt-1 text-xs text-slate-500">{formatFileSize(pendingRecording.size)}</p>
            {recordingUrl ? (
              <audio className="mt-4 w-full" controls src={recordingUrl} preload="metadata" />
            ) : null}
            <p className={uploadError ? 'mt-4 text-sm text-amber-700' : 'mt-4 text-sm text-slate-600'}>
              {isUploading
                ? 'Uploading recording... Keep this page open.'
                : uploadError
                  ? `Upload failed: ${uploadError}`
                  : 'Recording is ready to upload.'}
            </p>
            {!isUploading && uploadError ? (
              <p className="mt-1 text-xs text-slate-500">
                The recording is still available on this page. If the upload reached the server before the connection failed, check Recordings before retrying.
              </p>
            ) : null}
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              {!isUploading ? (
                <button
                  type="button"
                  onClick={() => void queueRecording(pendingRecording)}
                  className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
                >
                  <RefreshCw className="h-4 w-4" />
                  Retry upload
                </button>
              ) : null}
              <a
                href={recordingUrl}
                download={pendingRecording.name}
                className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                <Download className="h-4 w-4" />
                Download
              </a>
              {!isUploading ? (
                <button
                  type="button"
                  onClick={confirmDiscard}
                  className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50"
                >
                  <Trash2 className="h-4 w-4" />
                  Discard
                </button>
              ) : null}
            </div>
          </div>
        ) : (
          <>
            <div className="text-4xl font-mono font-light text-slate-700 mb-8 tracking-wider">{formatTime(recordingTime)}</div>
            {isRecording ? (
              <button
                onClick={stopRecording}
                className="w-20 h-20 bg-red-500 hover:bg-red-600 rounded-full flex items-center justify-center shadow-lg shadow-red-500/30 transition-all hover:scale-105 active:scale-95"
              >
                <Square className="w-8 h-8 text-white fill-current" />
              </button>
            ) : (
              <button
                onClick={() => void startRecording()}
                className="w-20 h-20 bg-indigo-600 hover:bg-indigo-700 rounded-full flex items-center justify-center shadow-lg shadow-indigo-600/30 transition-all hover:scale-105 active:scale-95"
              >
                <Mic className="w-8 h-8 text-white" />
              </button>
            )}
            <p className="text-sm text-slate-500 mt-6">{isRecording ? 'Recording in progress...' : 'Click to start recording'}</p>
            {!isRecording ? (
              <p className="mt-2 text-xs text-slate-400">Important recordings can be downloaded before leaving this page.</p>
            ) : null}
          </>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 mt-4">
        <label className="block">
          <span className="text-sm font-medium text-slate-700">Provider</span>
          <select
            value={provider}
            onChange={(event) => setProvider(event.target.value)}
            className="w-full mt-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="">
              Default
            </option>
            {capabilities?.transcription.providers.map((item) => (
              <option key={item.id} value={item.id} disabled={!item.configured}>
                {item.label}{item.configured ? '' : ' (Not configured)'}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="text-sm font-medium text-slate-700">Language</span>
          <select
            value={language}
            onChange={(event) => setLanguage(event.target.value)}
            className="w-full mt-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            {LANGUAGE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="text-sm font-medium text-slate-700">Notebook</span>
          <select
            value={selectedNotebookId}
            onChange={(event) => setSelectedNotebookId(event.target.value)}
            className="w-full mt-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="">Unassigned</option>
            {notebooks.map((notebook) => (
              <option key={notebook.id} value={notebook.id}>
                {notebook.name}
              </option>
            ))}
          </select>
        </label>

        <div className="block">
          <span className="text-sm font-medium text-slate-700">Tags</span>
          <input
            type="text"
            value={tags}
            onChange={(event) => setTags(event.target.value)}
            placeholder="customer call, weekly sync"
            className="w-full mt-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          {allTags.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1.5">
              {allTags.slice(0, 6).map((t) => (
                <button
                  key={t.name}
                  type="button"
                  onClick={() => setTags((prev) => {
                    const current = prev.split(',').map((s) => s.trim()).filter(Boolean);
                    return current.includes(t.name) ? prev : [...current, t.name].join(', ');
                  })}
                  className="text-[10px] text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full hover:bg-indigo-50 hover:text-indigo-600 transition-colors"
                >
                  #{t.name}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
