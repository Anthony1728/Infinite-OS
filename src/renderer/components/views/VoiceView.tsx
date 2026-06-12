import { useState, useEffect, useRef, useCallback } from 'react';
import { Mic, MicOff, Volume2, VolumeX, Settings, Command, Trash2, Plus, Circle } from 'lucide-react';

export function VoiceView() {
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [interim, setInterim] = useState('');
  const [history, setHistory] = useState<any[]>([]);
  const [customCommands, setCustomCommands] = useState<any[]>([]);
  const [newTrigger, setNewTrigger] = useState('');
  const [newAction, setNewAction] = useState('');
  const [wakeWord, setWakeWord] = useState('hey infinite');
  const [showSettings, setShowSettings] = useState(false);
  const [config, setConfig] = useState({ language: 'en-US', rate: 1, pitch: 1, volume: 1, autoSpeak: true });
  const recognitionRef = useRef<any>(null);

  useEffect(() => {
    loadHistory();
    loadCustomCommands();
    loadConfig();
  }, []);

  const loadHistory = async () => {
    try {
      const h = await (window as any).api.voiceHistory();
      setHistory(h || []);
    } catch {}
  };

  const loadCustomCommands = async () => {
    try {
      const cmds = await (window as any).api.voiceCustomCommands();
      setCustomCommands(cmds || []);
    } catch {}
  };

  const loadConfig = async () => {
    try {
      const cfg = await (window as any).api.voiceConfigGet();
      if (cfg) setConfig(cfg);
    } catch {}
  };

  const toggleListening = useCallback(async () => {
    if (listening) {
      recognitionRef.current?.stop();
      setListening(false);
      await (window as any).api.voiceStopListening();
    } else {
      if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
        alert('Speech recognition is not supported in this browser.');
        return;
      }
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = config.language;

      recognition.onresult = async (event: any) => {
        let final = '';
        let interimText = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const t = event.results[i][0].transcript;
          if (event.results[i].isFinal) {
            final += t;
          } else {
            interimText += t;
          }
        }
        if (final) {
          setTranscript(final);
          setInterim('');
          try {
            const result = await (window as any).api.voiceProcessTranscript({ transcript: final });
            if (result?.intent === 'wake_word_detected') {
              setListening(true);
            }
          } catch {}
        } else {
          setInterim(interimText);
        }
      };

      recognition.onerror = () => setListening(false);
      recognition.onend = () => setListening(false);
      recognitionRef.current = recognition;
      recognition.start();
      setListening(true);
      await (window as any).api.voiceStartListening();
    }
  }, [listening, config.language]);

  const speakText = async (text: string) => {
    if (!config.autoSpeak) return;
    try {
      await (window as any).api.voiceSpeak({ text });
    } catch {}
  };

  const addCustomCommand = async () => {
    if (!newTrigger || !newAction) return;
    await (window as any).api.voiceAddCustomCommand({ trigger: newTrigger, action: newAction });
    setNewTrigger('');
    setNewAction('');
    loadCustomCommands();
  };

  const removeCustomCommand = async (trigger: string) => {
    await (window as any).api.voiceRemoveCustomCommand({ trigger });
    loadCustomCommands();
  };

  const updateWakeWord = async () => {
    await (window as any).api.voiceSetWakeWord({ word: wakeWord });
  };

  const updateConfig = async (partial: Partial<typeof config>) => {
    const newConfig = { ...config, ...partial };
    setConfig(newConfig);
    await (window as any).api.voiceConfigSet({ config: newConfig });
  };

  return (
    <div className="h-full flex flex-col bg-[var(--bg-primary)]">
      <div className="p-4 border-b border-[var(--border)]">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">Voice Assistant</h2>
            <p className="text-sm text-[var(--text-secondary)]">Speak commands or chat with voice</p>
          </div>
          <button
            onClick={() => setShowSettings(!showSettings)}
            className="p-2 rounded hover:bg-[var(--bg-tertiary)]"
          >
            <Settings size={16} />
          </button>
        </div>
      </div>

      {showSettings && (
        <div className="p-4 border-b border-[var(--border)] bg-[var(--bg-secondary)]">
          <div className="space-y-3">
            <div>
              <label className="text-sm text-[var(--text-secondary)]">Language</label>
              <select
                value={config.language}
                onChange={(e) => updateConfig({ language: e.target.value })}
                className="w-full mt-1 p-2 rounded bg-[var(--bg-primary)] border border-[var(--border)] text-sm"
              >
                <option value="en-US">English (US)</option>
                <option value="en-GB">English (UK)</option>
                <option value="es-ES">Spanish</option>
                <option value="fr-FR">French</option>
                <option value="de-DE">German</option>
                <option value="ja-JP">Japanese</option>
                <option value="zh-CN">Chinese</option>
              </select>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="text-sm text-[var(--text-secondary)]">Rate: {config.rate}</label>
                <input type="range" min="0.5" max="2" step="0.1" value={config.rate}
                  onChange={(e) => updateConfig({ rate: parseFloat(e.target.value) })}
                  className="w-full mt-1" />
              </div>
              <div>
                <label className="text-sm text-[var(--text-secondary)]">Pitch: {config.pitch}</label>
                <input type="range" min="0.5" max="2" step="0.1" value={config.pitch}
                  onChange={(e) => updateConfig({ pitch: parseFloat(e.target.value) })}
                  className="w-full mt-1" />
              </div>
              <div>
                <label className="text-sm text-[var(--text-secondary)]">Volume: {config.volume}</label>
                <input type="range" min="0" max="1" step="0.1" value={config.volume}
                  onChange={(e) => updateConfig({ volume: parseFloat(e.target.value) })}
                  className="w-full mt-1" />
              </div>
            </div>
            <div>
              <label className="text-sm text-[var(--text-secondary)]">Wake Word</label>
              <div className="flex gap-2 mt-1">
                <input
                  type="text"
                  value={wakeWord}
                  onChange={(e) => setWakeWord(e.target.value)}
                  className="flex-1 p-2 rounded bg-[var(--bg-primary)] border border-[var(--border)] text-sm"
                />
                <button onClick={updateWakeWord} className="px-3 py-2 rounded bg-[var(--accent)] text-white text-sm">
                  Set
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-auto p-4 space-y-4">
        <div className="flex flex-col items-center py-8">
          <button
            onClick={toggleListening}
            className={`w-24 h-24 rounded-full flex items-center justify-center transition-all ${
              listening
                ? 'bg-red-500/20 border-2 border-red-500 animate-pulse'
                : 'bg-[var(--bg-tertiary)] border-2 border-[var(--border)] hover:border-[var(--accent)]'
            }`}
          >
            {listening ? <MicOff size={32} className="text-red-400" /> : <Mic size={32} className="text-[var(--accent)]" />}
          </button>
          <p className="mt-3 text-sm text-[var(--text-secondary)]">
            {listening ? 'Listening... Click to stop' : 'Click to start listening'}
          </p>
          {interim && (
            <p className="mt-2 text-sm text-[var(--text-secondary)] italic max-w-md text-center">{interim}</p>
          )}
          {transcript && (
            <p className="mt-2 text-sm max-w-md text-center">{transcript}</p>
          )}
        </div>

        <div>
          <h3 className="text-sm font-medium mb-2 flex items-center gap-2">
            <Command size={14} /> Custom Commands
          </h3>
          <div className="space-y-2">
            {customCommands.map((cmd) => (
              <div key={cmd.trigger} className="flex items-center justify-between p-2 bg-[var(--bg-secondary)] rounded">
                <div className="text-sm">
                  <span className="font-mono text-[var(--accent)]">"{cmd.trigger}"</span>
                  <span className="text-[var(--text-secondary)] mx-2">→</span>
                  <span>{cmd.action}</span>
                </div>
                <button onClick={() => removeCustomCommand(cmd.trigger)} className="text-[var(--text-secondary)] hover:text-red-400">
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="Trigger phrase..."
                value={newTrigger}
                onChange={(e) => setNewTrigger(e.target.value)}
                className="flex-1 p-2 rounded bg-[var(--bg-secondary)] border border-[var(--border)] text-sm"
              />
              <input
                type="text"
                placeholder="Action text..."
                value={newAction}
                onChange={(e) => setNewAction(e.target.value)}
                className="flex-1 p-2 rounded bg-[var(--bg-secondary)] border border-[var(--border)] text-sm"
              />
              <button onClick={addCustomCommand} className="p-2 rounded bg-[var(--accent)] text-white">
                <Plus size={16} />
              </button>
            </div>
          </div>
        </div>

        <div>
          <h3 className="text-sm font-medium mb-2">Recent Commands</h3>
          <div className="space-y-1 max-h-48 overflow-auto">
            {history.slice().reverse().slice(0, 20).map((cmd) => (
              <div key={cmd.timestamp} className="p-2 bg-[var(--bg-secondary)] rounded text-sm">
                <span className="text-[var(--text-secondary)]">{cmd.intent || 'chat'}:</span>{' '}
                <span>{cmd.transcript}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
