import { cpus, freemem, hostname, platform, totalmem, uptime } from 'node:os';
import type { Tool, ToolResult } from './base.js';
import { spawnWithTimeout } from './spawn-timeout.js';

export const systemTool: Tool = {
  name: 'System',
  description: 'Inspect and manage Windows: CPU/RAM/uptime, battery, GPU, monitors, printers, USB, Wi-Fi, Bluetooth, processes, installed software, Windows settings, and winget software search/install/uninstall/upgrade.',
  inputSchema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['status', 'battery', 'gpu', 'monitors', 'printers', 'usb', 'wifi', 'bluetooth', 'processes', 'installed_apps', 'open_settings', 'software_search', 'software_install', 'software_uninstall', 'software_upgrade'] },
      value: { type: 'string', description: 'Settings URI, software query, package ID, or process filter' },
    },
    required: ['action'],
  },
  permission: 'ask',

  async execute(args, ctx): Promise<ToolResult> {
    const input = args as { action: string; value?: string };
    if (input.action === 'status') {
      return json({ hostname: hostname(), platform: platform(), uptimeSeconds: uptime(), cpu: cpus()[0]?.model, cpuCores: cpus().length, totalMemory: totalmem(), freeMemory: freemem(), usedMemoryPercent: Math.round((1 - freemem() / totalmem()) * 100) });
    }
    if (process.platform !== 'win32') return bad('System management currently targets Windows.');
    const commands: Record<string, string> = {
      battery: "Get-CimInstance Win32_Battery | Select-Object EstimatedChargeRemaining,BatteryStatus,EstimatedRunTime | ConvertTo-Json -Compress",
      gpu: "Get-CimInstance Win32_VideoController | Select-Object Name,AdapterRAM,DriverVersion,VideoProcessor | ConvertTo-Json -Compress",
      monitors: "Get-CimInstance Win32_DesktopMonitor | Select-Object Name,ScreenWidth,ScreenHeight,Status | ConvertTo-Json -Compress",
      printers: "Get-Printer | Select-Object Name,DriverName,PortName,PrinterStatus,Default | ConvertTo-Json -Compress",
      usb: "Get-PnpDevice -PresentOnly | Where-Object InstanceId -like 'USB*' | Select-Object FriendlyName,Class,Status | ConvertTo-Json -Compress",
      wifi: 'netsh wlan show interfaces; netsh wlan show networks mode=bssid',
      bluetooth: "Get-PnpDevice -Class Bluetooth | Select-Object FriendlyName,Status,InstanceId | ConvertTo-Json -Compress",
      processes: "Get-Process | Sort-Object WorkingSet64 -Descending | Select-Object -First 50 ProcessName,Id,CPU,WorkingSet64,MainWindowTitle | ConvertTo-Json -Compress",
      installed_apps: "Get-Package | Select-Object -First 200 Name,Version,ProviderName | ConvertTo-Json -Compress",
    };
     if (commands[input.action]) return run('powershell.exe', ['-NoProfile', '-Command', commands[input.action]], ctx.cwd, ctx.abortSignal);
    if (input.action === 'open_settings') {
      const uri = input.value?.startsWith('ms-settings:') ? input.value : `ms-settings:${input.value ?? ''}`;
      return run('cmd.exe', ['/d', '/c', 'start', '', uri], ctx.cwd, ctx.abortSignal);
    }
    if (!input.value) return bad(`${input.action} requires value.`);
    const wingetArgs = input.action === 'software_search' ? ['search', input.value, '--accept-source-agreements']
      : input.action === 'software_install' ? ['install', '--id', input.value, '--exact', '--accept-package-agreements', '--accept-source-agreements']
        : input.action === 'software_uninstall' ? ['uninstall', '--id', input.value, '--exact']
          : input.action === 'software_upgrade' ? ['upgrade', '--id', input.value, '--exact', '--accept-package-agreements', '--accept-source-agreements'] : [];
    return wingetArgs.length ? run('winget.exe', wingetArgs, ctx.cwd, ctx.abortSignal) : bad(`Unknown System action: ${input.action}`);
  },
};

function json(value: unknown): ToolResult { return { content: JSON.stringify(value, null, 2) }; }
function bad(content: string): ToolResult { return { content, is_error: true }; }
async function run(file: string, args: string[], cwd: string, signal: AbortSignal): Promise<ToolResult> {
  const result = await spawnWithTimeout({ command: file, args, cwd, signal, timeoutMs: 120_000, windowsHide: true });
  if (result.timedOut) return bad(`${file} timed out after 120 seconds and was cancelled.`);
  const output = `${result.stdout}${result.stderr}`.slice(-40_000);
  return { content: output || `Completed with exit code ${result.exitCode}.`, is_error: result.exitCode !== 0 };
}
