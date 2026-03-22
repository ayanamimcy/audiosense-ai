from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass, field
from typing import Any, Callable

import numpy as np

from .config import RuntimeConfig
from .model_manager import ModelManager
from .recorder import AudioToTextRecorder

logger = logging.getLogger(__name__)

SAMPLE_RATE = 16000


@dataclass
class RealtimeTranscriptionResult:
    text: str
    language: str | None = None
    duration: float = 0.0
    words: list[dict[str, Any]] = field(default_factory=list)
    segments: list[dict[str, Any]] = field(default_factory=list)


class RealtimeTranscriptionEngine:
    def __init__(
        self,
        *,
        manager: ModelManager,
        config: RuntimeConfig,
        on_recording_start: Callable[[], None] | None = None,
        on_recording_stop: Callable[[], None] | None = None,
        on_vad_start: Callable[[], None] | None = None,
        on_vad_stop: Callable[[], None] | None = None,
    ) -> None:
        self._manager = manager
        self._config = config
        self._language: str | None = None
        self._recorder: AudioToTextRecorder | None = None
        self._initialized = False
        self._is_recording = False
        self._on_recording_start = on_recording_start
        self._on_recording_stop = on_recording_stop
        self._on_vad_start = on_vad_start
        self._on_vad_stop = on_vad_stop

    def initialize(self, language: str | None = None) -> None:
        if self._initialized:
            return

        self._language = language
        self._recorder = AudioToTextRecorder(
            manager=self._manager,
            config=self._config,
            instance_name="realtime_main",
            language=language or "",
            on_recording_start=self._handle_recording_start,
            on_recording_stop=self._handle_recording_stop,
            on_vad_start=self._handle_vad_start,
            on_vad_stop=self._handle_vad_stop,
        )
        self._initialized = True

    def _handle_recording_start(self) -> None:
        self._is_recording = True
        if self._on_recording_start:
            self._on_recording_start()

    def _handle_recording_stop(self) -> None:
        self._is_recording = False
        if self._on_recording_stop:
            self._on_recording_stop()

    def _handle_vad_start(self) -> None:
        if self._on_vad_start:
            self._on_vad_start()

    def _handle_vad_stop(self) -> None:
        if self._on_vad_stop:
            self._on_vad_stop()

    def feed_audio(self, audio_data: bytes | bytearray | np.ndarray, sample_rate: int = SAMPLE_RATE) -> None:
        if not self._initialized or self._recorder is None:
            raise RuntimeError("Realtime engine not initialized")
        self._recorder.feed_audio(audio_data, sample_rate)

    def start_recording(self, language: str | None = None) -> None:
        if not self._initialized:
            self.initialize(language)
        if self._recorder is not None:
            self._recorder.listen()

    def stop_recording(self) -> None:
        if self._recorder is not None:
            self._recorder.stop()

    async def get_transcription(self) -> RealtimeTranscriptionResult:
        if not self._initialized or self._recorder is None:
            raise RuntimeError("Realtime engine not initialized")

        await asyncio.to_thread(self._recorder.wait_audio)
        result = await asyncio.to_thread(self._recorder.transcribe)
        return RealtimeTranscriptionResult(
            text=str(result.get("text", "")),
            language=result.get("language"),
            duration=float(result.get("duration", 0.0) or 0.0),
            words=list(result.get("words", [])),
            segments=list(result.get("segments", [])),
        )

    @property
    def is_recording(self) -> bool:
        return self._is_recording

    def shutdown(self) -> None:
        if self._recorder is not None:
            self._recorder.shutdown()
            self._recorder = None
        self._initialized = False

