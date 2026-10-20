import { defineConfig } from 'vitest/config';

/**
 * Vitest configuration for Infinite OS.
 *
 * The include/exclude patterns scope test discovery to the live source tree
 * so that stale backup copies (e.g. .backups/, dist/, out/) are never picked
 * up as test files. All tests live under src/.
 */
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    exclude: ['node_modules/**', 'dist/**', 'out/**', '.backups/**'],
    // Full-suite parallel load starves the slower integration tests (ffmpeg
    // packaging, PowerShell pipelines, voice provider probes) past vitest's
    // 5s default; they pass in isolation, so give the whole suite headroom.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
