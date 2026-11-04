from __future__ import annotations

import logging
import queue
import threading
from collections.abc import Callable
from dataclasses import dataclass
from enum import Enum, auto
from typing import Any

import numpy as np

from .config import RuntimeConfig
from .model_manager import ModelManager
from .recorder import AudioToTextRecorder

logger = logging.getLogger(__name__)

SAMPLE_RATE = 16000


class LiveModeState(Enum):
    STOPPED = auto()
    STARTING = auto()
    LISTENING = auto()
    PROCESSING = auto()
    ERROR = auto()


@dataclass
class LiveModeConfig:
    backend: str = ""
    model: str = ""
    language: str = ""
    translation_enabled: bool = False
    translation_target_language: str = "en"


class LiveModeEngine:
    def __init__(
        self,
        *,
        manager: ModelManager,
        config: RuntimeConfig,
        live_config: LiveModeConfig | None = None,
        on_sentence: Callable[[str, str | None], None] | None = None,
        on_realtime_update: Callable[[str], None] | None = None,
        on_state_change: Callable[[LiveModeState], None] | None = None,
    ) -> None:
        self._manager = manager
        self._runtime_config = config
        self.config = live_config or LiveModeConfig()
        self._on_sentence = on_sentence
        self._on_realtime_update = on_realtime_update
        self._on_state_change = on_state_change

        self._recorder: AudioToTextRecorder | None = None
        self._state = LiveModeState.STOPPED
        self._loop_thread: threading.Thread | None = None
        self._feeder_thread: threading.Thread | None = None
        self._stop_event = threading.Event()
        self._sentence_history: list[str] = []
        self._max_history = 50
        self._audio_queue: queue.Queue[tuple[bytes | bytearray | np.ndarray, int]] = queue.Queue()

    @property
    def state(self) -> LiveModeState:
        return self._state

    @property
    def is_running(self) -> bool:
        return self._state in (LiveModeState.LISTENING, LiveModeState.PROCESSING)

    @property
    def sentence_history(self) -> list[str]:
        return self._sentence_history.copy()

    def _set_state(self, state: LiveModeState) -> None:
        self._state = state
        if self._on_state_change:
            self._on_state_change(state)

    def _on_recording_start(self) -> None:
        self._set_state(LiveModeState.PROCESSING)

    def _on_recording_stop(self) -> None:
        if self._state == LiveModeState.PROCESSING:
            self._set_state(LiveModeState.LISTENING)

    def _process_sentence(self, text: str, language: str | None = None) -> None:
        if not text.strip():
            return

        normalized = text.strip()
        self._sentence_history.append(normalized)
        if len(self._sentence_history) > self._max_history:
            self._sentence_history = self._sentence_history[-self._max_history :]

        if self._on_sentence:
            self._on_sentence(normalized, language)

    def _handle_realtime_update(self, text: str) -> None:
        if self._on_realtime_update and not self._stop_event.is_set():
            self._on_realtime_update(text)

    def _transcription_loop(self) -> None:
        try:
            self._set_state(LiveModeState.STARTING)
            self._recorder = AudioToTextRecorder(
                manager=self._manager,
                config=self._runtime_config,
                instance_name="live_mode",
                backend=self.config.backend or self._runtime_config.backend,
                model_name=self.config.model or self._runtime_config.model_name,
                language=self.config.language,
                task="translate" if self.config.translation_enabled else "transcribe",
                translation_target_language=(
                    self.config.translation_target_language or self._runtime_config.translation_target_language
                ),
                on_recording_start=self._on_recording_start,
                on_recording_stop=self._on_recording_stop,
                on_realtime_update=self._handle_realtime_update if self._on_realtime_update else None,
                # Captions need text fast; word timing and alignment only add latency here.
                word_timestamps=False,
                align=False,
            )
            self._set_state(LiveModeState.LISTENING)

            # After stop() the loop keeps going until utterances already captured (including
            # the one closed by finish()) have been transcribed.
            while not self._stop_event.is_set() or self._recorder.has_pending_audio():
                result = self._recorder.text_result()
                text = str(result.get("text", "") or "")
                if text:
                    language = result.get("language")
                    self._process_sentence(text, str(language) if language else None)
                elif self._stop_event.is_set():
                    break
        except Exception:
            logger.exception("Live Mode transcription loop failed")
            self._set_state(LiveModeState.ERROR)
        finally:
            if self._recorder is not None:
                self._recorder.shutdown()
                self._recorder = None
            if self._state != LiveModeState.ERROR:
                self._set_state(LiveModeState.STOPPED)

    def _audio_feeder_loop(self) -> None:
        while not self._stop_event.is_set():
            try:
                audio_data, sample_rate = self._audio_queue.get(timeout=0.1)
            except queue.Empty:
                continue

            if self._recorder is not None and self.is_running:
                self._recorder.feed_audio(audio_data, sample_rate)

    def feed_audio(self, audio_data: bytes | bytearray | np.ndarray, sample_rate: int = SAMPLE_RATE) -> None:
        if self._state in {LiveModeState.STOPPED, LiveModeState.ERROR}:
            return
        try:
            self._audio_queue.put_nowait((audio_data, sample_rate))
        except queue.Full:
            logger.warning("Live Mode audio queue full, dropping chunk")

    def start(self) -> bool:
        if self.is_running:
            return False

        self._stop_event.clear()
        while not self._audio_queue.empty():
            try:
                self._audio_queue.get_nowait()
            except queue.Empty:
                break

        self._loop_thread = threading.Thread(
            target=self._transcription_loop,
            daemon=True,
            name="LiveModeThread",
        )
        self._feeder_thread = threading.Thread(
            target=self._audio_feeder_loop,
            daemon=True,
            name="LiveModeAudioFeeder",
        )
        self._loop_thread.start()
        self._feeder_thread.start()
        return True

    def stop(self, flush_timeout: float = 30.0) -> None:
        """Stops listening. Speech already captured, including an utterance still in progress,
        is transcribed and reported before this returns (bounded by `flush_timeout`)."""
        self._stop_event.set()

        if self._recorder is not None:
            self._recorder.finish()

        if self._loop_thread and self._loop_thread.is_alive():
            self._loop_thread.join(timeout=flush_timeout)
        if self._feeder_thread and self._feeder_thread.is_alive():
            self._feeder_thread.join(timeout=2.0)

        self._loop_thread = None
        self._feeder_thread = None
        self._recorder = None
        if self._state != LiveModeState.ERROR:
            self._set_state(LiveModeState.STOPPED)

    def clear_history(self) -> None:
        self._sentence_history.clear()
