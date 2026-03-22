from __future__ import annotations

from dataclasses import dataclass
from io import IOBase
import inspect
import logging
import os
import sys
from typing import Any

logger = logging.getLogger(__name__)


@dataclass(slots=True)
class AudioMetaData:
    sample_rate: int
    num_frames: int
    num_channels: int
    bits_per_sample: int
    encoding: str


def _infer_bits_per_sample(subtype: str | None) -> int:
    if not subtype:
        return 0

    normalized = subtype.replace("-", "_").upper()
    for part in normalized.split("_"):
        if part.isdigit():
            return int(part)

    fallback = {
        "PCM_S8": 8,
        "PCM_U8": 8,
        "PCM_16": 16,
        "PCM_24": 24,
        "PCM_32": 32,
        "FLOAT": 32,
        "DOUBLE": 64,
        "ULAW": 8,
        "ALAW": 8,
    }
    return fallback.get(normalized, 0)


def _torchaudio_info(uri: Any, *, backend: str | None = None) -> AudioMetaData:
    del backend

    import soundfile as sf

    rewind_to: int | None = None
    if isinstance(uri, IOBase):
        try:
            rewind_to = uri.tell()
        except Exception:
            rewind_to = None

    try:
        info = sf.info(uri)
    finally:
        if rewind_to is not None:
            try:
                uri.seek(rewind_to)
            except Exception:
                pass

    subtype = str(getattr(info, "subtype", "") or "")
    return AudioMetaData(
        sample_rate=int(getattr(info, "samplerate", 0) or 0),
        num_frames=int(getattr(info, "frames", 0) or 0),
        num_channels=int(getattr(info, "channels", 0) or 0),
        bits_per_sample=_infer_bits_per_sample(subtype),
        encoding=subtype or str(getattr(info, "format", "") or "unknown"),
    )


def _list_audio_backends() -> list[str]:
    return ["soundfile"]


def _wrap_use_auth_token_alias(func: Any) -> Any:
    if getattr(func, "_local_audio_runtime_patched", False):
        return func

    try:
        signature = inspect.signature(func)
    except (TypeError, ValueError):
        return func

    if "use_auth_token" in signature.parameters or "token" not in signature.parameters:
        return func

    def wrapper(*args: Any, use_auth_token: Any = None, **kwargs: Any) -> Any:
        if use_auth_token is not None and "token" not in kwargs:
            kwargs["token"] = use_auth_token
        return func(*args, **kwargs)

    wrapper._local_audio_runtime_patched = True
    wrapper.__name__ = getattr(func, "__name__", "wrapped_hf_function")
    wrapper.__doc__ = getattr(func, "__doc__", None)
    return wrapper


def patch_loaded_huggingface_aliases(
    module_prefixes: tuple[str, ...] = ("pyannote", "whisperx"),
) -> None:
    try:
        import huggingface_hub
        from huggingface_hub import file_download as hf_file_download
    except Exception:
        logger.debug("Could not import huggingface_hub for alias patching", exc_info=True)
        return

    wrapped_download = _wrap_use_auth_token_alias(huggingface_hub.hf_hub_download)
    wrapped_snapshot = _wrap_use_auth_token_alias(huggingface_hub.snapshot_download)
    wrapped_file_download = _wrap_use_auth_token_alias(hf_file_download.hf_hub_download)

    patched_modules: list[str] = []
    for module_name, module in list(sys.modules.items()):
        if module is None or not module_name.startswith(module_prefixes):
            continue

        module_patched = False

        if hasattr(module, "hf_hub_download"):
            setattr(module, "hf_hub_download", wrapped_download)
            module_patched = True

        if hasattr(module, "snapshot_download"):
            setattr(module, "snapshot_download", wrapped_snapshot)
            module_patched = True

        if hasattr(module, "file_download") and getattr(module.file_download, "hf_hub_download", None):
            setattr(module.file_download, "hf_hub_download", wrapped_file_download)
            module_patched = True

        if module_patched:
            patched_modules.append(module_name)

    if patched_modules:
        logger.info(
            "Patched Hugging Face download aliases in loaded modules: %s",
            ", ".join(sorted(patched_modules)),
        )


def ensure_torchaudio_compat() -> None:
    os.environ.setdefault("TORCH_FORCE_NO_WEIGHTS_ONLY_LOAD", "1")

    try:
        import torch
        from omegaconf.dictconfig import DictConfig
        from omegaconf.listconfig import ListConfig

        torch.serialization.add_safe_globals([DictConfig, ListConfig])
    except Exception:
        logger.debug("Could not register torch safe globals for OmegaConf", exc_info=True)

    try:
        import huggingface_hub
        from huggingface_hub import file_download as hf_file_download

        huggingface_hub.hf_hub_download = _wrap_use_auth_token_alias(huggingface_hub.hf_hub_download)
        huggingface_hub.snapshot_download = _wrap_use_auth_token_alias(huggingface_hub.snapshot_download)
        hf_file_download.hf_hub_download = _wrap_use_auth_token_alias(hf_file_download.hf_hub_download)
        patch_loaded_huggingface_aliases()
    except Exception:
        logger.debug("Could not patch huggingface_hub token compatibility", exc_info=True)

    import torchaudio

    patched: list[str] = []

    if not hasattr(torchaudio, "AudioMetaData"):
        torchaudio.AudioMetaData = AudioMetaData
        patched.append("AudioMetaData")

    if not hasattr(torchaudio, "list_audio_backends"):
        torchaudio.list_audio_backends = _list_audio_backends
        patched.append("list_audio_backends")

    if not hasattr(torchaudio, "info"):
        torchaudio.info = _torchaudio_info
        patched.append("info")

    if patched:
        logger.info("Applied torchaudio compatibility patch: %s", ", ".join(patched))
