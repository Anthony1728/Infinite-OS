import { cpus, freemem, hostname, platform, totalmem, uptime } from 'node:os';
import type { Tool, ToolResult } from './base.js';
import { spawnWithTimeout } from './spawn-timeout.js';

export const systemTool: Tool = {
  name: 'System',
  description: 'Inspect and manage Windows: CPU/RAM/uptime, battery, GPU, monitors, printers, USB, Wi-Fi, Bluetooth, processes, installed software, disk health, startup entries, services, env vars, registry, Windows settings, and winget software search/install/uninstall/upgrade. Use this instead of raw Bash for structured Windows diagnostics.',
  inputSchema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['status', 'battery', 'gpu', 'monitors', 'printers', 'usb', 'wifi', 'bluetooth', 'processes', 'installed_apps', 'disk_health', 'startup', 'services', 'env', 'registry', 'open_settings', 'software_search', 'software_install', 'software_uninstall', 'software_upgrade'] },
      value: { type: 'string', description: 'Settings URI, software query, package ID, registry path/value, env filter, or service/startup filter' },
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
      disk_health: "Get-Volume | Select-Object DriveLetter,FileSystemLabel,Size,SizeRemaining,HealthStatus | ConvertTo-Json -Compress; Write-Host '---PhysicalDisk---'; Get-PhysicalDisk | Select-Object FriendlyName,HealthStatus,MediaType,Size | ConvertTo-Json -Compress; Write-Host '---Smart---'; try { Get-StorageReliabilityCounter -PhysicalDisk (Get-PhysicalDisk)[0] | Select-Object Temperature,Wear,ReadErrorsTotal,WriteErrorsTotal | ConvertTo-Json -Compress } catch { Write-Host 'Smart unavailable' }",
      startup: "Get-CimInstance Win32_StartupCommand | Select-Object Name,Command,Location,User | ConvertTo-Json -Compress; Write-Host '---RunKeys---'; Get-ItemProperty HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run -ErrorAction SilentlyContinue | ConvertTo-Json -Compress",
      services: "Get-Service | Select-Object -First 100 Name,DisplayName,Status,StartType | ConvertTo-Json -Compress",
      env: "Get-ChildItem Env: | Sort-Object Name | Select-Object Name,Value | ConvertTo-Json -Compress",
    };
     if (commands[input.action]) {
      // For filtered queries, append Where-Object clause safely via value
      let cmd = commands[input.action];
      if (input.value && ['startup','services','processes','env'].includes(input.action)) {
        // Sanitize: only allow alphanumeric, hyphens, underscores, spaces, and dots
        const safe = input.value.replace(/[^a-zA-Z0-9\s\-_.]/g, '');
        if (input.action === 'env') cmd = `Get-ChildItem Env: | Where-Object Name -like '*${safe}*' | Select-Object Name,Value | ConvertTo-Json -Compress`;
        if (input.action === 'services') cmd = `Get-Service | Where-Object { $_.Name -like '*${safe}*' -or $_.DisplayName -like '*${safe}*' } | Select-Object Name,DisplayName,Status,StartType | ConvertTo-Json -Compress`;
        if (input.action === 'startup') cmd = `Get-CimInstance Win32_StartupCommand | Where-Object Name -like '*${safe}*' | Select-Object Name,Command,Location,User | ConvertTo-Json -Compress`;
        if (input.action === 'processes') cmd = `Get-Process | Where-Object ProcessName -like '*${safe}*' | Select-Object ProcessName,Id,CPU,WorkingSet64,MainWindowTitle | ConvertTo-Json -Compress`;
      }
      return run('powershell.exe', ['-NoProfile', '-Command', cmd], ctx.cwd, ctx.abortSignal);
    }
    if (input.action === 'registry') {
      if (!input.value) return bad('registry requires value as registry path, e.g. HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run or HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion');
      const safePath = input.value.replace(/"/g, '`"');
      return run('powershell.exe', ['-NoProfile', '-Command', `Get-ItemProperty -Path "${safePath}" -ErrorAction Stop | ConvertTo-Json -Depth 4 -Compress`], ctx.cwd, ctx.abortSignal);
    }
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
