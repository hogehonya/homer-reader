import importlib.util
import unittest
from pathlib import Path


ROOT = Path(__file__).parents[2]
SPEC = importlib.util.spec_from_file_location("translate_content", ROOT / "scripts" / "translate-content.py")
translate_content = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(translate_content)


class TranslationBatchTests(unittest.TestCase):
    def test_batches_respect_word_and_paragraph_limits(self):
        units = [{"id": f"x-{i}", "en": "word " * 4} for i in range(7)]
        result = list(translate_content.chunks(units, max_words=10, max_units=3))
        self.assertEqual([len(batch) for batch in result], [2, 2, 2, 1])
        self.assertTrue(all(sum(len(unit["en"].split()) for unit in batch) <= 10 for batch in result))

    def test_cache_key_changes_with_source_and_prompt(self):
        cache_dir = Path("/tmp/homer-reader-test-cache")
        source = [{"id": "iliad-01-0001", "en": "Sing, O goddess."}]
        initial = translate_content.cache_path(cache_dir, source)
        edited = translate_content.cache_path(cache_dir, [{**source[0], "en": "Sing, O Muse."}])
        self.assertNotEqual(initial, edited)
        original_prompt = translate_content.PROMPT_RULES
        try:
            translate_content.PROMPT_RULES += " Glossary revision."
            changed_prompt = translate_content.cache_path(cache_dir, source)
        finally:
            translate_content.PROMPT_RULES = original_prompt
        self.assertNotEqual(initial, changed_prompt)


if __name__ == "__main__":
    unittest.main()
