#!/usr/bin/env python3
"""Edge TTS wrapper — called by Infinite OS VoiceManager to synthesize speech.

Usage:
    python edge-tts-wrapper.py <voice> <output_file>
    Text is read from stdin.
"""
import asyncio
import sys
import edge_tts


async def main():
    if len(sys.argv) < 3:
        print("Usage: edge-tts-wrapper.py <voice> <output_file>", file=sys.stderr)
        sys.exit(1)

    voice = sys.argv[1]
    output = sys.argv[2]
    text = sys.stdin.read().strip()

    if not text:
        print("No text provided", file=sys.stderr)
        sys.exit(1)

    communicate = edge_tts.Communicate(text, voice)
    await communicate.save(output)


if __name__ == "__main__":
    asyncio.run(main())
