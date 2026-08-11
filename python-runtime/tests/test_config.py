from __future__ import annotations

import os
import unittest
from unittest.mock import patch

from local_audio_runtime.config import load_config


class RuntimeConfigTests(unittest.TestCase):
    def test_file_transcription_defaults_to_complete_first_pipeline(self) -> None:
        with patch.dict(os.environ, {}, clear=True):
            config = load_config()

        self.assertEqual(config.backend, "faster-whisper")
        self.assertFalse(config.vad_filter)
        self.assertFalse(config.whisperx_alignment)


if __name__ == "__main__":
    unittest.main()
