#!/usr/bin/env python3
"""Local Kokoro TTS worker — persistent stdio server, fully offline.

A per-sentence process spawn would pay the ~114MB ONNX model load on every
chunk, killing the speak-as-it-streams benefit. Instead this process loads
the model ONCE, then serves synthesis requests over stdin/stdout:

    stdin:  {"id": 1, "text": "Hello.", "voice": "af_heart", "speed": 1.0, "lang": "en-us"}
    stdout: {"id": 1, "ok": true, "audio": "<base64 wav>", "sample_rate": 24000}
    stdout: {"id": 2, "ok": false, "error": "..."}

Usage:
    python local-kokoro-worker.py <model.onnx> <voices.bin>

First ever run needs network once (espeak-ng phonemizer library download via
espeakng-loader, cached afterwards). Every run after that is fully offline.
"""

import base64
import io
import json
import sys
import wave


def fail(req_id, message):
    sys.stdout.write(json.dumps({"id": req_id, "ok": False, "error": message}) + "\n")
    sys.stdout.flush()


def main():
    if len(sys.argv) < 3:
        print("Usage: local-kokoro-worker.py <model.onnx> <voices.bin>", file=sys.stderr)
        sys.exit(1)

    model_path = sys.argv[1]
    voices_path = sys.argv[2]

    try:
        from kokoro_onnx import Kokoro
    except ImportError as e:
        print(f"kokoro-onnx is not installed: {e}", file=sys.stderr)
        sys.exit(2)

    try:
        kokoro = Kokoro(model_path, voices_path)
    except Exception as e:  # missing/corrupt files, no espeak lib, etc.
        print(f"could not load Kokoro model: {e}", file=sys.stderr)
        sys.exit(3)

    # Ready handshake — the parent treats any stdout line before this as
    # startup noise and waits for exactly this marker.
    sys.stdout.write(json.dumps({"ready": True}) + "\n")
    sys.stdout.flush()

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
        except json.JSONDecodeError:
            continue
        req_id = req.get("id")
        if req.get("op") == "shutdown":
            break
        text = (req.get("text") or "").strip()
        if not text:
            fail(req_id, "empty text")
            continue
        voice = req.get("voice") or "af_heart"
        try:
            speed = float(req.get("speed") or 1.0)
        except (TypeError, ValueError):
            speed = 1.0
        speed = min(2.0, max(0.5, speed))
        lang = req.get("lang") or "en-us"
        try:
            samples, sample_rate = kokoro.create(text, voice=voice, speed=speed, lang=lang)
            buf = io.BytesIO()
            with wave.open(buf, "wb") as wav:
                wav.setnchannels(1)
                wav.setsampwidth(2)
                wav.setframerate(int(sample_rate))
                wav.writeframes((samples * 32767).astype("<i2").tobytes())
            sys.stdout.write(json.dumps({
                "id": req_id,
                "ok": True,
                "audio": base64.b64encode(buf.getvalue()).decode("ascii"),
                "sample_rate": int(sample_rate),
            }) + "\n")
        except Exception as e:
            fail(req_id, str(e)[:500])
        sys.stdout.flush()


if __name__ == "__main__":
    main()
