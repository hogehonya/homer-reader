#!/usr/bin/env python3
"""Validate source coverage and cached AI drafts; optionally assemble public JSON."""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("import_content", ROOT / "scripts" / "import-content.py")
IMPORTER = importlib.util.module_from_spec(SPEC)
assert SPEC.loader
SPEC.loader.exec_module(IMPORTER)
TRANSLATE_SPEC = importlib.util.spec_from_file_location("translate_content", ROOT / "scripts" / "translate-content.py")
TRANSLATOR = importlib.util.module_from_spec(TRANSLATE_SPEC)
assert TRANSLATE_SPEC.loader
TRANSLATE_SPEC.loader.exec_module(TRANSLATOR)
KINDS = {"person", "place", "myth", "language", "interpretation"}
EXPECTED_NOTE_COUNTS = {"iliad": 749, "odyssey": 626}
WORK_META = {
    "iliad": {
        "titleJa": "イリアス", "titleEn": "The Iliad",
        "descriptionJa": "ホメロス作と伝わる叙事詩。",
    },
    "odyssey": {
        "titleJa": "オデュッセイア", "titleEn": "The Odyssey",
        "descriptionJa": "ホメロス作と伝わる、オデュッセウスの帰還を描く叙事詩。",
    },
}


def check_note(note: dict, unit_id: str, require_english: bool = False) -> None:
    if note.get("kind") not in KINDS or not isinstance(note.get("title"), str) or not note["title"].strip():
        raise ValueError(f"{unit_id}: invalid note kind/title")
    if not isinstance(note.get("body"), str) or not note["body"].strip() or not isinstance(note.get("spoiler"), bool):
        raise ValueError(f"{unit_id}: invalid note body/spoiler")
    if "sourceUrl" in note and not isinstance(note["sourceUrl"], str):
        raise ValueError(f"{unit_id}: invalid sourceUrl")
    if require_english:
        for field in ("titleEn", "bodyEn"):
            if not isinstance(note.get(field), str) or not note[field].strip():
                raise ValueError(f"{unit_id}: note {field} must be a non-empty string")


def note_signature(note: dict) -> str:
    fields = {key: value for key, value in note.items() if key not in {"titleEn", "bodyEn"}}
    return json.dumps(fields, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def existing_note_translations(public_dir: Path) -> dict[str, dict]:
    result = {}
    for work_id in ("iliad", "odyssey"):
        for number in range(1, 25):
            path = public_dir / work_id / f"{number:02d}.json"
            if not path.is_file():
                continue
            payload = json.loads(path.read_text(encoding="utf-8"))
            if payload.get("workId") != work_id or payload.get("bookNumber") != number:
                raise ValueError(f"existing note translations have invalid book metadata: {path}")
            for unit in payload.get("units", []):
                for index, note in enumerate(unit.get("notes", []), 1):
                    key = f"{unit['id']}#note-{index:04d}"
                    title_en, body_en = note.get("titleEn"), note.get("bodyEn")
                    if title_en is None and body_en is None:
                        continue
                    if not isinstance(title_en, str) or not title_en.strip() or not isinstance(body_en, str) or not body_en.strip():
                        raise ValueError(f"{key}: existing English note fields must both be non-empty")
                    if key in result:
                        raise ValueError(f"duplicate existing note translation: {key}")
                    result[key] = {"signature": note_signature(note), "titleEn": title_en, "bodyEn": body_en}
    return result


def preserve_note_translations(unit_id: str, notes: list[dict], existing: dict[str, dict]) -> list[dict]:
    preserved = []
    for index, note in enumerate(notes, 1):
        key = f"{unit_id}#note-{index:04d}"
        previous = existing.get(key)
        if previous is None:
            raise ValueError(f"{key}: missing English note translation; run scripts/translate-notes.py first")
        if previous["signature"] != note_signature(note):
            raise ValueError(f"{key}: Japanese note changed since its English translation")
        preserved.append({**note, "titleEn": previous["titleEn"], "bodyEn": previous["bodyEn"]})
    return preserved


def apply_corrections(translations: dict[str, dict], corrections: list[dict]) -> int:
    applied = 0
    for correction in corrections:
        unit_id = correction["unitId"]
        field = correction.get("field")
        if field not in {"ja", "noteBody"} or unit_id not in translations:
            raise ValueError(f"invalid or unknown translation correction target: {unit_id}")
        if field == "ja":
            target = translations[unit_id]
            key = "ja"
        else:
            notes = translations[unit_id].get("notes", [])
            titled = [note for note in notes if note.get("title") == correction.get("noteTitle")]
            if len(titled) != 1:
                raise ValueError(f"reviewed note correction does not identify exactly one note: {unit_id}")
            target = titled[0]
            key = "body"
        text = target.get(key)
        if not isinstance(text, str):
            raise ValueError(f"reviewed correction target is not text: {unit_id}")
        original, replacement = correction["find"], correction["replace"]
        matches = text.count(original)
        if matches == 1:
            target[key] = text.replace(original, replacement, 1)
            applied += 1
        elif matches != 0 or replacement not in text:
            raise ValueError(f"reviewed correction does not match current draft: {unit_id}")
    return applied


def load_translations(work_id: str, books: list[dict], cache_dir: Path) -> dict[str, dict]:
    result = {}
    for book in books:
        for batch in TRANSLATOR.chunks(book["units"], 1500, 24):
            path = TRANSLATOR.cache_path(cache_dir, batch)
            if not path.is_file():
                raise ValueError(f"missing translation batch: {path.name}")
            response = json.loads(path.read_text(encoding="utf-8"))
            rows = response.get("units")
            if not isinstance(rows, list) or [row.get("id") for row in rows] != [row["id"] for row in batch]:
                raise ValueError(f"{path.name}: IDs/order differ from source")
            for source, row in zip(batch, rows):
                ja = row.get("ja")
                if not isinstance(ja, str) or not ja.strip():
                    raise ValueError(f"{source['id']}: empty Japanese translation")
                source_chars = len(source["en"].strip())
                if len(ja.strip()) < max(8, source_chars * 0.18):
                    raise ValueError(f"{source['id']}: suspiciously short translation")
                japanese_chars = sum("\u3040" <= char <= "\u30ff" or "\u3400" <= char <= "\u9fff" for char in ja)
                if japanese_chars / max(1, len(ja)) < 0.12:
                    raise ValueError(f"{source['id']}: translation appears to remain in English")
                notes = row.get("notes")
                if not isinstance(notes, list):
                    raise ValueError(f"{source['id']}: notes must be a list")
                for note in notes:
                    check_note(note, source["id"])
                if source["id"] in result:
                    raise ValueError(f"duplicate translated ID: {source['id']}")
                result[source["id"]] = {"ja": ja.strip(), "notes": notes}
    expected_count = sum(len(book["units"]) for book in books)
    if len(result) != expected_count:
        raise ValueError(f"{work_id}: translation count mismatch ({len(result)}/{expected_count})")
    correction_file = ROOT / "scripts" / "translate-content-corrections.json"
    correction_rows = json.loads(correction_file.read_text(encoding="utf-8"))["corrections"]
    work_unit_ids = set(result)
    apply_corrections(result, [row for row in correction_rows if row["unitId"] in work_unit_ids])
    return result


def validate_sources(source_dir: Path, raw_dir: Path) -> tuple[dict, dict]:
    manifest = json.loads((source_dir / "source-manifest.json").read_text(encoding="utf-8"))
    source_works = {}
    for work_id, source_meta in IMPORTER.SOURCES.items():
        raw = (raw_dir / f"{source_meta['id']}.txt").read_bytes()
        actual_hash = hashlib.sha256(raw).hexdigest()
        recorded = manifest["works"][work_id]
        if recorded["sha256"] != actual_hash:
            raise ValueError(f"{work_id}: raw source hash mismatch")
        expected_books, _, excluded, audit = IMPORTER.parse_books(raw.decode("utf-8-sig"), work_id)
        audit_rows = recorded.get("excludedEditorialTextByBook", [])
        if len(excluded) != 24 or audit_rows != excluded:
            raise ValueError(f"{work_id}: excluded heading audit mismatch")
        if recorded.get("excludedEditorialParagraphs") != 24:
            raise ValueError(f"{work_id}: expected exactly 24 excluded editorial blocks")
        for key, value in audit.items():
            if recorded.get(key) != value:
                raise ValueError(f"{work_id}: source audit differs for {key}")
        parsed = json.loads((source_dir / f"{work_id}.json").read_text(encoding="utf-8"))
        if len(parsed.get("books", [])) != 24:
            raise ValueError(f"{work_id}: source import does not have 24 books")
        all_units = []
        for number, (expected, book) in enumerate(zip(expected_books, parsed["books"]), 1):
            units = book.get("units", [])
            expected_ids = [f"{work_id}-{number:02d}-{i:04d}" for i in range(1, len(expected) + 1)]
            if [u.get("id") for u in units] != expected_ids or [u.get("en") for u in units] != expected:
                raise ValueError(f"{work_id} book {number}: normalized English differs from full narrative source")
            all_units.extend(units)
        source_works[work_id] = (parsed, all_units)
    return manifest, source_works


def catalog_for(manifest: dict, source_works: dict, translated_works: dict) -> dict:
    works = []
    for work_id in ("iliad", "odyssey"):
        source, _ = source_works[work_id]
        english = manifest["works"][work_id]
        if work_id == "iliad":
            translation_review_scope = "49単位（英文6,203語）をAIで抜取照合。別途1単位の表現も個別確認・修正。全本文の通読校閲は未実施。"
            commentary_review_scope = "49単位（英文6,203語）の解説をAIで抜取照合。全解説の通読校閲は未実施。"
        else:
            translation_review_scope = "49単位（英文5,515語）をAIで抜取照合。全本文の通読校閲は未実施。"
            commentary_review_scope = "49単位（英文5,515語）の解説をAIで抜取照合。全解説の通読校閲は未実施。"
        books = []
        for book in source["books"]:
            books.append({
                "number": book["number"],
                "titleJa": f"第{book['number']}巻",
                "unitCount": len(book["units"]),
                "dataFile": f"data/{work_id}/{book['number']:02d}.json",
            })
        works.append({
            "id": work_id,
            **WORK_META[work_id],
            "books": books,
            "source": {
                "english": {
                    "title": WORK_META[work_id]["titleEn"], "translator": "Samuel Butler",
                    "url": english["url"], "license": "Public domain in the USA; source record and rights basis are documented in CONTENT.md.",
                    "sha256": english["sha256"], "acquiredDate": manifest["retrievedAt"],
                },
                "japanese": {
                    "title": "新規AI生成訳（Butler英訳からの重訳）", "translator": "AI-generated draft",
                    "license": "Original AI-generated translation based on the public-domain English text.",
                    "reviewScope": translation_review_scope,
                },
                "commentary": {
                    "author": "AI生成",
                    "method": "Butler英訳の各段落に基づきAIが作成。",
                    "reviewScope": commentary_review_scope,
                },
                "alignment": {
                    "method": "One Butler English source paragraph per stable ID; wrapped lines are joined with spaces.",
                    "scope": f"All {len(translated_works[work_id])} narrative paragraphs; no Greek line references are claimed.",
                },
            },
        })
    return {"version": 1, "works": works}


def narrative_digest(units: list[dict]) -> str:
    canonical = [{"id": unit["id"], "en": unit["en"]} for unit in units]
    payload = json.dumps(canonical, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def public_source_manifest(manifest: dict, source_works: dict) -> dict:
    works = []
    for work_id in ("iliad", "odyssey"):
        parsed, units = source_works[work_id]
        source = manifest["works"][work_id]
        books = []
        for book in parsed["books"]:
            book_units = book["units"]
            books.append({
                "number": book["number"],
                "unitCount": len(book_units),
                "englishWordCount": sum(len(unit["en"].split()) for unit in book_units),
                "firstUnitId": book_units[0]["id"],
                "lastUnitId": book_units[-1]["id"],
                "narrativeSha256": narrative_digest(book_units),
            })
        works.append({
            "id": work_id,
            "gutenbergId": source["gutenbergId"],
            "sourceUrl": source["url"],
            "rawSha256": source["sha256"],
            "rawByteLength": source["byteLength"],
            "bookCount": len(books),
            "narrativeUnitCount": len(units),
            "englishWordCount": sum(len(unit["en"].split()) for unit in units),
            "exclusions": {
                "editorialHeadingCount": source["excludedEditorialParagraphs"],
                "editorialHeadingSha256ByBook": [
                    hashlib.sha256(row["text"].encode("utf-8")).hexdigest()
                    for row in source["excludedEditorialTextByBook"]
                ],
                "detachedEndnoteBlockCount": source["excludedEndnoteSection"]["paragraphCount"],
                "detachedEndnoteReferenceCount": source["excludedEndnoteSection"]["referenceCount"],
                "inlineEndnoteMarkerCount": source["removedInlineFootnoteMarkerCount"],
                "postEbookBlockCount": source["excludedPostEbookBlocks"],
            },
            "books": books,
        })
    return {
        "version": 1,
        "retrievedAt": manifest["retrievedAt"],
        "hashAlgorithm": "SHA-256",
        "narrativeDigestFormat": "SHA-256 of UTF-8 JSON array [{id,en}, ...] using ensure_ascii=false and compact separators, in source order",
        "normalization": "UTF-8 decode; join wrapped lines within paragraphs; preserve paragraph order and wording; exclude the first checked editorial block after each BOOK marker; exclude Odyssey detached FOOTNOTES and inline reference digits; exclude Project Gutenberg post-ebook matter.",
        "works": works,
    }


def assemble(source_dir: Path, cache_dir: Path, raw_dir: Path, public_dir: Path) -> dict:
    manifest, source_works = validate_sources(source_dir, raw_dir)
    prior_note_translations = existing_note_translations(public_dir)
    translated_works = {}
    for work_id, (parsed, units) in source_works.items():
        translated = load_translations(work_id, parsed["books"], cache_dir)
        if len(translated) != len(units):
            raise ValueError(f"{work_id}: incomplete translations")
        for book in parsed["books"]:
            if not any(translated[unit["id"]]["notes"] for unit in book["units"]):
                raise ValueError(f"{work_id} book {book['number']}: missing reading commentary")
        translated_works[work_id] = translated
    expected_note_keys = {
        f"{unit['id']}#note-{index:04d}"
        for work_id in ("iliad", "odyssey")
        for unit in source_works[work_id][1]
        for index, _ in enumerate(translated_works[work_id][unit["id"]]["notes"], 1)
    }
    if set(prior_note_translations) != expected_note_keys:
        raise ValueError(
            "existing English note translations do not cover the complete generated note set; "
            "run scripts/translate-notes.py before assembling"
        )
    catalog = catalog_for(manifest, source_works, translated_works)
    for work in catalog["works"]:
        work_id = work["id"]
        parsed, _ = source_works[work_id]
        for book in parsed["books"]:
            output = {
                "workId": work_id, "bookNumber": book["number"],
                "units": [
                    {"id": unit["id"], "reference": unit["reference"], "en": unit["en"],
                     "ja": translated_works[work_id][unit["id"]]["ja"],
                     "notes": preserve_note_translations(
                         unit["id"], translated_works[work_id][unit["id"]]["notes"], prior_note_translations,
                     )}
                    for unit in book["units"]
                ],
            }
            path = public_dir / work_id / f"{book['number']:02d}.json"
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps(output, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    public_dir.mkdir(parents=True, exist_ok=True)
    (public_dir / "catalog.json").write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    source_manifest = public_source_manifest(manifest, source_works)
    (public_dir / "source-manifest.json").write_text(json.dumps(source_manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return catalog


def verify_published(public_dir: Path, expected_note_counts: dict[str, int] | None = EXPECTED_NOTE_COUNTS) -> None:
    manifest_path = public_dir / "source-manifest.json"
    catalog_path = public_dir / "catalog.json"
    if not manifest_path.is_file() or not catalog_path.is_file():
        raise ValueError("published content is incomplete: source-manifest.json and catalog.json are required")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
    if manifest.get("version") != 1 or manifest.get("hashAlgorithm") != "SHA-256":
        raise ValueError("unsupported source manifest version or hash algorithm")
    if catalog.get("version") != 1:
        raise ValueError("unsupported catalog version")
    catalog_works = catalog.get("works")
    manifest_works = manifest.get("works")
    if not isinstance(catalog_works, list) or not isinstance(manifest_works, list):
        raise ValueError("catalog and source manifest must contain work arrays")
    if [work.get("id") for work in catalog_works] != ["iliad", "odyssey"]:
        raise ValueError("catalog must contain Iliad and Odyssey in order")
    if [work.get("id") for work in manifest_works] != ["iliad", "odyssey"]:
        raise ValueError("source manifest must contain Iliad and Odyssey in order")
    if manifest.get("normalization") != "UTF-8 decode; join wrapped lines within paragraphs; preserve paragraph order and wording; exclude the first checked editorial block after each BOOK marker; exclude Odyssey detached FOOTNOTES and inline reference digits; exclude Project Gutenberg post-ebook matter.":
        raise ValueError("source manifest normalization policy mismatch")
    expected_paths: set[str] = set()
    for catalog_work, manifest_work in zip(catalog_works, manifest_works):
        work_id = catalog_work["id"]
        if not isinstance(manifest_work.get("rawSha256"), str) or len(manifest_work["rawSha256"]) != 64:
            raise ValueError(f"{work_id}: invalid raw source hash")
        if manifest_work.get("bookCount") != 24 or len(manifest_work.get("books", [])) != 24:
            raise ValueError(f"{work_id}: source manifest must describe all 24 books")
        catalog_books = catalog_work.get("books")
        if not isinstance(catalog_books, list) or len(catalog_books) != 24:
            raise ValueError(f"{work_id}: catalog must describe all 24 books")
        seen_ids: set[str] = set()
        unit_total = 0
        word_total = 0
        note_total = 0
        for number, (book, expected) in enumerate(zip(catalog_books, manifest_work["books"]), 1):
            expected_file = f"data/{work_id}/{number:02d}.json"
            if book.get("number") != number or expected.get("number") != number or book.get("dataFile") != expected_file:
                raise ValueError(f"{work_id} book {number}: catalog/source-manifest mapping mismatch")
            expected_paths.add(expected_file)
            path = public_dir.parent / expected_file
            if not path.is_file():
                raise ValueError(f"{work_id} book {number}: missing published data file {expected_file}")
            payload = json.loads(path.read_text(encoding="utf-8"))
            units = payload.get("units")
            if payload.get("workId") != work_id or payload.get("bookNumber") != number or not isinstance(units, list):
                raise ValueError(f"{work_id} book {number}: invalid book file shape")
            if len(units) != expected.get("unitCount") or book.get("unitCount") != expected.get("unitCount"):
                raise ValueError(f"{work_id} book {number}: unit count mismatch")
            prefix = f"{work_id}-{number:02d}-"
            for index, unit in enumerate(units, 1):
                unit_id = unit.get("id")
                if unit_id != f"{prefix}{index:04d}" or unit_id in seen_ids:
                    raise ValueError(f"{work_id} book {number}: missing, duplicate, or out-of-order unit ID")
                seen_ids.add(unit_id)
                if not isinstance(unit.get("en"), str) or not unit["en"].strip():
                    raise ValueError(f"{unit_id}: missing English source")
                if not isinstance(unit.get("ja"), str) or not unit["ja"].strip():
                    raise ValueError(f"{unit_id}: missing Japanese translation")
                notes = unit.get("notes")
                if not isinstance(notes, list):
                    raise ValueError(f"{unit_id}: notes must be an array")
                for note in notes:
                    check_note(note, unit_id, require_english=True)
                note_total += len(notes)
            if not units or units[0]["id"] != expected.get("firstUnitId") or units[-1]["id"] != expected.get("lastUnitId"):
                raise ValueError(f"{work_id} book {number}: first/last unit boundary mismatch")
            if narrative_digest(units) != expected.get("narrativeSha256"):
                raise ValueError(f"{work_id} book {number}: English narrative digest mismatch")
            book_words = sum(len(unit["en"].split()) for unit in units)
            if book_words != expected.get("englishWordCount"):
                raise ValueError(f"{work_id} book {number}: English word count mismatch")
            unit_total += len(units)
            word_total += book_words
        if unit_total != manifest_work.get("narrativeUnitCount") or word_total != manifest_work.get("englishWordCount"):
            raise ValueError(f"{work_id}: total unit/word count mismatch")
        if expected_note_counts is not None and note_total != expected_note_counts[work_id]:
            raise ValueError(f"{work_id}: note count mismatch ({note_total}/{expected_note_counts[work_id]})")
    print(f"Verified published source coverage: 48 books / {sum(work['narrativeUnitCount'] for work in manifest_works)} narrative units.")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-dir", type=Path, default=Path("/tmp/homer-reader-source"))
    parser.add_argument("--raw-dir", type=Path, default=Path("/tmp/homer-reader-content-cache"))
    parser.add_argument("--cache-dir", type=Path, default=Path("/tmp/homer-reader-translation-cache"))
    parser.add_argument("--public-dir", type=Path, default=ROOT / "public" / "data")
    parser.add_argument("--assemble", action="store_true", help="write validated content to public/data")
    parser.add_argument("--verify-published", action="store_true", help="verify committed public/data against its source manifest")
    args = parser.parse_args()
    if args.verify_published:
        verify_published(args.public_dir)
    elif args.assemble:
        catalog = assemble(args.source_dir, args.cache_dir, args.raw_dir, args.public_dir)
        print(f"Assembled {len(catalog['works'])} works / 48 books into {args.public_dir}.")
    else:
        manifest, source_works = validate_sources(args.source_dir, args.raw_dir)
        for work_id, (parsed, _) in source_works.items():
            load_translations(work_id, parsed["books"], args.cache_dir)
        print("Source coverage and all cached translations validated.")


if __name__ == "__main__":
    main()
