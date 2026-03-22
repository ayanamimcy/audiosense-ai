from __future__ import annotations

import logging
from pathlib import Path
import shutil
import subprocess
import tempfile

import numpy as np
from scipy import signal

logger = logging.getLogger(__name__)

try:
    import soundfile as sf
except ImportError as exc:  # pragma: no cover - dependency error path
    raise RuntimeError("soundfile is required for local audio runtime") from exc


def convert_to_wav(
    input_path: str,
    *,
    sample_rate: int = 16000,
    channels: int = 1,
) -> str:
    if not shutil.which("ffmpeg"):
        raise RuntimeError("ffmpeg is not installed or not in PATH")

    output_path = tempfile.mkstemp(suffix=".wav")[1]

    try:
        subprocess.run(
            [
                "ffmpeg",
                "-i",
                input_path,
                "-y",
                "-vn",
                "-ac",
                str(channels),
                "-ar",
                str(sample_rate),
                "-acodec",
                "pcm_s16le",
                output_path,
            ],
            check=True,
            capture_output=True,
            text=True,
        )
        return output_path
    except subprocess.CalledProcessError as exc:
        raise RuntimeError(exc.stderr or "ffmpeg conversion failed") from exc


def load_audio(file_path: str, *, target_sample_rate: int = 16000) -> tuple[np.ndarray, int]:
    path = Path(file_path)
    temp_wav: str | None = None

    try:
        if path.suffix.lower() not in {".wav", ".wave"}:
            temp_wav = convert_to_wav(str(path), sample_rate=target_sample_rate)
            file_path = temp_wav

        audio, sample_rate = sf.read(file_path, dtype="float32")

        if getattr(audio, "ndim", 1) > 1:
            audio = np.mean(audio, axis=1)

        if sample_rate != target_sample_rate:
            sample_count = int(len(audio) * target_sample_rate / sample_rate)
            audio = signal.resample(audio, sample_count)
            sample_rate = target_sample_rate

        return audio.astype(np.float32), sample_rate
    finally:
        if temp_wav:
            Path(temp_wav).unlink(missing_ok=True)


def get_audio_duration_seconds(audio: np.ndarray, sample_rate: int) -> float:
    if sample_rate <= 0:
        return 0.0
    return round(float(len(audio) / sample_rate), 3)


def resample_audio(audio: np.ndarray, source_sample_rate: int, target_sample_rate: int) -> np.ndarray:
    if source_sample_rate == target_sample_rate:
        return audio.astype(np.float32)

    sample_count = int(len(audio) * target_sample_rate / source_sample_rate)
    return signal.resample(audio, sample_count).astype(np.float32)


def normalize_audio_peak(audio: np.ndarray, *, target_peak: float = 0.95) -> np.ndarray:
    if audio.size == 0:
        return audio.astype(np.float32)

    peak = float(np.max(np.abs(audio)))
    if peak <= 0:
        return audio.astype(np.float32)

    return ((audio / peak) * target_peak).astype(np.float32)


def pcm16_bytes_to_float32(chunk: bytes | bytearray) -> np.ndarray:
    pcm = np.frombuffer(chunk, dtype=np.int16).astype(np.float32)
    return pcm / 32768.0


def float32_to_pcm16_bytes(audio: np.ndarray) -> bytes:
    clipped = np.clip(audio, -1.0, 1.0)
    return (clipped * 32767.0).astype(np.int16).tobytes()
