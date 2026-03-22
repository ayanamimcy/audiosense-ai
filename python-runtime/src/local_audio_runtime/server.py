from __future__ import annotations

import asyncio
import json
import logging
from pathlib import Path
import struct

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from starlette.websockets import WebSocketState
import uvicorn

from .catalog import get_backend_catalog
from .config import load_config
from .live_engine import LiveModeConfig, LiveModeEngine, LiveModeState
from .model_manager import ModelManager
from .schemas import HealthResponse, TranscriptionRequest, TranscriptionResponse

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s [local-audio-runtime] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

config = load_config()
manager = ModelManager(config)
app = FastAPI(title="AudioSense Local Audio Runtime")
_active_live_session: LiveModeSession | None = None
_session_lock = asyncio.Lock()


@app.on_event("startup")
def on_startup() -> None:
    logger.info("Local audio runtime starting on %s:%s", config.host, config.port)
    if config.preload:
        try:
            manager.preload()
        except Exception:
            logger.exception("Failed to preload local transcription model")


@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    return HealthResponse(ok=True, runtime=manager.health())


@app.get("/capabilities")
def capabilities() -> dict[str, object]:
    catalog = get_backend_catalog()
    return {
        "backends": catalog.get("backends", []),
        "defaults": {
            "backend": config.backend,
            "model_name": config.model_name,
            "diarization_strategy": config.diarization_strategy,
        },
    }


@app.post("/transcribe", response_model=TranscriptionResponse)
def transcribe(payload: TranscriptionRequest) -> TranscriptionResponse:
    if not Path(payload.file_path).exists():
        raise HTTPException(status_code=404, detail="Audio file not found")

    try:
        result = manager.transcribe_file(
            file_path=payload.file_path,
            language=payload.language,
            diarization=payload.diarization,
            word_timestamps=payload.word_timestamps,
            task=payload.task,
            translation_target_language=payload.translation_target_language,
            expected_speakers=payload.expected_speakers,
            backend=payload.backend,
            model_name=payload.model_name,
            diarization_strategy=payload.diarization_strategy,
            hf_token=payload.hf_token,
        )
        return TranscriptionResponse(**result)
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Local transcription failed")
        raise HTTPException(status_code=500, detail=str(exc)) from exc


def _parse_audio_message(audio_data: bytes) -> tuple[bytes, int]:
    if len(audio_data) > 4:
        try:
            metadata_len = struct.unpack("<I", audio_data[:4])[0]
            if 0 < metadata_len <= len(audio_data) - 4:
                metadata_raw = audio_data[4 : 4 + metadata_len]
                metadata = json.loads(metadata_raw.decode("utf-8"))
                sample_rate = int(metadata.get("sample_rate", 16000))
                return audio_data[4 + metadata_len :], sample_rate
        except Exception:
            pass
    return audio_data, 16000


class LiveModeSession:
    def __init__(self, websocket: WebSocket) -> None:
        self.websocket = websocket
        self._loop = asyncio.get_running_loop()
        self._engine: LiveModeEngine | None = None
        self._message_queue: asyncio.Queue[dict[str, object]] = asyncio.Queue()
        self._running = False

    async def send_message(self, msg_type: str, data: dict | None = None) -> None:
        if self.websocket.client_state == WebSocketState.DISCONNECTED:
            return
        if self.websocket.application_state == WebSocketState.DISCONNECTED:
            return

        try:
            await self.websocket.send_json(
                {
                    "type": msg_type,
                    "data": data or {},
                    "timestamp": asyncio.get_event_loop().time(),
                }
            )
        except RuntimeError:
            logger.debug("Skipping websocket message after connection closed: %s", msg_type)

    def _queue_message(self, msg_type: str, data: dict | None = None) -> None:
        self._loop.call_soon_threadsafe(
            self._message_queue.put_nowait,
            {"type": msg_type, "data": data or {}},
        )

    def _on_sentence(self, text: str) -> None:
        self._queue_message("sentence", {"text": text})

    def _on_state_change(self, state: LiveModeState) -> None:
        self._queue_message("state", {"state": state.name})

    async def start_engine(self, config_data: dict | None = None) -> bool:
        if self._engine and self._engine.is_running:
            await self.send_message("error", {"message": "Engine already running"})
            return False

        live_config = LiveModeConfig()
        if config_data:
            if "backend" in config_data:
                live_config.backend = str(config_data["backend"] or "").strip().lower()
            if "model" in config_data:
                live_config.model = str(config_data["model"] or "").strip()
            if "language" in config_data:
                live_config.language = str(config_data["language"] or "").strip().lower()
            if "translation_enabled" in config_data:
                live_config.translation_enabled = bool(config_data["translation_enabled"])
            if "translation_target_language" in config_data:
                live_config.translation_target_language = str(
                    config_data["translation_target_language"] or "en"
                ).strip().lower()

        self._engine = LiveModeEngine(
            manager=manager,
            config=config,
            live_config=live_config,
            on_sentence=self._on_sentence,
            on_state_change=self._on_state_change,
        )
        if self._engine.start():
            self._running = True
            return True

        await self.send_message("error", {"message": "Failed to start live engine"})
        return False

    async def stop_engine(self) -> None:
        self._running = False
        if self._engine:
            self._engine.stop()
            self._engine = None
        await self.send_message("state", {"state": "STOPPED"})

    async def clear_history(self) -> None:
        if self._engine:
            self._engine.clear_history()
        await self.send_message("history_cleared", {})

    async def get_history(self) -> None:
        history = self._engine.sentence_history if self._engine else []
        await self.send_message("history", {"sentences": history})

    async def cleanup(self) -> None:
        await self.stop_engine()

    async def process_messages(self) -> None:
        while True:
            try:
                msg = await asyncio.wait_for(self._message_queue.get(), timeout=0.1)
                await self.send_message(str(msg["type"]), msg.get("data") if isinstance(msg.get("data"), dict) else {})
            except TimeoutError:
                if not self._running and self._message_queue.empty():
                    break
                continue


async def _handle_client_message(session: LiveModeSession, message: dict) -> None:
    msg_type = str(message.get("type", ""))
    data = message.get("data", {})
    if not isinstance(data, dict):
        data = {}

    if msg_type == "start":
        await session.start_engine(data.get("config") if isinstance(data.get("config"), dict) else {})
    elif msg_type == "stop":
        await session.stop_engine()
    elif msg_type == "get_history":
        await session.get_history()
    elif msg_type == "clear_history":
        await session.clear_history()
    elif msg_type == "ping":
        await session.send_message("pong", {})
    else:
        await session.send_message("error", {"message": f"Unknown message type: {msg_type}"})


@app.websocket("/ws/live")
async def live_mode_endpoint(websocket: WebSocket) -> None:
    global _active_live_session

    await websocket.accept()
    session: LiveModeSession | None = None

    try:
        async with _session_lock:
            if _active_live_session is not None:
                await websocket.send_json(
                    {
                        "type": "error",
                        "data": {"message": "Another Live Mode session is already active"},
                        "timestamp": asyncio.get_event_loop().time(),
                    }
                )
                await websocket.close()
                return

            session = LiveModeSession(websocket)
            _active_live_session = session

        await session.send_message("connected", {"mode": "live"})
        message_task = asyncio.create_task(session.process_messages())

        try:
            while True:
                message = await websocket.receive()

                if message.get("type") == "websocket.disconnect":
                    break

                if "bytes" in message and isinstance(message["bytes"], (bytes, bytearray)):
                    audio_payload, sample_rate = _parse_audio_message(bytes(message["bytes"]))
                    if session._engine and session._engine.is_running:
                        session._engine.feed_audio(audio_payload, sample_rate)
                    continue

                if "text" in message and message["text"]:
                    try:
                        decoded = json.loads(str(message["text"]))
                    except json.JSONDecodeError:
                        await session.send_message("error", {"message": "Invalid JSON message"})
                        continue
                    if isinstance(decoded, dict):
                        await _handle_client_message(session, decoded)
        finally:
            message_task.cancel()
            try:
                await message_task
            except asyncio.CancelledError:
                pass

    except WebSocketDisconnect:
        logger.info("Live Mode websocket disconnected")
    finally:
        if session is not None:
            await session.cleanup()
        async with _session_lock:
            if _active_live_session is session:
                _active_live_session = None


def main() -> None:
    uvicorn.run(
        app,
        host=config.host,
        port=config.port,
        log_level="info",
    )


if __name__ == "__main__":
    main()
