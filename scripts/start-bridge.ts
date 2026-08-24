// Standalone bridge server launcher
process.on('uncaughtException', (err) => {
  console.error('[bridge] uncaughtException:', err.message);
  console.error(err.stack);
});
process.on('unhandledRejection', (err) => {
  console.error('[bridge] unhandledRejection:', err);
});

import { bridgeServer } from '../src/main/bridge/server.js';

async function main() {
  console.log('[bridge] Starting...');
  await bridgeServer.start();
  const status = bridgeServer.getStatus();
  console.log('[bridge] Running on port', status.port);
  console.log('[bridge] Token configured:', status.tokenConfigured);
  console.log('[bridge] Waiting for extension on ws://127.0.0.1:' + status.port + '/bridge');
}

main().catch((err) => {
  console.error('[bridge] Fatal:', err.message);
  process.exit(1);
});
