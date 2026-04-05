import React, { useEffect, useRef, useState } from 'react';
import { Loader2, Mic, Square } from 'lucide-react';
import { apiFetch } from '../api';
import { formatTime, getLocalSetting, LANGUAGE_OPTIONS } from '../lib/utils';
import { useAppDataContext } from '../contexts/AppDataContext';

export function RecordPage({
  onUploadSuccess,
}: {
  onUploadSuccess: (taskId?: string) => void | Promise<void>;
}) {
  const { notebooks, tags: allTags, capabilities, userSettings } = useAppDataContext();
  const [isRecording, setIsRecording] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [selectedNotebookId, setSelectedNotebookId] = useState('');
  const [tags, setTags] = useState('');
  const [provider, setProvider] = useState('');
  const [language, setLanguage] = useState(() => getLocalSetting('parseLanguage', 'auto'));
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);

  const clearRecordingTimer = () => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const uploadRecording = async (file: File) => {
    const formData = new FormData();
    formData.append('audio', file);
    formData.append('language', language);
    formData.append('diarization', getLocalSetting('enableDiarization', 'true'));
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

    const res = await apiFetch('/api/upload', { method: 'POST', body: formData });
    const payload = await res.json().catch(() => null);
    if (!res.ok) {
      throw new Error(payload?.error || 'Failed to queue recording.');
    }

    setTags('');
    await onUploadSuccess(
      payload && typeof payload === 'object' && 'taskId' in payload
        ? String((payload as { taskId?: string }).taskId || '')
        : undefined,
    );
  };

  const startRecording = async () => {
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
        if (chunksRef.current.length === 0) {
          setIsUploading(false);
          return;
        }

        const blob = new Blob(chunksRef.current, { type: mimeType });
        const ext = mimeType.includes('mp4') ? 'm4a' : 'webm';
        const file = new File([blob], `recording-${Date.now()}.${ext}`, { type: mimeType });

        setIsUploading(true);
        try {
          await uploadRecording(file);
        } catch (error: unknown) {
          console.error('Upload error:', error);
          alert(error instanceof Error ? error.message : 'Failed to queue recording.');
        } finally {
          setIsUploading(false);
        }
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
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      clearRecordingTimer();
    }
  };

  useEffect(() => {
    return () => {
      clearRecordingTimer();
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
      }
    };
  }, []);

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
      <h2 className="text-lg font-semibold text-slate-900 mb-4">Record Audio</h2>
      <div className="flex flex-col items-center justify-center p-8 bg-slate-50 rounded-xl border border-slate-200 min-h-[240px]">
        {isUploading ? (
          <div className="flex flex-col items-center">
            <Loader2 className="w-12 h-12 text-indigo-500 animate-spin mb-4" />
            <p className="text-sm font-medium text-slate-600">Queuing recording...</p>
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
