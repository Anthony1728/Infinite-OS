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
  $engine.add_SpeechHypothesized({
    param($sender, $eventArgs)
    [Console]::Out.WriteLine((@{ type='result'; transcript=$eventArgs.Result.Text; confidence=$eventArgs.Result.Confidence; final=$false } | ConvertTo-Json -Compress))
  })
  $engine.add_SpeechRecognized({
    param($sender, $eventArgs)
    [Console]::Out.WriteLine((@{ type='result'; transcript=$eventArgs.Result.Text; confidence=$eventArgs.Result.Confidence; final=$true } | ConvertTo-Json -Compress))
  })
  $engine.add_SpeechRecognitionRejected({
    [Console]::Out.WriteLine((@{ type='error'; message='Speech was heard but could not be recognized clearly.' } | ConvertTo-Json -Compress))
  })
  [Console]::Out.WriteLine((@{ type='ready'; language=$info.Culture.Name } | ConvertTo-Json -Compress))
  $engine.RecognizeAsync([System.Speech.Recognition.RecognizeMode]::Multiple)
  while ($true) {
    $line = [Console]::In.ReadLine()
    if ($null -eq $line) { break }
    if ($line -eq 'stop') { break }
  }
  $engine.RecognizeAsyncCancel()
  $engine.RecognizeAsyncStop()
  $engine.Dispose()
} catch {
  [Console]::Out.WriteLine((@{ type='error'; message=$_.Exception.Message } | ConvertTo-Json -Compress))
  exit 1
}
`;

const POWERSHELL_NOISE = /(?:^\s*#<\s*CLIXML|<Objs\s+Version=|Preparing modules for first use|Deserializing)/i;

function cleanDiagnostic(raw: string): string {
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !POWERSHELL_NOISE.test(line))
    .join(' ');
}

export function dictationExitMessage(code: number | null, stderr: string): string | undefined {
  if (!code || code === 0) return undefined;
  const detail = cleanDiagnostic(stderr);
  return detail
    ? `Windows dictation exited with code ${code}. ${detail}`
    : `Windows dictation exited with code ${code}.`;
}

class WindowsDictation {
  private child: ChildProcessWithoutNullStreams | null = null;
  private listener: ((event: NativeDictationEvent) => void) | null = null;
  private buffer = '';
  private stderrBuffer = '';
  private stderrLog = '';

  async start(listener: (event: NativeDictationEvent) => void): Promise<{ ok: boolean; engine?: string; error?: string }> {
    if (process.platform !== 'win32') return { ok: false, error: 'Windows local dictation is unavailable on this operating system.' };
    if (this.child) {
      this.listener = listener;
      return { ok: true, engine: 'windows-local' };
    }

    this.listener = listener;
    this.buffer = '';
    this.stderrBuffer = '';
    this.stderrLog = '';
    const encoded = Buffer.from(RECOGNIZER_SCRIPT, 'utf16le').toString('base64');
    const child = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.child = child;

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => this.consume(chunk));
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => this.consumeStderr(chunk));
    child.once('exit', (code) => {
      const wasActive = this.child === child;
      if (wasActive) this.child = null;
      if (wasActive) listener({ type: 'ended', message: dictationExitMessage(code, this.stderrLog) });
    });

    return await new Promise((resolve) => {
      const timeout = setTimeout(() => resolve({ ok: false, error: 'Windows dictation took too long to start.' }), 8_000);
      const startupListener = this.listener;
      this.listener = (event) => {
        startupListener?.(event);
        if (event.type === 'ready') {
          clearTimeout(timeout);
          this.listener = listener;
          resolve({ ok: true, engine: 'windows-local' });
        } else if (event.type === 'error') {
          clearTimeout(timeout);
          this.listener = listener;
          resolve({ ok: false, error: event.message });
        }
      };
      child.once('exit', (code) => {
        if (this.child === child) return;
        clearTimeout(timeout);
        const reason =
          dictationExitMessage(code, this.stderrLog) ??
          `Windows dictation exited before it was ready (code ${code ?? 'unknown'}).`;
        resolve({ ok: false, error: reason });
      });
    });
  }

  stop(): void {
    const child = this.child;
    if (!child) return;
    child.stdin.write('stop\n');
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
        this.listener?.(JSON.parse(trimmed) as NativeDictationEvent);
      } catch {
        this.listener?.({ type: 'error', message: trimmed });
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
      this.listener?.({ type: 'error', message: trimmed });
    }
  }
}

export const windowsDictation = new WindowsDictation();
