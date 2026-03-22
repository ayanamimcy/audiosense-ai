from __future__ import annotations

import logging
import threading
import warnings
from typing import Any

import numpy as np
from scipy import signal

from .config import RuntimeConfig

logger = logging.getLogger(__name__)

SAMPLE_RATE = 16000
INT16_MAX_ABS_VALUE = 32768.0


class VoiceActivityDetector:
    """Dual WebRTC + Silero voice activity detector."""

    def __init__(self, config: RuntimeConfig) -> None:
        self._config = config
        self.silero_sensitivity = config.silero_sensitivity
        self.webrtc_sensitivity = config.webrtc_sensitivity
        self.use_silero_deactivity = config.silero_deactivity_detection

        self.is_webrtc_speech_active = False
        self.is_silero_speech_active = False
        self._silero_working = False
        self._lock = threading.Lock()

        self._init_webrtc_vad()
        self._init_silero_vad()

    def _init_webrtc_vad(self) -> None:
        try:
            with warnings.catch_warnings():
                warnings.filterwarnings("ignore", category=UserWarning, module="pkg_resources")
                import webrtcvad

            self._webrtc_module = webrtcvad
            self.webrtc_vad_model = webrtcvad.Vad()
            self.webrtc_vad_model.set_mode(self.webrtc_sensitivity)
        except Exception as exc:
            raise RuntimeError(
                "WebRTC VAD is required for live streaming. Install the `live` extra."
            ) from exc

    def _init_silero_vad(self) -> None:
        try:
            from silero_vad import load_silero_vad

            self._torch = __import__("torch")
            self.silero_vad_model = load_silero_vad(onnx=self._config.silero_use_onnx)
        except Exception as exc:
            raise RuntimeError(
                "Silero VAD is required for live streaming. Install the `live` extra."
            ) from exc

    def reset_states(self) -> None:
        self.is_webrtc_speech_active = False
        self.is_silero_speech_active = False
        if hasattr(self.silero_vad_model, "reset_states"):
            self.silero_vad_model.reset_states()

    def _resample_if_needed(self, chunk: bytes | bytearray, sample_rate: int) -> bytes:
        if sample_rate == SAMPLE_RATE:
            return bytes(chunk)

        pcm_data = np.frombuffer(chunk, dtype=np.int16)
        resampled = signal.resample_poly(pcm_data, SAMPLE_RATE, sample_rate)
        return resampled.astype(np.int16).tobytes()

    def is_speech_webrtc(
        self,
        chunk: bytes | bytearray,
        sample_rate: int = SAMPLE_RATE,
        *,
        all_frames_must_be_true: bool = False,
    ) -> bool:
        chunk = self._resample_if_needed(chunk, sample_rate)
        frame_length = int(SAMPLE_RATE * 0.01)
        frame_count = int(len(chunk) / (2 * frame_length))
        speech_frames = 0

        for index in range(frame_count):
            start_byte = index * frame_length * 2
            end_byte = start_byte + frame_length * 2
            frame = chunk[start_byte:end_byte]
            if len(frame) < frame_length * 2:
                continue
            if self.webrtc_vad_model.is_speech(frame, SAMPLE_RATE):
                speech_frames += 1
                if not all_frames_must_be_true:
                    self.is_webrtc_speech_active = True
                    return True

        if all_frames_must_be_true and frame_count > 0:
            speech_detected = speech_frames == frame_count
            self.is_webrtc_speech_active = speech_detected
            return speech_detected

        self.is_webrtc_speech_active = False
        return False

    def is_speech_silero(
        self,
        chunk: bytes | bytearray,
        sample_rate: int = SAMPLE_RATE,
    ) -> bool:
        chunk = self._resample_if_needed(chunk, sample_rate)

        with self._lock:
            self._silero_working = True
            try:
                audio_chunk = np.frombuffer(chunk, dtype=np.int16).astype(np.float32) / INT16_MAX_ABS_VALUE
                vad_probability = self.silero_vad_model(
                    self._torch.from_numpy(audio_chunk),
                    SAMPLE_RATE,
                ).item()
                is_speech = vad_probability > (1 - self.silero_sensitivity)
                self.is_silero_speech_active = is_speech
                return is_speech
            finally:
                self._silero_working = False

    def check_voice_activity(self, chunk: bytes | bytearray, sample_rate: int = SAMPLE_RATE) -> None:
        self.is_speech_webrtc(chunk, sample_rate)

        if self.is_webrtc_speech_active and not self._silero_working:
            threading.Thread(
                target=self.is_speech_silero,
                args=(bytes(chunk), sample_rate),
                daemon=True,
                name="silero-vad-check",
            ).start()

    def is_voice_active(self) -> bool:
        return self.is_webrtc_speech_active and self.is_silero_speech_active

    def check_deactivation(self, chunk: bytes | bytearray, sample_rate: int = SAMPLE_RATE) -> bool:
        if self.use_silero_deactivity:
            return self.is_speech_silero(chunk, sample_rate)
        return self.is_speech_webrtc(chunk, sample_rate, all_frames_must_be_true=True)

