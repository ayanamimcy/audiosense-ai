import { useCallback, useEffect, useRef, useState } from 'react';
import { CaptureError, startAudioCapture, type AudioCapture } from '../lib/audio-capture';

export type LiveStatus = 'idle' | 'connecting' | 'live' | 'stopping' | 'ended';

export interface LiveCaption {
  id: string;
  text: string;
  language: string | null;
  offsetMs: number;
  translation: string | null;
  translationState: 'off' | 'pending' | 'done' | 'failed';
}

export interface LiveStartOptions {
  includeTab: boolean;
  includeMicrophone: boolean;
  language: 'auto' | 'zh' | 'ja';
  translate: boolean;
  notebookId: string | null;
  title: string;
}

export type LiveNotice = 'batch_running' | 'translation_unavailable' | 'captions_unavailable' | 'runtime_error' | 'save_failed';

type ServerMessage =
  | { type: 'ready'; translate: boolean }
  | { type: 'partial'; text: string }
  | { type: 'final'; id: string; text: string; language: string | null; offsetMs: number }
  | { type: 'translation'; id: string; text: string }
  | { type: 'translation_error'; id: string }
  | { type: 'notice'; code: LiveNotice; message?: string }
  | { type: 'saved'; taskId: string }
  | { type: 'ended' }
  | { type: 'error'; message: string };

function liveSocketUrl() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/api/live/ws`;
}

/**
 * Drives one live caption session: captures audio, streams it to the server and collects
 * interim text, finalized captions and their translations.
 */
export function useLiveCaptions() {
  const [status, setStatus] = useState<LiveStatus>('idle');
  const [captions, setCaptions] = useState<LiveCaption[]>([]);
  const [partial, setPartial] = useState('');
  const [notices, setNotices] = useState<Array<{ code: LiveNotice; message?: string }>>([]);
  const [error, setError] = useState<string | null>(null);
  const [savedTaskId, setSavedTaskId] = useState<string | null>(null);
  const [translating, setTranslating] = useState(false);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const captureRef = useRef<AudioCapture | null>(null);
  const statusRef = useRef<LiveStatus>('idle');
  statusRef.current = status;
  // Bumped to cancel a start that is still waiting (e.g. in Chrome's tab-sharing dialog).
  const startIdRef = useRef(0);

  const stopCapture = useCallback(() => {
    captureRef.current?.stop();
    captureRef.current = null;
  }, []);

  const stop = useCallback(() => {
    if (statusRef.current !== 'live' && statusRef.current !== 'connecting') return;
    stopCapture();
    setPartial('');
    const socket = socketRef.current;
    if (statusRef.current === 'live' && socket?.readyState === WebSocket.OPEN) {
      setStatus('stopping');
      socket.send(JSON.stringify({ type: 'stop' }));
      return;
    }
    // Still starting: cancel it. Nothing was recorded yet.
    startIdRef.current += 1;
    socketRef.current = null;
    socket?.close();
    statusRef.current = 'idle';
    setStatus('idle');
  }, [stopCapture]);

  const handleMessage = useCallback((message: ServerMessage) => {
    switch (message.type) {
      case 'ready':
        setTranslating(message.translate);
        break;
      case 'partial':
        setPartial(message.text);
        break;
      case 'final':
        setPartial('');
        setCaptions((current) => [...current, {
          id: message.id,
          text: message.text,
          language: message.language,
          offsetMs: message.offsetMs,
          translation: null,
          translationState: 'pending',
        }]);
        break;
      case 'translation':
        setCaptions((current) => current.map((caption) => (
          caption.id === message.id ? { ...caption, translation: message.text, translationState: 'done' } : caption
        )));
        break;
      case 'translation_error':
        setCaptions((current) => current.map((caption) => (
          caption.id === message.id ? { ...caption, translationState: 'failed' } : caption
        )));
        break;
      case 'notice':
        if (message.code === 'translation_unavailable') setTranslating(false);
        setNotices((current) => (current.some((notice) => notice.code === message.code)
          ? current
          : [...current, { code: message.code, message: message.message }]));
        break;
      case 'saved':
        setSavedTaskId(message.taskId);
        break;
      case 'ended':
        setStatus('ended');
        break;
      case 'error':
        setError(message.message);
        break;
      default:
        break;
    }
  }, []);

  const start = useCallback(async (options: LiveStartOptions) => {
    if (statusRef.current === 'connecting' || statusRef.current === 'live' || statusRef.current === 'stopping') return;
    const startId = ++startIdRef.current;
    statusRef.current = 'connecting';
    setStatus('connecting');
    setCaptions([]);
    setPartial('');
    setNotices([]);
    setError(null);
    setSavedTaskId(null);
    setTranslating(options.translate);

    // Ask for the tab first, while the click still counts as a user gesture; frames captured
    // before the socket opens are queued.
    const pending: ArrayBuffer[] = [];
    let socket: WebSocket | null = null;
    let capture: AudioCapture;
    try {
      capture = await startAudioCapture({
        includeTab: options.includeTab,
        includeMicrophone: options.includeMicrophone,
        onFrame: (frame) => {
          if (socket?.readyState === WebSocket.OPEN) socket.send(frame);
          else pending.push(frame);
        },
        onSourceEnded: () => stop(),
      });
    } catch (captureError) {
      if (startIdRef.current !== startId) return;
      setStatus('idle');
      setError(captureError instanceof CaptureError || captureError instanceof Error
        ? captureError.message
        : 'Could not capture audio.');
      return;
    }
    if (startIdRef.current !== startId) {
      // Stopped while the sharing dialog was open.
      capture.stop();
      return;
    }
    captureRef.current = capture;

    socket = new WebSocket(liveSocketUrl());
    socket.binaryType = 'arraybuffer';
    socketRef.current = socket;
    socket.onopen = () => {
      socket!.send(JSON.stringify({ type: 'start', ...options }));
      pending.splice(0).forEach((frame) => socket!.send(frame));
      setStartedAt(Date.now());
      setStatus('live');
    };
    socket.onmessage = (event) => {
      try {
        handleMessage(JSON.parse(String(event.data)) as ServerMessage);
      } catch {
        // ignore malformed messages
      }
    };
    const ownSocket = socket;
    socket.onclose = () => {
      // A start cancelled from the sharing dialog closes its socket on purpose.
      if (socketRef.current !== ownSocket) return;
      socketRef.current = null;
      if (statusRef.current === 'connecting' || statusRef.current === 'live') {
        // The server saves what it received when a connection drops.
        stopCapture();
        setError('The connection to the server was lost. The audio received so far is saved as a recording.');
      }
      if (statusRef.current !== 'idle') setStatus('ended');
    };
  }, [handleMessage, stop, stopCapture]);

  // Leaving the page ends the session (the server saves the recording).
  useEffect(() => () => {
    captureRef.current?.stop();
    const socket = socketRef.current;
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'stop' }));
  }, []);

  return { status, captions, partial, notices, error, savedTaskId, translating, startedAt, start, stop };
}
