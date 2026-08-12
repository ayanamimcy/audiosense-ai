from __future__ import annotations

from dataclasses import asdict
import logging
import os
import threading
from typing import Any, Callable

import numpy as np

from .audio_utils import get_audio_duration_seconds, load_audio, normalize_audio_peak
from .alignment import WhisperXAlignmentEngine
from .backends import BackendLoadSpec, BaseBackend, create_backend, release_accelerator_memory
from .config import RuntimeConfig
from .diarization import DiarizationEngine
from .parallel_diarize import transcribe_and_diarize, transcribe_then_diarize

logger = logging.getLogger(__name__)

CancellationCheck = Callable[[], None]


def _check_cancelled(cancellation_check: CancellationCheck | None) -> None:
    if cancellation_check is not None:
        cancellation_check()


_DEFAULT_IDLE_TIMEOUT_SECONDS = int(
    os.environ.get("LOCAL_AUDIO_ENGINE_IDLE_UNLOAD_SECONDS", "300")
)


class ModelManager:
    def __init__(self, config: RuntimeConfig) -> None:
        self._config = config
        self._backend: BaseBackend | None = None
        self._backend_spec: BackendLoadSpec | None = None
        self._diarization_engine: DiarizationEngine | None = None
        self._alignment_engine: WhisperXAlignmentEngine | None = None
        self._lock = threading.RLock()
        self._transcription_lock = threading.RLock()
        self._idle_timer: threading.Timer | None = None
        self._idle_timeout = _DEFAULT_IDLE_TIMEOUT_SECONDS

    def _reset_idle_timer(self) -> None:
        if self._idle_timeout <= 0:
            return
        if self._idle_timer is not None:
            self._idle_timer.cancel()
        self._idle_timer = threading.Timer(self._idle_timeout, self._idle_unload)
        self._idle_timer.daemon = True
        self._idle_timer.start()

    def _cancel_idle_timer(self) -> None:
        if self._idle_timer is not None:
            self._idle_timer.cancel()
            self._idle_timer = None

    def _idle_unload(self) -> None:
        with self._transcription_lock:
            logger.info("Idle timeout reached (%ds) — unloading models to free memory", self._idle_timeout)
            self.unload_backend()
            with self._lock:
                if self._diarization_engine is not None:
                    self._diarization_engine.unload()
                    self._diarization_engine = None
                if self._alignment_engine is not None:
                    self._alignment_engine.unload()
                    self._alignment_engine = None
            release_accelerator_memory()

    def _resolve_backend_spec(
        self,
        *,
        backend: str | None = None,
        model_name: str | None = None,
    ) -> BackendLoadSpec:
        return BackendLoadSpec(
            backend=(backend or self._config.backend).strip().lower(),
            model_name=model_name or self._config.model_name,
            device=self._config.device,
            compute_type=self._config.compute_type,
            batch_size=self._config.batch_size,
            download_root=self._config.download_root,
        )

    def _ensure_backend(self, *, backend: str | None = None, model_name: str | None = None) -> BaseBackend:
        spec = self._resolve_backend_spec(backend=backend, model_name=model_name)
        self._cancel_idle_timer()

        with self._lock:
            if self._backend is not None and self._backend_spec == spec:
                return self._backend

            if self._backend is not None:
                self._backend.unload()

            runtime_backend = create_backend(self._config, spec.backend)
            runtime_backend.load(spec)
            self._backend = runtime_backend
            self._backend_spec = spec
            return runtime_backend

    def _ensure_diarization_engine(self) -> DiarizationEngine:
        with self._lock:
            if self._diarization_engine is None:
                self._diarization_engine = DiarizationEngine(self._config)
            return self._diarization_engine

    def _ensure_alignment_engine(self) -> WhisperXAlignmentEngine:
        with self._lock:
            if self._alignment_engine is None:
                self._alignment_engine = WhisperXAlignmentEngine(self._config)
            return self._alignment_engine

    def preload(self) -> None:
        self._ensure_backend()
        self._reset_idle_timer()

    def unload_backend(self) -> None:
        with self._lock:
            if self._backend is None:
                return
            self._backend.unload()
            self._backend = None
            self._backend_spec = None
        release_accelerator_memory()

    def unload_alignment(self) -> None:
        with self._lock:
            if self._alignment_engine is None:
                return
            self._alignment_engine.unload()
            self._alignment_engine = None

    def _unload_transcription_stage(self) -> None:
        self.unload_backend()
        self.unload_alignment()

    def _apply_optional_alignment(
        self,
        result: dict[str, Any],
        audio_data: np.ndarray,
        *,
        runtime_backend: BaseBackend,
        task: str,
        language: str | None,
        cancellation_check: CancellationCheck | None = None,
    ) -> dict[str, Any]:
        _check_cancelled(cancellation_check)
        if (
            not self._config.whisperx_alignment
            or runtime_backend.backend_name != "faster-whisper"
            or task == "translate"
            or not result.get("segments")
        ):
            return result

        language_code = str(result.get("language") or language or "").strip()
        if not language_code:
            warnings = list(result.get("warnings", []))
            warnings.append("WhisperX alignment skipped because the transcription language is unknown.")
            result["warnings"] = warnings
            return result

        try:
            aligned = self._ensure_alignment_engine().align(
                result,
                audio_data,
                language_code=language_code,
            )
        except Exception as exc:
            logger.warning("Optional WhisperX alignment failed; preserving raw ASR output: %s", exc)
            warnings = list(result.get("warnings", []))
            warnings.append("Optional WhisperX alignment failed; raw ASR output was preserved.")
            result["warnings"] = warnings
            return result
        _check_cancelled(cancellation_check)
        return aligned

    def _transcribe_audio_with_backend(
        self,
        audio_data: np.ndarray,
        *,
        sample_rate: int,
        language: str | None = None,
        task: str = "transcribe",
        translation_target_language: str | None = None,
        word_timestamps: bool = False,
        initial_prompt: str | None = None,
        suppress_tokens: list[int] | None = None,
        backend: str | None = None,
        model_name: str | None = None,
        backend_instance: BaseBackend | None = None,
        cancellation_check: CancellationCheck | None = None,
    ) -> dict[str, Any]:
        _check_cancelled(cancellation_check)
        runtime_backend = backend_instance or self._ensure_backend(backend=backend, model_name=model_name)
        result = runtime_backend.transcribe(
            audio_data,
            audio_sample_rate=sample_rate,
            language=language,
            task=task,
            beam_size=self._config.beam_size,
            initial_prompt=initial_prompt,
            suppress_tokens=suppress_tokens,
            word_timestamps=word_timestamps,
            vad_filter=self._config.vad_filter,
            translation_target_language=translation_target_language,
            cancellation_check=cancellation_check,
        )
        _check_cancelled(cancellation_check)
        return result

    def transcribe_audio(
        self,
        *,
        audio_data: np.ndarray,
        sample_rate: int = 16000,
        language: str | None = None,
        diarization: bool = False,
        word_timestamps: bool = False,
        task: str = "transcribe",
        translation_target_language: str | None = None,
        expected_speakers: int | None = None,
        backend: str | None = None,
        model_name: str | None = None,
        initial_prompt: str | None = None,
        suppress_tokens: list[int] | None = None,
        diarization_strategy: str | None = None,
        hf_token: str | None = None,
        backend_instance: BaseBackend | None = None,
        cancellation_check: CancellationCheck | None = None,
    ) -> dict[str, Any]:
        with self._transcription_lock:
          try:
            _check_cancelled(cancellation_check)
            runtime_backend = backend_instance or self._ensure_backend(backend=backend, model_name=model_name)
            _check_cancelled(cancellation_check)

            if self._config.normalize_audio:
                audio_data = normalize_audio_peak(audio_data)
            _check_cancelled(cancellation_check)

            effective_task = (task or "transcribe").strip().lower()
            effective_target = (
                translation_target_language
                if translation_target_language is not None
                else self._config.translation_target_language
            )
            effective_word_timestamps = bool(word_timestamps or diarization)

            if diarization and runtime_backend.supports_integrated_diarization() and self._config.prefer_integrated_diarization:
                logger.info("Using integrated diarization path for backend=%s", runtime_backend.backend_name)
                result = runtime_backend.transcribe_with_diarization(
                    audio_data,
                    audio_sample_rate=sample_rate,
                    language=language,
                    task=effective_task,
                    beam_size=self._config.beam_size,
                    initial_prompt=initial_prompt,
                    suppress_tokens=suppress_tokens,
                    translation_target_language=effective_target,
                    num_speakers=expected_speakers,
                    hf_token=hf_token or self._config.hf_token,
                    cancellation_check=cancellation_check,
                )
                if result is not None:
                    _check_cancelled(cancellation_check)
                    result["duration"] = get_audio_duration_seconds(audio_data, sample_rate)
                    result["backend"] = runtime_backend.backend_name
                    result["model_name"] = runtime_backend.model_name
                    return result

            if not diarization:
                result = self._transcribe_audio_with_backend(
                    audio_data,
                    sample_rate=sample_rate,
                    language=language,
                    task=effective_task,
                    translation_target_language=effective_target,
                    word_timestamps=effective_word_timestamps,
                    initial_prompt=initial_prompt,
                    suppress_tokens=suppress_tokens,
                    backend=backend,
                    model_name=model_name,
                    backend_instance=runtime_backend,
                    cancellation_check=cancellation_check,
                )
                result = self._apply_optional_alignment(
                    result,
                    audio_data,
                    runtime_backend=runtime_backend,
                    task=effective_task,
                    language=language,
                    cancellation_check=cancellation_check,
                )
                _check_cancelled(cancellation_check)
                result["duration"] = get_audio_duration_seconds(audio_data, sample_rate)
                result["backend"] = runtime_backend.backend_name
                result["model_name"] = runtime_backend.model_name
                self._reset_idle_timer()
                return result

            strategy = (diarization_strategy or self._config.diarization_strategy or "auto").strip().lower()
            if strategy not in {"auto", "parallel", "sequential"}:
                strategy = "auto"

            diarization_engine = self._ensure_diarization_engine()
            backend_spec = self._resolve_backend_spec(backend=backend, model_name=model_name)

            def transcribe_fn() -> dict[str, Any]:
                raw_result = self._transcribe_audio_with_backend(
                    audio_data,
                    sample_rate=sample_rate,
                    language=language,
                    task=effective_task,
                    translation_target_language=effective_target,
                    word_timestamps=effective_word_timestamps,
                    initial_prompt=initial_prompt,
                    suppress_tokens=suppress_tokens,
                    backend=backend_spec.backend,
                    model_name=backend_spec.model_name,
                    cancellation_check=cancellation_check,
                )
                return self._apply_optional_alignment(
                    raw_result,
                    audio_data,
                    runtime_backend=runtime_backend,
                    task=effective_task,
                    language=language,
                    cancellation_check=cancellation_check,
                )

            def diarize_fn() -> list[dict[str, Any]]:
                _check_cancelled(cancellation_check)
                diarization_segments = diarization_engine.diarize(
                    audio_data,
                    sample_rate=sample_rate,
                    num_speakers=expected_speakers,
                    hf_token=hf_token,
                    exclusive=self._config.exclusive_diarization,
                )
                _check_cancelled(cancellation_check)
                return diarization_segments

            # Optional alignment adds a second GPU model. In auto mode, finish
            # and unload the transcription/alignment stage before diarization
            # to avoid keeping all three model families resident together.
            use_parallel = strategy == "parallel" or (
                strategy == "auto" and not self._config.whisperx_alignment
            )
            if use_parallel:
                result, diarization_segments = transcribe_and_diarize(
                    transcribe_fn=transcribe_fn,
                    diarize_fn=diarize_fn,
                )
            else:
                result, diarization_segments = transcribe_then_diarize(
                    transcribe_fn=transcribe_fn,
                    diarize_fn=diarize_fn,
                    unload_transcription_model=self._unload_transcription_stage
                    if self._config.sequential_unload_between_stages
                    else None,
                    reload_transcription_model=lambda: self._ensure_backend(
                        backend=backend_spec.backend,
                        model_name=backend_spec.model_name,
                    )
                    if self._config.sequential_unload_between_stages
                    else None,
                )

            _check_cancelled(cancellation_check)

            warnings = list(result.get("warnings", []))
            result["diarization_segments"] = diarization_segments or []
            result["duration"] = get_audio_duration_seconds(audio_data, sample_rate)
            result["backend"] = runtime_backend.backend_name
            result["model_name"] = runtime_backend.model_name
            if not result.get("words"):
                warnings.append(
                    "Transcription backend did not return word timestamps; diarization merge quality may be limited."
                )
            if warnings:
                result["warnings"] = warnings
            return result
          finally:
            self._reset_idle_timer()

    def transcribe_file(
        self,
        *,
        file_path: str,
        language: str | None = None,
        diarization: bool = False,
        word_timestamps: bool = False,
        task: str = "transcribe",
        translation_target_language: str | None = None,
        expected_speakers: int | None = None,
        backend: str | None = None,
        model_name: str | None = None,
        diarization_strategy: str | None = None,
        hf_token: str | None = None,
        cancellation_check: CancellationCheck | None = None,
    ) -> dict[str, Any]:
        _check_cancelled(cancellation_check)
        runtime_backend = self._ensure_backend(backend=backend, model_name=model_name)
        _check_cancelled(cancellation_check)
        audio, sample_rate = load_audio(file_path, target_sample_rate=16000)
        _check_cancelled(cancellation_check)
        return self.transcribe_audio(
            audio_data=audio,
            sample_rate=sample_rate,
            language=language,
            diarization=diarization,
            word_timestamps=word_timestamps,
            task=task,
            translation_target_language=translation_target_language,
            expected_speakers=expected_speakers,
            backend=backend,
            model_name=model_name,
            diarization_strategy=diarization_strategy,
            hf_token=hf_token,
            backend_instance=runtime_backend,
            cancellation_check=cancellation_check,
        )

    def health(self) -> dict[str, Any]:
        config = asdict(self._config)
        if config.get("hf_token"):
            config["hf_token"] = "<set>"

        return {
            "backend_loaded": self._backend is not None,
            "backend": self._backend.backend_name if self._backend is not None else None,
            "model_name": self._backend.model_name if self._backend is not None else None,
            "device": self._backend.device if self._backend is not None else None,
            "diarization_loaded": self._diarization_engine is not None and self._diarization_engine._pipeline is not None,
            "alignment_loaded": self._alignment_engine is not None and self._alignment_engine._model is not None,
            "config": config,
        }
