"""Live loop test: play a wav through the speakers, capture the mic, run VAD.

Uses an explicit InputStream read loop (the pattern that reliably captures on
this machine; sd.rec() returns digital silence), feeds frames through
EnergyVad, flushes at end-of-stream, then transcribes each utterance.

Usage: python mic_loop_test.py <wav> [seconds] [whisper_model]
Prints JSON diagnostics + per-utterance transcripts on stdout.
"""
from __future__ import annotations

import json
import os
import sys
import tempfile
import time

import numpy as np
import sounddevice as sd

sys.path.insert(0, __file__.rsplit("\\", 1)[0] if "\\" in __file__ else ".")
from local_voice_server import (  # noqa: E402
    FRAME_SAMPLES,
    EnergyVad,
    read_wav,
    resample,
    write_wav,
)


def main() -> int:
    path = sys.argv[1]
    seconds = float(sys.argv[2]) if len(sys.argv) > 2 else 8.0
    model_name = sys.argv[3] if len(sys.argv) > 3 else "base"

    audio, rate = read_wav(path)
    audio = resample(audio, rate)

    devices = sd.query_devices()
    device = int(sd.default.device[0])
    print(json.dumps({"event": "recording", "seconds": seconds, "device": device,
                      "name": devices[device]["name"]}), flush=True)

    blocks: list[np.ndarray] = []
    with sd.InputStream(device=device, channels=1, samplerate=16000, dtype="float32") as stream:
        time.sleep(1.0)
        sd.play(audio, 16000)
        deadline = time.time() + seconds
        while time.time() < deadline:
            block, _ = stream.read(1600)
            blocks.append(np.asarray(block, dtype=np.float32).reshape(-1))
    sd.stop()
    mic = np.concatenate(blocks)

    vad = EnergyVad()
    utterances: list[np.ndarray] = []
    frames = mic.shape[0] // FRAME_SAMPLES
    for index in range(frames):
        frame = mic[index * FRAME_SAMPLES : (index + 1) * FRAME_SAMPLES]
        result = vad.process(frame)
        if result is not None:
            utterances.append(result)
    flushed = vad.flush()
    if flushed is not None:
        utterances.append(flushed)

    frame_rms = [
        float(np.sqrt(np.mean(mic[i : i + FRAME_SAMPLES] ** 2)))
        for i in range(0, mic.shape[0] - FRAME_SAMPLES, FRAME_SAMPLES)
    ]
    print(json.dumps({
        "event": "vad",
        "mic_peak": round(float(np.abs(mic).max()), 5),
        "mic_rms_p90": round(float(np.percentile(frame_rms, 90)), 5),
        "mic_rms_max": round(float(max(frame_rms)), 5),
        "noise_floor_final": round(vad.noise_floor, 5),
        "threshold_final": round(vad.threshold, 5),
        "utterances": len(utterances),
        "utterance_seconds": [round(u.shape[0] / 16000, 2) for u in utterances],
    }), flush=True)

    if not utterances:
        return 1

    from faster_whisper import WhisperModel  # noqa: E402

    model = WhisperModel(model_name, device="cpu", compute_type="int8",
                         cpu_threads=max(2, (os_cpu_count() or 4)))
    for index, utterance in enumerate(utterances):
        out = os.path.join(tempfile.gettempdir(), f"mic-utt-{index}.wav")
        write_wav(out, utterance)
        started = time.monotonic()
        segments, info = model.transcribe(utterance, beam_size=1, language="en",
                                          vad_filter=False)
        text = "".join(seg.text for seg in segments).strip()
        print(json.dumps({"event": "transcript", "index": index, "path": out,
                          "text": text, "took": round(time.monotonic() - started, 2),
                          "prob": round(info.language_probability, 3)}), flush=True)
    return 0


def os_cpu_count() -> int | None:
    import os

    return os.cpu_count()


if __name__ == "__main__":
    sys.exit(main())
