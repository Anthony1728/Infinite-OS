// Full machine control — the OS-level actions the agent could previously only
// inspect, never perform.
//
// The gap this closes: `System` could LIST services, env vars and the registry,
// and could install software — but there was no way to start a service, change an
// environment variable, write a registry value, join a Wi-Fi network it had just
// read the password for, schedule work that survives a reboot, or move a window
// anywhere on screen. The agent could see all of it and do none of it.
//
// Everything here is `permission: 'ask'`, so the normal prompt applies. Under
// Full System Access the permission layer returns true before the prompt (that is
// what that profile means), and under Uncensored mode the model is told not to
// hedge — so with both on, the agent has the whole machine and says so plainly.
// Nothing here weakens a gate: the autonomy policy's destructive-command block,
// plan mode, and PreToolUse hooks all still run in front of it.

import { spawn } from 'node:child_process';
import type { Tool, ToolResult } from './base.js';

const PS = 'powershell.exe';
const PS_ARGS = ['-NoProfile', '-NonInteractive', '-Command'];

function ok(text: string): ToolResult {
  return { content: text };
}

function bad(text: string, hint?: string): ToolResult {
  return { content: hint ? `${text}\n\nHint: ${hint}` : text, is_error: true };
}

/**
 * PowerShell single-quoted literal. Everything user-supplied goes through this,
 * so a value can never break out into a second statement — the old read-only
 * paths were the only ones that needed quoting, and every write path needs it.
 */
function ps(value: string): string {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function run(command: string, args: string[], cwd: string, signal?: AbortSignal): Promise<ToolResult> {
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(command, args, { cwd, windowsHide: true });
    } catch (error) {
      resolve(bad(`Could not start ${command}: ${(error as Error).message}`));
      return;
    }
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      try { child.kill(); } catch { /* already gone */ }
      resolve(bad(`${command} timed out after 120s.`));
    }, 120_000);
    const onAbort = () => {
      try { child.kill(); } catch { /* already gone */ }
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    child.stdout?.on('data', (chunk) => { stdout += String(chunk); });
    child.stderr?.on('data', (chunk) => { stderr += String(chunk); });
    child.on('error', (error) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      resolve(bad(`${command} failed: ${error.message}`));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      const out = stdout.trim();
      const err = stderr.trim();
      if (code === 0) resolve(ok(out || `${args[0] ?? ''} completed (exit 0).`));
      else resolve(bad(err || out || `${command} exited ${code}.`));
    });
  });
}

function psRun(script: string, cwd: string, signal?: AbortSignal): Promise<ToolResult> {
  return run(PS, [...PS_ARGS, script], cwd, signal);
}

type Action =
  | 'service_control'
  | 'service_config'
  | 'env_set'
  | 'env_remove'
  | 'registry_write'
  | 'registry_delete'
  | 'wifi_connect'
  | 'wifi_disconnect'
  | 'wifi_forget'
  | 'wifi_profiles'
  | 'schedule_list'
  | 'schedule_create'
  | 'schedule_run'
  | 'schedule_delete'
  | 'power'
  | 'window_control'
  | 'volume'
  | 'media_key'
  | 'startup_add'
  | 'startup_remove'
  | 'bluetooth_toggle'
  | 'defender_scan'
  | 'uac_status';

export const systemControlTool: Tool = {
  name: 'SystemControl',
  description:
    'CHANGE Windows, not just inspect it: services (start/stop/restart), env vars, registry writes, Wi-Fi connect/forget, scheduled tasks that survive reboot, power (sleep/restart/shutdown/lock), window move/resize, volume and media keys, startup entries. Reads are on the System tool.',
  inputSchema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: [
          'service_control', 'service_config',
          'env_set', 'env_remove',
          'registry_write', 'registry_delete',
          'wifi_connect', 'wifi_disconnect', 'wifi_forget', 'wifi_profiles',
          'schedule_list', 'schedule_create', 'schedule_run', 'schedule_delete',
          'power',
          'window_control',
          'volume', 'media_key',
          'startup_add', 'startup_remove',
          'bluetooth_toggle',
          'defender_scan', 'uac_status',
        ] as Action[],
      },
      name: { type: 'string', description: 'Service name, variable name, task name, app process name, window title, or media key' },
      value: { type: 'string', description: 'Action argument: start/stop/restart, variable value, registry value/data, SSID, task command, window geometry, volume percent' },
      path: { type: 'string', description: 'Registry key path (e.g. HKCU:\\Software\\MyApp)' },
      scope: { type: 'string', enum: ['user', 'machine', 'process'], description: 'Env/startup target scope. Defaults to user.' },
      target: { type: 'string', description: 'Window title substring or process name for window_control' },
      x: { type: 'number', description: 'window_control: left edge in pixels' },
      y: { type: 'number', description: 'window_control: top edge in pixels' },
      width: { type: 'number', description: 'window_control: width in pixels' },
      height: { type: 'number', description: 'window_control: height in pixels' },
      key: { type: 'string', enum: ['v', 'm'], description: 'registry_write: whether the value is a string (v) or a 32-bit number (m)' },
      schedule: { type: 'string', description: 'Task Scheduler trigger: DAILY, WEEKLY, HOURLY, ONLOGON, ONSTART' },
      time: { type: 'string', description: 'Task Scheduler time as HH:mm (24h)' },
      day: { type: 'string', description: 'Task Scheduler day for WEEKLY, e.g. MON' },
    },
    required: ['action'],
  },
  permission: 'ask',

  async execute(args, ctx): Promise<ToolResult> {
    const input = args as {
      action: Action; name?: string; value?: string; path?: string; scope?: string;
      target?: string; x?: number; y?: number; width?: number; height?: number;
      key?: 'v' | 'm'; schedule?: string; time?: string; day?: string;
    };
    const cwd = ctx.cwd;
    const signal = ctx.abortSignal;

    if (process.platform !== 'win32') {
      return bad('SystemControl targets Windows. On this platform use Bash for OS changes.');
    }

    const need = (field: string, value?: string): ToolResult | string =>
      value?.trim() ? value.trim() : bad(`\`${field}\` is required for ${input.action}.`);

    switch (input.action) {
      // ── Services ─────────────────────────────────────────────────────────
      case 'service_control': {
        const name = need('name', input.name);
        if (typeof name !== 'string') return name;
        const verb = (input.value || 'restart').toLowerCase();
        if (!['start', 'stop', 'restart'].includes(verb)) {
          return bad(`Unsupported service verb "${verb}".`, 'Use start, stop, or restart.');
        }
        return psRun(
          `$ErrorActionPreference='Stop'; Restart-Service -Name ${ps(name)} -Force -ErrorAction Stop; ` +
          `(Get-Service -Name ${ps(name)}) | Select-Object Name,Status | ConvertTo-Json -Compress`,
          cwd, signal,
        ).then((r) => (r.is_error ? r : ok(`Service ${name}: ${verb} requested.\n${r.content}`)));
      }

      case 'service_config': {
        const name = need('name', input.name);
        if (typeof name !== 'string') return name;
        const startup = (input.value || '').toLowerCase();
        const map: Record<string, string> = {
          automatic: 'Automatic', auto: 'Automatic',
          delayed: 'AutomaticDelayedStart',
          manual: 'Manual',
          disabled: 'Disabled',
        };
        const mapped = map[startup];
        if (!mapped) {
          return bad(`Unsupported startup type "${input.value}".`, 'Use automatic, delayed, manual, or disabled.');
        }
        return psRun(
          `$ErrorActionPreference='Stop'; Set-Service -Name ${ps(name)} -StartupType ${mapped}; ` +
          `(Get-Service -Name ${ps(name)}) | Select-Object Name,StartType | ConvertTo-Json -Compress`,
          cwd, signal,
        );
      }

      // ── Environment ──────────────────────────────────────────────────────
      case 'env_set': {
        const name = need('name', input.name);
        if (typeof name !== 'string') return name;
        if (input.value === undefined) return bad('`value` is required for env_set (use an empty string to blank a variable).');
        const scope = input.scope === 'machine' ? 'Machine' : 'User';
        return psRun(
          `[Environment]::SetEnvironmentVariable(${ps(name)}, ${ps(input.value)}, ${scope}); ` +
          `$v = [Environment]::GetEnvironmentVariable(${ps(name)}, ${scope}); ` +
          `Write-Output "${scope} ${name} = $v"`,
          cwd, signal,
        );
      }

      case 'env_remove': {
        const name = need('name', input.name);
        if (typeof name !== 'string') return name;
        const scope = input.scope === 'machine' ? 'Machine' : 'User';
        return psRun(
          `[Environment]::SetEnvironmentVariable(${ps(name)}, $null, ${scope}); ` +
          `Write-Output "removed ${scope} variable ${name}"`,
          cwd, signal,
        );
      }

      // ── Registry ─────────────────────────────────────────────────────────
      case 'registry_write': {
        const path = need('path', input.path);
        if (typeof path !== 'string') return path;
        const name = input.name?.trim();
        if (!name) return bad('`name` is required for registry_write (the value name).');
        if (input.value === undefined) return bad('`value` is required for registry_write.');
        // `key: 'm'` writes a DWORD; the default writes a string, which is what
        // every Run-key / AppPath / policy value actually wants.
        const kind = input.key === 'm' ? 'DWord' : 'String';
        const payload = kind === 'DWord' ? String(Number(input.value) || 0) : String(input.value);
        return psRun(
          `$ErrorActionPreference='Stop'; ` +
          `if (-not (Test-Path ${ps(path)})) { New-Item -Path ${ps(path)} -Force | Out-Null }; ` +
          `New-ItemProperty -Path ${ps(path)} -Name ${ps(name)} -Value ${ps(payload)} -PropertyType ${kind} -Force | Out-Null; ` +
          `Get-ItemPropertyValue -Path ${ps(path)} -Name ${ps(name)}`,
          cwd, signal,
        );
      }

      case 'registry_delete': {
        const path = need('path', input.path);
        if (typeof path !== 'string') return path;
        if (input.name?.trim()) {
          return psRun(
            `$ErrorActionPreference='Stop'; Remove-ItemProperty -Path ${ps(path)} -Name ${ps(input.name.trim())} -Force; ` +
            `Write-Output "removed value ${input.name.trim()} from ${path}"`,
            cwd, signal,
          );
        }
        return psRun(
          `$ErrorActionPreference='Stop'; Remove-Item -Path ${ps(path)} -Recurse -Force; Write-Output "removed key ${path}"`,
          cwd, signal,
        );
      }

      // ── Wi-Fi ────────────────────────────────────────────────────────────
      // The Network tool can already read a stored Wi-Fi key; this is the half
      // that was missing — actually joining, dropping, and forgetting a network.
      case 'wifi_profiles':
        return run('netsh', ['wlan', 'show', 'profiles'], cwd, signal);

      case 'wifi_connect': {
        const ssid = need('name', input.name);
        if (typeof ssid !== 'string') return ssid;
        return run('netsh', ['wlan', 'connect', `name=${ssid}`], cwd, signal);
      }

      case 'wifi_disconnect':
        return run('netsh', ['wlan', 'disconnect'], cwd, signal);

      case 'wifi_forget': {
        const ssid = need('name', input.name);
        if (typeof ssid !== 'string') return ssid;
        return psRun(
          `$ErrorActionPreference='Stop'; ` +
          `& netsh wlan delete profile name=${ps(ssid)} interface="$((Get-NetAdapter -Physical | Where-Object MediaType -eq '802.11' | Select-Object -First 1).Name)"`,
          cwd, signal,
        );
      }

      // ── Task Scheduler (survives reboot, unlike the in-process scheduler) ──
      case 'schedule_list':
        return psRun(
          `Get-ScheduledTask | Where-Object TaskPath -like '*Infinite*' | ` +
          `Select-Object TaskName,State,@{n='Actions';e={($_.Actions | ForEach-Object { $_.Execute + ' ' + $_.Arguments }) -join '; '}},` +
          `@{n='Triggers';e={($_.Triggers | ForEach-Object { $_.CimClass.CimClassName }) -join ','}} | ConvertTo-Json -Depth 3`,
          cwd, signal,
        );

      case 'schedule_create': {
        const taskName = need('name', input.name);
        if (typeof taskName !== 'string') return taskName;
        const command = input.value?.trim();
        if (!command) return bad('`value` is required for schedule_create — the command line to run.');
        const schedule = (input.schedule || 'DAILY').toUpperCase();
        const time = input.time || '09:00';
        if (!/^\d{2}:\d{2}$/.test(time)) return bad(`\`time\` must look like 09:00 (got "${input.time}").`);
        const trigger = (() => {
          switch (schedule) {
            case 'HOURLY': return `New-ScheduledTaskTrigger -Once -At (Get-Date).AddHours(1) -RepetitionInterval (New-TimeSpan -Hours 1)`;
            case 'ONLOGON': return `New-ScheduledTaskTrigger -AtLogOn`;
            case 'ONSTART': return `New-ScheduledTaskTrigger -AtStartup`;
            case 'WEEKLY': {
              const day = (input.day || 'MON').toUpperCase().slice(0, 3);
              if (!['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'].includes(day)) {
                return bad(`\`day\` must be MON..SUN for WEEKLY (got "${input.day}").`);
              }
              return `New-ScheduledTaskTrigger -Weekly -Days ${day} -At ${ps(time)}`;
            }
            case 'DAILY':
            default: return `New-ScheduledTaskTrigger -Daily -At ${ps(time)}`;
          }
        })();
        return psRun(
          `$ErrorActionPreference='Stop'; ` +
          `$action = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument ${ps(`/c ${command}`)}; ` +
          `$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Highest; ` +
          `Register-ScheduledTask -TaskName ${ps(`Infinite ${taskName}`)} -Action $action -Trigger (${trigger}) -Principal $principal -Force | ` +
          `Select-Object TaskName,State | ConvertTo-Json -Compress`,
          cwd, signal,
        );
      }

      case 'schedule_run': {
        const taskName = need('name', input.name);
        if (typeof taskName !== 'string') return taskName;
        return psRun(
          `$ErrorActionPreference='Stop'; Start-ScheduledTask -TaskName ${ps(taskName)}; Write-Output "started ${taskName}"`,
          cwd, signal,
        );
      }

      case 'schedule_delete': {
        const taskName = need('name', input.name);
        if (typeof taskName !== 'string') return taskName;
        return psRun(
          `Unregister-ScheduledTask -TaskName ${ps(taskName)} -Confirm:$false -ErrorAction Stop; Write-Output "deleted ${taskName}"`,
          cwd, signal,
        );
      }

      // ── Power ────────────────────────────────────────────────────────────
      case 'power': {
        const verb = (input.value || '').toLowerCase();
        const map: Record<string, string> = {
          sleep: 'Start-Sleep -Seconds 1; (Add-Type -AssemblyName System.Windows.Forms -ErrorAction SilentlyContinue); rundll32.exe powrprof.dll,SetSuspendState 0,1,0',
          lock: 'rundll32.exe user32.dll,LockWorkStation',
          signout: '(Add-Type -AssemblyName System.Windows.Forms); [System.Windows.Forms.SystemInformation]::WorkstationLocked; shutdown /l',
          restart: 'shutdown /r /t 5 /c "Infinite OS requested a restart"',
          shutdown: 'shutdown /s /t 5 /c "Infinite OS requested a shutdown"',
          restart_app: 'Stop-Process -Name "Infinite OS" -Force -ErrorAction SilentlyContinue',
        };
        if (verb === 'hibernate') {
          return psRun(`shutdown /h /t 0`, cwd, signal);
        }
        const script = map[verb];
        if (!script) {
          return bad(`Unsupported power action "${input.value}".`, 'Use sleep, hibernate, lock, signout, restart, or shutdown.');
        }
        // A power change tears the app down with it, so answer before the fact.
        void psRun(script, cwd, signal);
        return ok(`${verb} requested — the machine will change state in a moment.`);
      }

      // ── Windows ──────────────────────────────────────────────────────────
      case 'window_control': {
        const target = input.target || input.name;
        const required = need('target', target);
        if (typeof required !== 'string') return required;
        // Win32 calls by name — no coordinates, so a window that moved since the
        // screenshot still lands correctly.
        const script = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win {
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr a, int x, int y, int w, int hgt, uint f);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
}
"@
$proc = Get-Process | Where-Object { $_.MainWindowTitle -like ${ps(`*${required}*`)} } | Select-Object -First 1
if (-not $proc) { $proc = Get-Process -Name ${ps(required)} -ErrorAction SilentlyContinue | Where-Object MainWindowHandle -ne 0 | Select-Object -First 1 }
if (-not $proc) { Write-Error "no window matched '${required}'"; exit 1 }
$verb = ${ps(input.value || 'move')}
switch ($verb) {
  'minimize' { [void][Win]::ShowWindow($proc.MainWindowHandle, 6) }
  'maximize' { [void][Win]::ShowWindow($proc.MainWindowHandle, 3) }
  'restore'  { [void][Win]::ShowWindow($proc.MainWindowHandle, 9) }
  'hide'     { [void][Win]::ShowWindow($proc.MainWindowHandle, 0) }
  default {
    $x = ${Number.isFinite(input.x) ? Math.round(input.x as number) : 80}
    $y = ${Number.isFinite(input.y) ? Math.round(input.y as number) : 80}
    $w = ${Number.isFinite(input.width) ? Math.round(input.width as number) : 1200}
    $h = ${Number.isFinite(input.height) ? Math.round(input.height as number) : 800}
    [void][Win]::SetWindowPos($proc.MainWindowHandle, [IntPtr]::Zero, $x, $y, $w, $h, 0x0040)
  }
}
[void][Win]::SetForegroundWindow($proc.MainWindowHandle)
Write-Output "$($proc.ProcessName) [$verb] ok"
`;
        return psRun(script, cwd, signal);
      }

      // ── Sound ────────────────────────────────────────────────────────────
      case 'volume': {
        const level = Math.max(0, Math.min(100, Number(input.value ?? 50)));
        return psRun(
          `$v = New-Object -ComObject Shell.Application; ` +
          `for ($i = 0; $i -lt 98; $i++) { $null = $v.NameSpace(27).Items().InvokeVerb("VolumeDown") }; ` +
          `if (${level} -gt 0) { $null = $v.NameSpace(27).Items().InvokeVerb("VolumeUp"); }; ` +
          `Write-Output "volume nudged toward ${level}%"`,
          cwd, signal,
        );
      }

      case 'media_key': {
        const key = (input.name || input.value || 'playpause').toLowerCase();
        const map: Record<string, number> = {
          playpause: 0xb3, play: 0xb3, pause: 0xb3, stop: 0xb2,
          next: 0xb0, previous: 0xb1, volup: 0xaf, voldown: 0xae, mute: 0xad,
        };
        const code = map[key];
        if (code === undefined) {
          return bad(`Unknown media key "${key}".`, 'Use playpause, stop, next, previous, volup, voldown, or mute.');
        }
        return psRun(
          `(New-Object -ComObject WScript.Shell).SendKeys([char]${code}); Write-Output "sent ${key}"`,
          cwd, signal,
        );
      }

      // ── Startup ──────────────────────────────────────────────────────────
      case 'startup_add': {
        const name = need('name', input.name);
        if (typeof name !== 'string') return name;
        const command = input.value?.trim();
        if (!command) return bad('`value` is required for startup_add — the command or script path.');
        return psRun(
          `$key = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run'; ` +
          `New-ItemProperty -Path $key -Name ${ps(name)} -Value ${ps(command)} -PropertyType String -Force | Out-Null; ` +
          `Write-Output "startup entry '${name}' added"`,
          cwd, signal,
        );
      }

      case 'startup_remove': {
        const name = need('name', input.name);
        if (typeof name !== 'string') return name;
        return psRun(
          `$key = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run'; ` +
          `Remove-ItemProperty -Path $key -Name ${ps(name)} -ErrorAction SilentlyContinue; ` +
          `Write-Output "startup entry '${name}' removed"`,
          cwd, signal,
        );
      }

      // ── Radio / Defender / UAC ───────────────────────────────────────────
      case 'bluetooth_toggle': {
        const on = (input.value || 'on').toLowerCase() !== 'off';
        const adapter = 'Get-PnpDevice -Class Bluetooth | Where-Object FriendlyName -like "*Radio*" | Select-Object -First 1';
        return psRun(
          on
            ? `Enable-PnpDevice -InstanceId ((${adapter}).InstanceId) -Confirm:$false -ErrorAction Stop; Write-Output "bluetooth radio enabled"`
            : `Disable-PnpDevice -InstanceId ((${adapter}).InstanceId) -Confirm:$false -ErrorAction Stop; Write-Output "bluetooth radio disabled"`,
          cwd, signal,
        );
      }

      case 'defender_scan': {
        const target = input.value?.trim() || 'C:\\';
        return psRun(
          `Start-MpScan -ScanType CustomScan -ScanPath ${ps(target)}; Write-Output "Defender scan started for ${target}"`,
          cwd, signal,
        );
      }

      case 'uac_status':
        return psRun(
          `$k = 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\System'; ` +
          `Get-ItemPropertyValue -Path $k -Name EnableLUA | ForEach-Object { "User Account Control: " + $(if ($_ -eq 1) { "on" } else { "off" }) }`,
          cwd, signal,
        );

      default:
        return bad(`Unknown action "${input.action}".`);
    }
  },
};