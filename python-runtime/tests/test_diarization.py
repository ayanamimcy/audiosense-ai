from __future__ import annotations

from types import SimpleNamespace
import unittest

from local_audio_runtime.diarization import _resolve_diarization_annotation


class FakeAnnotation:
    def itertracks(self, *, yield_label: bool = False):
        del yield_label
        return iter(())


class DiarizationOutputCompatibilityTests(unittest.TestCase):
    def test_legacy_annotation_is_used_directly(self) -> None:
        annotation = FakeAnnotation()

        self.assertIs(
            _resolve_diarization_annotation(annotation, exclusive=True),
            annotation,
        )

    def test_pyannote_4_output_prefers_exclusive_annotation(self) -> None:
        regular = FakeAnnotation()
        exclusive = FakeAnnotation()
        output = SimpleNamespace(
            speaker_diarization=regular,
            exclusive_speaker_diarization=exclusive,
        )

        self.assertIs(
            _resolve_diarization_annotation(output, exclusive=True),
            exclusive,
        )
        self.assertIs(
            _resolve_diarization_annotation(output, exclusive=False),
            regular,
        )

    def test_missing_exclusive_annotation_falls_back_to_regular(self) -> None:
        regular = FakeAnnotation()
        output = SimpleNamespace(speaker_diarization=regular)

        self.assertIs(
            _resolve_diarization_annotation(output, exclusive=True),
            regular,
        )

    def test_unknown_output_has_actionable_error(self) -> None:
        with self.assertRaisesRegex(TypeError, "Unsupported pyannote diarization output"):
            _resolve_diarization_annotation(object(), exclusive=True)


if __name__ == "__main__":
    unittest.main()
