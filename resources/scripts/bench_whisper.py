"""Benchmark faster-whisper models on a real utterance for speed + accuracy.

Usage: python bench_whisper.py [utterance.wav] [truth text]
"""
from __future__ import annotations

import json
import os
import sys
import tempfile
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from local_voice_server import read_wav, resample  # noqa: E402

DEFAULT_CLIP = os.path.join(tempfile.gettempdir(), "mic-utt-0.wav")
FALLBACK_CLIP = os.path.join(tempfile.gettempdir(), "inf-tts-test.wav")
TRUTH = "Infinite OS Voice Pipeline is online."
MODELS = ["tiny", "base", "base.en", "small", "small.en"]


def main() -> int:
    from faster_whisper import WhisperModel

    path = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_CLIP
    if not os.path.exists(path):
        path = FALLBACK_CLIP
    truth = sys.argv[2] if len(sys.argv) > 2 else TRUTH

    audio, rate = read_wav(path)
    audio = resample(audio, rate)
    seconds = audio.shape[0] / 16000
    print(json.dumps({"clip": path, "seconds": round(seconds, 2)}))

    rows = []
    for name in MODELS:
        started = time.monotonic()
        try:
            model = WhisperModel(name, device="cpu", compute_type="int8", cpu_threads=4)
        except Exception as error:  # noqa: BLE001
            rows.append({"model": name, "error": str(error)[:100]})
            continue
        load = time.monotonic() - started

        # Warm up (first decode pays ctranslate2 init), then time a real decode.
        model.transcribe(audio, beam_size=1, language="en", vad_filter=False)
        timed = []
        text = ""
        for _ in range(2):
            tick = time.monotonic()
            segments, info = model.transcribe(
                audio, beam_size=1, language="en", vad_filter=False
            )
            text = "".join(segment.text for segment in segments).strip()
            timed.append(time.monotonic() - tick)
        decode = min(timed)
        rows.append(
            {
                "model": name,
                "load_s": round(load, 1),
                "decode_s": round(decode, 2),
                "rtf": round(decode / seconds, 2),
                "exact": text.lower().rstrip(".") == truth.lower().rstrip("."),
                "text": text,
                "lang_prob": round(info.language_probability, 3),
            }
        )
        print(json.dumps(rows[-1]), flush=True)

    best = [r for r in rows if r.get("exact") and "rtf" in r]
    if best:
        winner = min(best, key=lambda r: r["decode_s"])
        print(json.dumps({"recommended": winner["model"], "decode_s": winner["decode_s"]}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
