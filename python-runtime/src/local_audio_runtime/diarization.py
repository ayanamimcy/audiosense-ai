from __future__ import annotations

import inspect
import logging
from typing import Any

import numpy as np

from .config import RuntimeConfig
from .backends import release_accelerator_memory, resolve_device
from .torchaudio_compat import ensure_torchaudio_compat, patch_loaded_huggingface_aliases

logger = logging.getLogger(__name__)

PYANNOTE_MODEL_FALLBACKS: dict[str, tuple[str, ...]] = {
    "pyannote/speaker-diarization-community-1": ("pyannote/speaker-diarization-3.1",),
}


def _build_pipeline_token_kwargs(
    from_pretrained: Any,
    effective_hf_token: str,
) -> dict[str, str]:
    try:
        signature = inspect.signature(from_pretrained)
    except (TypeError, ValueError):
        return {"token": effective_hf_token}

    if "token" in signature.parameters:
        return {"token": effective_hf_token}
    if "use_auth_token" in signature.parameters:
        return {"use_auth_token": effective_hf_token}
    return {"token": effective_hf_token}


def _is_auth_kwarg_error(exc: TypeError) -> bool:
    message = str(exc)
    return "unexpected keyword argument" in message and (
        "'token'" in message or "'use_auth_token'" in message
    )


def _is_pipeline_compatibility_error(exc: TypeError) -> bool:
    message = str(exc)
    if "unexpected keyword argument" not in message:
        return False

    incompatible_fields = (
        "'plda'",
        "'embedding_batch_size'",
        "'segmentation_batch_size'",
        "'der_variant'",
    )
    return any(field in message for field in incompatible_fields)


def _get_candidate_models(model_name: str) -> list[str]:
    fallbacks = PYANNOTE_MODEL_FALLBACKS.get(model_name, ())
    return [model_name, *fallbacks]


def _load_pipeline(
    pipeline_cls: Any,
    *,
    model_name: str,
    effective_hf_token: str,
) -> Any:
    token_kwargs = _build_pipeline_token_kwargs(
        pipeline_cls.from_pretrained,
        effective_hf_token,
    )

    try:
        return pipeline_cls.from_pretrained(
            model_name,
            **token_kwargs,
        )
    except TypeError as exc:
        if not _is_auth_kwarg_error(exc):
            raise

        fallback_kwargs = (
            {"use_auth_token": effective_hf_token}
            if "token" in token_kwargs
            else {"token": effective_hf_token}
        )
        return pipeline_cls.from_pretrained(
            model_name,
            **fallback_kwargs,
        )


class DiarizationEngine:
    def __init__(self, config: RuntimeConfig) -> None:
        self._config = config
        self._pipeline: Any | None = None
        self._device = resolve_device(config.device)
        self._loaded_model_name: str | None = None

    def load(self, hf_token: str | None = None) -> None:
        if self._pipeline is not None:
            return

        effective_hf_token = hf_token or self._config.hf_token
        if not effective_hf_token:
            raise ValueError(
                "HF_TOKEN or LOCAL_AUDIO_ENGINE_HF_TOKEN is required for speaker diarization."
            )

        ensure_torchaudio_compat()
        from pyannote.audio import Pipeline
        patch_loaded_huggingface_aliases(("pyannote",))

        logger.info(
            "Loading diarization pipeline=%s device=%s",
            self._config.diarization_model,
            self._device,
        )
        last_error: Exception | None = None
        candidate_models = _get_candidate_models(self._config.diarization_model)

        for index, model_name in enumerate(candidate_models):
            try:
                self._pipeline = _load_pipeline(
                    Pipeline,
                    model_name=model_name,
                    effective_hf_token=effective_hf_token,
                )
                self._loaded_model_name = model_name
                if index > 0:
                    logger.warning(
                        "Diarization model %s is incompatible with current pyannote runtime; "
                        "using fallback model %s instead.",
                        self._config.diarization_model,
                        model_name,
                    )
                break
            except TypeError as exc:
                last_error = exc
                if index < len(candidate_models) - 1 and _is_pipeline_compatibility_error(exc):
                    logger.warning(
                        "Diarization model %s failed compatibility check (%s); retrying with %s",
                        model_name,
                        exc,
                        candidate_models[index + 1],
                    )
                    continue
                raise

        if self._pipeline is None:
            if last_error is not None:
                raise last_error
            raise RuntimeError("Failed to initialize diarization pipeline")

        try:
            import torch

            target_device = torch.device("cuda" if self._device == "cuda" and torch.cuda.is_available() else "cpu")
            self._pipeline = self._pipeline.to(target_device)
        except Exception:
            logger.warning("Could not move diarization pipeline to requested device", exc_info=True)

    def unload(self) -> None:
        self._pipeline = None
        self._loaded_model_name = None
        release_accelerator_memory()

    def diarize(
        self,
        audio: np.ndarray,
        *,
        sample_rate: int,
        num_speakers: int | None = None,
        hf_token: str | None = None,
    ) -> list[dict[str, Any]]:
        if self._pipeline is None:
            self.load(hf_token=hf_token)

        if self._pipeline is None:
            raise RuntimeError("Diarization pipeline is not available")

        import torch

        waveform = torch.from_numpy(audio).float().unsqueeze(0)
        diarization = self._pipeline(
            {"waveform": waveform, "sample_rate": sample_rate},
            num_speakers=num_speakers,
        )

        segments: list[dict[str, Any]] = []
        for turn, _, speaker in diarization.itertracks(yield_label=True):
            segments.append(
                {
                    "start": round(float(turn.start), 3),
                    "end": round(float(turn.end), 3),
                    "speaker": str(speaker),
                }
            )

        return segments
