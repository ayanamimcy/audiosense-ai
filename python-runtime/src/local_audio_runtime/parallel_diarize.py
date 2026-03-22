from __future__ import annotations

import logging
from collections.abc import Callable
from concurrent.futures import Future, ThreadPoolExecutor
from typing import Any

logger = logging.getLogger(__name__)


def transcribe_then_diarize(
    *,
    transcribe_fn: Callable[[], dict[str, Any]],
    diarize_fn: Callable[[], list[dict[str, Any]]],
    unload_transcription_model: Callable[[], None] | None = None,
    reload_transcription_model: Callable[[], None] | None = None,
) -> tuple[dict[str, Any], list[dict[str, Any]] | None]:
    logger.info("Starting sequential transcription then diarization")
    result = transcribe_fn()

    if unload_transcription_model is not None:
        try:
            unload_transcription_model()
        except Exception:
            logger.warning("Failed to unload transcription backend before diarization", exc_info=True)

    try:
        diarization_segments = diarize_fn()
        return result, diarization_segments
    except Exception:
        logger.warning("Sequential diarization failed; returning transcript without speakers", exc_info=True)
        return result, None
    finally:
        if reload_transcription_model is not None:
            try:
                reload_transcription_model()
            except Exception:
                logger.warning("Failed to reload transcription backend after sequential diarization", exc_info=True)


def transcribe_and_diarize(
    *,
    transcribe_fn: Callable[[], dict[str, Any]],
    diarize_fn: Callable[[], list[dict[str, Any]]],
) -> tuple[dict[str, Any], list[dict[str, Any]] | None]:
    logger.info("Starting parallel transcription and diarization")

    transcribe_future: Future[dict[str, Any]]
    diarize_future: Future[list[dict[str, Any]]]

    with ThreadPoolExecutor(max_workers=2, thread_name_prefix="local_audio_parallel") as pool:
        transcribe_future = pool.submit(transcribe_fn)
        diarize_future = pool.submit(diarize_fn)

        result = transcribe_future.result()

        try:
            diarization_segments = diarize_future.result()
        except Exception:
            logger.warning("Parallel diarization failed; returning transcript without speakers", exc_info=True)
            diarization_segments = None

        return result, diarization_segments

