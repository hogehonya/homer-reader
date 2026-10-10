import importlib.util
import json
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).parents[2]
SPEC = importlib.util.spec_from_file_location("validate_content", ROOT / "scripts" / "validate-content.py")
validate_content = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(validate_content)


class ContentValidationTests(unittest.TestCase):
    def test_reviewed_correction_is_targeted_and_idempotent(self):
        translations = {"iliad-01-0002": {"ja": "自分の祭司クリューセースを辱めた。"}}
        correction = {
            "unitId": "iliad-01-0002", "field": "ja",
            "find": "自分の祭司クリューセース", "replace": "アポロンの祭司クリューセース",
        }
        self.assertEqual(validate_content.apply_corrections(translations, [correction]), 1)
        self.assertIn("アポロンの祭司", translations["iliad-01-0002"]["ja"])
        self.assertEqual(validate_content.apply_corrections(translations, [correction]), 0)

    def write_published_fixture(self, public_dir):
        works = []
        catalog_works = []
        for work_id in ("iliad", "odyssey"):
            books = []
            catalog_books = []
            for number in range(1, 25):
                unit_id = f"{work_id}-{number:02d}-0001"
                unit = {"id": unit_id, "reference": f"Butler {work_id.title()} {number}, paragraph 1", "en": f"Narrative {work_id} book {number}.", "ja": f"{work_id} 第{number}巻の本文です。", "notes": []}
                book_path = public_dir / work_id / f"{number:02d}.json"
                book_path.parent.mkdir(parents=True, exist_ok=True)
                book_path.write_text(json.dumps({"workId": work_id, "bookNumber": number, "units": [unit]}, ensure_ascii=False), encoding="utf-8")
                relative = f"data/{work_id}/{number:02d}.json"
                catalog_books.append({"number": number, "unitCount": 1, "dataFile": relative})
                books.append({
                    "number": number, "unitCount": 1,
                    "englishWordCount": len(unit["en"].split()),
                    "firstUnitId": unit_id, "lastUnitId": unit_id,
                    "narrativeSha256": validate_content.narrative_digest([unit]),
                })
            works.append({"id": work_id, "rawSha256": "a" * 64, "bookCount": 24, "narrativeUnitCount": 24, "englishWordCount": sum(book["englishWordCount"] for book in books), "books": books})
            catalog_works.append({"id": work_id, "books": catalog_books})
        public_dir.mkdir(parents=True, exist_ok=True)
        manifest = {
            "version": 1, "hashAlgorithm": "SHA-256", "works": works,
            "normalization": "UTF-8 decode; join wrapped lines within paragraphs; preserve paragraph order and wording; exclude the first checked editorial block after each BOOK marker; exclude Odyssey detached FOOTNOTES and inline reference digits; exclude Project Gutenberg post-ebook matter.",
        }
        (public_dir / "source-manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
        (public_dir / "catalog.json").write_text(json.dumps({"version": 1, "works": catalog_works}), encoding="utf-8")

    def test_published_verifier_checks_all_books_and_detects_missing_files(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            public_dir = Path(temp_dir) / "public" / "data"
            self.write_published_fixture(public_dir)
            validate_content.verify_published(public_dir)
            (public_dir / "odyssey" / "24.json").unlink()
            with self.assertRaisesRegex(ValueError, "missing published data file"):
                validate_content.verify_published(public_dir)

    def test_published_verifier_rejects_english_omission_or_edit(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            public_dir = Path(temp_dir) / "public" / "data"
            self.write_published_fixture(public_dir)
            book_path = public_dir / "iliad" / "01.json"
            payload = json.loads(book_path.read_text(encoding="utf-8"))
            payload["units"][0]["en"] = "changed narrative"
            book_path.write_text(json.dumps(payload), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "narrative digest mismatch"):
                validate_content.verify_published(public_dir)


if __name__ == "__main__":
    unittest.main()
