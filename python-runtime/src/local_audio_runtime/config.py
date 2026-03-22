from __future__ import annotations

from dataclasses import dataclass
import os


def _read_bool(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _read_int(name: str, default: int) -> int:
    value = os.getenv(name)
    if value is None:
        return default
    try:
        return int(value)
    except ValueError:
        return default


def _read_float(name: str, default: float) -> float:
    value = os.getenv(name)
    if value is None:
        return default
    try:
        return float(value)
    except ValueError:
        return default


@dataclass(slots=True)
class RuntimeConfig:
    host: str
    port: int
    backend: str
    model_name: str
    device: str
    compute_type: str
    beam_size: int
    batch_size: int
    vad_filter: bool
    diarization_model: str
    hf_token: str | None
    download_root: str | None
    preload: bool
    diarization_strategy: str
    prefer_integrated_diarization: bool
    sequential_unload_between_stages: bool
    translation_target_language: str
    normalize_audio: bool
    pre_vad_normalize: bool
    silero_sensitivity: float
    webrtc_sensitivity: int
    silero_use_onnx: bool
    silero_deactivity_detection: bool
    post_speech_silence_duration: float
    min_length_of_recording: float
    min_gap_between_recordings: float
    pre_recording_buffer_duration: float
    max_silence_duration: float
    allowed_latency_limit: int
    ensure_sentence_starting_uppercase: bool
    ensure_sentence_ends_with_period: bool
    buffer_size: int


def load_config() -> RuntimeConfig:
    hf_token = os.getenv("LOCAL_AUDIO_ENGINE_HF_TOKEN") or os.getenv("HF_TOKEN")
    download_root = os.getenv("LOCAL_AUDIO_ENGINE_DOWNLOAD_ROOT")

    return RuntimeConfig(
        host=os.getenv("LOCAL_AUDIO_ENGINE_HOST", "127.0.0.1"),
        port=_read_int("LOCAL_AUDIO_ENGINE_PORT", 8765),
        backend=os.getenv("LOCAL_AUDIO_ENGINE_BACKEND", "faster-whisper").strip().lower(),
        model_name=os.getenv("LOCAL_AUDIO_ENGINE_MODEL", "small"),
        device=os.getenv("LOCAL_AUDIO_ENGINE_DEVICE", "auto").strip().lower(),
        compute_type=os.getenv("LOCAL_AUDIO_ENGINE_COMPUTE_TYPE", "default"),
        beam_size=_read_int("LOCAL_AUDIO_ENGINE_BEAM_SIZE", 5),
        batch_size=_read_int("LOCAL_AUDIO_ENGINE_BATCH_SIZE", 16),
        vad_filter=_read_bool("LOCAL_AUDIO_ENGINE_VAD_FILTER", True),
        diarization_model=os.getenv(
            "LOCAL_AUDIO_ENGINE_DIARIZATION_MODEL",
            "pyannote/speaker-diarization-3.1",
        ),
        hf_token=hf_token if hf_token else None,
        download_root=download_root if download_root else None,
        preload=_read_bool("LOCAL_AUDIO_ENGINE_PRELOAD", False),
        diarization_strategy=os.getenv("LOCAL_AUDIO_ENGINE_DIARIZATION_STRATEGY", "auto").strip().lower(),
        prefer_integrated_diarization=_read_bool(
            "LOCAL_AUDIO_ENGINE_PREFER_INTEGRATED_DIARIZATION",
            True,
        ),
        sequential_unload_between_stages=_read_bool(
            "LOCAL_AUDIO_ENGINE_SEQUENTIAL_UNLOAD_BETWEEN_STAGES",
            True,
        ),
        translation_target_language=os.getenv("LOCAL_AUDIO_ENGINE_TRANSLATION_TARGET_LANGUAGE", "en").strip().lower(),
        normalize_audio=_read_bool("LOCAL_AUDIO_ENGINE_NORMALIZE_AUDIO", False),
        pre_vad_normalize=_read_bool("LOCAL_AUDIO_ENGINE_PRE_VAD_NORMALIZE", False),
        silero_sensitivity=_read_float("LOCAL_AUDIO_ENGINE_SILERO_SENSITIVITY", 0.4),
        webrtc_sensitivity=_read_int("LOCAL_AUDIO_ENGINE_WEBRTC_SENSITIVITY", 3),
        silero_use_onnx=_read_bool("LOCAL_AUDIO_ENGINE_SILERO_USE_ONNX", False),
        silero_deactivity_detection=_read_bool("LOCAL_AUDIO_ENGINE_SILERO_DEACTIVITY_DETECTION", False),
        post_speech_silence_duration=_read_float(
            "LOCAL_AUDIO_ENGINE_POST_SPEECH_SILENCE_DURATION",
            0.8,
        ),
        min_length_of_recording=_read_float("LOCAL_AUDIO_ENGINE_MIN_LENGTH_OF_RECORDING", 0.4),
        min_gap_between_recordings=_read_float("LOCAL_AUDIO_ENGINE_MIN_GAP_BETWEEN_RECORDINGS", 0.2),
        pre_recording_buffer_duration=_read_float(
            "LOCAL_AUDIO_ENGINE_PRE_RECORDING_BUFFER_DURATION",
            1.0,
        ),
        max_silence_duration=_read_float("LOCAL_AUDIO_ENGINE_MAX_SILENCE_DURATION", 10.0),
        allowed_latency_limit=_read_int("LOCAL_AUDIO_ENGINE_ALLOWED_LATENCY_LIMIT", 100),
        ensure_sentence_starting_uppercase=_read_bool(
            "LOCAL_AUDIO_ENGINE_ENSURE_SENTENCE_STARTING_UPPERCASE",
            True,
        ),
        ensure_sentence_ends_with_period=_read_bool(
            "LOCAL_AUDIO_ENGINE_ENSURE_SENTENCE_ENDS_WITH_PERIOD",
            True,
        ),
        buffer_size=_read_int("LOCAL_AUDIO_ENGINE_BUFFER_SIZE", 512),
    )
