// Network self-help tool — recover your own Wi-Fi passwords and diagnose your
// own network. Authorized scope: this PC's saved profiles, the PC's own
// interfaces, and the user's own gateway/router. It never scans third-party
// networks and never performs any network intrusion.

import type { Tool, ToolResult } from './base.js';
import { spawnWithTimeout } from './spawn-timeout.js';

const WIFI_KEY_PATTERN = /(?:Key Content|Contenu de la clé|Schlüsselinhalt)\s*:\s*(.+)/i;
const SSID_PATTERN = /(?:SSID name|Nom du SSID|SSID-Name)\s*:\s*(.+)/i;

function parseProfiles(out: string): string[] {
  const profiles: string[] = [];
  for (const line of out.split(/\r?\n/)) {
    const match = line.match(/:\s*(.+)/);
    if (match && !/^(All User Profile|Tous les utilisateurs|Alle Benutzerprofile)/i.test(match[1].trim())) {
      profiles.push(match[1].trim());
    }
  }
  return [...new Set(profiles)];
}

function extractKey(detail: string): string | null {
  for (const line of detail.split(/\r?\n/)) {
    const m = line.match(WIFI_KEY_PATTERN);
    if (m && m[1] && m[1].trim() && !/^none$/i.test(m[1].trim())) return m[1].trim();
  }
  return null;
}

export const networkTool: Tool = {
  name: 'Network',
  description: 'Authorized network self-help on the user\'s own PC and network: recover a forgotten Wi-Fi password from this PC\'s saved profiles (list_profiles, get_password), show the current connection and gateway (status, gateway), diagnose connectivity (ping, dns, ports, traceroute), and test or adjust DNS (dns_test, dns_flush, dns_set). Only operates on this machine and the user\'s own devices; never scans or attacks third-party networks.',
  inputSchema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['status', 'list_profiles', 'get_password', 'gateway', 'ping', 'dns_test', 'traceroute', 'ports', 'dns_flush', 'dns_set'],
      },
      ssid: { type: 'string', description: 'Wi-Fi profile name (for get_password).' },
      host: { type: 'string', description: 'Host/IP for ping, traceroute, or ports (default: gateway for ping, 8.8.8.8 for dns_test).' },
      port: { type: 'number', description: 'TCP port for ports action (default 443).' },
      dns: { type: 'string', description: 'DNS server IP for dns_set (e.g. 1.1.1.1, 8.8.8.8).' },
    },
    required: ['action'],
  },
  permission: 'ask',

  async execute(args, ctx): Promise<ToolResult> {
    const input = args as { action: string; ssid?: string; host?: string; port?: number; dns?: string };
    const signal = ctx.abortSignal;
    try {
      switch (input.action) {
        case 'list_profiles': {
          const out = await runNetsh(['wlan', 'show', 'profiles'], signal);
          if (out.exitCode !== 0) return bad('Could not read Wi-Fi profiles. This action needs to run inside your Windows user session (it reads this PC\'s own saved profiles).');
          const profiles = parseProfiles(out.stdout);
          if (!profiles.length) return json({ profiles: [], note: 'No saved Wi-Fi profiles found on this PC.' });
          return json({ profiles, hint: 'Use action=get_password with an ssid to recover the stored key of a profile you own.' });
        }
        case 'get_password': {
          if (!input.ssid) return bad('get_password requires ssid (the Wi-Fi profile name, from list_profiles).');
          const detail = await runNetsh(['wlan', 'show', 'profile', `name=${input.ssid}`, 'key=clear'], signal);
          if (detail.exitCode !== 0) {
            return bad(`Could not read profile "${input.ssid}". It may not be saved on this PC or the name is misspelled. Use list_profiles first.`);
          }
          const key = extractKey(detail.stdout);
          const ssid = detail.stdout.match(SSID_PATTERN)?.[1]?.trim() ?? input.ssid;
          if (!key) {
            return json({ ssid, note: 'This profile has no recoverable key (open network or key material unavailable).', detail: detail.stdout.slice(0, 2000) });
          }
          return json({ ssid, password: key, note: 'This is the Wi-Fi password stored in your own Windows profile. Use it only on your own network.' });
        }
        case 'status': {
          const ifaces = await runNetsh(['wlan', 'show', 'interfaces'], signal);
          const summary = ifaces.stdout
            .split(/\r?\n/)
            .filter((l) => /(SSID|State|Signal|Radio type|Channel)/i.test(l))
            .map((l) => l.trim())
            .join('\n');
          return json({ connected: ifaces.exitCode === 0 && /State\s*:\s*connected/i.test(ifaces.stdout), interfaces: summary || 'No Wi-Fi interface reported.', raw: ifaces.stdout.slice(0, 3000) });
        }
        case 'gateway': {
          const out = await runCmd('ipconfig', ['/all'], signal);
          const gateway = out.stdout.match(/Default Gateway[^\r\n]*:\s*([0-9a-fA-F:.]+)/i)?.[1];
          const ip = out.stdout.match(/IPv4 Address[^\r\n]*:\s*([0-9.]+)/i)?.[1];
          return json({ gateway: gateway ?? null, ipv4: ip ?? null, note: gateway ? 'This is your router\'s admin address — open it in a browser to manage your router.' : 'No default gateway found; you may be offline.' });
        }
        case 'ping': {
          const host = input.host ?? (await gatewayAddress(signal)) ?? '8.8.8.8';
          const out = await runCmd('ping', ['-n', '4', host], signal);
          const success = out.exitCode === 0;
          const stats = out.stdout.split(/\r?\n/).filter((l) => /(Average|Moyenne|Durchschnitt|Lost|Perte|Verloren|Reply|Réponse|Antwort)/i.test(l)).slice(0, 8).join('\n');
          return json({ host, reachable: success, output: stats || out.stdout.slice(0, 1200), error: !success ? out.stderr.slice(0, 500) : undefined });
        }
        case 'dns_test': {
          const host = input.host ?? '8.8.8.8';
          const results: Array<{ dns: string; ok: boolean; ms: number | null; detail: string }> = [];
          for (const dns of ['1.1.1.1', '8.8.8.8']) {
            const out = await runCmd('nslookup', [host, dns], signal);
            const ok = /Address(es)?:/.test(out.stdout) && out.exitCode === 0;
            const time = out.stdout.match(/time:\s*(\d+)\s*ms/i)?.[1];
            results.push({ dns, ok, ms: time ? Number(time) : null, detail: out.stdout.split(/\r?\n/).slice(-6).join('\n') });
          }
          return json({ host, results, note: 'Tests public resolvers 1.1.1.1 (Cloudflare) and 8.8.8.8 (Google). If both fail, your internet connection or local DNS is the problem.' });
        }
        case 'traceroute': {
          const host = input.host ?? '8.8.8.8';
          const out = await runCmd('tracert', ['-d', '-h', '15', host], signal);
          return json({ host, output: out.stdout.slice(0, 4000), note: 'First hop (1) is usually your router/gateway.' });
        }
        case 'ports': {
          const host = input.host ?? '127.0.0.1';
          const port = input.port ?? 443;
          const script = `$c = New-Object System.Net.Sockets.TcpClient; try { $iar = $c.BeginConnect('${host.replace(/'/g, "''")}', ${port}, $null, $null); $ok = $iar.AsyncWaitHandle.WaitOne(3000, $false) -and $c.Connected; if ($ok) { 'OPEN' } else { 'TIMEOUT_OR_CLOSED' } } catch { 'CLOSED' } finally { $c.Close() }`;
          const out = await runPowershell(script, signal);
          return json({ host, port, result: out.stdout.trim() || 'CLOSED', note: 'OPEN means something is accepting connections on that port; CLOSED/TIMEOUT means nothing responded.' });
        }
        case 'dns_flush': {
          const out = await runCmd('ipconfig', ['/flushdns'], signal);
          return json({ flushed: out.exitCode === 0, output: out.stdout.trim() || out.stderr.trim() });
        }
        case 'dns_set': {
          const dns = input.dns ?? '1.1.1.1';
          if (!/^(\d{1,3}\.){3}\d{1,3}$/.test(dns)) return bad(`Invalid DNS IP: ${dns}`);
          const script = `$iface = Get-NetAdapter | Where-Object Status -eq 'Up' | Select-Object -First 1; if (-not $iface) { 'NO_ACTIVE_ADAPTER'; exit 1 }; Set-DnsClientServerAddress -InterfaceIndex $iface.ifIndex -ServerAddresses ('${dns}'); 'DNS set to ${dns} on ' + $iface.Name`;
          const out = await runPowershell(script, signal);
          if (out.exitCode !== 0) return bad(`Could not set DNS (requires an elevated session): ${out.stderr || out.stdout}`);
          return json({ dns, adapter: out.stdout.trim(), note: 'Run dns_flush afterwards. Revert with dns_set using your router\'s DNS (usually 192.168.x.1) or 8.8.8.8.' });
        }
        default:
          return bad(`Unknown Network action: ${input.action}`);
      }
    } catch (error) {
      return bad((error as Error).message);
    }
  },
};

async function runNetsh(args: string[], signal: AbortSignal) {
  return spawnWithTimeout({ command: 'netsh.exe', args, signal, timeoutMs: 60_000, windowsHide: true });
}

async function runCmd(file: string, args: string[], signal: AbortSignal) {
  return spawnWithTimeout({ command: file, args, signal, timeoutMs: 60_000, windowsHide: true });
}

async function runPowershell(script: string, signal: AbortSignal) {
  return spawnWithTimeout({ command: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-Command', script], signal, timeoutMs: 60_000, windowsHide: true });
}

async function gatewayAddress(signal: AbortSignal): Promise<string | null> {
  const out = await runCmd('ipconfig', ['/all'], signal);
  return out.stdout.match(/Default Gateway[^\r\n]*:\s*([0-9a-fA-F:.]+)/i)?.[1] ?? null;
}

function json(value: unknown): ToolResult { return { content: JSON.stringify(value, null, 2) }; }
function bad(content: string): ToolResult { return { content, is_error: true }; }
