import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';

export interface NativeDictationEvent {
  type: 'ready' | 'result' | 'error' | 'ended';
  transcript?: string;
  confidence?: number;
  final?: boolean;
  language?: string;
  message?: string;
}

const RECOGNIZER_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
try {
  Add-Type -AssemblyName System.Speech
  $installed = [System.Speech.Recognition.SpeechRecognitionEngine]::InstalledRecognizers()
  if (-not $installed -or $installed.Count -eq 0) { throw 'No Windows speech recognition language is installed.' }
  $info = $installed | Where-Object { $_.Culture.Name -eq [System.Globalization.CultureInfo]::CurrentUICulture.Name } | Select-Object -First 1
  if (-not $info) { $info = $installed | Where-Object { $_.Culture.Name -like 'en-*' } | Select-Object -First 1 }
  if (-not $info) { $info = $installed | Select-Object -First 1 }
  $engine = [System.Speech.Recognition.SpeechRecognitionEngine]::new($info)
  $engine.LoadGrammar([System.Speech.Recognition.DictationGrammar]::new())
  $engine.SetInputToDefaultAudioDevice()
  # System.Speech raises its events on the engine's own thread, where a raw
  # scriptblock delegate is never dispatched by PowerShell: the callback
  # silently does nothing, an escaping exception bypasses this script's
  # try/catch, and the process dies with exit code 2 and no output ("Windows
  # dictation exited with code 2."). Registering the events hands each one
  # to PowerShell's own event pipeline instead, whose -Action runs where
  # Console output and try/catch work — the loop below keeps that pipeline
  # pumped. Stop detection moves off the main thread to a .NET watcher
  # (a blocking stdin read would starve that pump): 'stop' or EOF flips a
  # flag the loop drains on, then the recognizer shuts down cleanly.
  Add-Type -TypeDefinition @'
using System;
using System.Text;

public static class InfiniteStdinWatcher {
  public static volatile bool Stopped;

  public static void Start() {
    System.IO.Stream stdin = Console.OpenStandardInput();
    byte[] buf = new byte[1];
    StringBuilder sb = new StringBuilder();
    System.Action begin = null;
    begin = delegate {
      try {
        stdin.BeginRead(buf, 0, 1, delegate(IAsyncResult ar) {
          try {
            int n = stdin.EndRead(ar);
            if (n == 0) { Stopped = true; return; }
            char c = (char)buf[0];
            if (c == '\n') {
              string line = sb.ToString().Trim();
              sb.Length = 0;
              if (line == "stop") { Stopped = true; return; }
            } else {
              sb.Append(c);
            }
            begin();
          } catch {
            Stopped = true;
          }
        }, null);
      } catch {
        Stopped = true;
      }
    };
    begin();
  }
}
'@
  $null = Register-ObjectEvent -InputObject $engine -EventName SpeechHypothesized -SourceIdentifier 'inf.hyp' -Action {
    try {
      $ea = $args[$args.Count - 1]
      [Console]::Out.WriteLine((@{ type='result'; transcript=$ea.Result.Text; confidence=$ea.Result.Confidence; final=$false } | ConvertTo-Json -Compress))
    } catch {
      try { [Console]::Out.WriteLine((@{ type='error'; message=[string]$_.Exception.Message } | ConvertTo-Json -Compress)) } catch { }
    }
  }
  $null = Register-ObjectEvent -InputObject $engine -EventName SpeechRecognized -SourceIdentifier 'inf.rec' -Action {
    try {
      $ea = $args[$args.Count - 1]
      [Console]::Out.WriteLine((@{ type='result'; transcript=$ea.Result.Text; confidence=$ea.Result.Confidence; final=$true } | ConvertTo-Json -Compress))
    } catch {
      try { [Console]::Out.WriteLine((@{ type='error'; message=[string]$_.Exception.Message } | ConvertTo-Json -Compress)) } catch { }
    }
  }
  $null = Register-ObjectEvent -InputObject $engine -EventName SpeechRecognitionRejected -SourceIdentifier 'inf.rej' -Action {
    try {
      [Console]::Out.WriteLine((@{ type='error'; message='Speech was heard but could not be recognized clearly.' } | ConvertTo-Json -Compress))
    } catch { }
  }
  [InfiniteStdinWatcher]::Start()
  [Console]::Out.WriteLine((@{ type='ready'; language=$info.Culture.Name } | ConvertTo-Json -Compress))
  $engine.RecognizeAsync([System.Speech.Recognition.RecognizeMode]::Multiple)
  while (-not [InfiniteStdinWatcher]::Stopped) {
    while ($true) {
      $evt = Wait-Event -Timeout 0
      if ($null -eq $evt) { break }
      Remove-Event -EventIdentifier $evt.EventIdentifier -ErrorAction SilentlyContinue | Out-Null
    }
    Start-Sleep -Milliseconds 100
  }
  try {
    $engine.RecognizeAsyncCancel()
    $engine.RecognizeAsyncStop()
    $engine.Dispose()
  } catch { }
  # Let in-flight events drain, then tear the subscribers down before the
  # script ends: PowerShell's event dispatcher otherwise meets a queued
  # action during runspace shutdown and dies unhandled (exit 2) — and
  # unregistering can race an in-flight dispatch (TargetInvocationException),
  # so every teardown step is individually best-effort.
  Start-Sleep -Milliseconds 300
  try { Remove-Event -SourceIdentifier 'inf.hyp' -ErrorAction SilentlyContinue } catch { }
  try { Remove-Event -SourceIdentifier 'inf.rec' -ErrorAction SilentlyContinue } catch { }
  try { Remove-Event -SourceIdentifier 'inf.rej' -ErrorAction SilentlyContinue } catch { }
  try { Unregister-Event -SourceIdentifier 'inf.hyp' -ErrorAction SilentlyContinue } catch { }
  try { Unregister-Event -SourceIdentifier 'inf.rec' -ErrorAction SilentlyContinue } catch { }
  try { Unregister-Event -SourceIdentifier 'inf.rej' -ErrorAction SilentlyContinue } catch { }
} catch {
  [Console]::Out.WriteLine((@{ type='error'; message=$_.Exception.Message } | ConvertTo-Json -Compress))
  exit 1
}
`;

const POWERSHELL_NOISE = /(?:^\s*#<\s*CLIXML|<Objs\s+Version=|Preparing modules for first use|Deserializing)/i;

// Redirected PowerShell stderr arrives CLIXML-encoded: the real failure text
// hides inside <S S="Error">…</S> fragments carried on a line the noise
// filter drops wholesale — without extraction the exit reason vanishes and
// the user only ever sees a bare "exited with code N".
const CLIXML_ERROR_FRAGMENT = /<S S="Error">([\s\S]*?)<\/S>/g;
const CLIXML_ERROR_NOISE =
  /^(?:At line:|\+\s|CategoryInfo\b|FullyQualifiedErrorId\b|PSComputerName\b|RecommendedAction\b)/i;

function decodeClixml(text: string): string {
  return text
    .replace(/_x000D_/g, '\r')
    .replace(/_x000A_/g, '\n')
    .replace(/_x0009_/g, '\t')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

// Cold PowerShell + Add-Type(System.Speech) + engine/audio init can take a few
// seconds on a loaded machine; 8s proved too tight and demoted keyless
// dictation to the (broken in Electron) browser recognizer.
const STARTUP_TIMEOUT_MS = 15_000;

function cleanDiagnostic(raw: string): string {
  const parts: string[] = [];
  // Fresh regex per call so a shared lastIndex can never skip fragments.
  const fragment = new RegExp(CLIXML_ERROR_FRAGMENT);
  let match: RegExpExecArray | null;
  while ((match = fragment.exec(raw))) {
    const text = decodeClixml(match[1]).replace(/\s+/g, ' ').trim();
    if (text && !CLIXML_ERROR_NOISE.test(text)) parts.push(text);
  }
  const plain = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('<') && !POWERSHELL_NOISE.test(line))
    .join(' ');
  if (plain) parts.push(plain);
  return parts.join(' ').trim();
}

export function dictationExitMessage(code: number | null, stderr: string): string | undefined {
  if (!code || code === 0) return undefined;
  const detail = cleanDiagnostic(stderr);
  return detail
    ? `Windows dictation exited with code ${code}. ${detail}`
    : `Windows dictation exited with code ${code}.`;
}

type StartResult = { ok: boolean; engine?: string; error?: string };

class WindowsDictation {
  private child: ChildProcessWithoutNullStreams | null = null;
  // Fan-out set: a session's listener lives until the next start() takes
  // ownership. Never accumulate across sessions — duplicate listeners would
  // deliver every transcript twice.
  private listeners = new Set<(event: NativeDictationEvent) => void>();
  private starting: Promise<StartResult> | null = null;
  private suppressEnded = false;
  private buffer = '';
  private stderrBuffer = '';
  private stderrLog = '';

  private emit(event: NativeDictationEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // A broken listener must not break dictation for everyone else.
      }
    }
  }

  async start(listener: (event: NativeDictationEvent) => void): Promise<StartResult> {
    if (process.platform !== 'win32') {
      return { ok: false, error: 'Windows local dictation is unavailable on this operating system.' };
    }

    // A startup is already in flight: share its result instead of clobbering
    // its completion wiring (a second caller used to replace the listener and
    // hang the first invoke forever).
    if (this.starting) {
      this.listeners.add(listener);
      return this.starting;
    }

    // New session owns every event from here on.
    this.listeners.clear();
    this.listeners.add(listener);

    if (this.child) return { ok: true, engine: 'windows-local' };

    this.starting = this.spawnAndAwait();
    try {
      return await this.starting;
    } finally {
      this.starting = null;
    }
  }

  private spawnAndAwait(): Promise<StartResult> {
    this.buffer = '';
    this.stderrBuffer = '';
    this.stderrLog = '';
    this.suppressEnded = false;
    const encoded = Buffer.from(RECOGNIZER_SCRIPT, 'utf16le').toString('base64');
    const child = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.child = child;

    return new Promise<StartResult>((resolve) => {
      let settled = false;
      let startupError: string | undefined;

      const settle = (result: StartResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.listeners.delete(watcher);
        if (!result.ok) {
          // A failed attempt owns nothing: drop its listeners so the next
          // session starts from exactly one consumer.
          this.listeners.clear();
        }
        resolve(result);
      };

      const watcher = (event: NativeDictationEvent) => {
        if (event.type === 'ready') settle({ ok: true, engine: 'windows-local' });
        // Transient diagnostics keep the startup promise pending — only an
        // engine exit or the timeout may fail it (previously any stray stderr
        // line aborted startup and silently fell back to the browser engine).
        else if (event.type === 'error' && !startupError) startupError = event.message;
      };
      this.listeners.add(watcher);

      const timer = setTimeout(() => {
        // Late results must not reach a renderer that already fell back —
        // kill our own process and swallow the exit notice.
        this.suppressEnded = true;
        settle({ ok: false, error: 'Windows dictation took too long to start.' });
        if (this.child === child) this.child = null;
        try {
          child.kill();
        } catch {
          /* already gone */
        }
      }, STARTUP_TIMEOUT_MS);

      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => this.consume(chunk));
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (chunk: string) => this.consumeStderr(chunk));

      // A failed spawn emits 'error' and never 'exit': without this listener
      // the startup promise would hang (and an unhandled 'error' event can
      // take the main process down with it).
      child.once('error', (error) => {
        if (this.child === child) this.child = null;
        settle({ ok: false, error: `Windows dictation could not start: ${error.message}` });
      });

      child.once('exit', (code) => {
        const wasActive = this.child === child;
        if (wasActive) this.child = null;
        if (!settled) {
          settle({
            ok: false,
            error:
              startupError ??
              dictationExitMessage(code, this.stderrLog) ??
              `Windows dictation exited before it was ready (code ${code ?? 'unknown'}).`,
          });
          return;
        }
        if (this.suppressEnded) {
          this.suppressEnded = false;
          return;
        }
        this.emit({ type: 'ended', message: dictationExitMessage(code, this.stderrLog) });
      });
    });
  }

  stop(): void {
    const child = this.child;
    if (!child) return;
    try {
      child.stdin.write('stop\n');
    } catch {
      /* pipe already closed — the kill below finishes the job */
    }
    const timer = setTimeout(() => {
      if (this.child === child) child.kill();
    }, 2_000);
    child.once('exit', () => clearTimeout(timer));
  }

  isListening(): boolean {
    return Boolean(this.child);
  }

  private consume(chunk: string) {
    this.buffer += chunk;
    const lines = this.buffer.split(/\r?\n/);
    this.buffer = lines.pop() ?? '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        this.emit(JSON.parse(trimmed) as NativeDictationEvent);
      } catch {
        this.emit({ type: 'error', message: trimmed });
      }
    }
  }

  private consumeStderr(chunk: string) {
    this.stderrLog += chunk;
    this.stderrBuffer += chunk;
    const lines = this.stderrBuffer.split(/\r?\n/);
    this.stderrBuffer = lines.pop() ?? '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || POWERSHELL_NOISE.test(trimmed)) continue;
      this.emit({ type: 'error', message: trimmed });
    }
  }
}

export const windowsDictation = new WindowsDictation();
