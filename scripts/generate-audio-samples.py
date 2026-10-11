#!/usr/bin/env python3
"""Generate the four fixed voice-comparison samples for Iliad 1's opening unit."""
from __future__ import annotations

import asyncio
import hashlib
import json
import math
import struct
import subprocess
from datetime import datetime, timezone
from pathlib import Path

import edge_tts


ROOT = Path(__file__).resolve().parents[1]
SOURCE_PATH = ROOT / "public/data/iliad/01.json"
OUTPUT_DIR = ROOT / "public/audio-samples"
SAMPLES = (
    ("en-ava", "en", "Ava", "en-US-AvaMultilingualNeural"),
    ("en-andrew", "en", "Andrew", "en-US-AndrewMultilingualNeural"),
    ("ja-nanami", "ja", "Nanami", "ja-JP-NanamiNeural"),
    ("ja-keita", "ja", "Keita", "ja-JP-KeitaNeural"),
)


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def inspect_audio(path: Path) -> float:
    probe = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "a:0", "-show_entries",
         "stream=codec_type", "-show_entries", "format=duration", "-of", "json", str(path)],
        check=True, capture_output=True, text=True,
    )
    info = json.loads(probe.stdout)
    if not any(row.get("codec_type") == "audio" for row in info.get("streams", [])):
        raise ValueError(f"no audio stream in {path}")
    duration = float(info["format"]["duration"])
    if not math.isfinite(duration) or duration <= 0:
        raise ValueError(f"invalid audio duration in {path}: {duration}")
    decoded = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", str(path), "-f", "s16le", "-ac", "1", "-ar", "8000", "-"],
        check=True, capture_output=True,
    ).stdout
    if len(decoded) < 2 or len(decoded) % 2 or not any(sample != 0 for (sample,) in struct.iter_unpack("<h", decoded)):
        raise ValueError(f"decoded audio is empty or silent: {path}")
    return duration


async def generate() -> None:
    source = json.loads(SOURCE_PATH.read_text(encoding="utf-8"))
    if (source.get("workId"), source.get("bookNumber")) != ("iliad", 1):
        raise ValueError("unexpected source work/book")
    units = [unit for unit in source["units"] if unit.get("id") == "iliad-01-0001"]
    if len(units) != 1 or not units[0].get("en") or not units[0].get("ja"):
        raise ValueError("the exact Iliad opening unit is missing or ambiguous")
    unit = units[0]
    texts = {"en": unit["en"], "ja": unit["ja"]}
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    rows = []
    for sample_id, language, label, voice in SAMPLES:
        text = texts[language]
        destination = OUTPUT_DIR / f"{sample_id}.mp3"
        await edge_tts.Communicate(text, voice, rate="+0%").save(str(destination))
        duration = inspect_audio(destination)
        audio_hash = sha256(destination.read_bytes())
        rows.append({
            "id": sample_id, "language": language, "label": label, "voice": voice,
            "rate": "+0%", "src": f"audio-samples/{sample_id}.mp3",
            "textSha256": sha256(text.encode("utf-8")), "audioSha256": audio_hash,
            "durationSeconds": duration,
        })
        print(f"{sample_id}: {duration:.2f}s sha256={audio_hash}", flush=True)
    manifest = {
        "schema": "homer-voice-samples-v1",
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "provider": "Microsoft Edge online TTS (edge-tts)",
        "source": {
            "workId": "iliad", "bookNumber": 1, "unitId": unit["id"],
            "reference": unit["reference"],
        },
        "texts": texts,
        "samples": rows,
    }
    (OUTPUT_DIR / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8",
    )


if __name__ == "__main__":
    asyncio.run(generate())
