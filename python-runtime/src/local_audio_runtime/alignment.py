from __future__ import annotations

import copy
import logging
import unicodedata
from typing import Any

import numpy as np

from .backends import _import_whisperx_modules, release_accelerator_memory, resolve_device
from .config import RuntimeConfig

logger = logging.getLogger(__name__)


def _read_time(value: Any) -> float | None:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    return parsed if np.isfinite(parsed) else None


def _normalize_aligned_word(word: dict[str, Any], index: int) -> dict[str, Any] | None:
    start = _read_time(word.get("start"))
    end = _read_time(word.get("end"))
    text = str(word.get("word", word.get("text", ""))).strip()
    if start is None or end is None or end < start or not text:
        return None

    return {
        "id": str(index),
        "word": text,
        "text": text,
        "start": round(start, 3),
        "end": round(end, 3),
        "probability": round(float(word.get("score", word.get("probability", 0.0)) or 0.0), 4),
    }


def _normalize_comparable_text(value: str) -> str:
    normalized = unicodedata.normalize("NFKC", value).lower()
    return "".join(character for character in normalized if character.isalnum())


def _words_cover_text(words: list[dict[str, Any]], text: str) -> bool:
    return bool(words) and _normalize_comparable_text(
        "".join(str(word.get("text", word.get("word", ""))) for word in words)
    ) == _normalize_comparable_text(text)


def _assign_words_to_authoritative_segments(
    segments: list[dict[str, Any]],
    aligned_words: list[dict[str, Any]],
) -> list[list[dict[str, Any]]]:
    assignments: list[list[dict[str, Any]]] = [[] for _ in segments]
    bounds = [
        (
            _read_time(segment.get("start")) or 0.0,
            _read_time(segment.get("end")) or (_read_time(segment.get("start")) or 0.0),
        )
        for segment in segments
    ]

    for word in aligned_words:
        word_start = float(word["start"])
        word_end = float(word["end"])
        midpoint = (word_start + word_end) / 2
        best_index: int | None = None
        best_overlap = 0.0
        best_distance = float("inf")

        for index, (segment_start, segment_end) in enumerate(bounds):
            overlap = max(0.0, min(word_end, segment_end) - max(word_start, segment_start))
            if overlap > best_overlap:
                best_index = index
                best_overlap = overlap
                continue

            if best_overlap > 0:
                continue

            distance = (
                0.0
                if segment_start <= midpoint <= segment_end
                else min(abs(midpoint - segment_start), abs(midpoint - segment_end))
            )
            if distance < best_distance:
                best_index = index
                best_distance = distance

        # Do not attach a distant alignment artefact to an unrelated segment.
        if best_index is not None and (best_overlap > 0 or best_distance <= 0.5):
            assignments[best_index].append(word)

    return assignments


class WhisperXAlignmentEngine:
    """Optional timestamp refinement that never replaces authoritative ASR text."""

    def __init__(self, config: RuntimeConfig) -> None:
        self._device = resolve_device(config.device)
        self._model: Any | None = None
        self._metadata: Any | None = None
        self._language: str | None = None

    def load(self, language_code: str) -> None:
        if self._model is not None and self._metadata is not None and self._language == language_code:
            return

        whisperx, _ = _import_whisperx_modules()
        self._model, self._metadata = whisperx.load_align_model(
            language_code=language_code,
            device=self._device,
        )
        self._language = language_code

    def unload(self) -> None:
        self._model = None
        self._metadata = None
        self._language = None
        release_accelerator_memory()

    def align(
        self,
        result: dict[str, Any],
        audio: np.ndarray,
        *,
        language_code: str,
    ) -> dict[str, Any]:
        original = copy.deepcopy(result)
        original_segments = original.get("segments")
        if not isinstance(original_segments, list) or not original_segments:
            return original

        self.load(language_code)
        if self._model is None or self._metadata is None:
            return original

        whisperx, _ = _import_whisperx_modules()
        aligned = whisperx.align(
            [
                {
                    "start": segment.get("start", 0.0),
                    "end": segment.get("end", segment.get("start", 0.0)),
                    "text": str(segment.get("text", "")),
                }
                for segment in original_segments
            ],
            self._model,
            self._metadata,
            audio,
            self._device,
            return_char_alignments=False,
        )

        normalized_words: list[dict[str, Any]] = []
        for aligned_segment in aligned.get("segments", []):
            for word in aligned_segment.get("words", []):
                normalized = _normalize_aligned_word(word, len(normalized_words) + 1)
                if normalized is not None:
                    normalized_words.append(normalized)

        if not normalized_words:
            logger.warning("WhisperX alignment returned no usable word timestamps; preserving raw ASR output")
            warnings = list(original.get("warnings", []))
            warnings.append("WhisperX alignment returned no usable timestamps; raw ASR timestamps were preserved.")
            original["warnings"] = warnings
            return original

        assignments = _assign_words_to_authoritative_segments(original_segments, normalized_words)
        alignment_applied = False
        incomplete_alignment = False
        for index, segment in enumerate(original_segments):
            # Text and segment boundaries intentionally remain the
            # faster-whisper values. Alignment may enrich timestamps, never
            # rewrite or filter the authoritative transcript.
            if _words_cover_text(assignments[index], str(segment.get("text", ""))):
                segment["words"] = assignments[index]
                alignment_applied = True
            elif assignments[index]:
                incomplete_alignment = True

        original["segments"] = original_segments
        segment_words = [
            word
            for segment in original_segments
            for word in segment.get("words", [])
            if isinstance(word, dict)
        ]
        if segment_words:
            original["words"] = segment_words
        if alignment_applied:
            original["alignment_backend"] = "whisperx"
        if incomplete_alignment:
            warnings = list(original.get("warnings", []))
            warnings.append(
                "WhisperX alignment omitted transcript characters in one or more segments; "
                "raw ASR word timestamps were preserved for those segments."
            )
            original["warnings"] = warnings
        return original
