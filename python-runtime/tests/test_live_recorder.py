"""Live-mode recorder behaviour with a fake VAD and a fake model, fed in real time."""
from __future__ import annotations

import dataclasses
import threading
import time
import unittest
from unittest.mock import patch

import numpy as np

from local_audio_runtime.config import load_config
from local_audio_runtime import recorder as recorder_module
from local_audio_runtime.recorder import AudioToTextRecorder

SAMPLE_RATE = 16000
CHUNK = 512  # samples, ~32 ms, as fed by clients


class EnergyVad:
    """Speech = loud chunk. Stands in for the WebRTC + Silero detector."""

    def __init__(self, config) -> None:
        self._active = False

    @staticmethod
    def _is_loud(data: bytes) -> bool:
        samples = np.frombuffer(data, dtype=np.int16)
        return bool(samples.size) and float(np.mean(np.abs(samples))) > 500

    def check_voice_activity(self, data: bytes) -> None:
        self._active = self._is_loud(data)

    def is_voice_active(self) -> bool:
        return self._active

    def check_deactivation(self, data: bytes) -> bool:
        return self._is_loud(data)

    def reset_states(self) -> None:
        self._active = False


class FakeManager:
    """Reports how much audio it was given; interim calls (beam_size=1) are tagged."""

    def __init__(self) -> None:
        self.final_calls: list[float] = []
        self.interim_calls = 0
        self.lock = threading.Lock()

    def transcribe_audio(self, *, audio_data, beam_size=None, **kwargs):
        seconds = len(audio_data) / SAMPLE_RATE
        with self.lock:
            if beam_size == 1:
                self.interim_calls += 1
                return {"text": f"interim {seconds:.1f}", "language": "ja"}
            self.final_calls.append(seconds)
        return {"text": f"final {seconds:.2f}", "language": "ja"}


def speech(seconds: float) -> np.ndarray:
    rng = np.random.default_rng(0)
    return (rng.uniform(-1, 1, int(seconds * SAMPLE_RATE)) * 8000).astype(np.int16)


def silence(seconds: float) -> np.ndarray:
    return np.zeros(int(seconds * SAMPLE_RATE), dtype=np.int16)


class LiveRecorderTest(unittest.TestCase):
    def setUp(self) -> None:
        self.config = dataclasses.replace(
            load_config(),
            post_speech_silence_duration=0.3,
            min_length_of_recording=0.1,
            min_gap_between_recordings=0.0,
            pre_recording_buffer_duration=0.2,
            max_utterance_duration=1.0,
            long_utterance_silence_duration=0.1,
            hard_max_utterance_duration=1.5,
            realtime_update_interval=0.1,
            realtime_min_audio_duration=0.2,
            normalize_audio=False,
            pre_vad_normalize=False,
            allowed_latency_limit=1000,
            ensure_sentence_ends_with_period=False,
            ensure_sentence_starting_uppercase=False,
        )
        self.manager = FakeManager()
        self.interim: list[str] = []
        self.results: list[dict] = []
        self.vad_patch = patch.object(recorder_module, "VoiceActivityDetector", EnergyVad)
        self.vad_patch.start()
        self.recorder = AudioToTextRecorder(
            manager=self.manager,
            config=self.config,
            on_realtime_update=self.interim.append,
            word_timestamps=False,
            align=False,
        )
        self.consumer_done = threading.Event()
        self.consumer = threading.Thread(target=self._consume, daemon=True)
        self.consumer.start()

    def tearDown(self) -> None:
        self.recorder.shutdown()
        self.vad_patch.stop()

    def _consume(self) -> None:
        while not self.recorder.is_shut_down or self.recorder.has_pending_audio():
            result = self.recorder.text_result()
            if result.get("text"):
                self.results.append(result)
            elif self.recorder.is_shut_down:
                break
        self.consumer_done.set()

    def feed(self, audio: np.ndarray) -> None:
        """Feeds audio at real-time pace, like a microphone stream."""
        for start in range(0, len(audio), CHUNK):
            self.recorder.feed_audio(audio[start : start + CHUNK].tobytes())
            time.sleep(CHUNK / SAMPLE_RATE)

    def finish(self) -> None:
        self.recorder.finish()
        self.assertTrue(self.consumer_done.wait(5), "consumer did not finish")

    def final_seconds(self) -> list[float]:
        return [float(result["text"].split()[1]) for result in self.results]

    def test_pauses_end_utterances_and_interim_text_streams_meanwhile(self) -> None:
        self.feed(np.concatenate([silence(0.3), speech(0.8), silence(0.6), speech(0.6), silence(0.6)]))
        self.finish()

        self.assertEqual(len(self.results), 2, self.results)
        self.assertEqual(self.results[0]["language"], "ja")
        self.assertGreater(self.manager.interim_calls, 0)
        self.assertTrue(all(text.startswith("interim") for text in self.interim))

    def test_long_speech_is_split_without_losing_audio(self) -> None:
        self.feed(np.concatenate([speech(3.5), silence(0.6)]))
        self.finish()

        seconds = self.final_seconds()
        self.assertGreaterEqual(len(seconds), 2, seconds)
        # Every chunk of speech reached a transcription: splitting must not drop audio.
        self.assertGreaterEqual(sum(seconds), 3.4, seconds)

    def test_long_utterance_ends_at_a_short_pause(self) -> None:
        self.feed(np.concatenate([speech(1.1), silence(0.15), speech(0.5), silence(0.6)]))
        self.finish()

        seconds = self.final_seconds()
        self.assertEqual(len(seconds), 2, seconds)
        # Cut at the pause: the second utterance holds all of the last 0.5 s of speech. A cut at
        # the 1.5 s hard limit instead would give ~1.7 s (with the pre-roll) and ~0.35 s.
        self.assertLess(seconds[0], 1.65, seconds)
        self.assertGreaterEqual(seconds[1], 0.45, seconds)

    def test_silence_after_a_split_is_not_transcribed(self) -> None:
        self.feed(np.concatenate([speech(1.1), silence(1.2)]))
        self.finish()

        # One utterance with speech; the silent tail after the short-pause split is dropped
        # instead of being sent to the model (where Whisper tends to invent text).
        self.assertEqual(len(self.manager.final_calls), 1, self.manager.final_calls)

    def test_finish_transcribes_the_utterance_in_progress(self) -> None:
        self.feed(np.concatenate([silence(0.2), speech(0.7)]))
        self.finish()

        self.assertEqual(len(self.results), 1, self.results)
        self.assertGreaterEqual(self.final_seconds()[0], 0.6)


class SentenceEndingTest(unittest.TestCase):
    def test_cjk_sentences_get_an_ideographic_full_stop(self) -> None:
        config = dataclasses.replace(load_config(), ensure_sentence_ends_with_period=True)
        with patch.object(recorder_module, "VoiceActivityDetector", EnergyVad):
            recorder = AudioToTextRecorder(manager=FakeManager(), config=config)
        try:
            self.assertEqual(recorder._preprocess_output("今日はいい天気"), "今日はいい天気。")
            self.assertEqual(recorder._preprocess_output("会议结束了。"), "会议结束了。")
            self.assertEqual(recorder._preprocess_output("hello there"), "Hello there.")
        finally:
            recorder.shutdown()


if __name__ == "__main__":
    unittest.main()
