import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { test, expect, _electron as electron } from '@playwright/test';

const exe = resolve('dist/win-unpacked/Infinite OS.exe');

function runPowerShell(script: string): string {
  return execFileSync('powershell.exe', ['-NoProfile', '-Command', script], {
    encoding: 'utf8',
    timeout: 30_000,
  }).trim();
}

/**
 * Reload the extension in the validated Profile 1 window via the Chrome
 * extensions page's accessibility tree. This wakes the MV3 service worker and
 * loads the files currently on disk. Returns the Profile 1 window handle so
 * later steps touch only that window, never the user's Profile 5.
 */
function reloadProfile1Extension(): string {
  const script = `
$ErrorActionPreference='Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$root=[System.Windows.Automation.AutomationElement]::RootElement
$cond=New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty,'Extensions - Google Chrome')
$win=$root.FindFirst([System.Windows.Automation.TreeScope]::Children,$cond)
if (-not $win) { throw 'Profile 1 extensions window not found' }
$btnCond=New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::AutomationIdProperty,'dev-reload-button')
$btn=$win.FindFirst([System.Windows.Automation.TreeScope]::Descendants,$btnCond)
if (-not $btn) { throw 'Extension reload button not found' }
$pattern=$btn.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
$pattern.Invoke()
Write-Output $win.Current.NativeWindowHandle
`;
  const lines = runPowerShell(script).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const handle = lines[lines.length - 1] ?? '';
  if (!/^\d+$/.test(handle) || handle === '0') throw new Error(`No Profile 1 window handle (${handle})`);
  return handle;
}

function focusWindow(handle: string): void {
  const command = [
    "$ErrorActionPreference='Stop'",
    `Add-Type -Name Win32ShowWindow -Namespace Win32 -MemberDefinition '[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow); [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);'`,
    `[Win32.Win32ShowWindow]::ShowWindow([IntPtr]${handle}, 9) | Out-Null`,
    `[Win32.Win32ShowWindow]::SetForegroundWindow([IntPtr]${handle}) | Out-Null`,
  ].join('; ');
  runPowerShell(command);
}

test.describe('Live real-Chrome bridge screenshots', () => {
  test.skip(!process.env.INFINITE_LIVE, 'Set INFINITE_LIVE=1 to drive the validated Chrome profile.');
  test.skip(!existsSync(exe), 'Build dist/win-unpacked before running.');

  test('captures the real Profile 1 tab through both the visible-tab and debugger paths', async () => {
    test.setTimeout(240_000);
    let profile1Handle = '';
    let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
    let bridgeExec:
      | ((command: string, params?: Record<string, unknown>) => Promise<{ ok: boolean; data?: Record<string, unknown>; error?: string } | null>)
      | undefined;
    let createdTabId: number | undefined;
    try {
      app = await electron.launch({ executablePath: exe, timeout: 120_000 });
      const page = await app.firstWindow({ timeout: 120_000 });
      await page.waitForFunction(
        () => Boolean(document.querySelector('[data-nav="studio"]')),
        undefined,
        { timeout: 120_000 },
      );

      profile1Handle = reloadProfile1Extension();

      const status = async () =>
        page.evaluate(async () => {
          const api = (window as unknown as { api?: { bridgeStatus?: () => Promise<unknown> } }).api;
          return api?.bridgeStatus ? await api.bridgeStatus() : null;
        });

      await expect
        .poll(async () => {
          const value = (await status()) as { status?: { connected?: boolean } } | null;
          return value?.status?.connected === true;
        }, { timeout: 90_000, message: 'the installed Profile 1 extension did not reconnect' })
        .toBe(true);

      bridgeExec = async (command: string, params: Record<string, unknown> = {}) =>
        (await page.evaluate(
          async ({ command: cmd, params: args }) => {
            const api = (window as unknown as { api?: { bridgeExec?: (v: { command: string; params?: Record<string, unknown> }) => Promise<unknown> } }).api;
            return api?.bridgeExec ? await api.bridgeExec({ command: cmd, params: args }) : null;
          },
          { command, params },
        )) as { ok: boolean; data?: Record<string, unknown>; error?: string } | null;

      // Make Profile 1 the last-focused Chrome window, then open a normal
      // http page there. No other Chrome window (especially Profile 5) is
      // touched by the screenshot commands.
      focusWindow(profile1Handle);
      await page.waitForTimeout(700);
      const newTab = await bridgeExec('new_tab', { url: 'https://example.com/' });
      expect(newTab?.ok, newTab?.error).toBe(true);
      createdTabId = typeof newTab?.data?.id === 'number' ? newTab.data.id : undefined;
      await page.waitForTimeout(1_500);

      const visible = await bridgeExec('screenshot');
      expect(visible?.ok, visible?.error).toBe(true);
      const visibleBase64 = String(visible?.data?.base64 ?? '');
      console.log('REAL_CHROME_SCREENSHOT_SOURCE', visible?.data?.source ?? 'captureVisibleTab');
      console.log('REAL_CHROME_SCREENSHOT_BYTES', Math.floor((visibleBase64.length * 3) / 4));
      expect(visibleBase64.length).toBeGreaterThan(1_000);

      // This is the same CDP path the extension uses automatically when
      // captureVisibleTab fails (occluded window, GPU readback failure).
      const debugShot = await bridgeExec('screenshot', { forceDebugger: true });
      expect(debugShot?.ok, debugShot?.error).toBe(true);
      const debugBase64 = String(debugShot?.data?.base64 ?? '');
      console.log('REAL_CHROME_DEBUGGER_SOURCE', debugShot?.data?.source ?? 'missing');
      console.log('REAL_CHROME_DEBUGGER_BYTES', Math.floor((debugBase64.length * 3) / 4));
      expect(debugBase64.length).toBeGreaterThan(1_000);
      expect(debugShot?.data?.source, 'The forced CDP screenshot must use the debugger path').toBe('debugger');
    } finally {
      try {
        if (bridgeExec && createdTabId != null) await bridgeExec('close_tab', { tabId: createdTabId });
        if (bridgeExec) await bridgeExec('back');
      } catch {
        /* best effort cleanup */
      }
      await app?.close().catch(() => undefined);
    }
  });
});
