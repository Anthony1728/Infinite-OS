import { EventEmitter } from 'events';
import log from 'electron-log';

export interface VoiceConfig {
  language: string;
  continuous: boolean;
  interimResults: boolean;
  autoSpeak: boolean;
  voiceId?: string;
  rate: number;
  pitch: number;
  volume: number;
}

export interface VoiceCommand {
  transcript: string;
  confidence: number;
  intent?: string;
  entities?: Record<string, string>;
  timestamp: number;
}

export interface VoiceResponse {
  text: string;
  audio?: Buffer;
  timestamp: number;
}

class VoiceAssistant extends EventEmitter {
  private config: VoiceConfig;
  private isListening = false;
  private commandHistory: VoiceCommand[] = [];
  private wakeWord = 'hey infinite';
  private customCommands: Map<string, string> = new Map();

  constructor() {
    super();
    this.config = {
      language: 'en-US',
      continuous: true,
      interimResults: true,
      autoSpeak: true,
      rate: 1.0,
      pitch: 1.0,
      volume: 1.0,
    };
  }

  getConfig(): VoiceConfig {
    return { ...this.config };
  }

  updateConfig(partial: Partial<VoiceConfig>): void {
    this.config = { ...this.config, ...partial };
    this.emit('configChanged', this.config);
  }

  getWakeWord(): string {
    return this.wakeWord;
  }

  setWakeWord(word: string): void {
    this.wakeWord = word.toLowerCase();
  }

  addCustomCommand(trigger: string, action: string): void {
    this.customCommands.set(trigger.toLowerCase(), action);
  }

  removeCustomCommand(trigger: string): void {
    this.customCommands.delete(trigger.toLowerCase());
  }

  getCustomCommands(): Array<{ trigger: string; action: string }> {
    return Array.from(this.customCommands.entries()).map(([trigger, action]) => ({
      trigger,
      action,
    }));
  }

  processTranscript(transcript: string): VoiceCommand {
    const lower = transcript.toLowerCase().trim();
    const command: VoiceCommand = {
      transcript,
      confidence: 1.0,
      intent: this.detectIntent(lower),
      entities: this.extractEntities(lower),
      timestamp: Date.now(),
    };

    this.commandHistory.push(command);
    if (this.commandHistory.length > 100) {
      this.commandHistory.shift();
    }

    if (lower.startsWith(this.wakeWord)) {
      command.intent = 'wake_word_detected';
      this.emit('wakeWord', command);
    }

    if (this.customCommands.has(lower)) {
      command.intent = 'custom_command';
      this.emit('customCommand', { command, action: this.customCommands.get(lower) });
    }

    this.emit('command', command);
    return command;
  }

  private detectIntent(text: string): string {
    if (text.includes('search') || text.includes('find') || text.includes('look up')) return 'search';
    if (text.includes('open') || text.includes('launch') || text.includes('start')) return 'open';
    if (text.includes('create') || text.includes('make') || text.includes('new')) return 'create';
    if (text.includes('run') || text.includes('execute')) return 'execute';
    if (text.includes('stop') || text.includes('pause') || text.includes('halt')) return 'stop';
    if (text.includes('settings') || text.includes('configure') || text.includes('config')) return 'settings';
    if (text.includes('help') || text.includes('what can you do')) return 'help';
    if (text.includes('close') || text.includes('quit') || text.includes('exit')) return 'close';
    if (text.includes('save') || text.includes('store')) return 'save';
    if (text.includes('read') || text.includes('show') || text.includes('display')) return 'read';
    if (text.includes('write') || text.includes('type') || text.includes('input')) return 'write';
    if (text.includes('copy') || text.includes('duplicate')) return 'copy';
    if (text.includes('paste')) return 'paste';
    if (text.includes('delete') || text.includes('remove')) return 'delete';
    if (text.includes('undo') || text.includes('revert')) return 'undo';
    if (text.includes('redo')) return 'redo';
    return 'chat';
  }

  private extractEntities(text: string): Record<string, string> {
    const entities: Record<string, string> = {};
    const urlMatch = text.match(/https?:\/\/[^\s]+/);
    if (urlMatch) entities.url = urlMatch[0];
    const fileMatch = text.match(/(?:file|folder|directory)\s+(\S+)/i);
    if (fileMatch) entities.file = fileMatch[1];
    const numberMatch = text.match(/\b\d+\b/);
    if (numberMatch) entities.number = numberMatch[0];
    return entities;
  }

  getHistory(): VoiceCommand[] {
    return [...this.commandHistory];
  }

  clearHistory(): void {
    this.commandHistory = [];
  }

  setListening(listening: boolean): void {
    this.isListening = listening;
    this.emit('listeningChanged', listening);
  }

  getListening(): boolean {
    return this.isListening;
  }
}

export const voiceAssistant = new VoiceAssistant();
