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
        ambiguous = {"iliad-01-0002": {"ja": "自分の祭司クリューセースと自分の祭司クリューセース。アポロンの祭司クリューセース。"}}
        with self.assertRaisesRegex(ValueError, "does not match current draft"):
            validate_content.apply_corrections(ambiguous, [correction])

    def test_reviewed_note_correction_is_title_scoped_and_idempotent(self):
        translations = {
            "iliad-04-0039": {
                "ja": "本文",
                "notes": [{
                    "title": "修辞としての「軽んじる者はなかった」",
                    "body": "無傷で歩けた者はいない、という強調。後半は保持する。",
                }],
            },
        }
        correction = {
            "unitId": "iliad-04-0039", "field": "noteBody",
            "noteTitle": "修辞としての「軽んじる者はなかった」",
            "find": "無傷で歩けた者はいない、という強調。",
            "replace": "たとえ女神に守られて無傷で歩けても軽んじなかった、という強調。",
        }
        self.assertEqual(validate_content.apply_corrections(translations, [correction]), 1)
        self.assertEqual(translations["iliad-04-0039"]["notes"][0]["body"], "たとえ女神に守られて無傷で歩けても軽んじなかった、という強調。後半は保持する。")
        self.assertEqual(validate_content.apply_corrections(translations, [correction]), 0)

    def test_assembly_preserves_english_note_only_for_unchanged_japanese_source(self):
        note = {"kind": "person", "title": "人物", "body": "説明。", "spoiler": False}
        signature = validate_content.note_signature(note)
        existing = {
            "iliad-01-0001#note-0001": {
                "signature": signature, "titleEn": "Person", "bodyEn": "Description.",
            },
        }
        preserved = validate_content.preserve_note_translations("iliad-01-0001", [note], existing)
        self.assertEqual(preserved[0]["titleEn"], "Person")
        self.assertEqual(preserved[0]["bodyEn"], "Description.")
        self.assertEqual(
            {key: value for key, value in preserved[0].items() if key not in {"titleEn", "bodyEn"}},
            note,
        )
        changed = {**note, "body": "変更された説明。"}
        with self.assertRaisesRegex(ValueError, "Japanese note changed"):
            validate_content.preserve_note_translations("iliad-01-0001", [changed], existing)

    def test_catalog_exposes_japanese_review_scope_and_omits_null_japanese_url(self):
        source_works = {}
        translated_works = {}
        manifest_works = {}
        for work_id in ("iliad", "odyssey"):
            unit = {"id": f"{work_id}-01-0001", "en": "Source text."}
            source_works[work_id] = ({"books": [{"number": 1, "units": [unit]}]}, [unit])
            translated_works[work_id] = {unit["id"]: {"ja": "日本語本文。", "notes": []}}
            manifest_works[work_id] = {"url": "https://example.test/source", "sha256": "a" * 64}
        catalog = validate_content.catalog_for(
            {"retrievedAt": "2026-10-10", "works": manifest_works}, source_works, translated_works,
        )
        for work in catalog["works"]:
            self.assertNotIn("url", work["source"]["japanese"])
            self.assertIn("AI", work["source"]["commentary"]["author"])
        self.assertIn("49単位", catalog["works"][0]["source"]["commentary"]["reviewScope"])
        self.assertIn("49単位", catalog["works"][1]["source"]["commentary"]["reviewScope"])

    def test_public_source_manifest_uses_full_import_manifest_and_omits_excluded_text(self):
        source_works = {}
        source_meta = {}
        for work_id in ("iliad", "odyssey"):
            unit = {"id": f"{work_id}-01-0001", "en": "Narrative opening."}
            source_works[work_id] = ({"books": [{"number": 1, "units": [unit]}]}, [unit])
            source_meta[work_id] = {
                "gutenbergId": 2199 if work_id == "iliad" else 1727,
                "url": "https://example.test/source", "sha256": "a" * 64, "byteLength": 123,
                "excludedEditorialParagraphs": 1, "excludedEditorialTextByBook": [{"text": "private synopsis"}],
                "excludedEndnoteSection": {"paragraphCount": 0, "referenceCount": 0},
                "removedInlineFootnoteMarkerCount": 0, "excludedPostEbookBlocks": 1,
            }
        manifest = validate_content.public_source_manifest(
            {"retrievedAt": "2026-10-10", "works": source_meta}, source_works,
        )
        self.assertEqual(manifest["works"][0]["books"][0]["narrativeSha256"], validate_content.narrative_digest(source_works["iliad"][0]["books"][0]["units"]))
        self.assertNotIn("private synopsis", json.dumps(manifest, ensure_ascii=False))

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
            validate_content.verify_published(public_dir, expected_note_counts={"iliad": 0, "odyssey": 0})
            (public_dir / "odyssey" / "24.json").unlink()
            with self.assertRaisesRegex(ValueError, "missing published data file"):
                validate_content.verify_published(public_dir, expected_note_counts={"iliad": 0, "odyssey": 0})

    def test_published_verifier_rejects_english_omission_or_edit(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            public_dir = Path(temp_dir) / "public" / "data"
            self.write_published_fixture(public_dir)
            book_path = public_dir / "iliad" / "01.json"
            payload = json.loads(book_path.read_text(encoding="utf-8"))
            payload["units"][0]["en"] = "changed narrative"
            book_path.write_text(json.dumps(payload), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "narrative digest mismatch"):
                validate_content.verify_published(public_dir, expected_note_counts={"iliad": 0, "odyssey": 0})

    def test_published_verifier_rejects_missing_english_note_fields(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            public_dir = Path(temp_dir) / "public" / "data"
            self.write_published_fixture(public_dir)
            book_path = public_dir / "iliad" / "01.json"
            payload = json.loads(book_path.read_text(encoding="utf-8"))
            payload["units"][0]["notes"] = [{
                "kind": "person", "title": "人物", "body": "説明。", "spoiler": False,
            }]
            book_path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "titleEn must be a non-empty string"):
                validate_content.verify_published(public_dir, expected_note_counts={"iliad": 1, "odyssey": 0})


if __name__ == "__main__":
    unittest.main()
