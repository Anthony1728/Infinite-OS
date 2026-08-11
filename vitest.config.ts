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
  },
});
