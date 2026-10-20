/**
 * App catalog for Workers.
 *
 * Warmwind's "install and sign in to apps" surface is a curated catalog backed
 * by the platform's package manager. This is the Windows-native equivalent:
 * winget for installation, the Start-menu app list for discovery, and
 * `shell:AppsFolder` for launching.
 *
 * Only IDs that pass `isValidWingetId` ever reach a process argument. Nothing
 * here builds a shell command string from user input.
 */

import { execFile } from 'node:child_process';
import { spawn } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface CatalogApp {
  id: string;
  name: string;
  publisher: string;
  description: string;
  category: 'browser' | 'communication' | 'development' | 'media' | 'productivity' | 'utility';
  wingetId: string;
}

export interface InstalledApp {
  name: string;
  id: string;
}

export interface CatalogView extends CatalogApp {
  installed: boolean;
}

export const APP_CATALOG: CatalogApp[] = [
  { id: 'chrome', name: 'Google Chrome', publisher: 'Google', description: 'Fast, widely compatible web browser.', category: 'browser', wingetId: 'Google.Chrome' },
  { id: 'firefox', name: 'Mozilla Firefox', publisher: 'Mozilla', description: 'Independent, privacy-focused browser.', category: 'browser', wingetId: 'Mozilla.Firefox' },
  { id: 'brave', name: 'Brave', publisher: 'Brave Software', description: 'Chromium browser with built-in tracking protection.', category: 'browser', wingetId: 'Brave.Brave' },
  { id: 'vscode', name: 'Visual Studio Code', publisher: 'Microsoft', description: 'Code editor with extensions and an integrated terminal.', category: 'development', wingetId: 'Microsoft.VisualStudioCode' },
  { id: 'visual-studio', name: 'Visual Studio Community', publisher: 'Microsoft', description: 'Full IDE for .NET, C++, and desktop apps.', category: 'development', wingetId: 'Microsoft.VisualStudio.2022.Community' },
  { id: 'git', name: 'Git', publisher: 'Git Project', description: 'Version control for local and remote repositories.', category: 'development', wingetId: 'Git.Git' },
  { id: 'nodejs', name: 'Node.js LTS', publisher: 'OpenJS Foundation', description: 'JavaScript runtime for tools and local servers.', category: 'development', wingetId: 'OpenJS.NodeJS.LTS' },
  { id: 'python', name: 'Python 3.12', publisher: 'Python Software Foundation', description: 'Python interpreter and package tooling.', category: 'development', wingetId: 'Python.Python.3.12' },
  { id: 'docker', name: 'Docker Desktop', publisher: 'Docker', description: 'Containers and local development services.', category: 'development', wingetId: 'Docker.DockerDesktop' },
  { id: 'postman', name: 'Postman', publisher: 'Postman', description: 'Build, test, and inspect APIs.', category: 'development', wingetId: 'Postman.Postman' },
  { id: 'github-desktop', name: 'GitHub Desktop', publisher: 'GitHub', description: 'Visual Git client for repositories and pull requests.', category: 'development', wingetId: 'GitHub.GitHubDesktop' },
  { id: 'jetbrains-toolbox', name: 'JetBrains Toolbox', publisher: 'JetBrains', description: 'Installer and updater for JetBrains IDEs.', category: 'development', wingetId: 'JetBrains.Toolbox' },
  { id: 'ollama', name: 'Ollama', publisher: 'Ollama', description: 'Run local language models from a simple runtime.', category: 'development', wingetId: 'Ollama.Ollama' },
  { id: 'slack', name: 'Slack', publisher: 'Salesforce', description: 'Team chat, channels, and calls.', category: 'communication', wingetId: 'SlackTechnologies.Slack' },
  { id: 'discord', name: 'Discord', publisher: 'Discord', description: 'Voice, video, and community chat.', category: 'communication', wingetId: 'Discord.Discord' },
  { id: 'zoom', name: 'Zoom Workplace', publisher: 'Zoom', description: 'Video meetings and screen sharing.', category: 'communication', wingetId: 'Zoom.Zoom' },
  { id: 'teams', name: 'Microsoft Teams', publisher: 'Microsoft', description: 'Chat and meetings for work or school.', category: 'communication', wingetId: 'Microsoft.Teams' },
  { id: 'whatsapp', name: 'WhatsApp', publisher: 'Meta', description: 'Desktop messaging for WhatsApp accounts.', category: 'communication', wingetId: 'WhatsApp.WhatsApp' },
  { id: 'telegram', name: 'Telegram Desktop', publisher: 'Telegram', description: 'Fast desktop messaging client.', category: 'communication', wingetId: 'Telegram.TelegramDesktop' },
  { id: 'signal', name: 'Signal', publisher: 'Signal Foundation', description: 'Private, end-to-end encrypted messaging.', category: 'communication', wingetId: 'OpenWhisperSystems.Signal' },
  { id: 'notion', name: 'Notion', publisher: 'Notion Labs', description: 'Docs, databases, and project pages.', category: 'productivity', wingetId: 'Notion.Notion' },
  { id: 'obsidian', name: 'Obsidian', publisher: 'Obsidian', description: 'Local-first Markdown knowledge base.', category: 'productivity', wingetId: 'Obsidian.Obsidian' },
  { id: 'libreoffice', name: 'LibreOffice', publisher: 'The Document Foundation', description: 'Offline office suite for documents and spreadsheets.', category: 'productivity', wingetId: 'TheDocumentFoundation.LibreOffice' },
  { id: 'power-toys', name: 'Microsoft PowerToys', publisher: 'Microsoft', description: 'Window, keyboard, and file productivity utilities.', category: 'utility', wingetId: 'Microsoft.PowerToys' },
  { id: '7zip', name: '7-Zip', publisher: 'Igor Pavlov', description: 'Archive manager for zip, 7z, and more.', category: 'utility', wingetId: '7zip.7zip' },
  { id: 'bitwarden', name: 'Bitwarden', publisher: 'Bitwarden', description: 'Open-source password manager desktop app.', category: 'utility', wingetId: 'Bitwarden.Bitwarden' },
  { id: 'acrobat-reader', name: 'Acrobat Reader', publisher: 'Adobe', description: 'Read and annotate PDF documents.', category: 'utility', wingetId: 'Adobe.Acrobat.Reader.64-bit' },
  { id: 'vlc', name: 'VLC media player', publisher: 'VideoLAN', description: 'Plays almost every audio and video format.', category: 'media', wingetId: 'VideoLAN.VLC' },
  { id: 'spotify', name: 'Spotify', publisher: 'Spotify', description: 'Music and podcast streaming.', category: 'media', wingetId: 'Spotify.Spotify' },
  { id: 'obs-studio', name: 'OBS Studio', publisher: 'OBS Project', description: 'Screen recording and live streaming.', category: 'media', wingetId: 'OBSProject.OBSStudio' },
  { id: 'audacity', name: 'Audacity', publisher: 'Muse Group', description: 'Audio recording and editing.', category: 'media', wingetId: 'Audacity.Audacity' },
  { id: 'gimp', name: 'GIMP', publisher: 'GIMP Team', description: 'Image editing and retouching.', category: 'media', wingetId: 'GIMP.GIMP' },
  { id: 'figma', name: 'Figma', publisher: 'Figma', description: 'Interface design and collaborative prototypes.', category: 'media', wingetId: 'Figma.Figma' },
  { id: 'steam', name: 'Steam', publisher: 'Valve', description: 'Game library and launcher.', category: 'media', wingetId: 'Valve.Steam' },
];

const WINGET_ID = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,200}$/;

export function isValidWingetId(value: unknown): value is string {
  return typeof value === 'string' && WINGET_ID.test(value.trim());
}

export function searchCatalog(query: string, installed: InstalledApp[] = []): CatalogView[] {
  const needle = query.trim().toLowerCase();
  const installedNames = installed.map((app) => app.name.toLowerCase());
  return APP_CATALOG
    .filter((app) => {
      if (!needle) return true;
      return `${app.name} ${app.publisher} ${app.description} ${app.category} ${app.wingetId}`
        .toLowerCase()
        .includes(needle);
    })
    .map((app) => ({
      ...app,
      installed: installedNames.some((name) => name.includes(app.name.toLowerCase()) || app.name.toLowerCase().includes(name)),
    }));
}

export function isInstalled(app: CatalogApp, installed: InstalledApp[]): boolean {
  const target = app.name.toLowerCase();
  return installed.some((entry) => {
    const name = entry.name.toLowerCase();
    return name === target || name.includes(target) || target.includes(name);
  });
}

export async function listInstalledApps(timeoutMs = 15_000): Promise<{ apps: InstalledApp[]; error?: string }> {
  const script = [
    "$ErrorActionPreference = 'SilentlyContinue'",
    'Get-StartApps | Select-Object Name, AppID | ConvertTo-Json -Compress -Depth 3',
  ].join('; ');
  try {
    const { stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { timeout: timeoutMs, windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
    );
    const text = String(stdout).trim();
    if (!text) return { apps: [] };
    const parsed = JSON.parse(text) as { Name?: unknown; AppID?: unknown } | Array<{ Name?: unknown; AppID?: unknown }>;
    const rows = Array.isArray(parsed) ? parsed : [parsed];
    const apps = rows
      .map((row) => ({
        name: typeof row.Name === 'string' ? row.Name.trim() : '',
        id: typeof row.AppID === 'string' ? row.AppID.trim() : '',
      }))
      .filter((row) => row.name && row.id)
      .sort((a, b) => a.name.localeCompare(b.name));
    return { apps };
  } catch (error) {
    return { apps: [], error: error instanceof Error ? error.message : String(error) };
  }
}

export async function installApp(wingetId: string, timeoutMs = 15 * 60_000): Promise<{ ok: boolean; output: string }> {
  const id = wingetId.trim();
  if (!isValidWingetId(id)) throw new Error('Invalid winget package ID.');
  try {
    const { stdout, stderr } = await execFileAsync(
      'winget.exe',
      [
        'install',
        '--id', id,
        '--exact',
        '--source', 'winget',
        '--accept-package-agreements',
        '--accept-source-agreements',
        '--disable-interactivity',
      ],
      { timeout: timeoutMs, windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
    );
    return { ok: true, output: `${stdout ?? ''}${stderr ?? ''}`.trim().slice(0, 12_000) };
  } catch (error) {
    const detail = error as { stdout?: string; stderr?: string; message?: string };
    const output = `${detail.stdout ?? ''}${detail.stderr ?? ''}`.trim() || detail.message || 'winget failed.';
    return { ok: false, output: output.slice(0, 12_000) };
  }
}

export function launchApp(appId: string): { ok: boolean; error?: string } {
  const id = appId.trim();
  if (!id || id.length > 400 || /["\r\n]/.test(id)) {
    return { ok: false, error: 'Invalid app ID.' };
  }
  try {
    const child = spawn('explorer.exe', [`shell:AppsFolder\\${id}`], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.unref();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
