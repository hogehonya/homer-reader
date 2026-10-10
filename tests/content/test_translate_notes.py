import importlib.util
import json
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).parents[2]
SPEC = importlib.util.spec_from_file_location("translate_notes", ROOT / "scripts" / "translate-notes.py")
translate_notes = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(translate_notes)


class TranslateNotesTests(unittest.TestCase):
    def setUp(self):
        self.book = {
            "workId": "iliad",
            "bookNumber": 1,
            "units": [
                {
                    "id": "iliad-01-0001", "reference": "ref 1", "en": "English.", "ja": "日本語。",
                    "notes": [
                        {"kind": "person", "title": "人物", "body": "本文。", "spoiler": False},
                        {"kind": "myth", "title": "神話", "body": "別の本文。", "spoiler": True},
                    ],
                },
                {
                    "id": "iliad-01-0002", "reference": "ref 2", "en": "English 2.", "ja": "日本語 2。",
                    "notes": [{"kind": "language", "title": "表現", "body": "語の説明。", "spoiler": False}],
                },
            ],
        }

    def test_extract_uses_stable_composite_keys_and_preserves_order(self):
        entries = translate_notes.extract_notes([self.book])
        self.assertEqual([entry["key"] for entry in entries], [
            "iliad-01-0001#note-0001", "iliad-01-0001#note-0002", "iliad-01-0002#note-0001",
        ])
        self.assertEqual([(entry["title"], entry["body"]) for entry in entries], [
            ("人物", "本文。"), ("神話", "別の本文。"), ("表現", "語の説明。"),
        ])

    def test_batches_obey_note_and_japanese_character_limits(self):
        entries = translate_notes.extract_notes([self.book])
        chunks = list(translate_notes.chunks(entries, max_notes=2, max_chars=8))
        self.assertEqual([len(batch) for batch in chunks], [1, 1, 1])
        self.assertTrue(all(sum(len(x["title"]) + len(x["body"]) for x in batch) <= 8 for batch in chunks))

    def test_cache_key_includes_source_identity_text_and_prompt(self):
        with tempfile.TemporaryDirectory() as directory:
            cache_dir = Path(directory)
            entries = translate_notes.extract_notes([self.book])
            first = translate_notes.cache_path(cache_dir, entries[:2])
            edited_text = [{**entries[0], "body": "変更された本文。"}, entries[1]]
            edited_index = [{**entries[0], "key": "iliad-01-0001#note-0003"}, entries[1]]
            self.assertNotEqual(first, translate_notes.cache_path(cache_dir, edited_text))
            self.assertNotEqual(first, translate_notes.cache_path(cache_dir, edited_index))
            original_prompt = translate_notes.PROMPT_RULES
            try:
                translate_notes.PROMPT_RULES += " Glossary revision."
                self.assertNotEqual(first, translate_notes.cache_path(cache_dir, entries[:2]))
            finally:
                translate_notes.PROMPT_RULES = original_prompt

    def test_response_requires_exact_keys_order_and_nonempty_english(self):
        entries = translate_notes.extract_notes([self.book])[:2]
        with tempfile.TemporaryDirectory() as directory:
            response_path = Path(directory) / "response.json"
            valid = {"notes": [
                {"key": entry["key"], "titleEn": "A title", "bodyEn": "A body."}
                for entry in entries
            ]}
            response_path.write_text(json.dumps(valid), encoding="utf-8")
            self.assertEqual(len(translate_notes.validate_response(response_path, entries)["notes"]), 2)
            invalid = {"notes": list(reversed(valid["notes"]))}
            response_path.write_text(json.dumps(invalid), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "keys/order"):
                translate_notes.validate_response(response_path, entries)
            valid["notes"][0]["bodyEn"] = " "
            response_path.write_text(json.dumps(valid), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "empty/invalid"):
                translate_notes.validate_response(response_path, entries)

    def test_reviewed_english_note_correction_is_exact_and_idempotent(self):
        correction = {
            "key": "iliad-01-0005#note-0001",
            "field": "bodyEn",
            "find": "the mouse (smintheus)",
            "replace": "the mouse (sminthos)",
        }
        corrected, changed = translate_notes.apply_correction(
            "Apollo is called Smintheus after the mouse (smintheus).", correction, correction["key"],
        )
        self.assertTrue(changed)
        self.assertEqual(corrected, "Apollo is called Smintheus after the mouse (sminthos).")
        unchanged, changed = translate_notes.apply_correction(corrected, correction, correction["key"])
        self.assertFalse(changed)
        self.assertEqual(unchanged, corrected)
        with self.assertRaisesRegex(ValueError, "does not match current translation"):
            translate_notes.apply_correction("the mouse (smintheus), the mouse (smintheus)", correction, correction["key"])

    def test_phthia_spelling_correction_is_exact_and_idempotent(self):
        correction = {
            "key": "iliad-23-0012#note-0001",
            "field": "bodyEn",
            "find": "Pthia",
            "replace": "Phthia",
        }
        corrected, changed = translate_notes.apply_correction(
            "through Pthia, Achilles' homeland", correction, correction["key"],
        )
        self.assertTrue(changed)
        self.assertEqual(corrected, "through Phthia, Achilles' homeland")
        unchanged, changed = translate_notes.apply_correction(corrected, correction, correction["key"])
        self.assertFalse(changed)
        self.assertEqual(unchanged, corrected)

    def test_apply_translations_only_adds_english_fields(self):
        before = json.loads(json.dumps(self.book, ensure_ascii=False))
        entries = translate_notes.extract_notes([self.book])
        translations = {
            entry["key"]: {"titleEn": f"English title {index}", "bodyEn": f"English body {index}."}
            for index, entry in enumerate(entries, 1)
        }
        translated_count = translate_notes.apply_translations([self.book], translations)
        self.assertEqual(translated_count, 3)
        self.assertEqual(
            [{key: value for key, value in note.items() if key not in {"titleEn", "bodyEn"}}
             for unit in self.book["units"] for note in unit["notes"]],
            [note for unit in before["units"] for note in unit["notes"]],
        )
        self.assertEqual([note["titleEn"] for unit in self.book["units"] for note in unit["notes"]],
                         ["English title 1", "English title 2", "English title 3"])
        self.assertEqual([note["spoiler"] for unit in self.book["units"] for note in unit["notes"]],
                         [False, True, False])

    def test_missing_or_extra_translation_is_rejected(self):
        entries = translate_notes.extract_notes([self.book])
        translations = {
            entry["key"]: {"titleEn": "Title", "bodyEn": "Body."}
            for entry in entries[:-1]
        }
        with self.assertRaisesRegex(ValueError, "translation coverage mismatch"):
            translate_notes.apply_translations([self.book], translations)


if __name__ == "__main__":
    unittest.main()
