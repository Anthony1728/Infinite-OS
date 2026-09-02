import { cpus, totalmem, freemem, arch, platform, release } from 'node:os';
import { execSync } from 'node:child_process';
import type { Tool, ToolContext, ToolResult } from './base.js';

/**
 * Intelligent Compute Manager — Hermes-beating hardware-aware model router helper.
 * Hermes routes by task type; Infinite OS routes by task + live hardware:
 * CPU, GPU, VRAM, RAM, disk, plus local model list and cloud provider reachability.
 * No cloud key is exposed; recommendations are offline-first and fast.
 */
interface ComputeArgs {
  action: 'inspect' | 'recommend';
  task?: string;
  model?: string;
}

export const computeTool: Tool = {
  name: 'Compute',
  description:
    'Inspect live hardware (CPU/GPU/VRAM/RAM/disk + local Ollama models) and recommend local vs cloud and small vs large model for a task. Hermes routes by task type only; Infinite OS inspects your machine first, then decides. Never exposes keys, never blocks on network unless you ask for a live check.',
  inputSchema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['inspect', 'recommend'], description: 'inspect = report hardware; recommend = inspect + suggest model for task' },
      task: { type: 'string', description: 'Free-form task description for recommendation, e.g. "vision on 4K image" or "refactor large repo"' },
      model: { type: 'string', description: 'Optional model you are considering, e.g. "llama3.3:70b"' },
    },
    required: ['action'],
  },
  permission: 'allow',
  async execute(args: unknown, _ctx: ToolContext): Promise<ToolResult> {
    const a = args as ComputeArgs;
    const hw = await inspectHardware();
    if (a.action === 'inspect') {
      return { content: formatInspect(hw) };
    }
    // recommend
    const task = (a.task || '').toLowerCase();
    const isHeavy = /\b(70b|405b|large|heavy|vision|4k|video|train|finetune|reasoning|deep research|large repo)\b/i.test(task) || /\b70b\b/i.test(a.model || '');
    const isCode = /\b(code|typescript|javascript|python|refactor|debug|repo)\b/i.test(task);
    const isVision = /\b(vision|image|ocr|describe|vision model)\b/i.test(task);
    const ramGB = hw.ram.totalGB;
    const vramGB = hw.gpu.vramGB ?? 0;
    const hasLocal70B = hw.ollama.models.some(m => /70b/i.test(m));
    const hasGpu = vramGB >= 8 || /nvidia|geforce|rtx|quadro/i.test(hw.gpu.name || '');

    let recommendation = '';
    if (isHeavy && ramGB >= 32 && vramGB >= 16 && hasGpu) {
      recommendation = `Run locally: ${hasLocal70B ? 'llama3.3:70b' : 'qwen2.5:32b'} — your ${vramGB}GB VRAM + ${ramGB}GB RAM can handle it. Faster, private, no egress.`;
    } else if (isHeavy) {
      recommendation = `Use cloud: ${isVision ? 'gpt-4o or gemini-1.5-pro (vision)' : isCode ? 'claude-3.5-sonnet or deepseek-coder' : 'llama3.3:70b via OpenRouter'} — local ${ramGB}GB RAM / ${vramGB}GB VRAM is tight for heavy tasks. Fallback to local qwen2.5:7b if offline.`;
    } else if (isCode || isVision) {
      recommendation = `Hybrid: try local ${isVision ? 'minicpm-v4.6 or llava' : 'qwen2.5-coder:7b'} first (fast, local), escalate to cloud 70b only on failure. Local is enough for 80% of these tasks.`;
    } else {
      recommendation = `Use fast local: ${hw.ollama.models[0] || 'qwen2.5:7b'} — small model, instant, private. No need for cloud for chat/summarize.`;
    }
    return {
      content: `${formatInspect(hw)}\n\n**Recommendation for ${a.task ? `"${a.task}"` : 'general task'}${a.model ? ` (considering ${a.model})` : ''}**\n${recommendation}\n\nRouter logic: task type + live RAM/VRAM/GPU + local model list. No key exposed, no network required unless you explicitly test a provider.`,
    };
  },
};

type Hw = {
  cpu: { model: string; cores: number; arch: string; platform: string; release: string };
  ram: { totalGB: number; freeGB: number; usedPct: number };
  gpu: { name: string | null; vramGB: number | null; driver: string | null };
  disk: { freeGB: number | null };
  ollama: { available: boolean; models: string[] };
};

async function inspectHardware(): Promise<Hw> {
  const cpuM = cpus()[0]?.model || 'Unknown';
  const cores = cpus().length;
  const total = totalmem();
  const free = freemem();
  const ram = { totalGB: Math.round(total / (1024 ** 3)), freeGB: Math.round(free / (1024 ** 3)), usedPct: Math.round((1 - free / total) * 100) };
  const gpu = await getGpu();
  const disk = await getDisk();
  const ollama = await getOllamaModels();
  return { cpu: { model: cpuM, cores, arch: arch(), platform: platform(), release: release() }, ram, gpu, disk, ollama };
}

async function getGpu(): Promise<{ name: string | null; vramGB: number | null; driver: string | null }> {
  try {
    const out = execSync('wmic path win32_VideoController get name,AdapterRAM,DriverVersion /format:csv', { timeout: 4000, windowsHide: true }).toString();
    const lines = out.split('\n').filter(l => l.trim() && !l.toLowerCase().includes('node')).slice(0, 3);
    for (const line of lines) {
      // wmic csv: Node,AdapterRAM,DriverVersion,Name
      const m = line.match(/\"(.+)\"/);
      if (m) {
        const name = m[1].trim();
        if (name) {
          const ramMatch = line.match(/(\d{9,12})/);
          const vramGB = ramMatch ? Math.round(Number(ramMatch[1]) / 1e9) : null;
          return { name, vramGB, driver: null };
        }
      }
    }
  } catch { /* ignore */ }
  try {
    const out = execSync('nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv,noheader', { timeout: 3000, windowsHide: true }).toString();
    const [name, mem, driver] = out.split(',').map(s => s.trim());
    const vramGB = mem ? Math.round(parseInt(mem) / 1024) : null;
    if (name) return { name, vramGB, driver };
  } catch { /* no nvidia */ }
  return { name: null, vramGB: null, driver: null };
}

async function getDisk(): Promise<{ freeGB: number | null }> {
  try {
    const out = execSync('wmic logicaldisk get size,freespace,caption /format:csv', { timeout: 3000, windowsHide: true }).toString();
    const line = out.split('\n').find(l => l.includes('C:'));
    if (line) {
      const free = line.split(',')[1];
      const freeGB = free ? Math.round(Number(free) / 1e9) : null;
      return { freeGB };
    }
  } catch { /* ignore */ }
  return { freeGB: null };
}

async function getOllamaModels(): Promise<{ available: boolean; models: string[] }> {
  try {
    const res = await fetch('http://127.0.0.1:11434/api/tags', { signal: AbortSignal.timeout(1500) } as RequestInit);
    if (!res.ok) return { available: false, models: [] };
    const j = await res.json() as { models?: { name: string }[] };
    return { available: true, models: (j.models || []).map(m => m.name) };
  } catch {
    return { available: false, models: [] };
  }
}

function formatInspect(hw: Hw): string {
  return [
    `**Hardware inspected (live, no network except localhost Ollama)**`,
    `- CPU: ${hw.cpu.model} (${hw.cpu.cores} cores, ${hw.cpu.arch}, ${hw.cpu.platform} ${hw.cpu.release})`,
    `- RAM: ${hw.ram.totalGB} GB total, ${hw.ram.freeGB} GB free, ${hw.ram.usedPct}% used`,
    `- GPU: ${hw.gpu.name || 'none detected'}${hw.gpu.vramGB ? `, ${hw.gpu.vramGB} GB VRAM` : ''}${hw.gpu.driver ? `, driver ${hw.gpu.driver}` : ''}`,
    `- Disk C: free ${hw.disk.freeGB ?? '?'} GB`,
    `- Ollama: ${hw.ollama.available ? `available — ${hw.ollama.models.slice(0, 5).join(', ') || 'no models'}` : 'not reachable on 11434'}`,
  ].join('\n');
}
