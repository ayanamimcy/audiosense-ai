import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import WebSocket, { type RawData } from 'ws';
import config from '../config.js';
import logger from '../shared/logger.js';
import { isLlmConfigured, translateLiveCaption } from '../ai/llm.js';
import { getUserSettings } from '../settings/settings.js';
import { createUploadTask } from '../tasks/upload-service.js';
import {
  countProcessingJobs,
  deleteLiveSession,
  insertLiveSession,
  touchLiveSession,
} from '../../database/repositories/live-sessions-repository.js';
import {
  buildWavHeader,
  chooseTranslationTarget,
  detectCaptionLanguage,
  normalizeLiveLanguage,
  pcmBytesToMs,
  WAV_HEADER_BYTES,
  type LiveLanguage,
} from './live-caption-utils.js';

const log = logger.child('live-captions');

const HEARTBEAT_MS = 10_000;
/** Waiting for the runtime to transcribe the last utterance after "stop". */
const FLUSH_TIMEOUT_MS = 40_000;
const TRANSLATION_DRAIN_TIMEOUT_MS = 20_000;
/** Translation context: this many preceding captions. */
const TRANSLATION_CONTEXT = 3;
/** Shorter recordings are not kept (an accidental start/stop). */
const MIN_SAVED_AUDIO_MS = 2000;

export interface LiveCaptionUser {
  id: string;
}

/** Messages the browser sends. Audio arrives as binary frames of 16 kHz PCM16 mono. */
type ClientMessage =
  | { type: 'start'; language?: string; translate?: boolean; notebookId?: string | null; title?: string }
  | { type: 'stop' };

type RuntimeMessage = { type?: string; data?: Record<string, unknown> };

/**
 * One live captioning session: browser <-> this server <-> local audio runtime (/ws/live).
 *
 * - Audio from the browser is forwarded to the runtime and appended to a WAV file.
 * - Interim text and finalized sentences come back from the runtime; finalized sentences are
 *   translated (Chinese <-> Japanese) in order, with the previous sentences as context.
 * - While running, a heartbeat row in live_sessions keeps the worker from starting new jobs.
 * - When the session ends (stop or disconnect), the WAV becomes a normal recording, so the
 *   full pipeline (accurate transcript, speakers, summary) runs on the meeting afterwards.
 */
export class LiveCaptionSession {
  private readonly id = uuidv4();
  private state: 'idle' | 'running' | 'stopping' | 'ended' = 'idle';
  private language: LiveLanguage = 'auto';
  private translate = false;
  private notebookId: string | null = null;
  private title = '';
  private runtime: WebSocket | null = null;
  private runtimeStopped: (() => void) | null = null;
  private audioFile: fs.WriteStream | null = null;
  private audioFilename = '';
  private audioBytes = 0;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private captionCount = 0;
  private readonly recentCaptions: string[] = [];
  private translationChain: Promise<void> = Promise.resolve();
  private llmSettings: Awaited<ReturnType<typeof getUserSettings>> | null = null;

  constructor(
    private readonly client: WebSocket,
    private readonly user: LiveCaptionUser,
  ) {
    client.on('message', (data, isBinary) => {
      if (isBinary) {
        this.handleAudio(data);
      } else {
        void this.handleClientMessage(data);
      }
    });
    client.on('close', () => {
      void this.end();
    });
    client.on('error', (error) => {
      log.warn('Live caption client socket error', { error: error.message });
    });
  }

  private send(message: Record<string, unknown>) {
    if (this.client.readyState === WebSocket.OPEN) {
      this.client.send(JSON.stringify(message));
    }
  }

  private async handleClientMessage(data: RawData) {
    let message: ClientMessage;
    try {
      message = JSON.parse(data.toString()) as ClientMessage;
    } catch {
      this.send({ type: 'error', message: 'Invalid message.' });
      return;
    }

    if (message.type === 'start') {
      await this.start(message);
    } else if (message.type === 'stop') {
      await this.end();
    }
  }

  private async start(options: Extract<ClientMessage, { type: 'start' }>) {
    if (this.state !== 'idle') return;
    this.state = 'running';
    this.language = normalizeLiveLanguage(options.language);
    this.notebookId = options.notebookId ? String(options.notebookId) : null;
    this.title = String(options.title || '').trim().slice(0, 200);

    // Record the meeting even if captions fail: the audio becomes a recording either way.
    // Opened before any await, because audio frames start arriving right after "start".
    this.audioFilename = `${uuidv4()}.wav`;
    this.audioFile = fs.createWriteStream(path.join(config.upload.dir, this.audioFilename));
    this.audioFile.write(Buffer.alloc(WAV_HEADER_BYTES)); // placeholder, rewritten at the end

    this.llmSettings = await getUserSettings(this.user.id);
    this.translate = Boolean(options.translate);
    if (this.translate && !isLlmConfigured(this.llmSettings)) {
      this.translate = false;
      this.send({ type: 'notice', code: 'translation_unavailable' });
    }

    await insertLiveSession({ id: this.id, userId: this.user.id, startedAt: Date.now() });
    this.heartbeat = setInterval(() => {
      void touchLiveSession(this.id).catch((error) => {
        log.warn('Live session heartbeat failed', { error: error instanceof Error ? error.message : String(error) });
      });
    }, HEARTBEAT_MS);

    if (await countProcessingJobs() > 0) {
      // A job already running holds the runtime until it finishes; new ones wait for us.
      this.send({ type: 'notice', code: 'batch_running' });
    }

    try {
      await this.connectRuntime();
      this.send({ type: 'ready', translate: this.translate });
    } catch (error) {
      log.warn('Live captions unavailable', { error: error instanceof Error ? error.message : String(error) });
      this.send({
        type: 'notice',
        code: 'captions_unavailable',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private connectRuntime() {
    if (!config.localAudioEngine.enabled) {
      return Promise.reject(new Error('The local transcription runtime is not enabled.'));
    }
    const url = `${config.localAudioEngine.baseUrl.replace(/^http/, 'ws')}/ws/live`;

    return new Promise<void>((resolve, reject) => {
      const runtime = new WebSocket(url);
      let started = false;
      const fail = (error: Error) => {
        if (!started) {
          started = true;
          reject(error);
        }
      };

      runtime.on('message', (data) => {
        let message: RuntimeMessage;
        try {
          message = JSON.parse(data.toString()) as RuntimeMessage;
        } catch {
          return;
        }

        if (message.type === 'connected' && !started) {
          started = true;
          this.runtime = runtime;
          runtime.send(JSON.stringify({
            type: 'start',
            data: { config: { language: this.language === 'auto' ? '' : this.language } },
          }));
          resolve();
          return;
        }
        if (message.type === 'error' && !started) {
          fail(new Error(String(message.data?.message || 'The transcription runtime refused the session.')));
          runtime.close();
          return;
        }
        this.handleRuntimeMessage(message);
      });
      runtime.on('error', (error) => fail(error));
      runtime.on('close', () => {
        fail(new Error('The transcription runtime closed the connection.'));
        if (this.runtime === runtime) {
          this.runtime = null;
          this.runtimeStopped?.();
          if (this.state === 'running') {
            this.send({ type: 'notice', code: 'captions_unavailable', message: 'The transcription runtime disconnected.' });
          }
        }
      });
    });
  }

  private handleRuntimeMessage(message: RuntimeMessage) {
    const data = message.data || {};
    switch (message.type) {
      case 'realtime': {
        const text = String(data.text || '').trim();
        if (text && this.state === 'running') this.send({ type: 'partial', text });
        break;
      }
      case 'sentence': {
        const text = String(data.text || '').trim();
        if (text) this.handleSentence(text, typeof data.language === 'string' ? data.language : null);
        break;
      }
      case 'stopped':
        this.runtimeStopped?.();
        break;
      case 'error':
        this.send({ type: 'notice', code: 'runtime_error', message: String(data.message || '') });
        break;
      default:
        break;
    }
  }

  private handleSentence(text: string, recognizedLanguage: string | null) {
    const id = `c${++this.captionCount}`;
    const language = detectCaptionLanguage(text, recognizedLanguage);
    this.send({ type: 'final', id, text, language, offsetMs: pcmBytesToMs(this.audioBytes) });

    const context = this.recentCaptions.slice(-TRANSLATION_CONTEXT);
    this.recentCaptions.push(text);
    if (this.recentCaptions.length > TRANSLATION_CONTEXT) this.recentCaptions.shift();

    if (!this.translate) return;
    const targetLanguage = chooseTranslationTarget(language);
    // One at a time, in caption order, so translations arrive in order and context is right.
    this.translationChain = this.translationChain.then(async () => {
      try {
        const translation = await translateLiveCaption(
          { text, sourceLanguage: language, targetLanguage, context },
          this.llmSettings || undefined,
          { userId: this.user.id },
        );
        this.send({ type: 'translation', id, text: translation.trim(), language: targetLanguage });
      } catch (error) {
        log.warn('Live caption translation failed', { error: error instanceof Error ? error.message : String(error) });
        this.send({ type: 'translation_error', id });
      }
    });
  }

  private handleAudio(data: RawData) {
    if (this.state !== 'running') return;
    const chunk = Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data as ArrayBuffer);
    // PCM16 samples are 2 bytes; an odd-length frame would misalign everything after it.
    if (chunk.length === 0 || chunk.length % 2 !== 0) return;

    this.audioBytes += chunk.length;
    this.audioFile?.write(chunk);
    if (this.runtime?.readyState === WebSocket.OPEN) {
      this.runtime.send(chunk);
    }
  }

  /** Ends the session (stop or disconnect): flush captions, save the recording, clean up. */
  async end() {
    if (this.state === 'ended' || this.state === 'stopping') return;
    const wasRunning = this.state === 'running';
    this.state = 'stopping';

    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;

    await this.stopRuntime();
    await Promise.race([this.translationChain, delay(TRANSLATION_DRAIN_TIMEOUT_MS)]);
    await deleteLiveSession(this.id).catch(() => {});

    if (wasRunning) {
      const taskId = await this.saveRecording();
      if (taskId) this.send({ type: 'saved', taskId });
    }

    this.state = 'ended';
    this.send({ type: 'ended' });
    if (this.client.readyState === WebSocket.OPEN) this.client.close();
  }

  private async stopRuntime() {
    const runtime = this.runtime;
    if (!runtime || runtime.readyState !== WebSocket.OPEN) return;

    // The runtime transcribes the utterance in progress, then reports "stopped".
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, FLUSH_TIMEOUT_MS);
      this.runtimeStopped = () => {
        clearTimeout(timer);
        resolve();
      };
      runtime.send(JSON.stringify({ type: 'stop' }));
    });
    this.runtimeStopped = null;
    this.runtime = null;
    runtime.close();
  }

  private async saveRecording() {
    const file = this.audioFile;
    this.audioFile = null;
    if (!file) return null;
    await new Promise<void>((resolve) => file.end(resolve));

    const filePath = path.join(config.upload.dir, this.audioFilename);
    if (pcmBytesToMs(this.audioBytes) < MIN_SAVED_AUDIO_MS) {
      await fs.promises.unlink(filePath).catch(() => {});
      return null;
    }

    try {
      const handle = await fs.promises.open(filePath, 'r+');
      try {
        await handle.write(buildWavHeader(this.audioBytes), 0, WAV_HEADER_BYTES, 0);
      } finally {
        await handle.close();
      }

      return await createUploadTask({
        userId: this.user.id,
        file: {
          filename: this.audioFilename,
          originalname: this.title || `Live captions ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`,
          mimetype: 'audio/wav',
          size: WAV_HEADER_BYTES + this.audioBytes,
        },
        body: {
          language: this.language,
          sourceType: 'live',
          notebookId: this.notebookId || undefined,
        },
      });
    } catch (error) {
      log.error('Failed to save live caption recording', { error: error instanceof Error ? error.message : String(error) });
      this.send({ type: 'notice', code: 'save_failed', message: error instanceof Error ? error.message : String(error) });
      return null;
    }
  }
}

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}
