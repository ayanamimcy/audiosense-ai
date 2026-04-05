from __future__ import annotations

import threading
import unittest
from unittest.mock import Mock, patch

import numpy as np

from local_audio_runtime.config import RuntimeConfig
from local_audio_runtime.model_manager import ModelManager


class FakeTimer:
    def __init__(self, interval: int, callback) -> None:
        self.interval = interval
        self.callback = callback
        self.started = False
        self.cancelled = False
        self.daemon = False

    def start(self) -> None:
        self.started = True

    def cancel(self) -> None:
        self.cancelled = True


class FakeBackend:
    def __init__(self) -> None:
        self.backend_name = "fake-backend"
        self.model_name = "fake-model"
        self.device = "cpu"
        self.load_calls = 0
        self.unload_calls = 0
        self.supports_integrated = False
        self.raise_on_transcribe = False
        self.transcribe_result = {"text": "hello", "segments": [], "words": []}
        self.integrated_result = {"text": "hello", "segments": [], "words": []}
        self.block_event: threading.Event | None = None
        self.started_event: threading.Event | None = None

    def load(self, spec) -> None:
        self.load_calls += 1
        self.model_name = spec.model_name
        self.device = spec.device

    def unload(self) -> None:
        self.unload_calls += 1

    def supports_integrated_diarization(self) -> bool:
        return self.supports_integrated

    def transcribe(self, *args, **kwargs):
        del args, kwargs
        if self.started_event is not None:
            self.started_event.set()
        if self.block_event is not None:
            self.block_event.wait(timeout=2)
        if self.raise_on_transcribe:
            raise RuntimeError("boom")
        return dict(self.transcribe_result)

    def transcribe_with_diarization(self, *args, **kwargs):
        del args, kwargs
        if not self.supports_integrated:
            return None
        return dict(self.integrated_result)


def build_runtime_config() -> RuntimeConfig:
    return RuntimeConfig(
        host="127.0.0.1",
        port=8765,
        backend="fake-backend",
        model_name="fake-model",
        device="cpu",
        compute_type="default",
        beam_size=5,
        batch_size=16,
        vad_filter=True,
        diarization_model="fake-diarization",
        hf_token=None,
        download_root=None,
        preload=False,
        diarization_strategy="auto",
        prefer_integrated_diarization=True,
        sequential_unload_between_stages=False,
        translation_target_language="en",
        normalize_audio=False,
        pre_vad_normalize=False,
        silero_sensitivity=0.4,
        webrtc_sensitivity=3,
        silero_use_onnx=False,
        silero_deactivity_detection=False,
        post_speech_silence_duration=0.8,
        min_length_of_recording=0.4,
        min_gap_between_recordings=0.2,
        pre_recording_buffer_duration=1.0,
        max_silence_duration=10.0,
        allowed_latency_limit=100,
        ensure_sentence_starting_uppercase=True,
        ensure_sentence_ends_with_period=True,
        buffer_size=512,
    )


class ModelManagerIdleUnloadTests(unittest.TestCase):
    def setUp(self) -> None:
        self.backend = FakeBackend()
        self.timer_instances: list[FakeTimer] = []

        def timer_factory(interval, callback):
            timer = FakeTimer(interval, callback)
            self.timer_instances.append(timer)
            return timer

        self.timer_patch = patch(
            "local_audio_runtime.model_manager.threading.Timer",
            side_effect=timer_factory,
        )
        self.backend_patch = patch(
            "local_audio_runtime.model_manager.create_backend",
            return_value=self.backend,
        )
        self.duration_patch = patch(
            "local_audio_runtime.model_manager.get_audio_duration_seconds",
            return_value=1.25,
        )

        self.timer_patch.start()
        self.backend_patch.start()
        self.duration_patch.start()

        self.manager = ModelManager(build_runtime_config())
        self.manager._idle_timeout = 30

    def tearDown(self) -> None:
        patch.stopall()

    def test_preload_arms_idle_unload(self) -> None:
        self.manager.preload()

        self.assertIs(self.manager._backend, self.backend)
        self.assertEqual(len(self.timer_instances), 1)
        self.assertTrue(self.timer_instances[0].started)

    def test_successful_transcription_rearms_timer(self) -> None:
        self.manager.preload()

        result = self.manager.transcribe_audio(
            audio_data=np.zeros(160, dtype=np.float32),
            sample_rate=16000,
            diarization=False,
        )

        self.assertEqual(result["backend"], "fake-backend")
        self.assertEqual(result["model_name"], "fake-model")
        self.assertEqual(len(self.timer_instances), 3)
        self.assertTrue(self.timer_instances[0].cancelled)
        self.assertTrue(self.timer_instances[1].started)
        self.assertTrue(self.timer_instances[2].started)

    def test_integrated_diarization_path_rearms_timer(self) -> None:
        self.backend.supports_integrated = True
        self.manager.preload()

        result = self.manager.transcribe_audio(
            audio_data=np.zeros(160, dtype=np.float32),
            sample_rate=16000,
            diarization=True,
        )

        self.assertEqual(result["backend"], "fake-backend")
        self.assertEqual(result["model_name"], "fake-model")
        self.assertEqual(len(self.timer_instances), 2)
        self.assertTrue(self.timer_instances[0].cancelled)
        self.assertTrue(self.timer_instances[1].started)

    def test_exception_path_rearms_timer(self) -> None:
        self.backend.raise_on_transcribe = True
        self.manager.preload()

        with self.assertRaisesRegex(RuntimeError, "boom"):
            self.manager.transcribe_audio(
                audio_data=np.zeros(160, dtype=np.float32),
                sample_rate=16000,
                diarization=False,
            )

        self.assertEqual(len(self.timer_instances), 2)
        self.assertTrue(self.timer_instances[0].cancelled)
        self.assertTrue(self.timer_instances[1].started)

    def test_idle_unload_clears_backend_and_diarization_engine(self) -> None:
        self.manager.preload()
        diarization_engine = Mock()
        self.manager._diarization_engine = diarization_engine

        self.manager._idle_unload()

        self.assertIsNone(self.manager._backend)
        self.assertEqual(self.backend.unload_calls, 1)
        diarization_engine.unload.assert_called_once_with()
        self.assertIsNone(self.manager._diarization_engine)

    def test_idle_unload_waits_for_active_transcription(self) -> None:
        started_event = threading.Event()
        release_event = threading.Event()
        self.backend.started_event = started_event
        self.backend.block_event = release_event
        self.manager.preload()

        transcription_error: list[BaseException] = []

        def run_transcription() -> None:
            try:
                self.manager.transcribe_audio(
                    audio_data=np.zeros(160, dtype=np.float32),
                    sample_rate=16000,
                    diarization=False,
                )
            except BaseException as exc:  # pragma: no cover - defensive capture for test thread
                transcription_error.append(exc)

        transcription_thread = threading.Thread(target=run_transcription)
        transcription_thread.start()
        self.assertTrue(started_event.wait(timeout=1), "transcription did not start in time")

        unload_thread = threading.Thread(target=self.manager._idle_unload)
        unload_thread.start()

        threading.Event().wait(0.05)
        self.assertTrue(unload_thread.is_alive(), "idle unload should wait for active transcription")
        self.assertEqual(self.backend.unload_calls, 0)

        release_event.set()
        transcription_thread.join(timeout=2)
        unload_thread.join(timeout=2)

        self.assertFalse(transcription_error, f"unexpected transcription error: {transcription_error}")
        self.assertFalse(transcription_thread.is_alive(), "transcription thread should finish")
        self.assertFalse(unload_thread.is_alive(), "idle unload thread should finish")
        self.assertGreaterEqual(self.backend.unload_calls, 1)


if __name__ == "__main__":
    unittest.main()
