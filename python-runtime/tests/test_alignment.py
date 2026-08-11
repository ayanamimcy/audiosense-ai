from __future__ import annotations

from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

import numpy as np

from local_audio_runtime.alignment import WhisperXAlignmentEngine


class WhisperXAlignmentEngineTests(unittest.TestCase):
    def setUp(self) -> None:
        self.whisperx = Mock()
        self.whisperx.load_align_model.return_value = (Mock(), {"language": "ja"})
        self.import_patch = patch(
            "local_audio_runtime.alignment._import_whisperx_modules",
            return_value=(self.whisperx, None),
        )
        self.release_patch = patch("local_audio_runtime.alignment.release_accelerator_memory")
        self.import_patch.start()
        self.release_patch.start()
        self.engine = WhisperXAlignmentEngine(SimpleNamespace(device="cpu"))

    def tearDown(self) -> None:
        patch.stopall()

    def test_alignment_enriches_words_without_replacing_authoritative_text(self) -> None:
        source = {
            "text": "AIエンジニアリングです",
            "language": "ja",
            "segments": [
                {
                    "id": "raw-1",
                    "start": 0.0,
                    "end": 3.0,
                    "text": "AIエンジニアリングです",
                    "words": [
                        {"word": "AIエンジニアリングです", "start": 0.1, "end": 2.9},
                    ],
                }
            ],
            "words": [
                {"word": "AIエンジニアリングです", "start": 0.1, "end": 2.9},
            ],
        }
        self.whisperx.align.return_value = {
            "segments": [
                {
                    "start": 0.0,
                    "end": 3.0,
                    # Simulate an aligner that cannot represent the Latin token.
                    "text": "エンジニアリングです",
                    "words": [
                        {"word": "エンジニアリング", "start": 0.35, "end": 2.2, "score": 0.9},
                        {"word": "です", "start": 2.2, "end": 2.7, "score": 0.95},
                    ],
                }
            ]
        }

        result = self.engine.align(
            source,
            np.zeros(48_000, dtype=np.float32),
            language_code="ja",
        )

        self.assertEqual(result["text"], "AIエンジニアリングです")
        self.assertEqual(result["segments"][0]["text"], "AIエンジニアリングです")
        self.assertEqual(result["segments"][0]["start"], 0.0)
        self.assertEqual(result["segments"][0]["end"], 3.0)
        self.assertEqual([word["word"] for word in result["words"]], ["AIエンジニアリングです"])
        self.assertTrue(any("omitted transcript characters" in warning for warning in result["warnings"]))
        self.assertEqual(source["segments"][0]["words"][0]["word"], "AIエンジニアリングです")

    def test_complete_alignment_replaces_only_word_timestamps(self) -> None:
        source = {
            "text": "テストです",
            "language": "ja",
            "segments": [
                {
                    "start": 0.0,
                    "end": 2.0,
                    "text": "テストです",
                    "words": [{"word": "テストです", "start": 0.0, "end": 2.0}],
                }
            ],
            "words": [{"word": "テストです", "start": 0.0, "end": 2.0}],
        }
        self.whisperx.align.return_value = {
            "segments": [
                {
                    "words": [
                        {"word": "テスト", "start": 0.25, "end": 1.1, "score": 0.9},
                        {"word": "です", "start": 1.15, "end": 1.7, "score": 0.95},
                    ]
                }
            ]
        }

        result = self.engine.align(
            source,
            np.zeros(32_000, dtype=np.float32),
            language_code="ja",
        )

        self.assertEqual(result["text"], "テストです")
        self.assertEqual(result["segments"][0]["text"], "テストです")
        self.assertEqual([word["text"] for word in result["words"]], ["テスト", "です"])
        self.assertEqual(result["words"][0]["start"], 0.25)
        self.assertEqual(result["alignment_backend"], "whisperx")

    def test_empty_alignment_preserves_raw_words_and_adds_warning(self) -> None:
        source = {
            "text": "600ページ",
            "language": "ja",
            "segments": [
                {
                    "start": 1.0,
                    "end": 2.0,
                    "text": "600ページ",
                    "words": [{"word": "600ページ", "start": 1.0, "end": 2.0}],
                }
            ],
            "words": [{"word": "600ページ", "start": 1.0, "end": 2.0}],
        }
        self.whisperx.align.return_value = {"segments": [{"words": []}]}

        result = self.engine.align(
            source,
            np.zeros(32_000, dtype=np.float32),
            language_code="ja",
        )

        self.assertEqual(result["text"], "600ページ")
        self.assertEqual(result["segments"], source["segments"])
        self.assertEqual(result["words"], source["words"])
        self.assertTrue(any("raw ASR timestamps" in warning for warning in result["warnings"]))


if __name__ == "__main__":
    unittest.main()
