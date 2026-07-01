import { useVoiceAssistant } from '../../hooks/useVoiceAssistant';

export function VoiceIndicator() {
  const { isListening, startListening, stopListening, isSupported } = useVoiceAssistant();

  if (!isSupported) {
    return (
      <div className="flex items-center gap-2 px-2 py-1 rounded border border-borderSubtle bg-bgMain text-textMuted text-[10px]">
        <span className="w-2 h-2 rounded-full bg-red-500" />
        Voice Unsupported
      </div>
    );
  }

  return (
    <button
      onClick={isListening ? stopListening : startListening}
      className={`flex items-center gap-2 px-2 py-1 rounded border transition-colors ${
        isListening
          ? 'bg-red-500/20 border-red-500/50 text-red-500'
          : 'bg-bgMain border-borderSubtle text-textMain hover:bg-bgPanel'
      }`}
    >
      <div className={`w-2 h-2 rounded-full ${isListening ? 'bg-red-500 animate-pulse' : 'bg-textMuted'}`} />
      <span className="text-[10px]">
        {isListening ? 'Listening...' : 'Start Voice'}
      </span>
    </button>
  );
}

