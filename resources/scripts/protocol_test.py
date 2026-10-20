"""Live end-to-end check of the local voice server pipe protocol.

Drives resources/scripts/local_voice_server.py exactly the way the Electron
main process does: newline-delimited JSON on stdin, events on stdout. Proves
boot -> start -> status -> speak -> stop -> shutdown without touching the UI.

Usage:
    python resources/scripts/protocol_test.py
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPT = os.path.join(ROOT, "scripts", "local_voice_server.py")

START_TIMEOUT = 60.0
REQUEST_TIMEOUT = 120.0


class Events:
    def __init__(self) -> None:
        self.by_id: dict[int, dict] = {}
        self.all: list[dict] = []
        self.by_type: dict[str, list[dict]] = {}

    def record(self, event: dict) -> None:
        self.all.append(event)
        self.by_type.setdefault(event.get("type", ""), []).append(event)
        if isinstance(event.get("id"), int):
            self.by_id[event["id"]] = event

    def wait(self, predicate, timeout: float, what: str) -> dict:
        deadline = time.monotonic() + timeout
        seen = 0
        while time.monotonic() < deadline:
            while seen < len(self.all):
                event = self.all[seen]
                seen += 1
                if predicate(event):
                    return event
            time.sleep(0.02)
        raise TimeoutError(f"timed out waiting for {what}")


def main() -> int:
    env = dict(os.environ)
    env.setdefault("PYTHONIOENCODING", "utf-8")
    env.setdefault("PYTHONUTF8", "1")

    proc = subprocess.Popen(
        [sys.executable, "-u", "-X", "utf8", SCRIPT],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        encoding="utf-8",
        env=env,
    )

    events = Events()
    failures: list[str] = []

    def pump() -> None:
        assert proc.stdout is not None
        for line in proc.stdout:
            line = line.strip()
            if not line.startswith("{"):
                continue
            try:
                events.record(json.loads(line))
            except json.JSONDecodeError:
                continue

    import threading

    reader = threading.Thread(target=pump, daemon=True)
    reader.start()

    next_id = 1

    def send(command: dict) -> int:
        nonlocal next_id
        command = dict(command)
        command["id"] = next_id
        next_id += 1
        assert proc.stdin is not None
        proc.stdin.write(json.dumps(command) + "\n")
        proc.stdin.flush()
        return command["id"]

    def check(label: str, ok: bool, detail: str = "") -> None:
        status = "PASS" if ok else "FAIL"
        print(f"[{status}] {label}{f' — {detail}' if detail else ''}")
        if not ok:
            failures.append(label)

    try:
        boot = events.wait(lambda e: e.get("type") == "boot", 30.0, "boot")
        check("boot event", True, f"python={boot.get('python')} pid={boot.get('pid')}")

        warm = events.wait(lambda e: e.get("type") == "ready" and e.get("warmed"), 60.0, "warm ready")
        check("model warm ready", True, f"model={warm.get('model')}")

        start_id = send({"cmd": "start", "config": {"model": "base.en", "language": "en"}})
        started = events.wait(
            lambda e: e.get("id") == start_id and e.get("type") == "start_result", START_TIMEOUT, "start_result"
        )
        check("start_result ok", started.get("ok") is True, json.dumps({k: started[k] for k in ('ok', 'engine', 'model') if k in started}))
        ready = events.wait(lambda e: e.get("type") == "ready" and not e.get("warmed"), 10.0, "capture ready")
        check("capture ready", True, f"model={ready.get('model')} sampling_rate={ready.get('sampling_rate')}")

        status_id = send({"cmd": "status"})
        status = events.wait(
            lambda e: e.get("id") == status_id and e.get("type") == "status_report", 10.0, "status_report"
        )
        check("status reports listening", status.get("listening") is True, json.dumps(status))
        check("status reports model loaded", status.get("model_loaded") is True)

        speak_id = send({"cmd": "speak", "text": "Infinite OS voice pipeline is online.", "format": "wav"})
        spoken = events.wait(
            lambda e: e.get("id") == speak_id and e.get("type") in ("tts_done", "tts_error"),
            REQUEST_TIMEOUT,
            "speak result",
        )
        speak_ok = spoken.get("type") == "tts_done"
        check("speak produces audio", speak_ok, f"bytes={spoken.get('bytes')} duration={spoken.get('duration')}")
        if speak_ok:
            path = spoken.get("path")
            check("spoken file exists", bool(path) and os.path.exists(path), str(path))

        stop_id = send({"cmd": "stop"})
        stopped = events.wait(
            lambda e: e.get("id") == stop_id and e.get("type") == "stop_result", 10.0, "stop_result"
        )
        check("stop_result ok", stopped.get("ok") is True)
        ended = events.wait(lambda e: e.get("type") == "ended", 5.0, "ended")
        check("ended event", True, json.dumps(ended))

        send({"cmd": "shutdown"})
        try:
            proc.wait(timeout=15)
            check("clean shutdown", proc.returncode == 0, f"exit={proc.returncode}")
        except subprocess.TimeoutExpired:
            proc.kill()
            check("clean shutdown", False, "process did not exit after shutdown")

        stderr = (proc.stderr.read() if proc.stderr else "").strip()
        if stderr:
            print("[info] stderr tail:")
            for line in stderr.splitlines()[-8:]:
                print(f"       {line}")
    except TimeoutError as error:
        check("protocol flow", False, str(error))
        proc.kill()
    finally:
        if proc.poll() is None:
            proc.kill()

    print()
    if failures:
        print(f"FAILED: {len(failures)} check(s): {', '.join(failures)}")
        return 1
    print("ALL CHECKS PASSED")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
