import { useState, useRef, useEffect } from 'react';
import { Terminal, Send, Trash2, Filter, Mic, MicOff } from 'lucide-react';
import type { EngineLog } from '../utils/jarvisEngine';
import { sounds } from '../utils/sounds';
import { speech } from '../utils/speech';

interface TerminalConsoleProps {
  logs: EngineLog[];
  setLogs: React.Dispatch<React.SetStateAction<EngineLog[]>>;
  onSubmitCommand: (text: string) => void;
}

export function TerminalConsole({ logs, setLogs, onSubmitCommand }: TerminalConsoleProps) {
  const [inputValue, setInputValue] = useState('');
  const [filter, setFilter] = useState<'all' | 'input' | 'thought' | 'action' | 'output' | 'system'>('all');
  const [isListening, setIsListening] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const toggleSpeechInput = () => {
    if (isListening) {
      speech.stopListening();
      setIsListening(false);
      sounds.playPing();
      return;
    }

    if (!speech.isRecognitionSupported()) {
      sounds.playError();
      alert("Speech recognition is not supported in your browser.");
      return;
    }

    sounds.playActivation();
    setIsListening(true);

    speech.startListening(
      (result) => {
        setIsListening(false);
        if (result.trim()) {
          onSubmitCommand(result);
        }
      },
      () => {
        setIsListening(false);
      },
      (err) => {
        console.error("Terminal STT error:", err);
        setIsListening(false);
        sounds.playError();
      }
    );
  };

  // Auto scroll to bottom when new logs arrive
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputValue.trim()) return;

    sounds.playPing();
    onSubmitCommand(inputValue);
    setInputValue('');
  };

  const handleClearLogs = () => {
    sounds.playError();
    setLogs([
      {
        id: 'init',
        timestamp: new Date().toLocaleTimeString(),
        type: 'system',
        text: 'Terminal logs flushed. Secure console connection initialized.'
      }
    ]);
  };

  const filteredLogs = logs.filter((log) => {
    if (filter === 'all') return true;
    return log.type === filter;
  });

  const getLogStyle = (type: EngineLog['type']) => {
    switch (type) {
      case 'input':
        return 'text-slate-300';
      case 'thought':
        return 'text-purple-400 font-italic opacity-80';
      case 'action':
        return 'text-green-400 font-semibold';
      case 'output':
        return 'text-cyan-300 font-bold';
      case 'system':
        return 'text-amber-400/90 font-mono';
      case 'error':
        return 'text-red-400 font-bold glow-text-red';
      default:
        return 'text-slate-200';
    }
  };

  const getLogTag = (type: EngineLog['type']) => {
    switch (type) {
      case 'input': return '[USER]';
      case 'thought': return '[NEURAL]';
      case 'action': return '[IOT GRID]';
      case 'output': return '[JARVIS]';
      case 'system': return '[SYS]';
      case 'error': return '[ERR]';
    }
  };

  return (
    <div className="hud-panel h-full flex flex-col gap-3 font-mono text-xs">
      <div className="hud-corner-tl"></div>
      <div className="hud-corner-tr"></div>
      <div className="hud-corner-bl"></div>

      {/* Terminal Title Bar */}
      <div className="flex justify-between items-center border-b border-cyan-500/10 pb-2">
        <h3 className="text-sm tracking-wider glow-text-cyan uppercase flex items-center gap-2 font-bold font-header">
          <Terminal className="w-4 h-4" />
          Interactive Terminal Log
        </h3>
        
        {/* Buttons */}
        <div className="flex items-center gap-2">
          {/* Filters */}
          <div className="flex items-center gap-1 bg-black/40 p-0.5 rounded border border-cyan-500/10">
            <Filter className="w-3 h-3 text-cyan-400 ml-1.5" />
            <select
              value={filter}
              onChange={(e) => { sounds.playPing(); setFilter(e.target.value as any); }}
              className="bg-transparent border-none text-[10px] text-cyan-400 font-mono outline-none cursor-pointer pr-1"
            >
              <option value="all" className="bg-slate-900">ALL</option>
              <option value="input" className="bg-slate-900">USER</option>
              <option value="thought" className="bg-slate-900">NEURAL</option>
              <option value="action" className="bg-slate-900">IOT</option>
              <option value="output" className="bg-slate-900">JARVIS</option>
              <option value="system" className="bg-slate-900">SYSTEM</option>
            </select>
          </div>

          <button
            onClick={handleClearLogs}
            className="hud-btn p-1 px-2 text-[10px] text-red-400 hover:text-white hover:border-red-500 hover:shadow-[0_0_8px_rgba(255,0,85,0.4)]"
            title="Flush Terminal Cache"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* Logging output screen */}
      <div 
        ref={scrollRef}
        className="flex-1 bg-black/60 border border-cyan-500/10 rounded p-3 h-[250px] overflow-y-auto flex flex-col gap-1.5 scrollbar-thin select-text"
      >
        {filteredLogs.length === 0 ? (
          <div className="text-slate-500 italic text-center py-4">No records in this spectral range.</div>
        ) : (
          filteredLogs.map((log) => (
            <div key={log.id} className="leading-5 flex items-start gap-1">
              <span className="text-cyan-500/40 select-none">[{log.timestamp}]</span>
              <span className={`select-none mr-1 font-bold ${getLogStyle(log.type)}`}>
                {getLogTag(log.type)}
              </span>
              <span className={`${getLogStyle(log.type)} flex-1 break-words`}>
                {log.text}
              </span>
            </div>
          ))
        )}
      </div>

      {/* Input console */}
      <form onSubmit={handleSubmit} className="flex gap-2 relative">
        <span className="absolute left-2.5 top-[9px] text-cyan-400 animate-pulse font-bold pointer-events-none">&gt;</span>
        <input
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          placeholder="Issue keyboard command to JARVIS..."
          className="hud-input flex-1 pl-6 text-xs text-cyan-300 font-mono tracking-wide"
        />
        <button
          type="button"
          onClick={toggleSpeechInput}
          className={`hud-btn p-2 ${isListening ? 'bg-amber-500/25 border-amber-500 text-amber-400 shadow-[0_0_8px_rgba(255,170,0,0.4)] animate-pulse' : ''}`}
          title="Voice Command"
        >
          {isListening ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
        </button>
        <button
          type="submit"
          className="hud-btn-active hud-btn p-2"
          title="Send Instruction"
        >
          <Send className="w-3.5 h-3.5" />
        </button>
      </form>
    </div>
  );
}
