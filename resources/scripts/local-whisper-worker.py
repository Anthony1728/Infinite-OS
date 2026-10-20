#!/usr/bin/env python3
"""Local speech-to-text worker — persistent faster-whisper server, fully offline.

Spawning Python per utterance pays the interpreter + ~145MB model load every
turn (measured ~6s of an ~8.5s transcription on an i5-4210U). This process
loads the model ONCE, then serves transcriptions over stdin/stdout:

    stdin:  {"id": 1, "audio": "<base64 webm>", "format": "webm", "language": "en"}
    stdout: {"id": 1, "ok": true, "text": "..."}

Usage:
    python local-whisper-worker.py <download_root> [model]

Compute is CPU INT8 by construction — faster-whisper has no Intel-iGPU path
(CUDA only), and device="cpu" never initializes GPU libraries, so the
integrated GPU is correctly left alone on machines like HD 4400.
"""

import base64
import json
import os
import sys
import tempfile


def fail(req_id, message):
    sys.stdout.write(json.dumps({"id": req_id, "ok": False, "error": message}) + "\n")
    sys.stdout.flush()


def main():
    if len(sys.argv) < 2:
        print("Usage: local-whisper-worker.py <download_root> [model]", file=sys.stderr)
        sys.exit(1)

    download_root = sys.argv[1]
    model_id = sys.argv[2] if len(sys.argv) > 2 else "base.en"

    try:
        from faster_whisper import WhisperModel
    except ImportError as e:
        print(f"faster-whisper is not installed: {e}", file=sys.stderr)
        sys.exit(2)

    try:
        # CPU INT8: the supported fast path on non-NVIDIA hardware. The
        # English-only base.en model is the accuracy/size sweet spot — tiny
        # is faster but measurably worse, and beam search below keeps quality.
        model = WhisperModel(model_id, device="cpu", compute_type="int8", download_root=download_root)
    except Exception as e:
        print(f"could not load Whisper model: {e}", file=sys.stderr)
        sys.exit(3)

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
        audio_b64 = req.get("audio") or ""
        if not audio_b64:
            fail(req_id, "empty audio")
            continue
        fmt = (req.get("format") or "webm").strip().lstrip(".") or "webm"
        language = (req.get("language") or "").strip() or None
        tmp_path = ""
        try:
            with tempfile.NamedTemporaryFile(suffix=f".{fmt}", delete=False) as tmp:
                tmp.write(base64.b64decode(audio_b64))
                tmp_path = tmp.name
            # Hallucination guards. Whisper invents words on silence, echo, or
            # TV chatter — most visibly when each segment is conditioned on the
            # previous one (a wrong start then repeats forever). Never
            # condition, demand real speech via VAD with a longer silence cut,
            # and drop weak candidates before they reach the transcript.
            # Beam search stays at the quality default: greedy (beam 1) drops
            # casing/punctuation with no meaningful speed gain on short clips.
            kwargs = {
                "condition_on_previous_text": False,
                "no_speech_threshold": 0.6,
                "log_prob_threshold": -1.0,
                "vad_filter": True,
                "vad_parameters": {
                    "min_silence_duration_ms": 500,
                    "speech_pad_ms": 200,
                },
            }
            if language:
                kwargs["language"] = language
            segments, _info = model.transcribe(tmp_path, **kwargs)
            text = " ".join(
                seg.text.strip()
                for seg in segments
                if seg.text.strip() and seg.no_speech_prob < 0.7
            ).strip()
            sys.stdout.write(json.dumps({"id": req_id, "ok": True, "text": text}) + "\n")
        except Exception as e:
            fail(req_id, str(e)[:500])
        finally:
            if tmp_path:
                try:
                    os.unlink(tmp_path)
                except OSError:
                    pass
        sys.stdout.flush()


if __name__ == "__main__":
    main()
