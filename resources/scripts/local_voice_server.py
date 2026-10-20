#!/usr/bin/env python3
"""Infinite OS local voice server.

Pipeline:  mic -> energy VAD -> Faster-Whisper (CPU, int8) -> transcript
           text -> Kokoro (local onnx) -> wav/mp3 -> speakers

Protocol: newline-delimited JSON.
    stdin  <- commands   {"cmd": "start"|"stop"|"speak"|"status"|"shutdown", ...}
    stdout -> events     {"type": "ready"|"result"|"error"|"ended"|"level"|...}

stdout carries ONLY event objects. All diagnostics go to stderr.

CLI helpers (used by tests and by `--selftest`):
    python local_voice_server.py --tts "hello" --out out.wav
    python local_voice_server.py --transcribe in.wav
    python local_voice_server.py --segment in.wav
    python local_voice_server.py --selftest
"""
from __future__ import annotations

import argparse
import json
import math
import os
import queue
import re
import shutil
import struct
import sys
import threading
import time
import traceback
import urllib.request
import wave
from collections import deque
from typing import Any, Optional

# Keep every library quiet on stdout — stdout is the event channel.
os.environ.setdefault("HF_HUB_DISABLE_PROGRESS_BARS", "1")
os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")
os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")
os.environ.setdefault("OMP_NUM_THREADS", str(os.cpu_count() or 2))
os.environ.setdefault("KMP_BLOCKTIME", "1")

import numpy as np  # noqa: E402

SAMPLE_RATE = 16000
FRAME_MS = 30
FRAME_SAMPLES = SAMPLE_RATE * FRAME_MS // 1000  # 480

# ---------------------------------------------------------------------------
# Event channel
# ---------------------------------------------------------------------------

_emit_lock = threading.Lock()


def log(message: str) -> None:
    sys.stderr.write(message + "\n")
    sys.stderr.flush()


# In CLI mode (--tts/--transcribe/--segment) the final JSON result is stdout,
# so progress events must not pollute it. Server mode keeps events on stdout.
_CLI_MODE = False


def emit(event: dict[str, Any]) -> None:
    """Publish one event to the parent process (stdout)."""
    try:
        line = json.dumps(event, ensure_ascii=False, default=str)
    except Exception:  # pragma: no cover - defensive
        line = json.dumps({"type": "error", "message": "unserializable event"})
    with _emit_lock:
        if _CLI_MODE:
            sys.stderr.write(line + "\n")
            sys.stderr.flush()
        else:
            sys.stdout.write(line + "\n")
            sys.stdout.flush()


# ---------------------------------------------------------------------------
# WAV helpers
# ---------------------------------------------------------------------------


def write_wav(path: str, samples: np.ndarray, sample_rate: int = SAMPLE_RATE) -> None:
    data = samples
    if data.dtype != np.int16:
        data = np.clip(data, -1.0, 1.0)
        data = (data * 32767.0).astype(np.int16)
    with wave.open(path, "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(sample_rate)
        handle.writeframes(data.tobytes())


def read_wav(path: str) -> tuple[np.ndarray, int]:
    with wave.open(path, "rb") as handle:
        rate = handle.getframerate()
        channels = handle.getnchannels()
        width = handle.getsampwidth()
        raw = handle.readframes(handle.getnframes())
    if width == 2:
        audio = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
    elif width == 4:
        audio = np.frombuffer(raw, dtype=np.int32).astype(np.float32) / 2147483648.0
    elif width == 1:
        audio = (np.frombuffer(raw, dtype=np.uint8).astype(np.float32) - 128.0) / 128.0
    else:
        raise ValueError(f"Unsupported sample width: {width}")
    if channels > 1:
        audio = audio.reshape(-1, channels).mean(axis=1)
    return audio.astype(np.float32), rate


def resample(audio: np.ndarray, source_rate: int, target_rate: int = SAMPLE_RATE) -> np.ndarray:
    if source_rate == target_rate:
        return audio.astype(np.float32)
    duration = audio.shape[0] / float(source_rate)
    target_length = max(1, int(round(duration * target_rate)))
    source_indices = np.linspace(0.0, duration, num=audio.shape[0], endpoint=False)
    target_times = np.arange(target_length) / float(target_rate)
    return np.interp(target_times, source_indices, audio.astype(np.float64)).astype(np.float32)


# ---------------------------------------------------------------------------
# Energy voice-activity detection
# ---------------------------------------------------------------------------


class EnergyVad:
    """Adaptive energy VAD.

    Runs while the microphone is open so transcription only happens after real
    speech — silence never reaches the model.
    """

    def __init__(
        self,
        start_ratio: float = 3.0,
        # Calibrated against this machine's mic: room tone ~0.003 RMS, speech
        # peaks ~0.023 RMS with p90 ~0.008. A 0.012 floor only caught peaks, so
        # quiet speech was missed; 0.007 clears speech while staying ~2x above
        # the noise floor (and 3 consecutive frames filter out clicks).
        min_threshold: float = 0.007,
        # Seeded at the measured room tone so the threshold starts at ~0.009
        # instead of needing several seconds of history to drift down.
        noise_floor: float = 0.003,
        pre_roll_ms: int = 300,
        silence_ms: int = 650,
        min_speech_ms: int = 280,
        max_speech_ms: int = 30000,
    ) -> None:
        self.start_ratio = start_ratio
        self.min_threshold = min_threshold
        self.noise_floor = noise_floor
        self.pre_roll_ms = pre_roll_ms
        self.silence_ms = silence_ms
        self.min_speech_ms = min_speech_ms
        self.max_speech_ms = max_speech_ms

        self.speaking = False
        self.buffer: list[np.ndarray] = []
        self.pre_roll: deque[np.ndarray] = deque()
        self.pre_roll_samples = 0
        self.pre_roll_max = SAMPLE_RATE * pre_roll_ms // 1000
        self.silent_frames = 0
        self.speech_frames = 0
        self.rms_history: deque[float] = deque(maxlen=400)  # ~12 s
        self.last_level_at = 0.0

    @property
    def threshold(self) -> float:
        floor = self.noise_floor
        if self.rms_history:
            ordered = sorted(self.rms_history)
            floor = ordered[max(0, len(ordered) // 10)]
            self.noise_floor = 0.9 * self.noise_floor + 0.1 * floor
        return max(self.min_threshold, self.noise_floor * self.start_ratio)

    def reset(self) -> None:
        self.speaking = False
        self.buffer.clear()
        self.pre_roll.clear()
        self.pre_roll_samples = 0
        self.silent_frames = 0
        self.speech_frames = 0

    def flush(self) -> Optional[np.ndarray]:
        """Commit a pending utterance at end-of-stream (stop / file EOF).

        Without this, speech captured right before the stream ends — including
        the very last phrase a user says before pressing Stop — is dropped.
        """
        if not self.speaking or not self.buffer:
            return None
        utterance = np.concatenate(self.buffer)
        silent_frames = self.silent_frames
        self.reset()
        if utterance.shape[0] < self.min_speech_ms * SAMPLE_RATE // 1000:
            return None
        # Only trailing silence is trimmed; buffered speech is kept whole.
        keep = max(1, utterance.shape[0] - silent_frames * FRAME_SAMPLES)
        return utterance[:keep].copy()

    def process(self, frame: np.ndarray, muted: bool = False) -> Optional[np.ndarray]:
        """Feed one frame. Returns a finished utterance (float32 mono) or None."""
        frame = np.asarray(frame, dtype=np.float32).reshape(-1)
        rms = float(np.sqrt(np.mean(np.square(frame)))) if frame.size else 0.0

        if muted:
            self.reset()
            self.rms_history.clear()
            return None

        now = time.monotonic()
        if now - self.last_level_at >= 0.1:
            self.last_level_at = now
            emit({"type": "level", "level": min(1.0, rms * 30.0), "threshold": self.threshold})

        if not self.speaking:
            self.rms_history.append(rms)
            self.pre_roll.append(frame)
            self.pre_roll_samples += frame.shape[0]
            while self.pre_roll_samples > self.pre_roll_max and self.pre_roll:
                dropped = self.pre_roll.popleft()
                self.pre_roll_samples -= dropped.shape[0]

            if rms >= self.threshold:
                self.speech_frames += 1
                if self.speech_frames >= 3:
                    self.speaking = True
                    self.silent_frames = 0
                    self.speech_frames = 0
                    self.buffer = [buf.copy() for buf in self.pre_roll]
                    self.pre_roll.clear()
                    self.pre_roll_samples = 0
                    emit({"type": "speech_start"})
            else:
                self.speech_frames = 0
            return None

        self.buffer.append(frame)
        voiced = rms >= self.threshold * 0.6
        if voiced:
            self.silent_frames = 0
        else:
            self.silent_frames += 1

        speech_ms = len(self.buffer) * FRAME_MS
        exceeded = speech_ms >= self.max_speech_ms
        finished = self.silent_frames * FRAME_MS >= self.silence_ms or exceeded
        if not finished:
            return None

        self.speaking = False
        self.silent_frames = 0
        self.speech_frames = 0
        self.pre_roll.clear()
        self.pre_roll_samples = 0

        if speech_ms < self.min_speech_ms:
            return None

        utterance = np.concatenate(self.buffer) if self.buffer else np.zeros(0, dtype=np.float32)
        self.buffer = []
        if utterance.size == 0:
            return None
        # Trim trailing silence so the model spends no time on it.
        keep = max(1, utterance.shape[0] - self.silent_frames * FRAME_SAMPLES)
        return utterance[:keep].copy()


# ---------------------------------------------------------------------------
# Faster-Whisper engine
# ---------------------------------------------------------------------------

# base.en: measured on this machine (2.8s utterance, int8, 4 threads) —
# tiny 1.44s but wrong words ("...is on."), base.en 2.30s exact, small 8.8s.
DEFAULT_STT_MODEL = "base.en"
KNOWN_MODELS = (
    "tiny",
    "tiny.en",
    "base",
    "base.en",
    "small",
    "small.en",
    "medium",
    "large-v3",
    "distil-large-v3",
)


class SttEngine:
    """Loads Whisper once on CPU (int8) and reuses it for every utterance."""

    def __init__(self) -> None:
        self.model: Any = None
        self.loaded_key: Optional[str] = None
        self.lock = threading.Lock()

    @property
    def loaded(self) -> bool:
        return self.model is not None

    def ensure(self, model_name: str, cpu_threads: int, compute_type: str = "int8") -> Any:
        key = f"{model_name}|{cpu_threads}|{compute_type}"
        with self.lock:
            if self.model is not None and self.loaded_key == key:
                return self.model
            emit({"type": "status", "state": "loading_model", "model": model_name})
            started = time.monotonic()
            from faster_whisper import WhisperModel

            # Known hub names, an on-disk directory, or an explicit "org/name"
            # repo id — anything else is a config bug, not an invitation to
            # download an arbitrary repo.
            target = model_name
            if (
                model_name not in KNOWN_MODELS
                and not os.path.isdir(model_name)
                and not re.fullmatch(r"[\w.-]+/[\w.-]+", model_name)
            ):
                raise ValueError(
                    f"Unknown Whisper model {model_name!r}; expected one of "
                    f"{', '.join(KNOWN_MODELS)}, a directory, or 'org/name'."
                )
            self.model = WhisperModel(
                target,
                device="cpu",
                compute_type=compute_type,
                cpu_threads=max(1, cpu_threads),
                num_workers=1,
            )
            self.loaded_key = key
            emit(
                {
                    "type": "status",
                    "state": "model_ready",
                    "model": model_name,
                    "seconds": round(time.monotonic() - started, 2),
                }
            )
            return self.model

    def transcribe(
        self,
        audio: np.ndarray,
        model_name: str,
        language: Optional[str],
        cpu_threads: int,
        compute_type: str = "int8",
        hotwords: Optional[str] = None,
        vad_filter: bool = True,
    ) -> dict[str, Any]:
        model = self.ensure(model_name, cpu_threads, compute_type)
        started = time.monotonic()
        segments, info = model.transcribe(
            audio,
            language=language,
            task="transcribe",
            beam_size=1,
            best_of=1,
            patience=1.0,
            temperature=[0.0],
            condition_on_previous_text=False,
            suppress_blank=True,
            without_timestamps=True,
            vad_filter=vad_filter,
            vad_parameters={"min_silence_duration_ms": 400, "speech_pad_ms": 120}
            if vad_filter
            else None,
            hotwords=hotwords or None,
            word_timestamps=False,
        )
        parts: list[str] = []
        for segment in segments:
            piece = segment.text.strip()
            if piece:
                parts.append(piece)
        elapsed = time.monotonic() - started
        text = " ".join(parts).strip()
        duration = audio.shape[0] / float(SAMPLE_RATE)
        return {
            "text": text,
            "language": getattr(info, "language", language) or (language or "en"),
            "language_probability": round(float(getattr(info, "language_probability", 0.0) or 0.0), 3),
            "duration": round(duration, 2),
            "took": round(elapsed, 2),
            "rtf": round(elapsed / duration, 2) if duration > 0 else None,
        }


# ---------------------------------------------------------------------------
# Kokoro TTS
# ---------------------------------------------------------------------------

KOKORO_BASE = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0"
KOKORO_MODEL = "kokoro-v1.0.onnx"
KOKORO_VOICES = "voices-v1.0.bin"

VOICE_ALIASES = {
    "female": "af_heart",
    "ava": "af_heart",
    "aria": "af_bella",
    "jenny": "af_nicole",
    "emma": "af_sarah",
    "michelle": "af_sky",
    "alloy": "af_heart",
    "nova": "af_nicole",
    "shimmer": "af_sarah",
    "male": "am_michael",
    "brian": "am_adam",
    "andrew": "am_michael",
    "guy": "am_fenrir",
    "christopher": "am_liam",
    "eric": "am_eric",
    "onyx": "am_michael",
    "echo": "am_fenrir",
}


def map_voice(voice: Optional[str]) -> str:
    if not voice:
        return "af_heart"
    key = voice.strip().lower()
    if key in VOICE_ALIASES:
        return VOICE_ALIASES[key]
    if "_" in key and key[0] in ("a", "b") and len(key.split("_")[0]) == 2:
        return key  # already a Kokoro voice id such as af_heart
    return VOICE_ALIASES.get(key, "af_heart")


class KokoroTts:
    def __init__(self, directory: str) -> None:
        self.directory = directory
        self.model_path = os.path.join(directory, KOKORO_MODEL)
        self.voices_path = os.path.join(directory, KOKORO_VOICES)
        self.kokoro: Any = None
        self.lock = threading.Lock()

    def available(self) -> bool:
        return os.path.exists(self.model_path) and os.path.exists(self.voices_path)

    def missing(self) -> list[str]:
        missing = []
        if not os.path.exists(self.model_path):
            missing.append(self.model_path)
        if not os.path.exists(self.voices_path):
            missing.append(self.voices_path)
        return missing

    def _download(self, url: str, destination: str) -> None:
        os.makedirs(os.path.dirname(destination), exist_ok=True)
        temp = destination + ".part"
        started = time.monotonic()
        request = urllib.request.Request(url, headers={"User-Agent": "InfiniteOS/voice"})
        with urllib.request.urlopen(request, timeout=60) as response:
            total = int(response.headers.get("Content-Length") or 0)
            read = 0
            with open(temp, "wb") as handle:
                while True:
                    chunk = response.read(1024 * 256)
                    if not chunk:
                        break
                    handle.write(chunk)
                    read += len(chunk)
                    if total:
                        emit(
                            {
                                "type": "tts_progress",
                                "file": os.path.basename(destination),
                                "percent": round(read * 100 / total, 1),
                            }
                        )
        shutil.move(temp, destination)
        emit(
            {
                "type": "tts_progress",
                "file": os.path.basename(destination),
                "percent": 100,
                "seconds": round(time.monotonic() - started, 1),
            }
        )

    def ensure(self) -> None:
        with self.lock:
            missing = self.missing()
            if missing:
                emit({"type": "status", "state": "downloading_kokoro", "files": missing})
            for target in missing:
                name = os.path.basename(target)
                self._download(f"{KOKORO_BASE}/{name}", target)
            if self.kokoro is None:
                from kokoro_onnx import Kokoro

                self.kokoro = Kokoro(self.model_path, self.voices_path)
                emit({"type": "status", "state": "kokoro_ready"})

    def synthesize(
        self,
        text: str,
        voice: Optional[str] = None,
        speed: float = 1.0,
        language: str = "en-us",
        out_path: Optional[str] = None,
        fmt: str = "wav",
    ) -> dict[str, Any]:
        self.ensure()
        started = time.monotonic()
        samples, rate = self.kokoro.create(
            text, voice=map_voice(voice), speed=max(0.5, min(2.0, speed)), lang=language
        )
        audio = np.asarray(samples, dtype=np.float32)
        if out_path is None:
            out_path = os.path.join(self.directory, f"tts-{int(time.time() * 1000)}.wav")
        os.makedirs(os.path.dirname(out_path) or ".", exist_ok=True)
        wav_path = out_path if out_path.endswith(".wav") else out_path + ".wav"
        write_wav(wav_path, audio, rate)

        result_path = wav_path
        result_format = "wav"
        if fmt == "mp3" and shutil.which("ffmpeg"):
            mp3_path = os.path.splitext(wav_path)[0] + ".mp3"
            code = os.system(
                f'ffmpeg -y -loglevel error -i "{wav_path}" -codec:a libmp3lame -b:a 96k "{mp3_path}"'
            )
            if code == 0 and os.path.exists(mp3_path):
                try:
                    os.remove(wav_path)
                except OSError:
                    pass
                result_path = mp3_path
                result_format = "mp3"

        return {
            "path": result_path,
            "format": result_format,
            "seconds": round(time.monotonic() - started, 2),
            "duration": round(audio.shape[0] / float(rate), 2),
            "bytes": os.path.getsize(result_path),
        }


# ---------------------------------------------------------------------------
# Server
# ---------------------------------------------------------------------------


def ffmpeg_available() -> bool:
    return shutil.which("ffmpeg") is not None


def default_home() -> str:
    override = os.environ.get("INFINITE_HOME")
    if override:
        return override
    return os.path.join(os.path.expanduser("~"), ".infinite-ai")


class VoiceServer:
    def __init__(self, home: Optional[str] = None) -> None:
        self.home = home or default_home()
        self.voice_dir = os.path.join(self.home, "voice")
        self.kokoro_dir = os.path.join(self.voice_dir, "kokoro")
        os.makedirs(self.voice_dir, exist_ok=True)
        os.makedirs(self.kokoro_dir, exist_ok=True)

        self.stt = SttEngine()
        self.tts = KokoroTts(self.kokoro_dir)
        self.vad = EnergyVad()

        self.listening = False
        self.muted_until = 0.0
        self.model_name = DEFAULT_STT_MODEL
        self.language = "en"
        self.cpu_threads = max(1, os.cpu_count() or 2)
        self.compute_type = "int8"
        self.hotwords = ""

        self.stream: Any = None
        self.audio_queue: "queue.Queue[Optional[np.ndarray]]" = queue.Queue(maxsize=64)
        self.capture_thread: Optional[threading.Thread] = None
        self.worker_thread: Optional[threading.Thread] = None
        self.work_queue: "queue.Queue[Optional[tuple[str, Any]]]" = queue.Queue()
        self.running = False
        self.busy = False
        self.utterance_count = 0

    # -- lifecycle ---------------------------------------------------------

    def boot(self) -> None:
        """Warm the model in the background so the first utterance is instant."""
        threading.Thread(target=self._preload, daemon=True).start()

    def _preload(self) -> None:
        try:
            self.stt.ensure(self.model_name, self.cpu_threads, self.compute_type)
            emit({"type": "ready", "engine": "local-whisper", "model": self.model_name, "warmed": True})
        except Exception as error:  # pragma: no cover - depends on network/disk
            log(f"preload failed: {error}")
            emit({"type": "error", "message": f"Whisper model could not be loaded: {error}"})

    def start(self, config: dict[str, Any]) -> dict[str, Any]:
        self.model_name = str(config.get("model") or self.model_name)
        lang = str(config.get("language") or "en").lower()
        self.language = None if lang in ("auto", "", "none") else lang.split("-")[0]
        self.cpu_threads = int(config.get("cpu_threads") or self.cpu_threads)
        self.compute_type = str(config.get("compute_type") or "int8")
        self.hotwords = str(config.get("hotwords") or "")
        vad_config = config.get("vad") or {}
        if isinstance(vad_config, dict):
            if "silence_ms" in vad_config:
                self.vad.silence_ms = int(vad_config["silence_ms"])
            if "min_speech_ms" in vad_config:
                self.vad.min_speech_ms = int(vad_config["min_speech_ms"])
            if "start_ratio" in vad_config:
                self.vad.start_ratio = float(vad_config["start_ratio"])
        self.vad.reset()

        if self.listening:
            return {"ok": True, "already": True, "engine": "local-whisper"}

        if not self._start_capture():
            return {"ok": False, "error": "No microphone is available (sounddevice/PortAudio)."}

        self.listening = True
        if self.worker_thread is None or not self.worker_thread.is_alive():
            self.worker_thread = threading.Thread(target=self._work_loop, daemon=True)
            self.worker_thread.start()
        self.work_queue.put(("preload", None))
        emit(
            {
                "type": "ready",
                "engine": "local-whisper",
                "language": self.language or "auto",
                "model": self.model_name,
                "sampling_rate": SAMPLE_RATE,
            }
        )
        return {"ok": True, "engine": "local-whisper", "model": self.model_name}

    def stop(self) -> dict[str, Any]:
        self.listening = False
        self._stop_capture()
        # Anything spoken just before Stop is still a real utterance — flush it
        # into the worker queue instead of dropping it on the floor.
        pending = self.vad.flush()
        self.vad.reset()
        if pending is not None and self.worker_thread is not None:
            self.work_queue.put(("transcribe", pending))
        emit({"type": "ended"})
        return {"ok": True}

    # -- capture -----------------------------------------------------------

    def _start_capture(self) -> bool:
        try:
            import sounddevice as sd
        except Exception as error:  # pragma: no cover
            log(f"sounddevice unavailable: {error}")
            return False

        def callback(indata, frames, time_info, status) -> None:  # noqa: ANN001
            if status:
                log(f"audio status: {status}")
            try:
                self.audio_queue.put_nowait(indata.copy())
            except queue.Full:
                try:
                    self.audio_queue.get_nowait()
                except queue.Empty:
                    pass
                try:
                    self.audio_queue.put_nowait(indata.copy())
                except queue.Full:
                    pass

        try:
            self.stream = sd.InputStream(
                samplerate=SAMPLE_RATE,
                channels=1,
                dtype="float32",
                blocksize=FRAME_SAMPLES,
                callback=callback,
            )
            self.stream.start()
        except Exception as error:
            log(f"microphone open failed: {error}")
            self.stream = None
            return False

        self.running = True
        self.capture_thread = threading.Thread(target=self._capture_loop, daemon=True)
        self.capture_thread.start()
        return True

    def _stop_capture(self) -> None:
        self.running = False
        stream = self.stream
        self.stream = None
        if stream is not None:
            try:
                stream.stop()
                stream.close()
            except Exception:  # pragma: no cover
                pass
        while not self.audio_queue.empty():
            try:
                self.audio_queue.get_nowait()
            except queue.Empty:
                break

    def _capture_loop(self) -> None:
        while self.running:
            try:
                block = self.audio_queue.get(timeout=0.2)
            except queue.Empty:
                continue
            if block is None:
                continue
            samples = np.asarray(block, dtype=np.float32).reshape(-1)
            muted = time.monotonic() < self.muted_until
            for offset in range(0, samples.shape[0], FRAME_SAMPLES):
                frame = samples[offset : offset + FRAME_SAMPLES]
                if frame.shape[0] < FRAME_SAMPLES:
                    frame = np.pad(frame, (0, FRAME_SAMPLES - frame.shape[0]))
                utterance = self.vad.process(frame, muted=muted)
                if utterance is not None:
                    self.work_queue.put(("transcribe", utterance))

    # -- worker ------------------------------------------------------------

    def _work_loop(self) -> None:
        while True:
            item = self.work_queue.get()
            if item is None:
                break
            kind, payload = item
            try:
                if kind == "preload":
                    self.stt.ensure(self.model_name, self.cpu_threads, self.compute_type)
                elif kind == "transcribe":
                    self._handle_utterance(payload)
            except Exception as error:  # pragma: no cover
                log(traceback.format_exc())
                emit({"type": "error", "message": str(error)})
            finally:
                if kind == "transcribe":
                    self.busy = False

    def _handle_utterance(self, audio: np.ndarray) -> None:
        self.busy = True
        self.utterance_count += 1
        emit(
            {
                "type": "status",
                "state": "transcribing",
                "duration": round(audio.shape[0] / float(SAMPLE_RATE), 2),
                "utterance": self.utterance_count,
            }
        )
        result = self.stt.transcribe(
            audio,
            self.model_name,
            self.language,
            self.cpu_threads,
            self.compute_type,
            self.hotwords,
            # EnergyVad already cut this utterance out of the stream — Silero
            # VAD would just re-cut it (and can nibble the pre-roll).
            vad_filter=False,
        )
        text = result["text"]
        if not text:
            emit({"type": "status", "state": "idle", "reason": "no_speech"})
            return
        emit(
            {
                "type": "result",
                "transcript": text,
                "final": True,
                "confidence": result["language_probability"],
                "language": result["language"],
                "took": result["took"],
                "rtf": result["rtf"],
                "model": self.model_name,
            }
        )

    # -- tts ----------------------------------------------------------------

    def speak(self, payload: dict[str, Any]) -> dict[str, Any]:
        text = str(payload.get("text") or "").strip()
        request_id = payload.get("id")
        if not text:
            emit({"type": "tts_error", "id": request_id, "message": "No text provided."})
            return {"ok": False, "error": "No text provided."}
        self.muted_until = time.monotonic() + 1.0
        try:
            result = self.tts.synthesize(
                text,
                voice=payload.get("voice"),
                speed=float(payload.get("speed") or 1.0),
                language=str(payload.get("language") or "en-us"),
                out_path=payload.get("out_path"),
                fmt=str(payload.get("format") or "wav"),
            )
        except Exception as error:
            log(traceback.format_exc())
            # Only the failed synthesis window should be muted.
            self.muted_until = time.monotonic() + 0.35
            emit({"type": "tts_error", "id": request_id, "message": str(error)})
            return {"ok": False, "error": str(error)}
        # Synthesis is finished but playback hasn't started yet — the renderer
        # plays the returned audio after tts_done. Keep the mic muted for the
        # whole playback window or the assistant transcribes its own voice.
        playback_seconds = float(result.get("duration") or 0.0)
        self.muted_until = time.monotonic() + playback_seconds + 1.5
        emit({"type": "tts_done", "id": request_id, **result})
        return {"ok": True, **result}

    # -- dispatch -----------------------------------------------------------

    def handle(self, command: dict[str, Any]) -> None:
        name = str(command.get("cmd") or "").lower()
        request_id = command.get("id")
        if name == "boot":
            self.boot()
        elif name == "start":
            result = self.start(command.get("config") or command)
            emit({"type": "start_result", "id": request_id, **result})
        elif name == "stop":
            result = self.stop()
            emit({"type": "stop_result", "id": request_id, **result})
        elif name == "speak":
            self.speak(command)
        elif name == "status":
            emit(
                {
                    "type": "status_report",
                    "id": request_id,
                    "listening": self.listening,
                    "model_loaded": self.stt.loaded,
                    "model": self.model_name,
                    "kokoro": self.tts.available(),
                    "ffmpeg": ffmpeg_available(),
                    "utterances": self.utterance_count,
                    "bus": "ok",
                }
            )
        elif name == "shutdown":
            self.stop()
            emit({"type": "bye"})
            self.running = False
            self.work_queue.put(None)
            self.audio_queue.put(None)
        else:
            emit({"type": "error", "message": f"Unknown command: {name}"})


def serve(home: Optional[str]) -> int:
    server = VoiceServer(home)
    emit({"type": "boot", "python": sys.version.split()[0], "pid": os.getpid()})
    server.handle({"cmd": "boot"})
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            command = json.loads(line)
        except json.JSONDecodeError:
            emit({"type": "error", "message": "Malformed command (expected JSON)."})
            continue
        if not isinstance(command, dict):
            emit({"type": "error", "message": "Command must be a JSON object."})
            continue
        if str(command.get("cmd", "")).lower() == "shutdown":
            server.handle(command)
            break
        threading.Thread(target=server.handle, args=(command,), daemon=True).start()
    time.sleep(0.2)
    return 0


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def cli_tts(text: str, out: str, voice: Optional[str], fmt: str) -> int:
    tts = KokoroTts(os.path.join(default_home(), "voice", "kokoro"))
    result = tts.synthesize(text, voice=voice, out_path=out, fmt=fmt)
    print(json.dumps(result))
    return 0


def cli_transcribe(path: str, model: str, language: Optional[str], threads: int) -> int:
    audio, rate = read_wav(path)
    audio = resample(audio, rate)
    engine = SttEngine()
    started = time.monotonic()
    result = engine.transcribe(audio, model, language, threads, "int8")
    result["wall"] = round(time.monotonic() - started, 2)
    print(json.dumps(result, ensure_ascii=False))
    return 0


def cli_segment(path: str) -> int:
    audio, rate = read_wav(path)
    audio = resample(audio, rate)
    vad = EnergyVad()
    utterances = 0
    frames = audio.shape[0] // FRAME_SAMPLES
    for index in range(frames):
        frame = audio[index * FRAME_SAMPLES : (index + 1) * FRAME_SAMPLES]
        result = vad.process(frame)
        if result is not None:
            utterances += 1
            print(json.dumps({"utterance": utterances, "seconds": round(result.shape[0] / SAMPLE_RATE, 2)}))
    flushed = vad.flush()
    if flushed is not None:
        utterances += 1
        print(json.dumps({"utterance": utterances, "seconds": round(flushed.shape[0] / SAMPLE_RATE, 2)}))
    print(json.dumps({"utterances": utterances}))
    return 0


def cli_selftest() -> int:
    checks: list[dict[str, Any]] = []

    def record(name: str, ok: bool, detail: str = "") -> None:
        checks.append({"check": name, "ok": ok, "detail": detail})
        log(f"{'PASS' if ok else 'FAIL'} {name} {detail}")

    try:
        import sounddevice as sd

        devices = sd.query_devices()
        inputs = [d for d in devices if d.get("max_input_channels", 0) > 0]
        record("microphone", bool(inputs), f"{len(inputs)} input device(s)")
    except Exception as error:
        record("microphone", False, str(error))

    try:
        from faster_whisper import WhisperModel  # noqa: F401

        record("faster_whisper", True)
    except Exception as error:
        record("faster_whisper", False, str(error))

    try:
        import kokoro_onnx  # noqa: F401

        record("kokoro_onnx", True)
    except Exception as error:
        record("kokoro_onnx", False, str(error))

    tts = KokoroTts(os.path.join(default_home(), "voice", "kokoro"))
    record("kokoro_files", tts.available(), f"missing={tts.missing()}")

    record("ffmpeg", ffmpeg_available())

    failed = [c for c in checks if not c["ok"]]
    print(json.dumps({"checks": checks, "ok": not failed}))
    return 1 if failed else 0


def main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Infinite OS local voice server")
    parser.add_argument("--home", default=None, help="Infinite OS home directory")
    parser.add_argument("--tts", default=None, help="Synthesize text to a file and exit")
    parser.add_argument("--transcribe", default=None, help="Transcribe a wav/mp3 file and exit")
    parser.add_argument("--segment", default=None, help="Run VAD over a file and exit")
    parser.add_argument("--out", default=None, help="Output path for --tts")
    parser.add_argument("--voice", default=None, help="Voice id for --tts")
    parser.add_argument("--format", default="wav", choices=("wav", "mp3"), help="Output format for --tts")
    parser.add_argument("--model", default=DEFAULT_STT_MODEL, help="Whisper model for --transcribe")
    parser.add_argument("--language", default=None, help="Language hint for --transcribe")
    parser.add_argument("--threads", type=int, default=max(1, os.cpu_count() or 2))
    parser.add_argument("--selftest", action="store_true", help="Run environment checks and exit")
    args = parser.parse_args(argv)

    if args.home:
        os.environ["INFINITE_HOME"] = args.home

    global _CLI_MODE
    if args.selftest or args.tts is not None or args.transcribe is not None or args.segment is not None:
        # stdout is the result channel in CLI mode; progress events go to stderr.
        _CLI_MODE = True

    try:
        if args.selftest:
            return cli_selftest()
        if args.tts is not None:
            return cli_tts(args.tts, args.out or "tts-out.wav", args.voice, args.format)
        if args.transcribe is not None:
            return cli_transcribe(args.transcribe, args.model, args.language, args.threads)
        if args.segment is not None:
            return cli_segment(args.segment)
        return serve(args.home)
    except KeyboardInterrupt:  # pragma: no cover
        return 0
    except Exception:  # pragma: no cover
        sys.stderr.write(traceback.format_exc())
        return 1


if __name__ == "__main__":
    sys.exit(main())
