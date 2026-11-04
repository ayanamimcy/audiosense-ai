"""The /ws/live protocol, with the transcription engine replaced by a scripted fake."""
from __future__ import annotations

import threading
import time
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

from local_audio_runtime import server


class ScriptedEngine:
    """Reports interim text on the first audio chunk and a sentence while stopping, the way the
    real engine flushes the utterance in progress."""

    instances: list["ScriptedEngine"] = []

    def __init__(self, *, manager, config, live_config, on_sentence, on_realtime_update, on_state_change) -> None:
        self.live_config = live_config
        self._on_sentence = on_sentence
        self._on_realtime_update = on_realtime_update
        self._running = False
        self._sent_interim = False
        ScriptedEngine.instances.append(self)

    @property
    def is_running(self) -> bool:
        return self._running

    def start(self) -> bool:
        self._running = True
        return True

    def feed_audio(self, audio: bytes, sample_rate: int) -> None:
        if not self._sent_interim:
            self._sent_interim = True
            self._on_realtime_update("会議を始め")

    def stop(self) -> None:
        # Flushing takes a moment; the sentence must still arrive before "stopped".
        time.sleep(0.2)
        self._on_sentence("会議を始めます。", "ja")
        self._running = False


class LiveWebSocketTest(unittest.TestCase):
    def setUp(self) -> None:
        ScriptedEngine.instances.clear()
        self.patch = patch.object(server, "LiveModeEngine", ScriptedEngine)
        self.patch.start()
        server._active_live_session = None

    def tearDown(self) -> None:
        self.patch.stop()

    @staticmethod
    def receive_until(websocket, wanted: str) -> list[dict]:
        messages = []
        while True:
            message = websocket.receive_json()
            messages.append(message)
            if message["type"] == wanted:
                return messages

    def test_session_streams_interim_text_and_flushes_the_last_sentence_on_stop(self) -> None:
        with TestClient(server.app) as client, client.websocket_connect("/ws/live") as websocket:
            self.assertEqual(websocket.receive_json()["type"], "connected")
            # Starting a little after connecting must not lose the session's messages.
            time.sleep(0.4)
            websocket.send_json({"type": "start", "data": {"config": {"language": "ja"}}})
            websocket.send_bytes(b"\x00\x00" * 1600)

            messages = self.receive_until(websocket, "realtime")
            self.assertEqual(messages[-1]["data"], {"text": "会議を始め"})

            websocket.send_json({"type": "stop"})
            messages = self.receive_until(websocket, "stopped")
            types = [message["type"] for message in messages]
            self.assertIn("sentence", types)
            self.assertLess(types.index("sentence"), types.index("stopped"))
            sentence = next(message for message in messages if message["type"] == "sentence")
            self.assertEqual(sentence["data"], {"text": "会議を始めます。", "language": "ja"})

        self.assertEqual(ScriptedEngine.instances[0].live_config.language, "ja")


if __name__ == "__main__":
    unittest.main()
