from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class TranscriptionRequest(BaseModel):
    file_path: str
    language: str | None = None
    diarization: bool = False
    word_timestamps: bool = False
    task: str = "transcribe"
    translation_target_language: str | None = None
    expected_speakers: int | None = Field(default=None, ge=1, le=20)
    backend: str | None = None
    model_name: str | None = None
    diarization_strategy: str | None = None
    hf_token: str | None = None


class TranscriptionResponse(BaseModel):
    text: str
    segments: list[dict[str, Any]]
    words: list[dict[str, Any]] = Field(default_factory=list)
    diarization_segments: list[dict[str, Any]] = Field(default_factory=list)
    language: str | None = None
    language_probability: float = 0.0
    duration: float = 0.0
    warnings: list[str] = Field(default_factory=list)
    backend: str | None = None
    model_name: str | None = None


class HealthResponse(BaseModel):
    ok: bool
    runtime: dict[str, Any]
