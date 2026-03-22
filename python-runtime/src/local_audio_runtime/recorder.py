from __future__ import annotations

import collections
import copy
import logging
import queue
import threading
import time
from typing import Any, Callable

import numpy as np

from .audio_utils import (
    float32_to_pcm16_bytes,
    normalize_audio_peak,
    pcm16_bytes_to_float32,
    resample_audio,
)
from .config import RuntimeConfig
from .model_manager import ModelManager
from .vad import VoiceActivityDetector

logger = logging.getLogger(__name__)

SAMPLE_RATE = 16000
INT16_MAX_ABS_VALUE = 32768.0


class AudioToTextRecorder:
    """Server-side audio recorder with VAD and sentence-level transcription."""

    def __init__(
        self,
        *,
        manager: ModelManager,
        config: RuntimeConfig,
        instance_name: str = "runtime_recorder",
        model_name: str | None = None,
        backend: str | None = None,
        language: str = "",
        task: str = "transcribe",
        translation_target_language: str | None = None,
        beam_size: int | None = None,
        initial_prompt: str | None = None,
        suppress_tokens: list[int] | None = None,
        on_recording_start: Callable[[], None] | None = None,
        on_recording_stop: Callable[[], None] | None = None,
        on_transcription_start: Callable[[np.ndarray], bool] | None = None,
        on_vad_start: Callable[[], None] | None = None,
        on_vad_stop: Callable[[], None] | None = None,
        on_recorded_chunk: Callable[[bytes], None] | None = None,
    ) -> None:
        self._manager = manager
        self._config = config
        self.instance_name = instance_name
        self.model_name = model_name or config.model_name
        self.backend = backend or config.backend
        self.language = language
        self.task = (task or "transcribe").strip().lower()
        self.translation_target_language = (
            translation_target_language or config.translation_target_language
        ).strip().lower()
        self.beam_size = beam_size or config.beam_size
        self.initial_prompt = initial_prompt
        self.suppress_tokens = suppress_tokens

        self.on_recording_start = on_recording_start
        self.on_recording_stop = on_recording_stop
        self.on_transcription_start = on_transcription_start
        self.on_vad_start = on_vad_start
        self.on_vad_stop = on_vad_stop
        self.on_recorded_chunk = on_recorded_chunk

        self.state = "inactive"
        self.is_recording = False
        self.is_running = True
        self.is_shut_down = False
        self.recording_start_time = 0.0
        self.recording_stop_time = 0.0
        self.speech_end_silence_start = 0.0
        self.extended_silence_start = 0.0
        self.is_trimming_silence = False

        self.audio_queue: queue.Queue[bytes] = queue.Queue()
        self.audio_buffer: collections.deque[bytes] = collections.deque(
            maxlen=int((SAMPLE_RATE // config.buffer_size) * config.pre_recording_buffer_duration),
        )
        self._buffer_size = config.buffer_size
        self.frames: list[bytes] = []
        self.audio: np.ndarray | None = None
        self._feed_buffer = bytearray()

        self.start_recording_event = threading.Event()
        self.stop_recording_event = threading.Event()
        self.shutdown_event = threading.Event()
        self.transcription_lock = threading.Lock()

        self.start_recording_on_voice_activity = False
        self.stop_recording_on_voice_deactivity = False

        self.vad = VoiceActivityDetector(config)

        self.recording_thread = threading.Thread(
            target=self._recording_worker,
            daemon=True,
            name=f"{instance_name}_worker",
        )
        self.recording_thread.start()

    def _set_state(self, state: str) -> None:
        self.state = state

    def feed_audio(self, chunk: bytes | bytearray | np.ndarray, original_sample_rate: int = SAMPLE_RATE) -> None:
        if isinstance(chunk, np.ndarray):
            audio = np.asarray(chunk, dtype=np.float32)
            if audio.ndim == 2:
                audio = np.mean(audio, axis=1)
            if original_sample_rate != SAMPLE_RATE:
                audio = resample_audio(audio, original_sample_rate, SAMPLE_RATE)
            chunk_bytes = float32_to_pcm16_bytes(audio)
        else:
            chunk_bytes = bytes(chunk)
            if original_sample_rate != SAMPLE_RATE:
                audio = pcm16_bytes_to_float32(chunk_bytes)
                audio = resample_audio(audio, original_sample_rate, SAMPLE_RATE)
                chunk_bytes = float32_to_pcm16_bytes(audio)

        self._feed_buffer += chunk_bytes
        buffer_bytes = 2 * self._buffer_size

        while len(self._feed_buffer) >= buffer_bytes:
            to_process = bytes(self._feed_buffer[:buffer_bytes])
            self._feed_buffer = self._feed_buffer[buffer_bytes:]

            if self._config.pre_vad_normalize:
                samples = np.frombuffer(to_process, dtype=np.int16).copy()
                peak = np.max(np.abs(samples))
                if peak > 0:
                    scale = (0.95 * 32767) / peak
                    if scale > 1.0:
                        samples = np.clip(samples.astype(np.float32) * scale, -32768, 32767).astype(np.int16)
                        to_process = samples.tobytes()

            self.audio_queue.put(to_process)

    def start(self) -> "AudioToTextRecorder":
        if time.time() - self.recording_stop_time < self._config.min_gap_between_recordings:
            return self

        self._set_state("recording")
        self.frames = []
        self.is_recording = True
        self.recording_start_time = time.time()
        self.speech_end_silence_start = 0.0
        self.extended_silence_start = 0.0
        self.is_trimming_silence = False
        self.vad.reset_states()
        self.stop_recording_event.clear()
        self.start_recording_event.set()

        if self.on_recording_start:
            self.on_recording_start()
        return self

    def stop(self) -> "AudioToTextRecorder":
        if time.time() - self.recording_start_time < self._config.min_length_of_recording:
            return self

        self.is_recording = False
        self.recording_stop_time = time.time()
        self.vad.reset_states()
        self.start_recording_event.clear()
        self.stop_recording_event.set()

        if self.on_recording_stop:
            self.on_recording_stop()
        return self

    def listen(self) -> None:
        self._set_state("listening")
        self.start_recording_on_voice_activity = True

    def wait_audio(self) -> None:
        if not self.is_recording and not self.frames:
            self._set_state("listening")
            self.start_recording_on_voice_activity = True
            while not self.shutdown_event.is_set():
                if self.start_recording_event.wait(timeout=0.02):
                    break

        if self.is_recording:
            self.stop_recording_on_voice_deactivity = True
            while not self.shutdown_event.is_set():
                if self.stop_recording_event.wait(timeout=0.02):
                    break

        if self.frames:
            audio_array = np.frombuffer(b"".join(self.frames), dtype=np.int16)
            self.audio = audio_array.astype(np.float32) / INT16_MAX_ABS_VALUE
        else:
            self.audio = np.array([], dtype=np.float32)

        self.frames = []
        self._set_state("inactive")

    def _preprocess_output(self, text: str) -> str:
        output = (text or "").strip()
        if not output:
            return ""

        if self._config.ensure_sentence_starting_uppercase:
            output = output[:1].upper() + output[1:]

        if self._config.ensure_sentence_ends_with_period and output[-1] not in ".!?":
            output = f"{output}."

        return output

    def _perform_transcription(self, audio: np.ndarray | None = None) -> dict[str, Any]:
        with self.transcription_lock:
            if audio is None:
                audio = copy.deepcopy(self.audio)

            if audio is None or len(audio) == 0:
                return {
                    "text": "",
                    "segments": [],
                    "words": [],
                    "language": self.language or None,
                    "duration": 0.0,
                }

            if self._config.normalize_audio:
                audio = normalize_audio_peak(audio)

            if self.on_transcription_start:
                abort = self.on_transcription_start(audio)
                if abort:
                    return {
                        "text": "",
                        "segments": [],
                        "words": [],
                        "language": self.language or None,
                        "duration": 0.0,
                    }

            result = self._manager.transcribe_audio(
                audio_data=audio,
                sample_rate=SAMPLE_RATE,
                language=self.language or None,
                diarization=False,
                word_timestamps=True,
                task=self.task,
                translation_target_language=self.translation_target_language,
                backend=self.backend,
                model_name=self.model_name,
                initial_prompt=self.initial_prompt,
                suppress_tokens=self.suppress_tokens,
            )
            result["text"] = self._preprocess_output(str(result.get("text", "")))
            return result

    def transcribe(self) -> dict[str, Any]:
        audio_copy = copy.deepcopy(self.audio)
        self._set_state("transcribing")
        try:
            return self._perform_transcription(audio_copy)
        finally:
            self._set_state("inactive")

    def text(self) -> str:
        self.wait_audio()
        if self.is_shut_down:
            return ""
        return str(self.transcribe().get("text", ""))

    def shutdown(self) -> None:
        self.is_running = False
        self.is_shut_down = True
        self.shutdown_event.set()
        self.start_recording_event.set()
        self.stop_recording_event.set()
        if self.recording_thread.is_alive():
            self.recording_thread.join(timeout=2.0)

    def _recording_worker(self) -> None:
        try:
            while self.is_running and not self.shutdown_event.is_set():
                try:
                    data = self.audio_queue.get(timeout=0.01)
                except queue.Empty:
                    continue

                if self.on_recorded_chunk:
                    self.on_recorded_chunk(data)

                while self.audio_queue.qsize() > self._config.allowed_latency_limit:
                    try:
                        self.audio_queue.get_nowait()
                    except queue.Empty:
                        break

                if not self.is_recording:
                    self.audio_buffer.append(data)
                    if self.start_recording_on_voice_activity:
                        if self.vad.is_voice_active():
                            if self.on_vad_start:
                                self.on_vad_start()
                            self.start()
                            self.start_recording_on_voice_activity = False
                            self.frames.extend(list(self.audio_buffer))
                            self.audio_buffer.clear()
                            self.vad.reset_states()
                        else:
                            self.vad.check_voice_activity(data)

                    if self.speech_end_silence_start != 0:
                        self.speech_end_silence_start = 0
                else:
                    self.frames.append(data)

                    if self.stop_recording_on_voice_deactivity:
                        is_speech = self.vad.check_deactivation(data)
                        if not is_speech:
                            if self.speech_end_silence_start == 0:
                                self.speech_end_silence_start = time.time()
                                if self.on_vad_stop:
                                    self.on_vad_stop()
                            silence_duration = time.time() - self.speech_end_silence_start
                            if silence_duration >= self._config.post_speech_silence_duration:
                                self.stop()
                                self.stop_recording_on_voice_deactivity = False
                        else:
                            self.speech_end_silence_start = 0
                            self.extended_silence_start = 0
                self.audio_queue.task_done()
        except Exception:
            logger.exception("Recorder worker failed")
            self.shutdown_event.set()
