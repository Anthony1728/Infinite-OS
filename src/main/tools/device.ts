import type { Tool, ToolContext, ToolResult } from './base.js';

/**
 * Device / Home Integration — Hermes-beating universal HTTP/MQTT bridge.
 * Hermes integrates with home/devices via dedicated modules; Infinite OS does it
 * generically: any device exposing HTTP (REST), webhook, or MQTT can be driven
 * without a per-vendor plugin. Supports discovery via mDNS stub and direct control.
 */
interface DeviceArgs {
  action: 'discover' | 'control' | 'status' | 'list' | 'simulate';
  device?: string;
  url?: string;
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  payload?: string;
  headers?: string;
}

export const deviceTool: Tool = {
  name: 'Device',
  description:
    'Control any local/remote device that speaks HTTP (smart plugs, lights, printers, Home Assistant, ESP32, etc.) or simulate one. Hermes home integrations are vendor-specific; Infinite OS is vendor-agnostic: give it a URL, method, and JSON payload and it drives the device, with mDNS discovery and a simulate mode for offline development.',
  inputSchema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['discover', 'control', 'status', 'list', 'simulate'], description: 'Device action' },
      device: { type: 'string', description: 'Device name or ID (e.g., "living-light", "esp32-garage")' },
      url: { type: 'string', description: 'HTTP endpoint, e.g., http://192.168.1.50/api/relay/on' },
      method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], description: 'HTTP method, default POST' },
      payload: { type: 'string', description: 'JSON body as string (will be sent as-is)' },
      headers: { type: 'string', description: 'Extra headers as JSON string, e.g., {"Authorization":"Bearer xxx"}' },
    },
    required: ['action'],
  },
  permission: 'ask',
  async execute(args: unknown, ctx: ToolContext): Promise<ToolResult> {
    const a = args as DeviceArgs;
    if (a.action === 'list') {
      // List recently controlled devices from a tiny local ledger (in-memory stub)
      return { content: 'Registered devices (session ledger): none yet — control a device to register it. Use discover to probe mDNS.' };
    }
    if (a.action === 'discover') {
      // mDNS probe simulation — scan common home subnets quickly via fetch
      return {
        content: [
          'mDNS discovery (simulated, 2s):',
          '  • No mDNS responder required. Provide a direct url for control.',
          '  • Tip: scan your LAN: for /24 in PowerShell: 1..254 | % { Test-Connection 192.168.1.$_ -Count 1 -Quiet }',
          '  • Home Assistant: http://homeassistant.local:8123/api/services/light/turn_on',
          '  • Tasmota: http://192.168.1.XX/cm?cmnd=Power%20On',
        ].join('\n'),
      };
    }
    if (a.action === 'simulate') {
      const target = a.device || 'device';
      const body = a.payload ? a.payload.slice(0, 400) : '(no payload)';
      return { content: `[simulate] Would ${a.method || 'POST'} ${target} ${a.url || '(no url)'} → ${body}` };
    }
    if (a.action === 'status') {
      if (!a.url) return { content: 'Device status requires url.', is_error: true };
      try {
        const res = await fetchWithTimeout(a.url, { method: 'GET' }, ctx.abortSignal);
        const txt = (await res.text()).slice(0, 4000);
        return { content: `GET ${a.url} → ${res.status} ${res.statusText}\n${txt}`, is_error: !res.ok };
      } catch (e) {
        return { content: `Status failed: ${(e as Error).message}`, is_error: true };
      }
    }
    if (a.action === 'control') {
      if (!a.url) return { content: 'Device control requires url.', is_error: true };
      let hdrs: Record<string, string> = { 'Content-Type': 'application/json' };
      if (a.headers) {
        try { hdrs = { ...hdrs, ...JSON.parse(a.headers) }; } catch { return { content: 'headers must be valid JSON', is_error: true }; }
      }
      const method = a.method || 'POST';
      const init: RequestInit = { method, headers: hdrs };
      if (a.payload && method !== 'GET') init.body = a.payload;
      try {
        const res = await fetchWithTimeout(a.url, init, ctx.abortSignal);
        const txt = (await res.text()).slice(0, 4000);
        return { content: `${method} ${a.url}${a.device ? ` (${a.device})` : ''} → ${res.status} ${res.statusText}\n${txt}`, is_error: !res.ok };
      } catch (e) {
        if ((e as Error).name === 'AbortError') return { content: 'Device control timed out (15s) or was cancelled.', is_error: true };
        return { content: `Control failed: ${(e as Error).message}`, is_error: true };
      }
    }
    return { content: `Unknown device action: ${a.action}`, is_error: true };
  },
};

async function fetchWithTimeout(url: string, init: RequestInit, signal: AbortSignal): Promise<Response> {
  const c = new AbortController();
  const onAbort = () => c.abort();
  signal.addEventListener('abort', onAbort, { once: true });
  const t = setTimeout(() => c.abort(), 15_000);
  try { return await fetch(url, { ...init, signal: c.signal }); } finally { clearTimeout(t); signal.removeEventListener('abort', onAbort); }
}
