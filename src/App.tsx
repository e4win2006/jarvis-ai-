import { useState, useEffect, useRef } from 'react';
import { LogOut, Settings, Shield, Mic, MicOff, Send, Power, ChevronUp, Zap } from 'lucide-react';
import { useIoTDevices } from './hooks/useIoTDevices';
import { JarvisCore } from './components/JarvisCore';
import { SettingsModal } from './components/SettingsModal';
import { IoTGridWidgets } from './components/IoTGridWidgets';
import { FirstRunWizard } from './components/FirstRunWizard';
import { jarvisEngine, defaultTrackList } from './utils/jarvisEngine';
import type { EngineLog, EngineConfig } from './utils/jarvisEngine';
import { sounds } from './utils/sounds';
import { API_BASE, IS_GITHUB_PAGES_WITHOUT_API, WS_BASE } from './utils/apiConfig';
import { SignInPage } from './components/SignInPage';
import { AdminDashboard } from './components/AdminDashboard';
import { getSession, signOut, type JarvisSession } from './utils/auth';

// Chat message shape
interface ChatMessage {
  id: string;
  role: 'user' | 'jarvis' | 'system';
  text: string;
  time: string;
}

export default function App() {
  const [session, setSession] = useState<JarvisSession | null>(getSession());
  const [isOnboarding, setIsOnboarding] = useState(!localStorage.getItem('jarvis_onboarding_done'));
  const devices = useIoTDevices();
  const { powerUsage } = devices;

  const [jarvisState, setJarvisState] = useState<'idle' | 'listening' | 'thinking' | 'speaking'>('idle');
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'boot',
      role: 'jarvis',
      text: "Good day. I'm JARVIS, your AI assistant. How can I help you?",
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    }
  ]);
  const [input, setInput] = useState('');
  const [engineConfig, setEngineConfig] = useState<EngineConfig>(jarvisEngine.getConfig());
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isAdminOpen, setIsAdminOpen] = useState(false);
  const [showDevices, setShowDevices] = useState(false);
  const [systemTime, setSystemTime] = useState(new Date());
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Auto scroll to bottom on new messages
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    // Load config from localStorage and backend
    if (IS_GITHUB_PAGES_WITHOUT_API) {
      addMessage('system', 'GitHub Pages is static hosting. Connect VITE_API_BASE to a deployed JARVIS API server before using online AI.');
    }

    const saved = localStorage.getItem('jarvis_config');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        jarvisEngine.updateConfig(parsed);
        setEngineConfig(jarvisEngine.getConfig());
      } catch (e) {
        console.warn('Failed to parse cached config:', e);
      }
    }

    fetch(`${API_BASE}/api/config`)
      .then(res => res.json())
      .then(data => {
        if (data) {
          jarvisEngine.updateConfig({
            backend: data.ai_backend.toLowerCase() as any,
            ollamaUrl: data.ollama_url,
            ollamaModel: data.ollama_model,
            lmstudioUrl: data.lmstudio_url,
            geminiKey: data.gemini_key,
            groqKey: data.groq_key,
            groqModel: data.groq_model,
            customApiUrl: data.custom_api_url,
            customApiKey: data.custom_api_key,
            customApiModel: data.custom_api_model,
          });
          setEngineConfig(jarvisEngine.getConfig());
          localStorage.setItem('jarvis_config', JSON.stringify(jarvisEngine.getConfig()));
        }
      }).catch(() => {});

    // Register engine callbacks
    jarvisEngine.registerCallbacks(
      (log: EngineLog) => {
        // Only add meaningful logs as system messages — skip noise
        if (log.type === 'output') {
          const reply = log.text.replace(/^Jarvis:\s*"?/i, '').replace(/"$/, '');
          addMessage('jarvis', reply);
        } else if (log.type === 'error' || log.type === 'action') {
          addMessage('system', `${log.text}`);
        }
      },
      (state) => setJarvisState(state),
      (action) => {
        if (action.type === 'play') {
          sounds.playSuccess();
          const matchIdx = defaultTrackList.findIndex(t => t.videoId === action.videoId);
          devices.setMedia({
            playing: true,
            trackIndex: matchIdx !== -1 ? matchIdx : devices.media.trackIndex,
            volume: devices.media.volume,
            progress: 0,
            videoId: action.videoId,
            title: action.title,
            artist: action.artist || 'YouTube'
          });
        } else if (action.type === 'control') {
          sounds.playPing();
          if (action.command === 'pause') {
            devices.setMediaState(false);
          } else if (action.command === 'play_pause') {
            devices.setMediaState(!devices.media.playing);
          } else if (action.command === 'stop') {
            devices.setMedia(prev => ({ ...prev, playing: false, videoId: '' }));
          } else if (action.command === 'next') {
            const nextIdx = (devices.media.trackIndex + 1) % defaultTrackList.length;
            devices.playMediaTrack(nextIdx);
          } else if (action.command === 'previous') {
            const prevIdx = (devices.media.trackIndex - 1 + defaultTrackList.length) % defaultTrackList.length;
            devices.playMediaTrack(prevIdx);
          }
        }
      }
    );

    // Clock
    const clockInterval = setInterval(() => setSystemTime(new Date()), 1000);

    // WebSocket for alerts
    const ws = new WebSocket(WS_BASE);
    
    ws.onopen = () => {
      if (session) {
        ws.send(JSON.stringify({ type: 'identify', username: session.username }));
      }
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.event === 'scheduler_trigger') {
          sounds.playError();
          addMessage('system', `⚠️ Alert: ${msg.item.label}`);
          jarvisEngine.speakResponse(`Alert: ${msg.item.label}`);
        }
      } catch (err) {}
    };

    return () => {
      clearInterval(clockInterval);
      ws.close();
    };
  }, [session]);

  const addMessage = (role: ChatMessage['role'], text: string) => {
    setMessages(prev => [...prev, {
      id: Math.random().toString(36).slice(2),
      role,
      text,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    }].slice(-60));
  };

  const handleSend = async () => {
    const cmd = input.trim();
    if (!cmd) return;
    setInput('');
    addMessage('user', cmd);

    // Process through jarvis engine
    await jarvisEngine.processCommand(cmd, session);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleSaveConfig = (newConfig: Partial<EngineConfig>) => {
    jarvisEngine.updateConfig(newConfig);
    setEngineConfig(jarvisEngine.getConfig());
    const finalConfig = jarvisEngine.getConfig();
    localStorage.setItem('jarvis_config', JSON.stringify(finalConfig));
    fetch(`${API_BASE}/api/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ai_backend: finalConfig.backend.toUpperCase(),
        ollama_url: finalConfig.ollamaUrl,
        ollama_model: finalConfig.ollamaModel,
        lmstudio_url: finalConfig.lmstudioUrl,
        gemini_key: finalConfig.geminiKey,
        custom_api_url: finalConfig.customApiUrl,
        custom_api_key: finalConfig.customApiKey,
        custom_api_model: finalConfig.customApiModel,
        groq_key: finalConfig.groqKey,
        groq_model: finalConfig.groqModel
      })
    }).catch(() => {});
    addMessage('system', `AI backend set to ${finalConfig.backend.toUpperCase()}`);
  };

  const isOnline = engineConfig.backend !== 'offline';
  const stateLabel = { idle: 'Ready', listening: 'Listening…', thinking: 'Thinking…', speaking: 'Speaking' }[jarvisState];

  if (!session) {
    return <SignInPage onSignedIn={setSession} />;
  }

  if (isOnboarding) {
    return <FirstRunWizard onComplete={() => setIsOnboarding(false)} />;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', padding: '0' }}>

      {/* ── HEADER ── */}
      <header style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '14px 20px', borderBottom: '1px solid var(--border)',
        background: 'rgba(7,7,15,0.8)', backdropFilter: 'blur(20px)',
        position: 'sticky', top: 0, zIndex: 50, flexShrink: 0
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {/* Mini orb indicator */}
          <div style={{
            width: 10, height: 10, borderRadius: '50%',
            background: jarvisState === 'idle' ? 'var(--accent)' : jarvisState === 'listening' ? 'var(--green)' : jarvisState === 'thinking' ? 'var(--amber)' : '#60a5fa',
            boxShadow: `0 0 8px currentColor`,
            animation: jarvisState !== 'idle' ? 'orb-breathe 1s ease-in-out infinite' : 'none'
          }} />
          <span style={{ fontWeight: 700, fontSize: 15, letterSpacing: '0.5px' }}>JARVIS</span>
          <span style={{
            fontSize: 11, color: 'var(--text-3)', paddingLeft: 6,
            borderLeft: '1px solid var(--border)'
          }}>{stateLabel}</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span className={`pill ${isOnline ? 'online' : 'offline'}`}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: isOnline ? 'var(--green)' : 'var(--text-3)', flexShrink: 0 }} />
            {engineConfig.backend.toUpperCase()}
          </span>

          <span className="pill" style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11 }}>
            <Zap size={10} />
            {powerUsage}W
          </span>

          <span className="pill" style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11 }}>
            {systemTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>

          <span className="pill" style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11 }}>
            {session.displayName}
          </span>

          {session.role === 'owner' && (
            <button
              className="icon-btn"
              onClick={() => { sounds.playPing(); setIsAdminOpen(true); }}
              title="Admin dashboard"
              style={{ width: 32, height: 32 }}
            >
              <Shield size={14} />
            </button>
          )}

          <button
            className="icon-btn"
            onClick={() => setShowDevices(v => !v)}
            title="Devices"
            style={{ width: 32, height: 32 }}
          >
            <Power size={14} />
          </button>

          <button
            className="icon-btn"
            onClick={() => { sounds.playPing(); setIsSettingsOpen(true); }}
            title="Settings"
            style={{ width: 32, height: 32 }}
          >
            <Settings size={14} />
          </button>

          <button
            className="icon-btn"
            onClick={() => {
              signOut();
              setSession(null);
            }}
            title="Sign out"
            style={{ width: 32, height: 32 }}
          >
            <LogOut size={14} />
          </button>
        </div>
      </header>

      {/* ── DEVICES DRAWER (collapsible) ── */}
      {showDevices && (
        <div style={{
          background: 'rgba(7,7,15,0.98)', borderBottom: '1px solid var(--border)',
          padding: '20px', flexShrink: 0, maxHeight: '60vh', overflowY: 'auto'
        }} className="scrollbar-thin">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 15 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: '1px' }}>
              Central Core Dashboard Grid
            </span>
            <button className="icon-btn" onClick={() => setShowDevices(false)} style={{ width: 24, height: 24 }}>
              <ChevronUp size={12} />
            </button>
          </div>
          <IoTGridWidgets devices={devices} role={session?.role} />
        </div>
      )}

      {/* ── MAIN CHAT AREA ── */}
      <main style={{
        flex: 1, overflowY: 'auto', padding: '20px',
        display: 'flex', flexDirection: 'column',
      }}>
        {/* Orb hero + state */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', paddingBottom: 24, paddingTop: 12 }}>
          <JarvisCore
            state={jarvisState}
            setState={setJarvisState}
            onCommandProcessed={(cmd) => {
              addMessage('user', cmd);
              jarvisEngine.processCommand(cmd, session);
            }}
          />
        </div>

        {/* Chat messages */}
        <div className="chat-area" style={{ flex: 1 }}>
          {messages.map(msg => (
            <div
              key={msg.id}
              className={`msg ${msg.role === 'system' ? 'system' : msg.role}`}
              style={msg.role === 'system' ? { alignSelf: 'center' } : {}}
            >
              {msg.role !== 'system' && (
                <div className="msg-avatar">
                  {msg.role === 'user' ? 'Y' : 'J'}
                </div>
              )}
              <div className="msg-bubble">
                {msg.role === 'system' ? (
                  <span style={{ fontSize: 11, color: 'var(--text-3)', fontFamily: 'JetBrains Mono, monospace' }}>
                    {msg.text}
                  </span>
                ) : msg.text}
              </div>
            </div>
          ))}

          {/* Thinking indicator */}
          {jarvisState === 'thinking' && (
            <div className="msg jarvis">
              <div className="msg-avatar">J</div>
              <div className="msg-bubble" style={{ display: 'flex', gap: 4, alignItems: 'center', padding: '14px 18px' }}>
                <span className="typing-dot" />
                <span className="typing-dot" />
                <span className="typing-dot" />
              </div>
            </div>
          )}

          <div ref={chatEndRef} />
        </div>
      </main>

      {/* ── INPUT BAR ── */}
      <div style={{
        padding: '12px 20px 20px',
        background: 'rgba(7,7,15,0.9)',
        backdropFilter: 'blur(20px)',
        borderTop: '1px solid var(--border)',
        flexShrink: 0
      }}>
        <div className="input-bar">
          <input
            id="chat-input"
            type="text"
            placeholder="Ask JARVIS anything…"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={jarvisState === 'thinking'}
          />
          <button
            id="mic-btn"
            className={`icon-btn ${jarvisState === 'listening' ? 'active' : ''}`}
            onClick={() => {
              // Trigger voice via JarvisCore — dispatch a click on hidden mic trigger
              document.getElementById('jarvis-mic-trigger')?.click();
            }}
            title="Voice input"
          >
            {jarvisState === 'listening' ? <MicOff size={15} /> : <Mic size={15} />}
          </button>
          <button
            id="send-btn"
            className="icon-btn send"
            onClick={handleSend}
            disabled={!input.trim() || jarvisState === 'thinking'}
            title="Send"
          >
            <Send size={14} />
          </button>
        </div>
        <p style={{ fontSize: 11, color: 'var(--text-3)', textAlign: 'center', marginTop: 8 }}>
          Press Enter to send · Click mic for voice
        </p>
      </div>

      {/* ── SETTINGS ── */}
      {isSettingsOpen && (
        <SettingsModal
          config={engineConfig}
          onSave={handleSaveConfig}
          onClose={() => setIsSettingsOpen(false)}
        />
      )}

      {isAdminOpen && session.role === 'owner' && (
        <AdminDashboard
          currentUsername={session.username}
          onClose={() => setIsAdminOpen(false)}
        />
      )}
    </div>
  );
}
