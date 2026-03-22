from __future__ import annotations

from dataclasses import dataclass, replace
import importlib
import inspect
import logging
import os
from typing import Any, Callable

import numpy as np

from .config import RuntimeConfig
from .torchaudio_compat import ensure_torchaudio_compat, patch_loaded_huggingface_aliases

logger = logging.getLogger(__name__)

SAMPLE_RATE = 16000


def resolve_device(device: str) -> str:
    if device != "auto":
        return device

    try:
        import torch

        return "cuda" if torch.cuda.is_available() else "cpu"
    except Exception:
        return "cpu"


def _import_whisperx_modules(*, include_diarize: bool = False) -> tuple[Any, Any | None]:
    ensure_torchaudio_compat()
    whisperx = importlib.import_module("whisperx")
    if include_diarize:
        diarize_module = importlib.import_module("whisperx.diarize")
    else:
        diarize_module = None
    patch_loaded_huggingface_aliases()
    return whisperx, diarize_module


@dataclass(slots=True)
class BackendLoadSpec:
    backend: str
    model_name: str
    device: str
    compute_type: str
    batch_size: int
    download_root: str | None


class BaseBackend:
    backend_name = "base"
    preferred_input_sample_rate_hz = SAMPLE_RATE

    def __init__(self) -> None:
        self.model_name: str | None = None
        self.device = "cpu"

    def load(self, spec: BackendLoadSpec) -> None:
        raise NotImplementedError

    def unload(self) -> None:
        raise NotImplementedError

    def supports_translation(self) -> bool:
        return False

    def supports_integrated_diarization(self) -> bool:
        return False

    def transcribe(
        self,
        audio: np.ndarray,
        *,
        audio_sample_rate: int,
        language: str | None,
        task: str,
        beam_size: int,
        initial_prompt: str | None = None,
        suppress_tokens: list[int] | None = None,
        word_timestamps: bool,
        vad_filter: bool,
        translation_target_language: str | None,
        progress_callback: Callable[[int, int], None] | None = None,
    ) -> dict[str, Any]:
        raise NotImplementedError

    def transcribe_with_diarization(
        self,
        audio: np.ndarray,
        *,
        audio_sample_rate: int,
        language: str | None,
        task: str,
        beam_size: int,
        initial_prompt: str | None = None,
        suppress_tokens: list[int] | None = None,
        translation_target_language: str | None = None,
        num_speakers: int | None = None,
        hf_token: str | None = None,
        progress_callback: Callable[[int, int], None] | None = None,
    ) -> dict[str, Any] | None:
        del (
            audio,
            audio_sample_rate,
            language,
            task,
            beam_size,
            initial_prompt,
            suppress_tokens,
            translation_target_language,
            num_speakers,
            hf_token,
            progress_callback,
        )
        return None


class FasterWhisperBackend(BaseBackend):
    backend_name = "faster-whisper"

    def __init__(self) -> None:
        super().__init__()
        self._model: Any | None = None

    def load(self, spec: BackendLoadSpec) -> None:
        from faster_whisper import WhisperModel

        device = resolve_device(spec.device)
        logger.info("Loading faster-whisper model=%s device=%s", spec.model_name, device)
        self._model = WhisperModel(
            spec.model_name,
            device=device,
            compute_type=spec.compute_type,
            download_root=spec.download_root,
        )
        self.model_name = spec.model_name
        self.device = device

    def unload(self) -> None:
        self._model = None

    def supports_translation(self) -> bool:
        return True

    def transcribe(
        self,
        audio: np.ndarray,
        *,
        audio_sample_rate: int,
        language: str | None,
        task: str,
        beam_size: int,
        initial_prompt: str | None = None,
        suppress_tokens: list[int] | None = None,
        word_timestamps: bool,
        vad_filter: bool,
        translation_target_language: str | None,
        progress_callback: Callable[[int, int], None] | None = None,
    ) -> dict[str, Any]:
        del audio_sample_rate, progress_callback
        if self._model is None:
            raise RuntimeError("faster-whisper model is not loaded")

        if task == "translate" and translation_target_language not in {None, "", "en"}:
            raise ValueError("Local faster-whisper translation currently supports only English output.")

        segments_iter, info = self._model.transcribe(
            audio,
            language=language or None,
            task=task,
            beam_size=beam_size,
            vad_filter=vad_filter,
            word_timestamps=word_timestamps,
            initial_prompt=initial_prompt,
            suppress_tokens=suppress_tokens,
            condition_on_previous_text=False,
        )

        segments: list[dict[str, Any]] = []
        words: list[dict[str, Any]] = []
        text_parts: list[str] = []

        for index, segment in enumerate(segments_iter, start=1):
            segment_words = []
            if word_timestamps and getattr(segment, "words", None):
                for word_index, word in enumerate(segment.words, start=1):
                    if word.start is None or word.end is None:
                        continue
                    word_text = word.word.strip()
                    word_dict = {
                        "id": f"{index}-{word_index}",
                        "word": word_text,
                        "text": word_text,
                        "start": round(float(word.start), 3),
                        "end": round(float(word.end), 3),
                        "probability": round(float(getattr(word, "probability", 0.0) or 0.0), 4),
                    }
                    segment_words.append(word_dict)
                    words.append(word_dict)

            text = (segment.text or "").strip()
            text_parts.append(text)
            segments.append(
                {
                    "id": str(index),
                    "text": text,
                    "start": round(float(segment.start), 3),
                    "end": round(float(segment.end), 3),
                    "words": segment_words,
                }
            )

        return {
            "text": " ".join(part for part in text_parts if part).strip(),
            "segments": segments,
            "words": words,
            "language": getattr(info, "language", None),
            "language_probability": round(float(getattr(info, "language_probability", 0.0) or 0.0), 4),
        }


class WhisperXBackend(BaseBackend):
    backend_name = "whisperx"

    def __init__(self) -> None:
        super().__init__()
        self._model: Any | None = None
        self._align_model: Any | None = None
        self._align_metadata: Any | None = None
        self._align_language: str | None = None
        self._batch_size = 16
        self._transcribe_param_names: set[str] | None = None
        self._compat_mode_logged = False

    def load(self, spec: BackendLoadSpec) -> None:
        whisperx, _ = _import_whisperx_modules()
        device = resolve_device(spec.device)
        logger.info("Loading whisperx model=%s device=%s", spec.model_name, device)
        self._model = whisperx.load_model(
            spec.model_name,
            device=device,
            compute_type=spec.compute_type,
            download_root=spec.download_root,
        )
        self.model_name = spec.model_name
        self.device = device
        self._batch_size = spec.batch_size
        self._transcribe_param_names = None
        self._compat_mode_logged = False

    def unload(self) -> None:
        self._model = None
        self._align_model = None
        self._align_metadata = None
        self._align_language = None
        self._transcribe_param_names = None
        self._compat_mode_logged = False

    def supports_translation(self) -> bool:
        return True

    def supports_integrated_diarization(self) -> bool:
        return True

    def _get_transcribe_param_names(self) -> set[str]:
        if self._model is None:
            raise RuntimeError("WhisperX model is not loaded")

        if self._transcribe_param_names is None:
            try:
                self._transcribe_param_names = set(inspect.signature(self._model.transcribe).parameters)
            except (TypeError, ValueError):
                self._transcribe_param_names = {
                    "audio",
                    "batch_size",
                    "language",
                    "task",
                    "beam_size",
                    "initial_prompt",
                    "suppress_tokens",
                }

        return self._transcribe_param_names

    def _whisperx_transcribe(
        self,
        audio: np.ndarray,
        *,
        language: str | None,
        task: str,
        beam_size: int,
        initial_prompt: str | None,
        suppress_tokens: list[int] | None,
    ) -> dict[str, Any]:
        if self._model is None:
            raise RuntimeError("WhisperX model is not loaded")

        param_names = self._get_transcribe_param_names()
        kwargs: dict[str, Any] = {
            "language": language,
            "task": task,
        }

        if "batch_size" in param_names:
            kwargs["batch_size"] = self._batch_size

        patch_fields: dict[str, Any] = {}
        compat_fields: set[str] = set()

        if "beam_size" in param_names:
            kwargs["beam_size"] = beam_size
        else:
            patch_fields["beam_size"] = beam_size
            compat_fields.add("beam_size")

        if initial_prompt is not None:
            if "initial_prompt" in param_names:
                kwargs["initial_prompt"] = initial_prompt
            else:
                patch_fields["initial_prompt"] = initial_prompt
                compat_fields.add("initial_prompt")

        if suppress_tokens is not None:
            if "suppress_tokens" in param_names:
                kwargs["suppress_tokens"] = suppress_tokens
            else:
                patch_fields["suppress_tokens"] = suppress_tokens
                compat_fields.add("suppress_tokens")

        previous_options: Any | None = None
        options_patched = False

        if compat_fields:
            if not self._compat_mode_logged:
                logger.info(
                    "WhisperX compatibility mode enabled: patching decode options via pipeline.options (%s)",
                    ", ".join(sorted(compat_fields)),
                )
                self._compat_mode_logged = True

            options_obj = getattr(self._model, "options", None)
            if options_obj is not None and patch_fields:
                available_fields = getattr(options_obj, "__dataclass_fields__", None)
                if isinstance(available_fields, dict):
                    patch_fields = {key: value for key, value in patch_fields.items() if key in available_fields}

                if patch_fields:
                    previous_options = options_obj
                    self._model.options = replace(options_obj, **patch_fields)
                    options_patched = True

        try:
            return self._model.transcribe(audio, **kwargs)
        finally:
            if options_patched:
                self._model.options = previous_options

    def _ensure_align_model(self, language_code: str) -> None:
        whisperx, _ = _import_whisperx_modules()

        if (
            self._align_model is not None
            and self._align_metadata is not None
            and self._align_language == language_code
        ):
            return

        self._align_model, self._align_metadata = whisperx.load_align_model(
            language_code=language_code,
            device=self.device,
        )
        self._align_language = language_code

    def _align(
        self,
        wx_result: dict[str, Any],
        audio: np.ndarray,
        language_code: str | None,
    ) -> dict[str, Any]:
        if not language_code:
            return wx_result

        whisperx, _ = _import_whisperx_modules()
        self._ensure_align_model(str(language_code))
        aligned = whisperx.align(
            wx_result["segments"],
            self._align_model,
            self._align_metadata,
            audio,
            self.device,
            return_char_alignments=False,
        )
        aligned["language"] = language_code
        return aligned

    def transcribe(
        self,
        audio: np.ndarray,
        *,
        audio_sample_rate: int,
        language: str | None,
        task: str,
        beam_size: int,
        initial_prompt: str | None = None,
        suppress_tokens: list[int] | None = None,
        word_timestamps: bool,
        vad_filter: bool,
        translation_target_language: str | None,
        progress_callback: Callable[[int, int], None] | None = None,
    ) -> dict[str, Any]:
        del audio_sample_rate, vad_filter, translation_target_language, progress_callback
        if self._model is None:
            raise RuntimeError("whisperx model is not loaded")

        wx_result = self._whisperx_transcribe(
            audio,
            language=language or None,
            task=task,
            beam_size=beam_size,
            initial_prompt=initial_prompt,
            suppress_tokens=suppress_tokens,
        )
        detected_language = wx_result.get("language") or language

        if word_timestamps and wx_result.get("segments"):
            try:
                wx_result = self._align(wx_result, audio, str(detected_language) if detected_language else None)
            except Exception as exc:
                logger.warning("WhisperX alignment failed: %s", exc)

        return self._normalize_whisperx_output(wx_result, detected_language)

    def transcribe_with_diarization(
        self,
        audio: np.ndarray,
        *,
        audio_sample_rate: int,
        language: str | None,
        task: str,
        beam_size: int,
        initial_prompt: str | None = None,
        suppress_tokens: list[int] | None = None,
        translation_target_language: str | None = None,
        num_speakers: int | None = None,
        hf_token: str | None = None,
        progress_callback: Callable[[int, int], None] | None = None,
    ) -> dict[str, Any] | None:
        del audio_sample_rate, translation_target_language, progress_callback
        whisperx, diarize_module = _import_whisperx_modules(include_diarize=True)
        if diarize_module is None:
            raise RuntimeError("WhisperX diarization module failed to import")

        if self._model is None:
            raise RuntimeError("whisperx model is not loaded")

        token = hf_token or os.environ.get("HUGGINGFACE_TOKEN") or os.environ.get("HF_TOKEN")
        if not token:
            raise ValueError(
                "HuggingFace token required for integrated WhisperX diarization. "
                "Set HUGGINGFACE_TOKEN or HF_TOKEN."
            )

        wx_result = self._whisperx_transcribe(
            audio,
            language=language or None,
            task=task,
            beam_size=beam_size,
            initial_prompt=initial_prompt,
            suppress_tokens=suppress_tokens,
        )
        detected_language = wx_result.get("language") or language

        if wx_result.get("segments"):
            try:
                wx_result = self._align(wx_result, audio, str(detected_language) if detected_language else None)
            except Exception as exc:
                logger.warning("WhisperX alignment failed during integrated diarization: %s", exc)

        diarization_pipeline = diarize_module.DiarizationPipeline(use_auth_token=token, device=self.device)
        diarize_kwargs: dict[str, Any] = {}
        if num_speakers is not None:
            diarize_kwargs["min_speakers"] = num_speakers
            diarize_kwargs["max_speakers"] = num_speakers

        diarize_segments = diarization_pipeline(audio, **diarize_kwargs)
        wx_result = whisperx.assign_word_speakers(diarize_segments, wx_result)
        normalized = self._normalize_whisperx_output(wx_result, detected_language, include_speakers=True)
        normalized["num_speakers"] = len({segment.get("speaker") for segment in normalized["segments"] if segment.get("speaker")})
        return normalized

    def _normalize_whisperx_output(
        self,
        wx_result: dict[str, Any],
        detected_language: str | None,
        *,
        include_speakers: bool = False,
    ) -> dict[str, Any]:
        segments: list[dict[str, Any]] = []
        words: list[dict[str, Any]] = []
        text_parts: list[str] = []

        for index, segment in enumerate(wx_result.get("segments", []), start=1):
            text = str(segment.get("text", "")).strip()
            speaker = str(segment.get("speaker", "")).strip() or None
            text_parts.append(text)
            segment_words = []
            for word_index, word in enumerate(segment.get("words", []), start=1):
                if "start" not in word or "end" not in word:
                    continue
                word_text = str(word.get("word", "")).strip()
                word_dict = {
                    "id": f"{index}-{word_index}",
                    "word": word_text,
                    "text": word_text,
                    "start": round(float(word.get("start", 0.0)), 3),
                    "end": round(float(word.get("end", 0.0)), 3),
                    "probability": round(float(word.get("score", 0.0) or 0.0), 4),
                }
                if include_speakers:
                    word_speaker = str(word.get("speaker", speaker or "")).strip()
                    if word_speaker:
                        word_dict["speaker"] = word_speaker
                segment_words.append(word_dict)
                words.append(word_dict)

            segment_dict = {
                "id": str(index),
                "text": text,
                "start": round(float(segment.get("start", 0.0)), 3),
                "end": round(float(segment.get("end", 0.0)), 3),
                "words": segment_words,
            }
            if include_speakers and speaker:
                segment_dict["speaker"] = speaker
            segments.append(segment_dict)

        return {
            "text": " ".join(part for part in text_parts if part).strip(),
            "segments": segments,
            "words": words,
            "language": detected_language,
            "language_probability": 0.0,
        }


def create_backend(config: RuntimeConfig, backend_name: str) -> BaseBackend:
    del config
    normalized = backend_name.strip().lower()
    if normalized in {"faster-whisper", "whisper"}:
        return FasterWhisperBackend()
    if normalized == "whisperx":
        return WhisperXBackend()
    raise ValueError(f"Unsupported local backend: {backend_name}")
