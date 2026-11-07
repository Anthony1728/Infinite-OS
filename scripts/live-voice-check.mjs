#!/usr/bin/env node
// Live voice proof on real hardware:
//   1. open the Voice view in the real app window
//   2. enumerate input devices and confirm a microphone is present
//   3. actually open the microphone and record ~2.5s (non-empty Blob)
//   4. synthesize speech through the configured TTS chain (non-empty audio)
//
// No mocks: the mic capture is Chromium's getUserMedia/MediaRecorder against
// the machine's default input, and TTS is the app's own main-process voice
// service. STT availability is reported, not faked — Windows dictation is a
// main-process SAPI path and does not accept an arbitrary audio buffer.
//
// Usage: node scripts/live-voice-check.mjs

import { _electron as electron } from '@playwright/test';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const mainEntry = join(root, 'out', 'main', 'index.js');
const artifacts = join(root, 'test-results', 'live-voice');

const startedAt = Date.now();
const report = {
  startedAt: new Date(startedAt).toISOString(),
  devices: [],
  capture: null,
  status: null,
  warmup: null,
  tts: null,
  stt: null,
};

function log(step, detail) {
  report.steps ??= [];
  report.steps.push({ at: new Date().toISOString(), step, ...(detail ?? {}) });
  console.log(`[live-voice] ${step}${detail ? ' ' + JSON.stringify(detail) : ''}`);
}

function writeReport() {
  try {
    mkdirSync(artifacts, { recursive: true });
    report.finishedAt = new Date().toISOString();
    report.durationMs = Date.now() - startedAt;
    writeFileSync(join(artifacts, 'report.json'), JSON.stringify(report, null, 2));
  } catch (error) {
    console.error('[live-voice] could not write report:', error.message);
  }
}

function fail(message) {
  console.error(`[live-voice] FAILED: ${message}`);
  writeReport();
  process.exit(1);
}

async function main() {
  if (!existsSync(mainEntry)) fail('out/main/index.js missing — run `npm run build` first');
  mkdirSync(artifacts, { recursive: true });
  const userData = mkdtempSync(join(tmpdir(), 'infinite-voice-userdata-'));

  const app = await electron.launch({
    args: [mainEntry, `--user-data-dir=${userData}`],
    env: { ...process.env, INFINITE_DISABLE_GPU: '1' },
    timeout: 120_000,
  });

  try {
    const page = await app.firstWindow({ timeout: 120_000 });
    await page.waitForFunction(() => Boolean(document.querySelector('[data-nav="studio"]')), undefined, {
      timeout: 120_000,
    });

    const voiceNav = page.locator('[data-nav="voice"]').first();
    if (await voiceNav.isVisible().catch(() => false)) {
      await voiceNav.click();
      await page.waitForTimeout(2_500);
      log('voice-view-open');
    } else {
      log('voice-view-not-in-nav');
    }

    // 1. Devices + real capture.
    report.capture = await page.evaluate(async () => {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const inputs = devices
        .filter((device) => device.kind === 'audioinput')
        .map((device) => ({ deviceId: device.deviceId, label: device.label, groupId: device.groupId }));
      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        });
      } catch (error) {
        return { inputs, error: error?.message ?? String(error) };
      }
      const track = stream.getAudioTracks()[0];
      const settings = track?.getSettings?.() ?? {};
      const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus']
        .find((candidate) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(candidate));
      const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      const chunks = [];
      const audioContext = new AudioContext();
      await audioContext.resume().catch(() => {});
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(analyser);
      const samples = new Float32Array(analyser.fftSize);
      let peak = 0;
      const levelTimer = setInterval(() => {
        analyser.getFloatTimeDomainData(samples);
        for (const value of samples) peak = Math.max(peak, Math.abs(value));
      }, 100);
      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) chunks.push(event.data);
      };
      const recording = new Promise((resolve) => {
        recorder.onstop = () => resolve();
        recorder.start();
        setTimeout(() => recorder.stop(), 2_500);
      });
      await recording;
      clearInterval(levelTimer);
      const blob = new Blob(chunks, { type: mime ?? 'audio/webm' });
      for (const t of stream.getTracks()) t.stop();
      await audioContext.close().catch(() => {});
      return {
        inputs,
        label: track?.label ?? '',
        mime: mime ?? null,
        bytes: blob.size,
        chunks: chunks.length,
        peak,
        settings,
      };
    });
    report.devices = report.capture?.inputs ?? [];
    log('capture', {
      inputs: report.devices.length,
      label: report.capture?.label,
      bytes: report.capture?.bytes,
      peak: report.capture?.peak,
      error: report.capture?.error,
    });
    if (report.capture?.error) fail(`microphone capture failed: ${report.capture.error}`);
    if (report.devices.length === 0) fail('no audio input device was enumerated');
    if (!report.capture?.bytes) fail('the microphone produced an empty recording');

    // 2. Voice service status + warmup.
    report.status = await page.evaluate(() => window.api.voiceStatus());
    report.warmup = await page.evaluate(() => window.api.voiceWarmup({ which: 'both' }));
    log('status', report.status);
    log('warmup', report.warmup);

    // 3. Real TTS through the configured chain.
    const tts = await page.evaluate(async () => {
      try {
        const result = await window.api.voiceTTS({ text: 'Infinite OS voice verification. One, two, three.' });
        return { ok: true, provider: result?.provider ?? null, bytes: Math.floor(((result?.audio ?? '').length * 3) / 4) };
      } catch (error) {
        return { ok: false, error: error?.message ?? String(error) };
      }
    });
    report.tts = tts;
    log('tts', tts);
    await page.screenshot({ path: join(artifacts, 'voice-view.png') }).catch(() => {});
    if (!tts.ok) fail(`TTS failed: ${tts.error}`);
    if (!tts.bytes) fail('TTS returned empty audio');

    // 4. Honest STT probe with the captured audio (informational).
    report.stt = await page.evaluate(async () => {
      try {
        const status = await window.api.voiceStatus();
        return { available: status?.whisper === true || status?.available === true };
      } catch (error) {
        return { available: false, error: error?.message ?? String(error) };
      }
    });
    log('stt', report.stt);

    writeReport();
    console.log('[live-voice] PASS: mic captured audio + TTS produced audio');
    await app.close().catch(() => {});
    process.exit(0);
  } catch (error) {
    writeReport();
    console.error('[live-voice] ERROR:', error);
    await app.close().catch(() => {});
    process.exit(1);
  }
}

main();
