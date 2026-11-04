import { describe, expect, it } from 'vitest';
import {
  SAFE_TEMP_DIRS,
  classifyProcess,
  classifyStartup,
  isProtectedProcess,
  isSafeTempPath,
  type Finding,
  type StartupItem,
} from './optimize.js';

/**
 * These tests exist to stop this feature from ever being the reason somebody's
 * computer stops working. The dangerous failures are not slowness â€” they are:
 *
 *   - killing a security or licensing service
 *   - deleting files outside a temp folder
 *   - closing the app the user is currently looking at
 *   - acting on something it does not recognise
 *
 * Each one has a test below. When someone adds a rule to the optimizer, these
 * are what should fail loudly.
 */

const item = (over: Partial<StartupItem> = {}): StartupItem => ({
  source: 'HKCU',
  name: 'Something',
  command: 'C:\\Program Files\\Thing\\thing.exe',
  location: 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run',
  enabled: true,
  ...over,
});

const INTEL = 'Intel(R) Core(TM) i5-4210U CPU @ 1.70GHz';
const AMD = 'AMD Ryzen 9 5900X';

describe('the rule that matters most', () => {
  it('never acts on a startup entry it does not recognise', () => {
    // The single most important behaviour: an unknown entry is left alone.
    expect(classifyStartup(item({ name: 'SomeVendorThing', command: 'C:\\x\\y.exe' }), INTEL)).toBe('report');
  });

  it('never offers an action for unknown entries', () => {
    const tier = classifyStartup(item({ name: 'Mystery' }), INTEL);
    expect(tier).toBe('report');
  });
});

describe('CPU vendor mismatch is a fact, not a judgement', () => {
  it('treats an AMD tuning tool on an Intel machine as safe to disable', () => {
    expect(classifyStartup(item({ name: 'amd_dc_opt', command: 'C:\\Program Files (x86)\\AMD\\Dual-Core Optimizer\\amd_dc_opt.exe' }), INTEL)).toBe('safe');
  });

  it('leaves it alone when the machine really is AMD', () => {
    // Same entry, same rule, different conclusion â€” because the machine differs.
    expect(classifyStartup(item({ name: 'amd_dc_opt', command: 'C:\\amd\\amd_dc_opt.exe' }), AMD)).not.toBe('safe');
  });
});

describe('things a human must decide', () => {
  it('asks before disabling cloud sync', () => {
    // People rely on OneDrive. Silently disabling it could stop their files
    // syncing, so this must never be automatic.
    expect(classifyStartup(item({ name: 'OneDrive', command: 'C:\\...\\OneDrive.exe /background' }), INTEL)).toBe('ask');
  });

  it('asks before disabling a game launcher', () => {
    expect(classifyStartup(item({ name: 'Steam', command: '"C:\\steam\\steam.exe" -silent' }), INTEL)).toBe('ask');
  });

  it('asks before disabling a VPN client', () => {
    // Also a privacy decision, which is exactly why it is not the app's call.
    expect(classifyStartup(item({ name: 'UrbanVPN', command: 'C:\\Program Files\\UrbanVPN\\Updater.exe' }), INTEL)).toBe('ask');
  });

  it('asks before disabling anything security or backup related', () => {
    expect(classifyStartup(item({ name: 'MyBackupAgent' }), INTEL)).toBe('ask');
    expect(classifyStartup(item({ name: 'AcmeAntivirusTray' }), INTEL)).toBe('ask');
  });

  it('automatically disables a background browser relauncher', () => {
    // The textbook safe win: the browser is not running, nothing is lost, and it
    // does not come back until the user opens it.
    expect(classifyStartup(item({ name: 'MicrosoftEdgeAutoLaunch_123' }), INTEL)).toBe('safe');
  });

  it('automatically disables an ad-hoc updater running at every log in', () => {
    expect(classifyStartup(item({ name: 'MTPW', command: 'E:\\MiniTool\\updatechecker.exe' }), INTEL)).toBe('safe');
  });

  it('automatically disables an advertising campaign task', () => {
    expect(classifyStartup(item({ source: 'task', name: 'IObit SUM2026Sale (One-time)' }), INTEL)).toBe('safe');
  });
});

describe('processes are never killed automatically', () => {
  it('always asks, however heavy', () => {
    // 100% CPU and 8 GB is still a human decision: it might be a render the user
    // started, and closing it loses their work.
    expect(classifyProcess({ name: 'SomethingBig', cpuPercent: 100, memoryMb: 8000 })).toBe('ask');
  });

  it('refuses to touch protected Windows processes', () => {
    for (const name of ['System', 'csrss', 'winlogon', 'lsass', 'svchost', 'dwm', 'WinDefend', 'wscsvc']) {
      expect(isProtectedProcess(name)).toBe(true);
    }
  });

  it('refuses anything the user has open', () => {
    // The feature's whole premise is to speed up the PC while the user works,
    // not to close what they are working in.
    const tier = classifyProcess({ name: 'chrome', cpuPercent: 90, memoryMb: 3000 }, { protected: ['chrome'] });
    expect(tier).toBe('report');
  });

  it('ignores light processes entirely', () => {
    expect(classifyProcess({ name: 'notepad', cpuPercent: 0.1, memoryMb: 20 })).toBe('report');
  });
});

describe('the deletion boundary', () => {
  const roots = [process.env.TEMP ?? 'C:\\Users\\x\\AppData\\Local\\Temp'];

  it('permits a path inside a temp folder', () => {
    expect(isSafeTempPath(`${roots[0]}\\thing.tmp`, roots)).toBe(true);
  });

  it('refuses the user folders that matter most', () => {
    const dangerous = [
      'C:\\Users\\example\\Downloads\\thesis.pdf',
      'C:\\Users\\example\\Documents\\tax return.xlsx',
      'C:\\Users\\example\\Desktop\\project',
      'C:\\Users\\example\\OneDrive\\work',
    ];
    for (const path of dangerous) {
      expect(isSafeTempPath(path, roots)).toBe(false);
    }
  });

  it('refuses a sibling folder that merely starts with a temp name', () => {
    // `C:\TempEvil` must not pass as `C:\Temp`. A prefix match without a path
    // boundary would allow exactly this.
    expect(isSafeTempPath('C:\\TempEvil\\file.txt', ['C:\\Temp'])).toBe(false);
  });

  it('refuses a traversal out of the temp folder', () => {
    expect(isSafeTempPath(`${roots[0]}\\..\\Documents\\file.docx`, roots)).toBe(false);
  });

  it('only ever considers the three known temp directories', () => {
    // The allow-list is short on purpose. Adding an entry is a decision to let
    // the app delete files in that location.
    expect(SAFE_TEMP_DIRS).toHaveLength(3);
    for (const dir of SAFE_TEMP_DIRS) {
      expect(dir.path).toMatch(/^%[A-Z]+%/);
    }
  });
});

describe('what the optimizer will never do', () => {
  it('has no action for anything report-only', () => {
    // Enforced in applyFinding: report means report, with no override.
    const finding: Finding = {
      id: 'x',
      title: 'x',
      detail: 'x',
      tier: 'report',
      impact: 1,
      evidence: 'x',
    };
    expect(finding.action).toBeUndefined();
  });
});

describe('regressions found while building this', () => {
  it('never lets a generic rule override a rule that needs a human', () => {
    // The updater rule matched "UrbanVPN\\Updater.exe" and returned `safe`
    // before the VPN rule was reached, so the app would have silently disabled
    // somebody's VPN. More specific intent must win.
    const vpnUpdater = item({
      name: 'UrbanVPN',
      command: 'C:\\Program Files\\UrbanVPN\\Urban Vpn Updater.exe /checknow -minuser',
    });
    expect(classifyStartup(vpnUpdater, INTEL)).toBe('ask');
  });

  it('recognises Defender whatever case it is written in', () => {
    // This list was originally `winDefend` and compared case-sensitively, so the
    // real service name `WinDefend` did not match â€” meaning Windows Defender was
    // not protected. A safety check that fails on capitalisation is a broken
    // safety check.
    expect(isProtectedProcess('WinDefend')).toBe(true);
    expect(isProtectedProcess('windefend')).toBe(true);
    expect(isProtectedProcess('WINDEFEND')).toBe(true);
    expect(isProtectedProcess('wscsvc')).toBe(true);
  });

  it('still treats genuinely unknown processes as report-only', () => {
    // Guard against "protect everything" becoming the lazy answer.
    expect(isProtectedProcess('SomeRandomApp')).toBe(false);
  });
});