#!/usr/bin/env python3
"""Download and normalize the two Project Gutenberg Samuel Butler texts."""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import urllib.request
from pathlib import Path


SOURCES = {
    "iliad": {
        "id": 2199,
        "url": "https://www.gutenberg.org/files/2199/2199-0.txt",
        "title_en": "The Iliad",
        "title_ja": "イリアス",
    },
    "odyssey": {
        "id": 1727,
        "url": "https://www.gutenberg.org/files/1727/1727-0.txt",
        "title_en": "The Odyssey",
        "title_ja": "オデュッセイア",
    },
}

ROMANS = [
    "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII",
    "XIII", "XIV", "XV", "XVI", "XVII", "XVIII", "XIX", "XX", "XXI", "XXII", "XXIII", "XXIV",
]
BOOK_RE = re.compile(r"^\s*BOOK\s+(" + "|".join(ROMANS) + r")\.?\s*$", re.I | re.M)


def normalize_text(text: str) -> str:
    """Join source-wrapped lines while retaining paragraph boundaries and wording."""
    paragraphs = []
    for block in re.split(r"\n\s*\n", text.replace("\r\n", "\n").replace("\r", "\n")):
        paragraph = re.sub(r"\s+", " ", block).strip()
        if paragraph and not BOOK_RE.fullmatch(paragraph):
            paragraphs.append(paragraph)
    return "\n\n".join(paragraphs)


ILIAD_HEADING_EXCEPTIONS = {
    10: "Ulysses and Diomed go out as spies",
    15: "Jove awakes, tells Apollo to heal Hector",
    19: "Achilles is reconciled with Agamemnon",
}


def is_editorial_heading(work_id: str, book_number: int, text: str) -> bool:
    letters = [char for char in text if char.isalpha()]
    if work_id == "odyssey":
        return bool(letters) and text.upper() == text
    if work_id == "iliad":
        if "—" in text or len(text) <= 70:
            return True
        prefix = ILIAD_HEADING_EXCEPTIONS.get(book_number)
        return bool(prefix and text.startswith(prefix))
    return False


def strip_inline_footnote_markers(text: str, work_id: str) -> str:
    if work_id == "odyssey":
        text = re.sub(r"\d+", "", text)
    return re.sub(r"\s+", " ", text).strip()


def parse_books(raw: str, work_id: str) -> tuple[list[list[str]], str, list[dict], dict]:
    """Return the 24 books and normalized complete book text; ignore Gutenberg front/back matter."""
    text = raw.lstrip("\ufeff").replace("\r\n", "\n").replace("\r", "\n")
    end_marker = re.search(r"^\*\*\* END OF THE PROJECT GUTENBERG EBOOK .*?\s*$", text, re.M | re.I)
    excluded_post_ebook_blocks = 0
    if end_marker:
        tail = normalize_text(text[end_marker.start():])
        excluded_post_ebook_blocks = len(tail.split("\n\n")) if tail else 0
        text = text[:end_marker.start()]
    starts = [(m.start(), ROMANS.index(m.group(1).upper())) for m in BOOK_RE.finditer(text)]
    # Contents lists and the actual text both contain headings. Keep the last complete sequence.
    runs: list[list[tuple[int, int]]] = []
    current: list[tuple[int, int]] = []
    for item in starts:
        index = item[1]
        if index == 0 and current:
            runs.append(current)
            current = []
        if not current or index == current[-1][1] + 1:
            current.append(item)
        elif index == 0:
            current = [item]
        else:
            current = []
    if current:
        runs.append(current)
    candidates = [run for run in runs if len(run) == 24 and [i for _, i in run] == list(range(24))]
    if not candidates:
        raise ValueError(f"{work_id}: could not identify a complete 24-book sequence")
    headings = candidates[-1]
    footnote_matches = [m for m in re.finditer(r"^FOOTNOTES:\s*$", text, re.M | re.I) if m.start() > headings[-1][0]]
    endnote_start = footnote_matches[-1].start() if footnote_matches else None
    endnote_text = text[endnote_start:] if endnote_start is not None else ""
    endnote_blocks = normalize_text(endnote_text).split("\n\n") if endnote_text else []
    section_end = endnote_start if endnote_start is not None else len(text)
    books: list[list[str]] = []
    complete = []
    excluded: list[dict] = []
    inline_marker_numbers = []
    for n, (start, _) in enumerate(headings):
        end = headings[n + 1][0] if n + 1 < len(headings) else section_end
        book_raw = text[start: end]
        # Exclude the BOOK marker and the first editorial synopsis/heading block; narrative follows.
        marker = BOOK_RE.search(book_raw)
        assert marker
        paragraphs = normalize_text(book_raw[marker.end():]).split("\n\n")
        if len(paragraphs) < 2 or not paragraphs[0]:
            raise ValueError(f"{work_id} book {n + 1}: expected editorial heading and narrative")
        if not is_editorial_heading(work_id, n + 1, paragraphs[0]):
            raise ValueError(f"{work_id} book {n + 1}: first block does not match known editorial-heading patterns")
        excluded.append({"bookNumber": n + 1, "text": paragraphs[0]})
        narrative = paragraphs[1:]
        for paragraph in narrative:
            if work_id == "odyssey":
                inline_marker_numbers.extend(int(value) for value in re.findall(r"\d+", paragraph))
        narrative = [strip_inline_footnote_markers(paragraph, work_id) for paragraph in narrative]
        if any(not paragraph for paragraph in narrative):
            raise ValueError(f"{work_id} book {n + 1}: footnote removal left an empty narrative paragraph")
        books.append(narrative)
        complete.extend(narrative)
    if work_id == "odyssey":
        expected_refs = [n for n in range(1, 188) if n != 88]
        if sorted(inline_marker_numbers) != expected_refs:
            found = sorted(set(inline_marker_numbers))
            raise ValueError(f"odyssey: inline footnote markers do not match expected source sequence (count={len(inline_marker_numbers)}, missing={sorted(set(expected_refs) - set(inline_marker_numbers))[:8]}, extra={sorted(set(inline_marker_numbers) - set(expected_refs))[:8]})")
    audit = {
        "excludedPostEbookBlocks": excluded_post_ebook_blocks,
        "excludedEndnoteSection": {
            "marker": "FOOTNOTES:" if endnote_start is not None else None,
            "paragraphCount": len(endnote_blocks),
            "referenceCount": len(re.findall(r"^(?:\[\d+\]|\d+\[\])", endnote_text, re.M)) if endnote_text else 0,
            "text": endnote_blocks,
        },
        "removedInlineFootnoteMarkerCount": len(inline_marker_numbers),
        "removedInlineFootnoteMarkerNumbers": sorted(inline_marker_numbers),
    }
    return books, "\n\n".join(complete), excluded, audit


def fetch(url: str) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": "homer-reader-content-import/1.0"})
    with urllib.request.urlopen(request, timeout=45) as response:
        return response.read()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--cache-dir", type=Path, default=Path("/tmp/homer-reader-content-cache"))
    parser.add_argument("--out-dir", type=Path, default=Path("/tmp/homer-reader-source"))
    args = parser.parse_args()
    args.cache_dir.mkdir(parents=True, exist_ok=True)
    args.out_dir.mkdir(parents=True, exist_ok=True)
    manifest = {"retrievedAt": "2026-10-10", "works": {}}
    for work_id, source in SOURCES.items():
        raw_path = args.cache_dir / f"{source['id']}.txt"
        raw = raw_path.read_bytes() if raw_path.exists() else fetch(source["url"])
        raw_path.write_bytes(raw)
        raw_text = raw.decode("utf-8-sig")
        books, _, excluded, audit = parse_books(raw_text, work_id)
        work = {"workId": work_id, "titleJa": source["title_ja"], "titleEn": source["title_en"], "books": []}
        for number, paragraphs in enumerate(books, 1):
            units = [
                {"id": f"{work_id}-{number:02d}-{i:04d}", "reference": f"Butler {work_id.title()} {number}, paragraph {i}", "en": p, "ja": "", "notes": []}
                for i, p in enumerate(paragraphs, 1)
            ]
            work["books"].append({"number": number, "units": units})
        (args.out_dir / f"{work_id}.json").write_text(json.dumps(work, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        manifest["works"][work_id] = {
            "gutenbergId": source["id"], "url": source["url"], "sha256": hashlib.sha256(raw).hexdigest(),
            "byteLength": len(raw), "bookCount": len(books), "paragraphCount": sum(map(len, books)),
            "excludedEditorialParagraphs": len(books),
            **audit,
            "excludedEditorialTextByBook": excluded,
            "normalization": "UTF-8 decode; normalize whitespace within paragraph; exclude one checked editorial heading/synopsis block per book, the detached Odyssey FOOTNOTES section, Odyssey inline footnote reference digits, and Project Gutenberg legal matter after the END OF EBOOK marker.",
        }
    (args.out_dir / "source-manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
