#!/usr/bin/env python3
"""Local speech-to-text wrapper — faster-whisper on CPU, fully offline.

Usage:
    python local-whisper.py <audio_file> <download_root> [model] [language]

Text is read from the audio file; JSON {"text": "..."} is printed to stdout.
The model downloads into <download_root> on first use, then runs locally
with no API key and no network.
"""
import json
import sys


def main():
    if len(sys.argv) < 3:
        print("Usage: local-whisper.py <audio_file> <download_root> [model]", file=sys.stderr)
        sys.exit(1)

    audio = sys.argv[1]
    download_root = sys.argv[2]
    model_id = sys.argv[3] if len(sys.argv) > 3 else "base.en"
    # Optional BCP-47 primary tag (e.g. "en"). Pinning the language skips
    # auto-detection, which is the classic "confident but completely wrong
    # words" failure on short clips. Only passed for languages the loaded
    # model actually supports (the caller guards the English-only models).
    language = sys.argv[4] if len(sys.argv) > 4 and sys.argv[4].strip() else None

    from faster_whisper import WhisperModel

    model = WhisperModel(model_id, device="cpu", compute_type="int8", download_root=download_root)
    # Hallucination guards. Whisper invents words on silence, echo, or TV
    # chatter — most visibly when each segment is conditioned on the previous
    # one (a wrong start then repeats forever). Never condition, demand a
    # real speech segment via VAD with a longer silence cut, and drop weak
    # candidates before they reach the transcript.
    transcribe_kwargs = {
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
        transcribe_kwargs["language"] = language
    segments, _info = model.transcribe(audio, **transcribe_kwargs)
    text = " ".join(
        seg.text.strip()
        for seg in segments
        if seg.text.strip() and seg.no_speech_prob < 0.7
    ).strip()
    print(json.dumps({"text": text}))


if __name__ == "__main__":
    main()
