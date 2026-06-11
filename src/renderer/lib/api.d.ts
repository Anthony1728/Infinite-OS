// Type-safe window.api surface (for renderer to import).

import type { Api } from '../preload/index.js';

declare global {
  interface Window {
    api: Api;
  }
}

export {};
