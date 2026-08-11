// RouterAdmin — guidance + safe local checks for managing the user's own
// router (recovering admin access, changing the Wi-Fi password, port
// forwarding). Everything here operates only on the user's own gateway and
// this PC. It never probes or attacks third-party devices.

import type { Tool, ToolResult } from './base.js';
import { spawnWithTimeout } from './spawn-timeout.js';

interface CheckResult {
  host: string;
  reachable: boolean;
  http: boolean;
  https: boolean;
  redirectsToHttps?: boolean;
}

export const routerAdminTool: Tool = {
  name: 'RouterAdmin',
  description: 'Help manage the user\'s OWN router: find the gateway address, check whether the router admin panel is reachable (check_access), and produce step-by-step guidance for recovering admin access (recover_access), changing the Wi-Fi password (change_password), or port forwarding (port_forward). Only touches the user\'s own gateway; no scanning or intrusion of other networks.',
  inputSchema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['gateway', 'check_access', 'recover_access', 'change_password', 'port_forward'],
      },
      host: { type: 'string', description: 'Router IP (optional; defaults to the detected gateway).' },
      brand: { type: 'string', description: 'Router brand for guidance (TP-Link, Netgear, Asus, Linksys, Xiaomi, Huawei, generic).' },
      port: { type: 'number', description: 'Local port to forward (for port_forward).' },
    },
    required: ['action'],
  },
  permission: 'ask',

  async execute(args, ctx): Promise<ToolResult> {
    const input = args as { action: string; host?: string; brand?: string; port?: number };
    try {
      switch (input.action) {
        case 'gateway': {
          const gateway = await detectGateway(ctx.abortSignal);
          return json({ gateway: gateway ?? null, note: gateway ? 'Open http://' + gateway + ' in a browser to reach the router admin panel.' : 'No gateway detected — you may be offline.' });
        }
        case 'check_access': {
          const host = input.host ?? (await detectGateway(ctx.abortSignal)) ?? '192.168.1.1';
          if (!/^(\d{1,3}\.){3}\d{1,3}$/.test(host)) return bad(`Invalid router IP: ${host}`);
          const result = await probeRouter(host, ctx.abortSignal);
          return json({
            ...result,
            next: result.https || result.http
              ? `Open http${result.https ? 's' : ''}://${host} in your browser. If you forgot the admin password, use action=recover_access.`
              : 'The router did not answer on port 80/443. Try action=recover_access for reset guidance.',
          });
        }
        case 'recover_access': {
          const host = input.host ?? (await detectGateway(ctx.abortSignal)) ?? 'unknown';
          const brand = normalizeBrand(input.brand);
          return json({
            host,
            brand,
            steps: recoverSteps(brand, host),
            warning: 'Only perform these steps on a router you own. A factory reset (30/30/30) erases all settings (Wi-Fi name/password, port forwards) and restores the default admin credentials printed on the device label.',
          });
        }
        case 'change_password': {
          const host = input.host ?? (await detectGateway(ctx.abortSignal)) ?? 'unknown';
          const brand = normalizeBrand(input.brand);
          return json({
            host,
            brand,
            steps: [
              `1. Open http://${host} in a browser and log in to the admin panel.`,
              `2. Find Wireless / Wi-Fi settings (often "Wireless", "Wi-Fi", or "Basic Settings").`,
              `3. Set the new network name (SSID) and password. Use WPA2/WPA3-Personal — never WEP or "open".`,
              `4. Save/Apply. Devices reconnect using the new password.`,
              `5. Optional: in the admin panel also change the admin login password (Administration / Management).`,
            ],
            note: `These steps match typical ${brand} panels; exact menu names vary by model and firmware.`,
          });
        }
        case 'port_forward': {
          const port = input.port;
          if (!port || port < 1 || port > 65535) return bad('port_forward requires a port between 1 and 65535.');
          const host = input.host ?? (await detectGateway(ctx.abortSignal)) ?? 'unknown';
          const brand = normalizeBrand(input.brand);
          return json({
            host,
            port,
            steps: [
              `1. On this PC, find the local IP of the device that should receive traffic: run "ipconfig" (IPv4 Address of the active adapter). Use a static IP or DHCP reservation for that device.`,
              `2. Open http://${host} in a browser and log in.`,
              `3. Find NAT / Virtual Server / Port Forwarding (typical ${brand} location).`,
              `4. Create a rule: name it (e.g. "app-${port}"), protocol TCP or UDP, external port ${port}, internal port ${port}, target IP = the device's local IP.`,
              `5. Save/Apply and verify from outside the network (e.g. https://portchecker.co) — note your public IP may be CGNAT, which blocks inbound forwarding.`,
            ],
            security: 'Only forward ports you actually need, and close them again when done. An open port is an attack surface.',
          });
        }
        default:
          return bad(`Unknown RouterAdmin action: ${input.action}`);
      }
    } catch (error) {
      return bad((error as Error).message);
    }
  },
};

function normalizeBrand(brand?: string): string {
  const b = (brand ?? '').toLowerCase();
  if (/(tp|tplink|tplink)/.test(b)) return 'TP-Link';
  if (/netgear/.test(b)) return 'Netgear';
  if (/asus/.test(b)) return 'Asus';
  if (/linksys/.test(b)) return 'Linksys';
  if (/xiaomi|miwi|mi router/.test(b)) return 'Xiaomi';
  if (/huawei/.test(b)) return 'Huawei';
  return 'generic';
}

function recoverSteps(brand: string, host: string): string[] {
  return [
    `1. Try common default credentials for ${brand} at http://${host}: admin/admin, admin/password, admin/1234 (check the sticker on the router first).`,
    `2. If that fails, look for the physical Reset button (usually recessed, near the ports) and hold it for ~10-30 seconds until the lights blink — this restores factory defaults.`,
    `3. After reset, log in with the default admin credentials printed on the device label (often "admin" / "admin" or "admin" / the serial number).`,
    `4. Immediately set a new admin password, then re-configure your Wi-Fi name and password (see change_password).`,
    `5. If the router was provided by your ISP, their support can also reset it remotely — check the label for the ISP help line.`,
  ];
}

async function detectGateway(signal: AbortSignal): Promise<string | null> {
  const out = await spawnWithTimeout({ command: 'ipconfig', args: ['/all'], signal, timeoutMs: 30_000, windowsHide: true });
  return out.stdout.match(/Default Gateway[^\r\n]*:\s*([0-9a-fA-F:.]+)/i)?.[1] ?? null;
}

async function probeRouter(host: string, signal: AbortSignal): Promise<CheckResult> {
  const result: CheckResult = { host, reachable: false, http: false, https: false };
  const ping = await spawnWithTimeout({ command: 'ping', args: ['-n', '2', '-w', '1500', host], signal, timeoutMs: 15_000, windowsHide: true });
  result.reachable = ping.exitCode === 0;
  const http = await curlHead(`http://${host}`, signal);
  const https = await curlHead(`https://${host}`, signal);
  result.http = http.ok;
  result.https = https.ok;
  if (http.ok && /^3\d\d$/.test(String(http.code)) && /https/i.test(http.location ?? '')) result.redirectsToHttps = true;
  return result;
}

async function curlHead(url: string, signal: AbortSignal): Promise<{ ok: boolean; code: number | null; location?: string }> {
  const out = await spawnWithTimeout({ command: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-Command', `try { $r = Invoke-WebRequest -Uri '${url}' -Method Head -TimeoutSec 5 -UseBasicParsing -MaximumRedirection 0 -ErrorAction Stop; "$($r.StatusCode)|$($r.Headers.Location)" } catch { if ($_.Exception.Response) { "$([int]$_.Exception.Response.StatusCode)|$($_.Exception.Response.Headers.Location)" } else { 'ERR' } }`], signal, timeoutMs: 20_000, windowsHide: true });
  const text = out.stdout.trim();
  if (text === 'ERR') return { ok: false, code: null };
  const [code, location] = text.split('|');
  const n = Number(code);
  return { ok: Number.isFinite(n) && n > 0 && n < 500, code: Number.isFinite(n) ? n : null, location };
}

function json(value: unknown): ToolResult { return { content: JSON.stringify(value, null, 2) }; }
function bad(content: string): ToolResult { return { content, is_error: true }; }
