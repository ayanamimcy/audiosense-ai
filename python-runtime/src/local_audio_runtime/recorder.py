from __future__ import annotations

import collections
import copy
import logging
import queue
import re
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

_CJK_PATTERN = re.compile(r"[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]")
_SENTENCE_END = ".!?。！？…"


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
        on_realtime_update: Callable[[str], None] | None = None,
        word_timestamps: bool = True,
        align: bool = True,
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
        self.on_realtime_update = on_realtime_update
        self.word_timestamps = word_timestamps
        self.align = align
        # Bumped at every utterance start, so interim text decoded for an utterance that has
        # since ended is never reported against the next one.
        self._utterance_id = 0

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
        # Utterances that have ended but not been transcribed yet. Ending an utterance moves its
        # frames here, so recording can carry straight on into the next one without racing the
        # consumer for `frames`.
        self._finished_utterances: collections.deque[list[bytes]] = collections.deque()
        self._finished_lock = threading.Lock()
        self._utterance_ready = threading.Event()
        self._utterance_has_speech = False
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

        self.realtime_thread: threading.Thread | None = None
        if self.on_realtime_update and config.realtime_update_interval > 0:
            self.realtime_thread = threading.Thread(
                target=self._realtime_worker,
                daemon=True,
                name=f"{instance_name}_realtime",
            )
            self.realtime_thread.start()

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
        self._utterance_id += 1
        self._utterance_has_speech = True
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

    def _close_utterance(self) -> None:
        frames, self.frames = self.frames, []
        if frames and self._utterance_has_speech:
            with self._finished_lock:
                self._finished_utterances.append(frames)
            self._utterance_ready.set()

    def _pop_finished_utterance(self) -> list[bytes] | None:
        with self._finished_lock:
            frames = self._finished_utterances.popleft() if self._finished_utterances else None
            if not self._finished_utterances:
                self._utterance_ready.clear()
            return frames

    def has_pending_audio(self) -> bool:
        with self._finished_lock:
            return bool(self._finished_utterances)

    def _split_utterance(self) -> None:
        """Hand the utterance so far to transcription and keep recording into a new one."""
        self._close_utterance()
        self._utterance_id += 1
        self._utterance_has_speech = False
        self.recording_start_time = time.time()
        self.speech_end_silence_start = 0.0

    def stop(self) -> "AudioToTextRecorder":
        if time.time() - self.recording_start_time < self._config.min_length_of_recording:
            return self
        return self._end_recording()

    def _end_recording(self) -> "AudioToTextRecorder":
        self._close_utterance()
        self.is_recording = False
        self.recording_stop_time = time.time()
        self.vad.reset_states()
        self.start_recording_event.clear()
        self.stop_recording_event.set()

        if self.on_recording_stop:
            self.on_recording_stop()
        return self

    def finish(self) -> None:
        """End the session. An utterance in progress is closed first, so the last words spoken
        before stopping are still returned by the next text_result() call."""
        if self.is_recording:
            self._end_recording()
        self.shutdown()

    def listen(self) -> None:
        self._set_state("listening")
        self.start_recording_on_voice_activity = True

    def wait_audio(self) -> None:
        """Blocks until an utterance has ended (or the recorder shuts down) and loads it into
        `self.audio`. Keeps the recorder listening for speech while it waits."""
        frames: list[bytes] | None = None
        while not self.shutdown_event.is_set():
            frames = self._pop_finished_utterance()
            if frames is not None:
                break
            if self.is_recording:
                self.stop_recording_on_voice_deactivity = True
            elif not self.start_recording_on_voice_activity:
                self._set_state("listening")
                self.start_recording_on_voice_activity = True
            self._utterance_ready.wait(timeout=0.02)
        else:
            # Shut down (e.g. by finish()): still return an utterance it closed.
            frames = self._pop_finished_utterance()

        if frames:
            audio_array = np.frombuffer(b"".join(frames), dtype=np.int16)
            self.audio = audio_array.astype(np.float32) / INT16_MAX_ABS_VALUE
        else:
            self.audio = np.array([], dtype=np.float32)

        self._set_state("inactive")

    def _preprocess_output(self, text: str) -> str:
        output = (text or "").strip()
        if not output:
            return ""

        if self._config.ensure_sentence_starting_uppercase:
            output = output[:1].upper() + output[1:]

        if self._config.ensure_sentence_ends_with_period and output[-1] not in _SENTENCE_END:
            # Chinese/Japanese sentences end with an ideographic full stop, not ".".
            output = f"{output}{'。' if _CJK_PATTERN.search(output) else '.'}"

        return output

    def _perform_transcription(self, audio: np.ndarray | None = None, *, realtime: bool = False) -> dict[str, Any]:
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
                # Interim text is decoded greedily and without word timing: it is redrawn
                # every fraction of a second and replaced by the final pass anyway.
                word_timestamps=False if realtime else self.word_timestamps,
                beam_size=1 if realtime else None,
                align=False if realtime else self.align,
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
        return str(self.text_result().get("text", ""))

    def text_result(self) -> dict[str, Any]:
        """Waits for the next utterance and returns its transcription (text, language, ...).
        An utterance closed by finish() is still transcribed."""
        self.wait_audio()
        if self.is_shut_down and (self.audio is None or len(self.audio) == 0):
            return {"text": "", "language": None}
        return self.transcribe()

    def _realtime_worker(self) -> None:
        """Re-decodes the utterance in progress at a fixed interval and reports interim text."""
        interval = self._config.realtime_update_interval
        min_samples = int(self._config.realtime_min_audio_duration * SAMPLE_RATE)
        last_text = ""
        last_utterance = -1
        while self.is_running and not self.shutdown_event.wait(interval):
            if not self.is_recording:
                continue
            utterance_id = self._utterance_id
            if utterance_id != last_utterance:
                last_utterance, last_text = utterance_id, ""
            frames = list(self.frames)
            if sum(len(frame) for frame in frames) // 2 < min_samples:
                continue
            # A final transcription owns the lock; interim text for that utterance is moot.
            if not self.transcription_lock.acquire(blocking=False):
                continue
            self.transcription_lock.release()
            audio = np.frombuffer(b"".join(frames), dtype=np.int16).astype(np.float32) / INT16_MAX_ABS_VALUE
            try:
                text = str(self._perform_transcription(audio, realtime=True).get("text", "")).strip()
            except Exception:
                logger.exception("Interim transcription failed")
                continue
            if (
                text
                and text != last_text
                and self.is_recording
                and self._utterance_id == utterance_id
                and self.on_realtime_update
            ):
                last_text = text
                self.on_realtime_update(text)

    def shutdown(self) -> None:
        self.is_running = False
        self.is_shut_down = True
        self.shutdown_event.set()
        self.start_recording_event.set()
        self.stop_recording_event.set()
        if self.recording_thread.is_alive():
            self.recording_thread.join(timeout=2.0)
        if self.realtime_thread is not None and self.realtime_thread.is_alive():
            self.realtime_thread.join(timeout=2.0)

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
                        utterance_duration = time.time() - self.recording_start_time
                        # Long monologues: end the utterance at a short pause once it is long,
                        # and cut it outright past the hard limit, so captions keep flowing.
                        is_long = utterance_duration >= self._config.max_utterance_duration
                        is_speech = self.vad.check_deactivation(data)
                        if is_speech:
                            self._utterance_has_speech = True
                            self.speech_end_silence_start = 0
                            self.extended_silence_start = 0
                            if utterance_duration >= self._config.hard_max_utterance_duration:
                                self._split_utterance()
                        else:
                            if self.speech_end_silence_start == 0:
                                self.speech_end_silence_start = time.time()
                                if self.on_vad_stop:
                                    self.on_vad_stop()
                            silence_duration = time.time() - self.speech_end_silence_start
                            if is_long and silence_duration >= self._config.long_utterance_silence_duration:
                                # A long utterance ends at the first short pause; recording
                                # continues so the next words are not lost.
                                self._split_utterance()
                            elif silence_duration >= self._config.post_speech_silence_duration:
                                self.stop()
                                self.stop_recording_on_voice_deactivity = False
                self.audio_queue.task_done()
        except Exception:
            logger.exception("Recorder worker failed")
            self.shutdown_event.set()
