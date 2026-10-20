"""Play a wav and record it from each input device to find which mic hears it.

Usage: python probe_mics.py <wav> [seconds] [device_index ...]
Prints one JSON line per input device with peak / rms percentiles / speech frames.
"""
from __future__ import annotations

import json
import sys
import time

import numpy as np
import sounddevice as sd

sys.path.insert(0, __file__.rsplit("\\", 1)[0] if "\\" in __file__ else ".")
from local_voice_server import FRAME_SAMPLES, read_wav, resample  # noqa: E402


_AUDIO: np.ndarray


def main() -> int:
    global _AUDIO
    path = sys.argv[1]
    seconds = float(sys.argv[2]) if len(sys.argv) > 2 else 5.0
    explicit = [int(a) for a in sys.argv[3:]]

    audio, rate = read_wav(path)
    _AUDIO = resample(audio, rate)

    devices = sd.query_devices()
    inputs = explicit or [i for i, d in enumerate(devices) if d["max_input_channels"] > 0]

    for index in inputs:
        name = devices[index]["name"] if index < len(devices) else "?"
        try:
            with sd.InputStream(device=index, channels=1, samplerate=16000, dtype="float32") as stream:
                time.sleep(1.0)
                sd.play(_AUDIO, 16000)
                blocks = []
                deadline = time.time() + seconds
                while time.time() < deadline:
                    block, _ = stream.read(1600)
                    blocks.append(np.asarray(block, dtype=np.float32).reshape(-1))
                sd.stop()
            mic = np.concatenate(blocks) if blocks else np.zeros(16000, dtype=np.float32)
        except Exception as error:  # noqa: BLE001
            print(json.dumps({"device": index, "name": name, "error": str(error)[:140]}), flush=True)
            continue

        rms = np.array(
            [
                float(np.sqrt(np.mean(mic[i : i + FRAME_SAMPLES] ** 2)))
                for i in range(0, max(0, mic.shape[0] - FRAME_SAMPLES), FRAME_SAMPLES)
            ]
        )
        print(
            json.dumps(
                {
                    "device": index,
                    "name": name,
                    "peak": round(float(np.abs(mic).max()), 5),
                    "rms_p50": round(float(np.percentile(rms, 50)), 5) if rms.size else 0.0,
                    "rms_p90": round(float(np.percentile(rms, 90)), 5) if rms.size else 0.0,
                    "rms_max": round(float(rms.max()), 5) if rms.size else 0.0,
                    "speech_frames": int((rms > 0.012).sum()),
                    "frames": int(rms.size),
                }
            ),
            flush=True,
        )
        time.sleep(0.5)
    return 0


if __name__ == "__main__":
    sys.exit(main())
