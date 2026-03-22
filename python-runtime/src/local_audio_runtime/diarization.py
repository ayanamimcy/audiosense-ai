from __future__ import annotations

import inspect
import logging
from typing import Any

import numpy as np

from .config import RuntimeConfig
from .backends import resolve_device
from .torchaudio_compat import ensure_torchaudio_compat, patch_loaded_huggingface_aliases

logger = logging.getLogger(__name__)


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


class DiarizationEngine:
    def __init__(self, config: RuntimeConfig) -> None:
        self._config = config
        self._pipeline: Any | None = None
        self._device = resolve_device(config.device)

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
        token_kwargs = _build_pipeline_token_kwargs(
            Pipeline.from_pretrained,
            effective_hf_token,
        )

        try:
            self._pipeline = Pipeline.from_pretrained(
                self._config.diarization_model,
                **token_kwargs,
            )
        except TypeError as exc:
            # Older/newer pyannote releases disagree on the auth kwarg name.
            if "unexpected keyword argument" not in str(exc):
                raise

            fallback_kwargs = (
                {"use_auth_token": effective_hf_token}
                if "token" in token_kwargs
                else {"token": effective_hf_token}
            )
            self._pipeline = Pipeline.from_pretrained(
                self._config.diarization_model,
                **fallback_kwargs,
            )

        try:
            import torch

            target_device = torch.device("cuda" if self._device == "cuda" and torch.cuda.is_available() else "cpu")
            self._pipeline = self._pipeline.to(target_device)
        except Exception:
            logger.warning("Could not move diarization pipeline to requested device", exc_info=True)

    def unload(self) -> None:
        self._pipeline = None

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
