from __future__ import annotations

import logging
from typing import Any

import numpy as np

from .config import RuntimeConfig
from .backends import resolve_device
from .torchaudio_compat import ensure_torchaudio_compat, patch_loaded_huggingface_aliases

logger = logging.getLogger(__name__)


class DiarizationEngine:
    def __init__(self, config: RuntimeConfig) -> None:
        self._config = config
        self._pipeline: Any | None = None
        self._device = resolve_device(config.device)

    def load(self) -> None:
        if self._pipeline is not None:
            return

        if not self._config.hf_token:
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
        self._pipeline = Pipeline.from_pretrained(
            self._config.diarization_model,
            token=self._config.hf_token,
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
    ) -> list[dict[str, Any]]:
        if self._pipeline is None:
            self.load()

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
