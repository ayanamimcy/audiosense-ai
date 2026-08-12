from __future__ import annotations

import threading
import unittest

from local_audio_runtime.cancellation import (
    CancellationRegistry,
    TranscriptionCancelledError,
)


class CancellationRegistryTests(unittest.TestCase):
    def test_active_request_can_be_cancelled_and_cleaned_up(self) -> None:
        registry = CancellationRegistry()
        event = registry.begin("job-1")

        self.assertTrue(registry.cancel("job-1"))
        with self.assertRaises(TranscriptionCancelledError):
            registry.raise_if_cancelled(event)

        registry.finish("job-1", event)
        self.assertNotIn("job-1", registry._events)

    def test_finishing_old_event_does_not_remove_new_request(self) -> None:
        registry = CancellationRegistry()
        old_event = registry.begin("job-1")
        new_event = registry.begin("job-1")

        registry.finish("job-1", old_event)
        self.assertTrue(registry.cancel("job-1"))
        self.assertTrue(new_event.is_set())

    def test_cancel_before_begin_is_applied_when_request_registers(self) -> None:
        registry = CancellationRegistry()
        self.assertTrue(registry.cancel("job-early"))
        event = registry.begin("job-early")
        with self.assertRaises(TranscriptionCancelledError):
            registry.raise_if_cancelled(event)

        registry.raise_if_cancelled(threading.Event())


if __name__ == "__main__":
    unittest.main()
