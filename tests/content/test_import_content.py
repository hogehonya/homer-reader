import importlib.util
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).parents[2] / "scripts" / "import-content.py"
spec = importlib.util.spec_from_file_location("import_content", MODULE_PATH)
import_content = importlib.util.module_from_spec(spec)
spec.loader.exec_module(import_content)


class ImportContentTests(unittest.TestCase):
    def source(self, work_id):
        lines = ["Project Gutenberg front matter", ""]
        odyssey_ref_numbers = iter(n for n in range(1, 188) if n != 88)
        for number, roman in enumerate(import_content.ROMANS, 1):
            lines.extend([f"BOOK {roman}.", ""])
            if number == 1 and work_id == "iliad":
                heading, narrative = "THE QUARREL—A SUMMARY.", "Sing, O goddess, the anger of Achilles."
            elif number == 1 and work_id == "odyssey":
                heading, narrative = "THE GODS IN COUNCIL—A SUMMARY.", "Tell me, O Muse, of that ingenious hero."
            elif work_id == "odyssey":
                heading, narrative = f"EDITORIAL HEADING FOR BOOK {number}.", f"Opening narrative of Odyssey {roman}."
            else:
                heading, narrative = f"Summary—events of Iliad book {number}.", f"Opening narrative of Iliad book {number}."
            if work_id == "odyssey" and number == 1:
                narrative += " " + " ".join(str(n) for n in odyssey_ref_numbers)
                heading += "88"
            lines.extend([heading, "", narrative, "", "A second paragraph wrapped", "over two lines.", ""])
        if work_id == "odyssey":
            lines.extend(["FOOTNOTES:", "[1] Editorial endnote spoiler.", "29[] [A differently formatted note.]", "[187] Final endnote.", ""])
        lines.extend(["*** END OF THE PROJECT GUTENBERG EBOOK TEST ***", "License boilerplate must not enter the book."])
        return "\n".join(lines)

    def test_all_books_and_full_narrative_openers_are_preserved(self):
        iliad, _, excluded_iliad, audit_iliad = import_content.parse_books(self.source("iliad"), "iliad")
        odyssey, _, excluded_odyssey, audit_odyssey = import_content.parse_books(self.source("odyssey"), "odyssey")
        self.assertEqual(len(iliad), 24)
        self.assertEqual(len(odyssey), 24)
        self.assertEqual(iliad[0][0], "Sing, O goddess, the anger of Achilles.")
        self.assertEqual(odyssey[0][0], "Tell me, O Muse, of that ingenious hero.")
        self.assertEqual(iliad[0][1], "A second paragraph wrapped over two lines.")
        self.assertEqual(len(excluded_iliad), 24)
        self.assertEqual(len(excluded_odyssey), 24)
        self.assertNotIn("License boilerplate", "\n".join(sum(iliad, [])))
        self.assertEqual(audit_odyssey["removedInlineFootnoteMarkerCount"], 186)
        self.assertEqual(audit_odyssey["excludedEndnoteSection"]["referenceCount"], 3)
        self.assertEqual(odyssey[-1][-1], "A second paragraph wrapped over two lines.")
        self.assertNotIn("Editorial endnote spoiler", "\n".join(sum(odyssey, [])))
        self.assertEqual(audit_iliad["excludedEndnoteSection"]["referenceCount"], 0)

    def test_missing_book_is_rejected(self):
        source = self.source("iliad").replace("BOOK XII.\n\n", "", 1)
        with self.assertRaisesRegex(ValueError, "complete 24-book sequence"):
            import_content.parse_books(source, "iliad")

    def test_non_editorial_first_block_is_not_silently_dropped(self):
        source = self.source("odyssey").replace("THE GODS IN COUNCIL—A SUMMARY.", "A narrative-looking sentence.", 1)
        with self.assertRaisesRegex(ValueError, "known editorial-heading patterns"):
            import_content.parse_books(source, "odyssey")


if __name__ == "__main__":
    unittest.main()
