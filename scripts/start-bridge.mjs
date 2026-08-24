// Standalone bridge server launcher — starts the Infinite OS Bridge server
// outside Electron so the browser extension can connect.
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// The bridge server is TypeScript — import it from compiled output.
// First try the compiled out/ directory; fall back to tsx if available.
const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

async function main() {
  try {
    // Try importing from compiled output
    const mod = await import(resolve(root, 'out/main/bridge/server.js'));
    const server = mod.bridgeServer;
    await server.start();
    const status = server.getStatus();
    console.log('[bridge-launcher] Bridge server started:', JSON.stringify(status, null, 2));
    console.log('[bridge-launcher] Token:', status.tokenConfigured ? 'configured' : 'NOT configured');
    console.log('[bridge-launcher] Listening on port', status.port);
    console.log('[bridge-launcher] Waiting for extension to connect...');
  } catch (err) {
    console.error('[bridge-launcher] Failed to start from compiled output:', err.message);
    console.log('[bridge-launcher] Trying direct TS import via tsx...');
    try {
      const { execSync } = await import('node:child_process');
      execSync(`npx tsx "${resolve(__dirname, 'start-bridge.ts')}"`, { stdio: 'inherit', cwd: root });
    } catch {
      console.error('[bridge-launcher] Fallback also failed. Make sure the project is built: npm run build');
      process.exit(1);
    }
  }
}

main();
