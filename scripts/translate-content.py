#!/usr/bin/env python3
"""Translate one bounded source batch through the approved read-only Codex runtime."""
from __future__ import annotations

import argparse
import concurrent.futures
import hashlib
import json
import os
import signal
import subprocess
import time
from pathlib import Path

CLI = "/home/honya/.local/bin/codex-deepseek"
PROMPT_RULES = """Process only the supplied source data. Do not use tools, browse, access files, or call other services. Translate every supplied English paragraph completely into fluent Japanese. This is a full translation, never a summary, paraphrase, or omission. Preserve paragraph-level correspondence and keep every input ID exactly once. Use standard Greek myth names: Jove/Jupiter=ゼウス (never ユピテル), Juno=ヘラ, Minerva=アテナ, Ulysses=オデュッセウス, Neptune=ポセイドン, Troy=トロイア, Achaeans=アカイア勢. Keep other names consistent and retain meaningful archaic/mythological nuance in readable modern Japanese.

Add a small number of useful Japanese reading notes across the batch (zero or one per paragraph; do not force notes). Notes explain only people, places, myth, language, or interpretation relevant at this paragraph. Do not reveal later plot; if a note necessarily refers to later events set spoiler=true. Do not claim uncertain interpretation as fact. Use kind values person, place, myth, language, interpretation.

Return only strict JSON matching this shape: {"units":[{"id":"...","ja":"...","notes":[{"kind":"person|place|myth|language|interpretation","title":"...","body":"...","spoiler":false}]}]}. No markdown fences or text outside JSON.
"""


def make_prompt(units: list[dict]) -> str:
    payload = [{"id": u["id"], "en": u["en"]} for u in units]
    return PROMPT_RULES + "Source batch:\n" + json.dumps(payload, ensure_ascii=False)


def cache_path(cache_dir: Path, units: list[dict]) -> Path:
    source_text = "\n".join(unit["id"] + "\0" + unit["en"] for unit in units)
    source_hash = hashlib.sha256(source_text.encode("utf-8")).hexdigest()[:16]
    prompt_hash = hashlib.sha256(PROMPT_RULES.encode("utf-8")).hexdigest()[:16]
    return cache_dir / f"{units[0]['id']}-{units[-1]['id']}-{source_hash}-{prompt_hash}.json"


def validate_response(path: Path, units: list[dict]) -> dict:
    translated = json.loads(path.read_text(encoding="utf-8"))
    actual = translated["units"]
    if [x.get("id") for x in actual] != [x["id"] for x in units]:
        raise ValueError("returned IDs/order do not match request")
    for item in actual:
        if not isinstance(item.get("ja"), str) or not item["ja"].strip() or not isinstance(item.get("notes"), list):
            raise ValueError(f"empty/invalid translation for {item.get('id')}")
    return translated


def chunks(units: list[dict], max_words: int, max_units: int):
    batch = []
    words = 0
    for unit in units:
        unit_words = len(unit["en"].split())
        if batch and (words + unit_words > max_words or len(batch) >= max_units):
            yield batch
            batch, words = [], 0
        batch.append(unit)
        words += unit_words
    if batch:
        yield batch


def translate_batch(worktree: Path, cache_dir: Path, units: list[dict], timeout: int = 300, retries: int = 2) -> tuple[Path, float]:
    cache_dir.mkdir(parents=True, exist_ok=True)
    output = cache_path(cache_dir, units)
    if output.exists():
        try:
            validate_response(output, units)
            return output, 0.0
        except Exception:
            pass
    elapsed = 0.0
    for attempt in range(1, retries + 1):
        temporary = cache_dir / f"{output.stem}.attempt-{attempt}.tmp"
        command = [CLI, "exec", "--ephemeral", "--sandbox", "read-only", "--output-last-message", str(temporary), "-"]
        started = time.monotonic()
        process = subprocess.Popen(
            command, stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            text=True, cwd=worktree, start_new_session=True,
        )
        try:
            process.communicate(make_prompt(units), timeout=timeout)
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
            validate_response(temporary, units)
            temporary.replace(output)
            return output, elapsed
        except Exception:
            if temporary.exists():
                temporary.replace(cache_dir / f"{output.stem}.invalid-{attempt}.txt")
    raise RuntimeError(f"translation batch failed after {retries} attempts/{elapsed:.1f}s: {units[0]['id']}..{units[-1]['id']}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-dir", type=Path, default=Path("/tmp/homer-reader-source"))
    parser.add_argument("--cache-dir", type=Path, default=Path("/tmp/homer-reader-translation-cache"))
    parser.add_argument("--work", choices=("iliad", "odyssey"))
    parser.add_argument("--book", type=int)
    parser.add_argument("--start", type=int, default=1, help="1-based paragraph number")
    parser.add_argument("--count", type=int, default=24)
    parser.add_argument("--all", action="store_true", help="translate every book in both works")
    parser.add_argument("--max-workers", type=int, default=4)
    parser.add_argument("--max-words", type=int, default=1500)
    parser.add_argument("--max-units", type=int, default=24)
    parser.add_argument("--timeout", type=int, default=300, help="per-attempt timeout in seconds")
    args = parser.parse_args()
    if not 1 <= args.max_workers <= 4 or args.max_words < 1 or args.max_units < 1 or args.timeout < 1:
        parser.error("max-workers must be 1..4; max-words, max-units, and timeout must be positive")
    if not args.all and (args.work is None or args.book is None or not 1 <= args.book <= 24 or args.start < 1 or args.count < 1):
        parser.error("provide --all or a valid --work and --book 1..24; start/count must be positive")
    work_ids = ("iliad", "odyssey") if args.all else (args.work,)
    tasks = []
    for work_id in work_ids:
        source = json.loads((args.source_dir / f"{work_id}.json").read_text(encoding="utf-8"))
        book_range = range(1, 25) if args.all else (args.book,)
        for book_number in book_range:
            units = source["books"][book_number - 1]["units"]
            if args.all:
                batch_iter = chunks(units, args.max_words, args.max_units)
            else:
                units = units[args.start - 1: args.start - 1 + args.count]
                batch_iter = chunks(units, args.max_words, args.max_units)
            tasks.extend((work_id, book_number, batch) for batch in batch_iter)
    print(f"Prepared {len(tasks)} bounded batches (max {args.max_words} English words / {args.max_units} paragraphs, {args.max_workers} workers).", flush=True)
    done, failures = 0, []
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.max_workers) as pool:
        futures = {pool.submit(translate_batch, Path.cwd(), args.cache_dir, batch): (work, book, batch) for work, book, batch in tasks}
        for future in concurrent.futures.as_completed(futures):
            work, book, batch = futures[future]
            try:
                cache, elapsed = future.result()
                done += 1
                print(f"[{done}/{len(tasks)}] {work} book {book:02d}: {batch[0]['id']}..{batch[-1]['id']} cached ({elapsed:.1f}s)", flush=True)
            except Exception as exc:
                failures.append(f"{work} book {book:02d} {batch[0]['id']}..{batch[-1]['id']}: {exc}")
                print(f"FAILED {failures[-1]}", flush=True)
    if failures:
        print(f"{len(failures)} batches failed; rerun the same command to resume.", flush=True)
        raise SystemExit(1)
    print(f"All {done} batches are cached under {args.cache_dir}.", flush=True)


if __name__ == "__main__":
    main()
