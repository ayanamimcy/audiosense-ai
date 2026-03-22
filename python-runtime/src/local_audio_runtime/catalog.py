from __future__ import annotations

import json
from pathlib import Path
from typing import Any


_CATALOG_PATH = Path(__file__).with_name("backend_catalog.json")


def get_backend_catalog() -> dict[str, Any]:
    try:
        raw = json.loads(_CATALOG_PATH.read_text(encoding="utf-8"))
    except Exception:
        return {"backends": []}

    backends = raw.get("backends", [])
    if not isinstance(backends, list):
        return {"backends": []}

    normalized_backends: list[dict[str, Any]] = []
    for backend in backends:
        if not isinstance(backend, dict):
            continue

        models = backend.get("models", [])
        if not isinstance(models, list):
            continue

        normalized_models = []
        for model in models:
            if not isinstance(model, dict):
                continue

            model_id = str(model.get("id", "")).strip()
            if not model_id:
                continue

            normalized_models.append(
                {
                    "id": model_id,
                    "label": str(model.get("label", model_id)).strip(),
                    "description": str(model.get("description", "")).strip(),
                }
            )

        if not normalized_models:
            continue

        backend_id = str(backend.get("id", "")).strip()
        if not backend_id:
            continue

        default_model = str(backend.get("defaultModel", normalized_models[0]["id"])).strip()
        if default_model not in {model["id"] for model in normalized_models}:
            default_model = normalized_models[0]["id"]

        normalized_backends.append(
            {
                "id": backend_id,
                "label": str(backend.get("label", backend_id)).strip(),
                "description": str(backend.get("description", "")).strip(),
                "supportsDiarization": bool(backend.get("supportsDiarization")),
                "supportsIntegratedDiarization": bool(
                    backend.get("supportsIntegratedDiarization")
                ),
                "supportsTranslation": bool(backend.get("supportsTranslation")),
                "defaultModel": default_model,
                "models": normalized_models,
            }
        )

    return {"backends": normalized_backends}
