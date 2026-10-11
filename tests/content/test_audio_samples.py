import hashlib
import importlib.util
import json
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).parents[2]
SPEC = importlib.util.spec_from_file_location("validate_audio_samples", ROOT / "scripts/validate-audio-samples.py")
VALIDATOR = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(VALIDATOR)


class AudioSampleValidationTests(unittest.TestCase):
    def create_fixture(self, root):
        public = root / "public"
        (public / "data/iliad").mkdir(parents=True)
        (public / "audio-samples").mkdir(parents=True)
        unit = {
            "id": "iliad-01-0001", "reference": "Butler Iliad 1, paragraph 1",
            "en": "Sing, O goddess.", "ja": "女神よ、歌え。",
        }
        (public / "data/iliad/01.json").write_text(json.dumps({
            "workId": "iliad", "bookNumber": 1, "units": [unit],
        }), encoding="utf-8")
        rows = []
        for sample_id, language, label, voice in VALIDATOR.EXPECTED:
            audio = f"fixture audio {sample_id}".encode()
            relative = f"audio-samples/{sample_id}.mp3"
            (public / relative).write_bytes(audio)
            rows.append({
                "id": sample_id, "language": language, "label": label, "voice": voice,
                "rate": "+0%", "src": relative,
                "textSha256": hashlib.sha256(unit[language].encode()).hexdigest(),
                "audioSha256": hashlib.sha256(audio).hexdigest(), "durationSeconds": 1.25,
            })
        manifest = {
            "schema": "homer-voice-samples-v1",
            "generatedAt": datetime.now(timezone.utc).isoformat(),
            "provider": VALIDATOR.PROVIDER,
            "source": {
                "workId": "iliad", "bookNumber": 1, "unitId": unit["id"], "reference": unit["reference"],
            },
            "texts": {"en": unit["en"], "ja": unit["ja"]}, "samples": rows,
        }
        (public / "audio-samples/manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
        return public, manifest

    def test_accepts_exact_source_and_matching_files(self):
        with tempfile.TemporaryDirectory() as directory:
            self.create_fixture(Path(directory))
            VALIDATOR.validate(Path(directory))

    def test_rejects_changed_audio_bytes(self):
        with tempfile.TemporaryDirectory() as directory:
            public, _ = self.create_fixture(Path(directory))
            with (public / "audio-samples/en-ava.mp3").open("ab") as audio:
                audio.write(b"tampered")
            with self.assertRaisesRegex(ValueError, "audio checksum mismatch"):
                VALIDATOR.validate(Path(directory))

    def test_rejects_manifest_text_that_differs_from_source(self):
        with tempfile.TemporaryDirectory() as directory:
            public, manifest = self.create_fixture(Path(directory))
            manifest["texts"]["en"] += " changed"
            (public / "audio-samples/manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "exact source unit"):
                VALIDATOR.validate(Path(directory))

    def test_rejects_missing_audio(self):
        with tempfile.TemporaryDirectory() as directory:
            public, _ = self.create_fixture(Path(directory))
            (public / "audio-samples/ja-keita.mp3").unlink()
            with self.assertRaisesRegex(ValueError, "missing or empty"):
                VALIDATOR.validate(Path(directory))


if __name__ == "__main__":
    unittest.main()
