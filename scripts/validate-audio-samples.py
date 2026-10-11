#!/usr/bin/env python3
"""Validate published voice samples against the exact source unit and checksums."""
from __future__ import annotations

import argparse
import hashlib
import json
import math
from datetime import datetime
from pathlib import Path


EXPECTED = (
    ("en-ava", "en", "Ava", "en-US-AvaMultilingualNeural"),
    ("en-andrew", "en", "Andrew", "en-US-AndrewMultilingualNeural"),
    ("ja-nanami", "ja", "Nanami", "ja-JP-NanamiNeural"),
    ("ja-keita", "ja", "Keita", "ja-JP-KeitaNeural"),
)
PROVIDER = "Microsoft Edge online TTS (edge-tts)"


def digest(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def validate(root: Path) -> None:
    public = root / "public"
    manifest_path = public / "audio-samples/manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest.get("schema") != "homer-voice-samples-v1":
        raise ValueError("unsupported audio sample manifest schema")
    if manifest.get("provider") != PROVIDER:
        raise ValueError("unexpected audio sample provider")
    try:
        generated = datetime.fromisoformat(manifest["generatedAt"].replace("Z", "+00:00"))
    except (KeyError, TypeError, ValueError) as error:
        raise ValueError("generatedAt must be an ISO timestamp") from error
    if generated.tzinfo is None:
        raise ValueError("generatedAt must include a timezone")

    source_path = public / "data/iliad/01.json"
    source = json.loads(source_path.read_text(encoding="utf-8"))
    if (source.get("workId"), source.get("bookNumber")) != ("iliad", 1):
        raise ValueError("source book metadata does not identify Iliad 1")
    matching = [unit for unit in source.get("units", []) if unit.get("id") == "iliad-01-0001"]
    if len(matching) != 1:
        raise ValueError("source unit iliad-01-0001 must occur exactly once")
    unit = matching[0]
    if manifest.get("source") != {
        "workId": "iliad", "bookNumber": 1, "unitId": unit["id"], "reference": unit["reference"],
    }:
        raise ValueError("manifest source metadata differs from source unit")
    texts = manifest.get("texts")
    if texts != {"en": unit.get("en"), "ja": unit.get("ja")}:
        raise ValueError("manifest text differs from the exact source unit")

    rows = manifest.get("samples")
    if not isinstance(rows, list) or len(rows) != len(EXPECTED):
        raise ValueError("manifest must contain exactly four voice samples")
    if [row.get("id") for row in rows] != [entry[0] for entry in EXPECTED]:
        raise ValueError("sample IDs/order differ from the agreed contract")
    for row, (sample_id, language, label, voice) in zip(rows, EXPECTED):
        if (row.get("language"), row.get("label"), row.get("voice"), row.get("rate")) != (
            language, label, voice, "+0%",
        ):
            raise ValueError(f"{sample_id}: sample metadata differs from the agreed voice configuration")
        expected_src = f"audio-samples/{sample_id}.mp3"
        if row.get("src") != expected_src:
            raise ValueError(f"{sample_id}: unsafe or unexpected audio path")
        text_hash = digest(texts[language].encode("utf-8"))
        if row.get("textSha256") != text_hash:
            raise ValueError(f"{sample_id}: text checksum mismatch")
        audio_path = public / expected_src
        if not audio_path.is_file() or audio_path.stat().st_size == 0:
            raise ValueError(f"{sample_id}: audio file is missing or empty")
        if row.get("audioSha256") != digest(audio_path.read_bytes()):
            raise ValueError(f"{sample_id}: audio checksum mismatch")
        duration = row.get("durationSeconds")
        if isinstance(duration, bool) or not isinstance(duration, (int, float)) or not math.isfinite(duration) or duration <= 0:
            raise ValueError(f"{sample_id}: duration must be a positive finite number")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    args = parser.parse_args()
    try:
        validate(args.root.resolve())
    except (OSError, KeyError, TypeError, ValueError, json.JSONDecodeError) as error:
        parser.error(str(error))
    print("Audio sample manifest and files are valid.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
