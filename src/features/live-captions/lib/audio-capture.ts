/**
 * Captures meeting audio for live captions: the audio of a browser tab (the meeting) and,
 * optionally, the microphone (you). Both are mixed and delivered as 16 kHz mono PCM16 frames of
 * ~100 ms, the format the live caption server expects.
 */

const SAMPLE_RATE = 16000;
const FRAME_SAMPLES = 1600; // 100 ms

// Runs on the audio rendering thread: Float32 -> Int16, batched into 100 ms frames.
const WORKLET_SOURCE = `
class PcmCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.frame = new Int16Array(${FRAME_SAMPLES});
    this.length = 0;
  }
  process(inputs) {
    const channels = inputs[0];
    if (!channels || channels.length === 0) return true;
    const samples = channels[0].length;
    for (let i = 0; i < samples; i += 1) {
      let value = 0;
      for (let c = 0; c < channels.length; c += 1) value += channels[c][i];
      value /= channels.length;
      value = Math.max(-1, Math.min(1, value));
      this.frame[this.length++] = value < 0 ? value * 0x8000 : value * 0x7fff;
      if (this.length === this.frame.length) {
        this.port.postMessage(this.frame.buffer, [this.frame.buffer]);
        this.frame = new Int16Array(${FRAME_SAMPLES});
        this.length = 0;
      }
    }
    return true;
  }
}
registerProcessor('pcm-capture', PcmCaptureProcessor);
`;

export class CaptureError extends Error {
  constructor(
    readonly code: 'no_tab_audio' | 'cancelled' | 'unsupported' | 'microphone_denied',
    message: string,
  ) {
    super(message);
  }
}

export interface AudioCapture {
  stop: () => void;
}

export interface CaptureOptions {
  /** Share a browser tab and capture its audio (the meeting). */
  includeTab: boolean;
  /** Also capture the microphone (your own voice). */
  includeMicrophone: boolean;
  onFrame: (pcm: ArrayBuffer) => void;
  /** The user ended tab sharing from the browser's own controls. */
  onSourceEnded: () => void;
}

export async function startAudioCapture(options: CaptureOptions): Promise<AudioCapture> {
  if (!options.includeTab && !options.includeMicrophone) {
    throw new CaptureError('unsupported', 'Choose at least one audio source.');
  }
  if (typeof AudioWorkletNode === 'undefined' || !navigator.mediaDevices) {
    throw new CaptureError('unsupported', 'This browser cannot capture audio for live captions.');
  }

  const streams: MediaStream[] = [];
  const stopStreams = () => streams.forEach((stream) => stream.getTracks().forEach((track) => track.stop()));

  try {
    if (options.includeTab) {
      if (!navigator.mediaDevices.getDisplayMedia) {
        throw new CaptureError('unsupported', 'This browser cannot share tab audio. Use desktop Chrome or Edge.');
      }
      let display: MediaStream;
      try {
        display = await navigator.mediaDevices.getDisplayMedia({
          // Chrome only offers tab audio together with video; the video is not used.
          video: true,
          audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
          // Chrome hints: list tabs first, keep this app's own tab out of the picker.
          preferCurrentTab: false,
          selfBrowserSurface: 'exclude',
          systemAudio: 'include',
        } as DisplayMediaStreamOptions);
      } catch (error) {
        throw new CaptureError('cancelled', error instanceof Error ? error.message : 'Sharing was cancelled.');
      }
      streams.push(display);
      if (display.getAudioTracks().length === 0) {
        throw new CaptureError(
          'no_tab_audio',
          'No audio was shared. Share the meeting\'s Chrome tab and turn on "Also share tab audio".',
        );
      }
      display.getTracks().forEach((track) => track.addEventListener('ended', options.onSourceEnded));
    }

    if (options.includeMicrophone) {
      try {
        streams.push(await navigator.mediaDevices.getUserMedia({
          // Echo cancellation keeps the meeting audio playing from your speakers out of the mic.
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        }));
      } catch (error) {
        throw new CaptureError('microphone_denied', error instanceof Error ? error.message : 'Microphone access was denied.');
      }
    }

    // The context resamples every source to 16 kHz for us.
    const context = new AudioContext({ sampleRate: SAMPLE_RATE });
    const moduleUrl = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: 'application/javascript' }));
    try {
      await context.audioWorklet.addModule(moduleUrl);
    } finally {
      URL.revokeObjectURL(moduleUrl);
    }

    const processor = new AudioWorkletNode(context, 'pcm-capture', { channelCount: 1, channelCountMode: 'explicit' });
    processor.port.onmessage = (event: MessageEvent<ArrayBuffer>) => options.onFrame(event.data);
    for (const stream of streams) {
      const audioTracks = stream.getAudioTracks();
      if (audioTracks.length > 0) {
        // Every source connected to the same input is summed: the meeting and your voice mix.
        context.createMediaStreamSource(new MediaStream(audioTracks)).connect(processor);
      }
    }
    // A worklet only runs while connected to the output; route it there silently.
    const mute = context.createGain();
    mute.gain.value = 0;
    processor.connect(mute).connect(context.destination);
    if (context.state === 'suspended') await context.resume();

    return {
      stop: () => {
        processor.port.onmessage = null;
        stopStreams();
        void context.close();
      },
    };
  } catch (error) {
    stopStreams();
    throw error;
  }
}
