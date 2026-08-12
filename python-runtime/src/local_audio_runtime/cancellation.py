from __future__ import annotations

import threading
import time


class TranscriptionCancelledError(RuntimeError):
    def __init__(self) -> None:
        super().__init__("Transcription was cancelled.")


class CancellationRegistry:
    _PENDING_TTL_SECONDS = 300

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._events: dict[str, threading.Event] = {}
        self._pending: dict[str, float] = {}

    def _prune_pending(self) -> None:
        cutoff = time.monotonic() - self._PENDING_TTL_SECONDS
        self._pending = {
            request_id: created_at
            for request_id, created_at in self._pending.items()
            if created_at >= cutoff
        }

    def begin(self, request_id: str | None) -> threading.Event:
        event = threading.Event()
        if request_id:
            with self._lock:
                self._prune_pending()
                if self._pending.pop(request_id, None) is not None:
                    event.set()
                self._events[request_id] = event
        return event

    def cancel(self, request_id: str) -> bool:
        with self._lock:
            event = self._events.get(request_id)
            if event is None:
                self._prune_pending()
                self._pending[request_id] = time.monotonic()
                return True
            event.set()
            return True

    def finish(self, request_id: str | None, event: threading.Event) -> None:
        if not request_id:
            return
        with self._lock:
            if self._events.get(request_id) is event:
                self._events.pop(request_id, None)
            self._pending.pop(request_id, None)

    @staticmethod
    def raise_if_cancelled(event: threading.Event) -> None:
        if event.is_set():
            raise TranscriptionCancelledError()
