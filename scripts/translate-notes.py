#!/usr/bin/env python3
"""Translate existing Japanese notes into English using the managed read-only runtime."""
from __future__ import annotations

import argparse
import concurrent.futures
import copy
import hashlib
import json
import os
import signal
import subprocess
import time
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CLI = "/home/honya/.local/bin/codex-deepseek"
WORK_IDS = ("iliad", "odyssey")
EXPECTED_NOTE_COUNTS = {"iliad": 749, "odyssey": 626}
PROMPT_RULES = """Translate only the supplied existing Japanese note titles and bodies into fluent, concise English. This is a faithful translation, not a summary, rewrite, expansion, or new commentary. Do not add facts, context, interpretations, or plot information. Preserve every qualification, uncertainty, time reference, and level of spoiler in the Japanese. Use the note's existing category only as context; do not translate or alter its category. Use familiar English names for Greek myth (ゼウス=Zeus, ヘラ=Hera, アテナ=Athena, オデュッセウス=Odysseus, ポセイドン=Poseidon, トロイア=Troy, アカイア勢=Achaeans); keep other names consistent with the source passage. Translate every supplied title and body completely.

For each input key, return exactly one result with non-empty titleEn and bodyEn, in the same order. Do not return Japanese source text or any fields besides key, titleEn, and bodyEn. Return only strict JSON of this shape: {"notes":[{"key":"...","titleEn":"...","bodyEn":"..."}]}. No markdown fences or text outside JSON.
"""


def note_key(unit_id: str, note_index: int) -> str:
    return f"{unit_id}#note-{note_index:04d}"


def extract_notes(books: list[dict]) -> list[dict]:
    entries = []
    seen = set()
    for book in books:
        for unit in book.get("units", []):
            unit_id = unit.get("id")
            if not isinstance(unit_id, str) or not unit_id:
                raise ValueError("every unit must have a non-empty ID")
            notes = unit.get("notes")
            if not isinstance(notes, list):
                raise ValueError(f"{unit_id}: notes must be an array")
            for index, note in enumerate(notes, 1):
                if not isinstance(note, dict):
                    raise ValueError(f"{unit_id}: note {index} must be an object")
                title, body = note.get("title"), note.get("body")
                if not isinstance(title, str) or not title.strip() or not isinstance(body, str) or not body.strip():
                    raise ValueError(f"{unit_id}: note {index} has an empty Japanese title/body")
                key = note_key(unit_id, index)
                if key in seen:
                    raise ValueError(f"duplicate note key: {key}")
                seen.add(key)
                entries.append({"key": key, "title": title, "body": body})
    return entries


def chunks(entries: list[dict], max_notes: int, max_chars: int):
    batch = []
    chars = 0
    for entry in entries:
        entry_chars = len(entry["title"]) + len(entry["body"])
        if batch and (chars + entry_chars > max_chars or len(batch) >= max_notes):
            yield batch
            batch, chars = [], 0
        batch.append(entry)
        chars += entry_chars
    if batch:
        yield batch


def cache_path(cache_dir: Path, entries: list[dict]) -> Path:
    canonical = json.dumps(
        [{"key": x["key"], "title": x["title"], "body": x["body"]} for x in entries],
        ensure_ascii=False, separators=(",", ":"),
    ).encode("utf-8")
    source_hash = hashlib.sha256(canonical).hexdigest()
    prompt_hash = hashlib.sha256(PROMPT_RULES.encode("utf-8")).hexdigest()
    return cache_dir / f"notes-{source_hash}-{prompt_hash}.json"


def make_prompt(entries: list[dict]) -> str:
    payload = [{"key": x["key"], "title": x["title"], "body": x["body"]} for x in entries]
    return PROMPT_RULES + "\nExisting Japanese notes:\n" + json.dumps(payload, ensure_ascii=False)


def validate_response_data(result: dict, entries: list[dict]) -> dict:
    notes = result.get("notes")
    if not isinstance(notes, list) or [x.get("key") for x in notes] != [x["key"] for x in entries]:
        raise ValueError("returned note keys/order do not match request")
    for note in notes:
        if any(not isinstance(note.get(field), str) or not note[field].strip() for field in ("titleEn", "bodyEn")):
            raise ValueError(f"empty/invalid English note for {note.get('key')}")
    return result


def validate_response(path: Path, entries: list[dict]) -> dict:
    return validate_response_data(json.loads(path.read_text(encoding="utf-8")), entries)


def apply_correction(text: str, correction: dict, key: str) -> tuple[str, bool]:
    if not isinstance(text, str):
        raise ValueError(f"{key}: correction target must be text")
    original, replacement = correction["find"], correction["replace"]
    matches = text.count(original)
    if matches == 1:
        return text.replace(original, replacement, 1), True
    if matches == 0 and replacement in text:
        return text, False
    raise ValueError(f"{key}: reviewed correction does not match current translation exactly")


def apply_corrections_to_caches(cache_dir: Path, batches: list[list[dict]], corrections: list[dict]) -> dict[str, dict]:
    corrections_by_key = {row["key"]: row for row in corrections}
    active_keys = {entry["key"] for batch in batches for entry in batch}
    found = set()
    translations = {}
    for batch in batches:
        path = cache_path(cache_dir, batch)
        if not path.is_file():
            raise ValueError(f"missing note translation cache: {path.name}")
        result = validate_response(path, batch)
        for note in result["notes"]:
            correction = corrections_by_key.get(note["key"])
            if correction:
                if correction.get("field") != "bodyEn":
                    raise ValueError(f"{note['key']}: unsupported reviewed correction field")
                note["bodyEn"], _ = apply_correction(note["bodyEn"], correction, note["key"])
                found.add(note["key"])
            translations[note["key"]] = note
        if any(row["key"] in corrections_by_key for row in result["notes"]):
            atomic_json(path, result)
    missing = (set(corrections_by_key) & active_keys) - found
    if missing:
        raise ValueError(f"reviewed note correction target is missing from generated notes: {sorted(missing)}")
    return translations


def apply_corrections_to_books(books: list[dict], corrections: list[dict]) -> None:
    targets = {}
    for book in books:
        for unit in book["units"]:
            for index, note in enumerate(unit["notes"], 1):
                targets[note_key(unit["id"], index)] = note
    for correction in corrections:
        key = correction["key"]
        if key not in targets:
            raise ValueError(f"reviewed correction target is missing from public data: {key}")
        note = targets[key]
        field = correction.get("field")
        if field != "bodyEn":
            raise ValueError(f"{key}: unsupported reviewed correction field")
        if note.get(field) is not None:
            note[field], _ = apply_correction(note[field], correction, key)


def existing_translation(entry: dict, note: dict) -> dict | None:
    title_en, body_en = note.get("titleEn"), note.get("bodyEn")
    has_title, has_body = title_en is not None, body_en is not None
    if has_title != has_body:
        raise ValueError(f"{entry['key']}: titleEn and bodyEn must be added together")
    if not has_title:
        return None
    if not isinstance(title_en, str) or not title_en.strip() or not isinstance(body_en, str) or not body_en.strip():
        raise ValueError(f"{entry['key']}: existing English note fields must be non-empty")
    return {"key": entry["key"], "titleEn": title_en, "bodyEn": body_en}


def atomic_json(path: Path, value: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    temporary.replace(path)


def translate_batch(cache_dir: Path, entries: list[dict], existing: dict[str, dict], timeout: int = 300, retries: int = 2) -> tuple[Path, float]:
    cache_dir.mkdir(parents=True, exist_ok=True)
    output = cache_path(cache_dir, entries)
    if output.exists():
        try:
            validate_response(output, entries)
            return output, 0.0
        except Exception:
            pass

    missing = [entry for entry in entries if entry["key"] not in existing]
    if not missing:
        atomic_json(output, {"notes": [existing[entry["key"]] for entry in entries]})
        return output, 0.0

    elapsed = 0.0
    for attempt in range(1, retries + 1):
        temporary = cache_dir / f"{output.stem}.attempt-{attempt}.tmp"
        command = [CLI, "exec", "--ephemeral", "--sandbox", "read-only", "--output-last-message", str(temporary), "-"]
        started = time.monotonic()
        process = subprocess.Popen(
            command, stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            text=True, cwd=ROOT, start_new_session=True,
        )
        try:
            process.communicate(make_prompt(missing), timeout=timeout)
        except subprocess.TimeoutExpired:
            elapsed += time.monotonic() - started
            os.killpg(process.pid, signal.SIGTERM)
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGKILL)
                process.wait()
            if temporary.exists():
                temporary.replace(cache_dir / f"{output.stem}.timeout-{attempt}.txt")
            continue
        elapsed += time.monotonic() - started
        if process.returncode:
            continue
        try:
            translated = validate_response(temporary, missing)["notes"]
            by_key = {row["key"]: row for row in translated}
            full_result = {"notes": [existing.get(entry["key"], by_key.get(entry["key"])) for entry in entries]}
            validate_response_data(full_result, entries)
            atomic_json(output, full_result)
            temporary.unlink(missing_ok=True)
            return output, elapsed
        except Exception:
            if temporary.exists():
                temporary.replace(cache_dir / f"{output.stem}.invalid-{attempt}.txt")
    raise RuntimeError(f"note translation batch failed after {retries} attempts/{elapsed:.1f}s: {entries[0]['key']}..{entries[-1]['key']}")


def load_books(public_dir: Path) -> list[tuple[Path, dict]]:
    books = []
    for work_id in WORK_IDS:
        for number in range(1, 25):
            path = public_dir / work_id / f"{number:02d}.json"
            if not path.is_file():
                raise ValueError(f"missing book data: {path}")
            book = json.loads(path.read_text(encoding="utf-8"))
            if book.get("workId") != work_id or book.get("bookNumber") != number or not isinstance(book.get("units"), list):
                raise ValueError(f"invalid book data: {path}")
            books.append((path, book))
    return books


def apply_translations(books: list[dict], translations: dict[str, dict]) -> int:
    entries = extract_notes(books)
    by_key = {entry["key"]: entry for entry in entries}
    expected = set(by_key)
    if set(translations) != expected:
        raise ValueError(f"translation coverage mismatch ({len(translations)}/{len(expected)})")
    applied = 0
    for book in books:
        for unit in book["units"]:
            for index, note in enumerate(unit["notes"], 1):
                key = note_key(unit["id"], index)
                current = existing_translation(by_key[key], note)
                translated = translations[key]
                values = {field: translated.get(field) for field in ("titleEn", "bodyEn")}
                for field, value in values.items():
                    if not isinstance(value, str) or not value.strip():
                        raise ValueError(f"{key}: missing non-empty {field}")
                if current is None:
                    note.update(values)
                    applied += 1
    return applied


def preserved_content_digest(books: list[dict]) -> str:
    unchanged = copy.deepcopy(books)
    for book in unchanged:
        for unit in book["units"]:
            for note in unit["notes"]:
                note.pop("titleEn", None)
                note.pop("bodyEn", None)
    payload = json.dumps(unchanged, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--public-dir", type=Path, default=ROOT / "public" / "data")
    parser.add_argument("--cache-dir", type=Path, default=Path("/tmp/homer-reader-note-translation-cache"))
    parser.add_argument("--max-workers", type=int, default=4)
    parser.add_argument("--max-notes", type=int, default=40)
    parser.add_argument("--max-chars", type=int, default=3500)
    parser.add_argument("--timeout", type=int, default=300, help="per-attempt timeout in seconds")
    parser.add_argument("--limit-batches", type=int, help="process only the first N deterministic batches")
    parser.add_argument("--cache-only", action="store_true", help="cache translations without modifying public data")
    args = parser.parse_args()
    if not 1 <= args.max_workers <= 4 or args.max_notes < 1 or args.max_chars < 1 or args.timeout < 1:
        parser.error("max-workers must be 1..4; max-notes, max-chars, and timeout must be positive")
    if args.limit_batches is not None and (args.limit_batches < 1 or not args.cache_only):
        parser.error("--limit-batches requires a positive value and --cache-only")

    paths_and_books = load_books(args.public_dir)
    books = [book for _, book in paths_and_books]
    entries = extract_notes(books)
    note_counts = {
        work_id: sum(
            len(unit.get("notes", []))
            for book in books if book["workId"] == work_id
            for unit in book["units"]
        )
        for work_id in WORK_IDS
    }
    if note_counts != EXPECTED_NOTE_COUNTS:
        raise ValueError(f"note counts differ from Issue #9 scope: {note_counts}")
    existing = {}
    for book in books:
        for unit in book["units"]:
            for index, note in enumerate(unit["notes"], 1):
                key = note_key(unit["id"], index)
                value = existing_translation({"key": key}, note)
                if value is not None:
                    existing[key] = value
    batches = list(chunks(entries, args.max_notes, args.max_chars))
    if args.limit_batches is not None:
        batches = batches[:args.limit_batches]
    print(f"Prepared {len(entries)} notes in {len(batches)} batches (max {args.max_notes} notes / {args.max_chars} Japanese chars, {args.max_workers} workers).", flush=True)
    tasks = [
        (batch, {key: value for key, value in existing.items() if key in {entry["key"] for entry in batch}})
        for batch in batches
    ]
    completed, failures = 0, []
    cache_rows = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.max_workers) as pool:
        futures = {pool.submit(translate_batch, args.cache_dir, batch, current, args.timeout): batch for batch, current in tasks}
        for future in concurrent.futures.as_completed(futures):
            batch = futures[future]
            try:
                path, elapsed = future.result()
                response = validate_response(path, batch)
                cache_rows.update({row["key"]: row for row in response["notes"]})
                completed += 1
                print(f"[{completed}/{len(batches)}] {batch[0]['key']}..{batch[-1]['key']} cached ({elapsed:.1f}s)", flush=True)
            except Exception as exc:
                failures.append(f"{batch[0]['key']}..{batch[-1]['key']}: {exc}")
                print(f"FAILED {failures[-1]}", flush=True)
    if failures:
        print(f"{len(failures)} batches failed; rerun the same command to resume.", flush=True)
        raise SystemExit(1)
    corrections_path = ROOT / "scripts" / "translate-notes-corrections.json"
    corrections = json.loads(corrections_path.read_text(encoding="utf-8"))["corrections"] if corrections_path.is_file() else []
    cache_rows = apply_corrections_to_caches(args.cache_dir, batches, corrections)
    apply_corrections_to_books(books, corrections)
    if len(cache_rows) != len(entries):
        if args.cache_only:
            print(f"Cached {len(cache_rows)} notes; public data unchanged.", flush=True)
            return
        raise ValueError(f"translation coverage mismatch ({len(cache_rows)}/{len(entries)})")

    if args.cache_only:
        print(f"Cached all {len(entries)} notes; public data unchanged.", flush=True)
        return
    before_digest = preserved_content_digest(books)
    applied = apply_translations(books, cache_rows)
    if before_digest != preserved_content_digest(books):
        raise ValueError("applying note translations changed source text or existing note fields")
    staged = []
    for path, book in paths_and_books:
        temporary = path.with_suffix(path.suffix + ".tmp")
        temporary.write_text(json.dumps(book, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
        staged.append((temporary, path))
    for temporary, path in staged:
        temporary.replace(path)
    print(f"Applied {applied} new bilingual notes; {len(entries)} total notes validated in {len(batches)} batches.", flush=True)


if __name__ == "__main__":
    main()
