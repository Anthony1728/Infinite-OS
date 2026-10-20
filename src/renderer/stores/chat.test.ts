import { describe, expect, it } from 'vitest';
import type { Message } from '../../shared/types';
import { appendLiveMessage, extractMediaEnvelope, formatRuntimeIdentity, inferExecutionMode, isModelIdentityQuestion, requiresOrchestration, upsertLiveToolUse } from './chat';const assistant = (id: string, text = ''): Message => ({  id,  role: 'assistant',  content: text ? [{ type: 'text', text }] : [],  timestamp: 1,});describe('automatic chat execution mode', () => {  it('returns to chat mode for ordinary conversation', () => {    expect(inferExecutionMode('Hey, how are you today?')).toBe('chat');    expect(inferExecutionMode('Can we chat about motivation?')).toBe('chat');  });  it('routes creation requests to creative mode', () => {    expect(inferExecutionMode('Create a modern dashboard for my business')).toBe('build');    expect(inferExecutionMode('Build me a portfolio website')).toBe('build');  });  it('routes software changes to code mode', () => {    expect(inferExecutionMode('Fix the bug in the TypeScript component')).toBe('code');    expect(inferExecutionMode('Add a feature to the sidebar')).toBe('code');  });  it('routes research and computer actions to their execution modes', () => {    expect(inferExecutionMode('Research the latest browser security guidance')).toBe('research');    expect(inferExecutionMode('Open Chrome and search for local suppliers')).toBe('agent');  });});describe('truthful runtime model identity', () => {  it('recognizes direct model identity questions', () => {    expect(isModelIdentityQuestion('What model are you using?')).toBe(true);    expect(isModelIdentityQuestion('Which AI model is Infinite OS running on')).toBe(true);    expect(isModelIdentityQuestion('What can this model create?')).toBe(false);  });  it('reports the configured provider, friendly name, and exact model id', () => {    const result = formatRuntimeIdentity('opencode', 'opencode::mimo-v2.5-free', 'MiMo V2.5 Free');    expect(result).toContain('**MiMo V2.5 Free**');    expect(result).toContain('`opencode::mimo-v2.5-free`');    expect(result).toContain('**OpenCode Zen**');    expect(result).not.toContain('NVIDIA');  });});describe('complex task routing', () => {  it('routes long build work to orchestration without the single-chat timeout', () => {    expect(requiresOrchestration('Build a complete dashboard application with authentication, persistence, responsive UI, tests, and deployment configuration.')).toBe(true);    expect(requiresOrchestration('Fix one typo')).toBe(false);  });});describe('streaming transcript guarantees', () => {  it('streams each new response into its own bubble, never an old one', () => {    const first = assistant('m1', 'First answer.');    const afterFirst = appendLiveMessage([], first);    expect(afterFirst).toHaveLength(1);    // A re-emitted id (retry after discard) reuses its bubble — no duplicate.    expect(appendLiveMessage(afterFirst, assistant('m1', 'First answer.'))).toBe(afterFirst);    // The next model turn is a new id → a new bubble; earlier text is untouched.    const afterSecond = appendLiveMessage(afterFirst, assistant('m2'));    expect(afterSecond).toHaveLength(2);    expect(afterSecond[0]).toBe(first);  });  it('renders the tool card the moment the tool starts, then fills it in place', () => {    const live = appendLiveMessage([], assistant('m1'));    // tool_use_start plants a running card in the live bubble only.    const started = upsertLiveToolUse(live, 'm1', { id: 't1', name: 'bash' });    expect(started[0].content).toEqual([{ type: 'tool_use', id: 't1', name: 'bash', input: {} }]);    // tool_use_end fills the SAME block — still exactly one card per call.    const ended = upsertLiveToolUse(started, 'm1', { id: 't1', name: 'bash', input: { command: 'npm run build' } });    expect(ended[0].content).toEqual([      { type: 'tool_use', id: 't1', name: 'bash', input: { command: 'npm run build' } },    ]);    // A second tool in the same turn appends; other bubbles are untouched.    const withTwo = appendLiveMessage(ended, assistant('m2', 'Follow-up.'));    const secondTool = upsertLiveToolUse(withTwo, 'm2', { id: 't2', name: 'read' });    expect(secondTool[0].content).toHaveLength(1);    expect(secondTool[1].content).toEqual([      { type: 'text', text: 'Follow-up.' },      { type: 'tool_use', id: 't2', name: 'read', input: {} },    ]);  // Unknown message id: no-op, never fabricates a bubble.
  expect(upsertLiveToolUse(secondTool, 'missing', { id: 't9', name: 'bash' })).toBe(secondTool);
});

describe('INFINITE_MEDIA envelope parsing', () => {
  it('turns an image tool result into a lazy-loading media file block', () => {
    const content = 'Generated via Stability (1024x1024): C:\\Users\\user\\infinite-images\\x.png\nPrompt: a sunset'
      + '\nINFINITE_MEDIA: ' + JSON.stringify([{ kind: 'image', path: 'C:\\Users\\user\\infinite-images\\x.png', mime: 'image/png' }]);
    const blocks = extractMediaEnvelope(content);
    expect(blocks).toHaveLength(1);
    const b = blocks[0];
    expect(b.type).toBe('file');
    if (b.type !== 'file') return;
    expect(b.name).toBe('x.png');
    expect(b.mimeType).toBe('image/png');
    expect(b.mediaPath).toBe('C:\\Users\\user\\infinite-images\\x.png');
    expect(b.mediaKind).toBe('image');
    expect(b.data).toBe(''); // bytes load lazily via fileRead, never into the transcript
  });

  it('maps video and audio kinds correctly', () => {
    const content = 'done\nINFINITE_MEDIA: ' + JSON.stringify([
      { kind: 'video', path: 'C:\\tmp\\v.mp4', mime: 'video/mp4' },
      { kind: 'audio', path: 'C:\\tmp\\m.wav', mime: 'audio/wav' },
    ]);
    const blocks = extractMediaEnvelope(content);
    expect(blocks).toHaveLength(2);
    expect(blocks[0].type === 'file' && blocks[0].mediaKind).toBe('video');
    expect(blocks[1].type === 'file' && blocks[1].mediaKind).toBe('audio');
  });

  it('returns nothing for plain tool output without an envelope', () => {
    expect(extractMediaEnvelope('Saved to C:\\tmp\\report.pdf')).toHaveLength(0);
  });

  it('ignores malformed or empty envelopes instead of throwing', () => {
    expect(extractMediaEnvelope('INFINITE_MEDIA: {not json')).toHaveLength(0);
    expect(extractMediaEnvelope('INFINITE_MEDIA: []')).toHaveLength(0);
    expect(extractMediaEnvelope('INFINITE_MEDIA: [{"path":3}]')).toHaveLength(0);
    expect(extractMediaEnvelope(undefined)).toHaveLength(0);
    expect(extractMediaEnvelope(42)).toHaveLength(0);
  });

  it('handles envelope text arriving inside structured content arrays', () => {
    const content = [
      { type: 'text', text: 'Image ready.\nINFINITE_MEDIA: ' + JSON.stringify([{ kind: 'image', path: 'C:\\i\\a.png', mime: 'image/png' }]) },
    ];
    expect(extractMediaEnvelope(content)).toHaveLength(1);
  });
});});