import React, { useEffect, useState, useRef } from 'react';
import { Settings, X, Save, Key, Cpu, Terminal, Database, Shield, Volume2 } from 'lucide-react';
import type { EngineConfig, LLMType } from '../utils/jarvisEngine';
import { speech } from '../utils/speech';
import { sounds } from '../utils/sounds';
import { API_BASE } from '../utils/apiConfig';

const DEFAULT_LMSTUDIO_URL = 'http://localhost:1234';

interface SettingsModalProps {
  config: EngineConfig;
  onSave: (config: Partial<EngineConfig>) => void;
  onClose: () => void;
}

export function SettingsModal({ config, onSave, onClose }: SettingsModalProps) {
  const [activeTab, setActiveTab] = useState<'settings' | 'logs' | 'data' | 'system'>('settings');
  const [backend, setBackend] = useState<LLMType>(config.backend);
  const [ollamaUrl, setOllamaUrl] = useState(config.ollamaUrl);
  const [ollamaModel, setOllamaModel] = useState(config.ollamaModel);
  const [geminiKey, setGeminiKey] = useState(config.geminiKey);
  const [groqKey, setGroqKey] = useState(config.groqKey);
  const [groqModel, setGroqModel] = useState(config.groqModel || 'llama-3.3-70b-versatile');
  const [lmstudioUrl, setLmstudioUrl] = useState(config.lmstudioUrl || DEFAULT_LMSTUDIO_URL);
  const [voiceName, setVoiceName] = useState(config.voiceName);
  const [speechRate, setSpeechRate] = useState(config.speechRate);
  
  const [customApiUrl, setCustomApiUrl] = useState(config.customApiUrl || 'http://192.168.56.1:1234/v1');
  const [customApiKey, setCustomApiKey] = useState(config.customApiKey || '');
  const [customApiModel, setCustomApiModel] = useState(config.customApiModel || 'qwen/qwen3-8b');
  
  const [availableVoices, setAvailableVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [showKey, setShowKey] = useState(false);

  // Logs state
  const [logType, setLogType] = useState('backend');
  const [logSearch, setLogSearch] = useState('');
  const [logText, setLogText] = useState('Loading logs...');

  // System info state
  const [systemInfo, setSystemInfo] = useState<any>(null);
  const [healthInfo, setHealthInfo] = useState<any>(null);

  // Backup states
  const [backups, setBackups] = useState<any[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load browser Speech Synthesis Voices
  useEffect(() => {
    const loadVoices = () => {
      const voices = speech.getVoices();
      setAvailableVoices(voices);
    };

    loadVoices();
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.onvoiceschanged = loadVoices;
    }
  }, []);

  // Fetch logs
  const fetchLogs = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/logs?type=${logType}`);
      if (res.ok) {
        const data = await res.json();
        setLogText(data.logs || '');
      }
    } catch {
      setLogText('Failed to read logs from backend server.');
    }
  };

  useEffect(() => {
    if (activeTab === 'logs') {
      fetchLogs();
      const interval = setInterval(fetchLogs, 3000);
      return () => clearInterval(interval);
    }
  }, [activeTab, logType]);

  // Fetch backups
  const fetchBackups = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/db/backups`);
      if (res.ok) {
        const data = await res.json();
        setBackups(data.backups || []);
      }
    } catch {}
  };

  useEffect(() => {
    if (activeTab === 'data') {
      fetchBackups();
    }
  }, [activeTab]);

  // Fetch system / health
  const fetchSystemInfo = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/system/info`);
      const health = await fetch(`${API_BASE}/api/system/health`);
      if (res.ok && health.ok) {
        setSystemInfo(await res.json());
        setHealthInfo(await health.json());
      }
    } catch {}
  };

  useEffect(() => {
    if (activeTab === 'system') {
      fetchSystemInfo();
      const interval = setInterval(fetchSystemInfo, 3000);
      return () => clearInterval(interval);
    }
  }, [activeTab]);

  const handleSave = () => {
    sounds.playSuccess();
    onSave({
      backend,
      ollamaUrl,
      ollamaModel,
      geminiKey,
      groqKey,
      groqModel,
      lmstudioUrl,
      customApiUrl,
      customApiKey,
      customApiModel,
      voiceName,
      speechRate
    });
    onClose();
  };

  const handleBackup = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/db/backup`, { method: 'POST' });
      if (res.ok) {
        sounds.playSuccess();
        fetchBackups();
      }
    } catch {
      sounds.playError();
    }
  };

  const handleRestore = async (filename: string) => {
    if (!confirm(`Are you sure you want to restore the database to backup point ${filename}? Current unsaved settings will be replaced.`)) return;
    try {
      const res = await fetch(`${API_BASE}/api/db/restore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename })
      });
      if (res.ok) {
        sounds.playSuccess();
        alert('Database restored successfully. Reloading...');
        window.location.reload();
      }
    } catch {
      sounds.playError();
    }
  };

  const handleExportConfig = async () => {
    try {
      const cRes = await fetch(`${API_BASE}/api/config`);
      const wRes = await fetch(`${API_BASE}/api/whatsapp/status`);
      if (cRes.ok && wRes.ok) {
        const cData = await cRes.json();
        const wData = await wRes.json();
        
        const payload = {
          version: 3,
          settings: cData,
          contacts: wData.contacts
        };
        
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `jarvis_config_v3_${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        sounds.playSuccess();
      }
    } catch {
      sounds.playError();
    }
  };

  const handleImportConfig = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const parsed = JSON.parse(evt.target?.result as string);
        if (parsed.version !== 3 || !parsed.settings) {
          alert('Invalid configuration file version. Version 3 expected.');
          sounds.playError();
          return;
        }

        await fetch(`${API_BASE}/api/config`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(parsed.settings)
        });

        if (parsed.contacts) {
          await fetch(`${API_BASE}/api/whatsapp/contacts`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contacts: parsed.contacts })
          });
        }

        sounds.playSuccess();
        alert('Configuration imported successfully. Reloading...');
        window.location.reload();
      } catch {
        sounds.playError();
        alert('Failed parsing configuration file.');
      }
    };
    reader.readAsText(file);
  };

  // Filter logs locally based on search input
  const getFilteredLogs = () => {
    if (!logSearch) return logText;
    return logText.split('\n')
      .filter(line => line.toLowerCase().includes(logSearch.toLowerCase()))
      .join('\n');
  };

  const handleCopyLogs = () => {
    navigator.clipboard.writeText(getFilteredLogs());
    sounds.playSuccess();
    alert('Logs copied to clipboard.');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-4">
      <div className="hud-panel w-full max-w-lg flex flex-col gap-3.5 relative animate-in fade-in zoom-in-95 duration-200">
        <div className="hud-corner-tl"></div>
        <div className="hud-corner-tr"></div>
        <div className="hud-corner-bl"></div>

        {/* Modal Header */}
        <div className="flex justify-between items-center border-b border-cyan-500/10 pb-2">
          <h3 className="text-sm tracking-wider uppercase font-header font-bold flex items-center gap-2 glow-text-cyan">
            <Settings className="w-4.5 h-4.5 text-cyan-400" />
            System Control Panel
          </h3>
          <button 
            onClick={() => { sounds.playPing(); onClose(); }}
            className="text-slate-400 hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Selection */}
        <div className="flex border-b border-cyan-500/10 text-[10px] font-mono uppercase font-bold">
          {['settings', 'logs', 'data', 'system'].map((t) => (
            <button
              key={t}
              onClick={() => { sounds.playPing(); setActiveTab(t as any); }}
              className={`flex-1 py-1.5 text-center border-b-2 transition-all ${
                activeTab === t ? 'border-cyan-500 text-cyan-400' : 'border-transparent text-slate-500 hover:text-slate-300'
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        {/* Modal Body */}
        <div className="flex-1 flex flex-col gap-3 min-h-[300px] max-h-[400px] overflow-y-auto pr-1 scrollbar-thin">
          
          {/* TAB 1: CORE SETTINGS */}
          {activeTab === 'settings' && (
            <div className="flex flex-col gap-3 animate-in fade-in duration-200">
              
              {/* SECTION 1: AI CORES BACKEND */}
              <div className="flex flex-col gap-2">
                <label className="text-[10px] uppercase font-mono tracking-widest text-slate-400 font-bold flex items-center gap-1.5">
                  <Cpu className="w-3.5 h-3.5 text-cyan-400" />
                  AI Cognitive Brain Backend
                </label>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                  {[
                    { id: 'offline', name: 'Offline', desc: 'Regex patterns (instant)' },
                    { id: 'ollama', name: 'Ollama', desc: 'Ollama models (port 11434)' },
                    { id: 'gemini', name: 'Gemini', desc: 'Gemini 2.5 Flash API' },
                    { id: 'groq', name: 'Groq', desc: 'Hosted fast Llama models' },
                    { id: 'lmstudio', name: 'LM Studio', desc: 'Local OpenAI server (port 1234)' },
                    { id: 'custom', name: 'Custom API', desc: 'Custom OpenAI-compatible provider' }
                  ].map((item) => (
                    <button
                      key={item.id}
                      onClick={() => { sounds.playPing(); setBackend(item.id as LLMType); }}
                      className={`border p-1.5 rounded text-left flex flex-col justify-between h-[75px] transition-all ${
                        backend === item.id 
                          ? 'bg-cyan-500/10 border-cyan-500 shadow-[0_0_10px_rgba(0,240,255,0.25)]' 
                          : 'bg-black/30 border-cyan-500/10 hover:border-cyan-500/30'
                      }`}
                    >
                      <span className={`text-[10px] font-header font-bold uppercase ${backend === item.id ? 'glow-text-cyan' : 'text-slate-300'}`}>
                        {item.name}
                      </span>
                      <span className="text-[8px] text-slate-500 mt-1 leading-normal">
                        {item.desc}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              {/* SECTION 2: AI BACKEND PARAMS */}
              {backend === 'gemini' && (
                <div className="flex flex-col gap-1 pt-1 border-t border-cyan-500/5 animate-in slide-in-from-top-1 duration-200">
                  <label className="text-[10px] uppercase font-mono text-slate-400 font-bold flex items-center gap-1">
                    <Key className="w-3 h-3 text-cyan-400" />
                    Gemini Developer API Key
                  </label>
                  <div className="flex gap-2">
                    <input
                      type={showKey ? 'text' : 'password'}
                      value={geminiKey}
                      onChange={(e) => setGeminiKey(e.target.value)}
                      className="hud-input flex-1 text-xs p-1.5 h-8 font-mono text-cyan-400"
                      placeholder="Enter API Key..."
                    />
                    <button 
                      onClick={() => setShowKey(!showKey)}
                      className="hud-btn px-2.5 text-[10px] h-8"
                    >
                      {showKey ? 'HIDE' : 'SHOW'}
                    </button>
                  </div>
                </div>
              )}

              {backend === 'groq' && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 pt-1 border-t border-cyan-500/5 animate-in slide-in-from-top-1 duration-200">
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] uppercase font-mono text-slate-400 font-bold">Groq Model</label>
                    <input
                      type="text"
                      value={groqModel}
                      onChange={(e) => setGroqModel(e.target.value)}
                      className="hud-input text-xs p-1.5 h-8 font-mono text-cyan-400"
                      placeholder="llama-3.3-70b-versatile"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] uppercase font-mono text-slate-400 font-bold flex items-center gap-1">
                      <Key className="w-3 h-3 text-cyan-400" />
                      Groq API Key
                    </label>
                    <input
                      type={showKey ? 'text' : 'password'}
                      value={groqKey}
                      onChange={(e) => setGroqKey(e.target.value)}
                      className="hud-input text-xs p-1.5 h-8 font-mono text-cyan-400"
                      placeholder="gsk-..."
                    />
                  </div>
                </div>
              )}

              {backend === 'ollama' && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 pt-1 border-t border-cyan-500/5 animate-in slide-in-from-top-1 duration-200">
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] uppercase font-mono text-slate-400 font-bold">Ollama API URL</label>
                    <input
                      type="text"
                      value={ollamaUrl}
                      onChange={(e) => setOllamaUrl(e.target.value)}
                      className="hud-input text-xs p-1.5 h-8 font-mono text-cyan-400"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] uppercase font-mono text-slate-400 font-bold">Ollama Model</label>
                    <input
                      type="text"
                      value={ollamaModel}
                      onChange={(e) => setOllamaModel(e.target.value)}
                      className="hud-input text-xs p-1.5 h-8 font-mono text-cyan-400"
                    />
                  </div>
                </div>
              )}

              {backend === 'lmstudio' && (
                <div className="flex flex-col gap-1 pt-1 border-t border-cyan-500/5 animate-in slide-in-from-top-1 duration-200">
                  <label className="text-[10px] uppercase font-mono text-slate-400 font-bold">LM Studio Server URL</label>
                  <input
                    type="text"
                    value={lmstudioUrl}
                    onChange={(e) => setLmstudioUrl(e.target.value)}
                    className="hud-input text-xs p-1.5 h-8 font-mono text-cyan-400"
                  />
                </div>
              )}

              {backend === 'custom' && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 pt-1 border-t border-cyan-500/5 animate-in slide-in-from-top-1 duration-200">
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] uppercase font-mono text-slate-400 font-bold">Custom API Base URL</label>
                    <input
                      type="text"
                      value={customApiUrl}
                      onChange={(e) => setCustomApiUrl(e.target.value)}
                      className="hud-input text-xs p-1.5 h-8 font-mono text-cyan-400"
                      placeholder="http://192.168.56.1:1234/v1"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] uppercase font-mono text-slate-400 font-bold">Custom API Model Name</label>
                    <input
                      type="text"
                      value={customApiModel}
                      onChange={(e) => setCustomApiModel(e.target.value)}
                      className="hud-input text-xs p-1.5 h-8 font-mono text-cyan-400"
                      placeholder="qwen/qwen3-8b"
                    />
                  </div>
                  <div className="flex flex-col gap-1 md:col-span-2">
                    <label className="text-[10px] uppercase font-mono text-slate-400 font-bold flex items-center gap-1">
                      Custom API Key (Optional)
                    </label>
                    <input
                      type="password"
                      value={customApiKey}
                      onChange={(e) => setCustomApiKey(e.target.value)}
                      className="hud-input text-xs p-1.5 h-8 font-mono text-cyan-400"
                      placeholder="sk-..."
                    />
                  </div>
                </div>
              )}

              {/* SECTION 3: VOICE SPEECH SYNTHESIS */}
              <div className="flex flex-col gap-2.5 border-t border-cyan-500/5 pt-2">
                <h4 className="text-[10px] font-mono font-bold tracking-widest uppercase text-slate-400 flex items-center gap-1.5">
                  <Volume2 className="w-3.5 h-3.5 text-cyan-400" />
                  Synthesizer Speech Settings (TTS)
                </h4>

                <div className="flex flex-col gap-1">
                  <label className="text-[10px] uppercase font-mono text-slate-400 font-bold">Select Voice Output</label>
                  {availableVoices.length === 0 ? (
                    <div className="text-[10px] text-slate-500 italic">Reading system speech libraries...</div>
                  ) : (
                    <select
                      value={voiceName}
                      onChange={(e) => { sounds.playPing(); setVoiceName(e.target.value); }}
                      className="hud-select w-full text-xs font-mono"
                    >
                      <option value="">Jarvis Core Default Voice</option>
                      {availableVoices.map((voice) => (
                        <option key={voice.name} value={voice.name}>
                          {voice.name} ({voice.lang})
                        </option>
                      ))}
                    </select>
                  )}
                </div>

                <div className="flex flex-col gap-1.5">
                  <div className="flex justify-between text-[10px] uppercase font-mono text-slate-400 font-bold">
                    <span>SPEECH SYNTHESIS VELOCITY</span>
                    <span className="text-cyan-400 font-bold">{speechRate}x</span>
                  </div>
                  <input
                    type="range"
                    min="0.5"
                    max="2.0"
                    step="0.05"
                    value={speechRate}
                    onChange={(e) => setSpeechRate(parseFloat(e.target.value))}
                    className="hud-slider"
                  />
                </div>
              </div>

            </div>
          )}

          {/* TAB 2: LOG VIEWER */}
          {activeTab === 'logs' && (
            <div className="flex flex-col gap-2.5 h-full animate-in fade-in duration-200">
              <div className="flex justify-between items-center gap-2">
                <select
                  value={logType}
                  onChange={(e) => { sounds.playPing(); setLogType(e.target.value); }}
                  className="hud-select text-[10px] py-0.5 px-2 bg-slate-950/60 border border-cyan-500/10 text-cyan-400 font-mono"
                >
                  <option value="backend">Backend (Core Server)</option>
                  <option value="electron">Electron (Host App)</option>
                  <option value="whatsapp">WhatsApp (Uplink Service)</option>
                  <option value="mcp">MCP (Plugin Processes)</option>
                </select>
                <input
                  type="text"
                  placeholder="Filter logs..."
                  value={logSearch}
                  onChange={(e) => setLogSearch(e.target.value)}
                  className="hud-input text-[10px] p-1 h-6 flex-1 max-w-[150px] font-mono text-cyan-400"
                />
                <button 
                  onClick={handleCopyLogs}
                  className="hud-btn py-0.5 px-2.5 text-[9px] h-6 flex items-center gap-1"
                >
                  <Terminal className="w-3 h-3" />
                  COPY LOGS
                </button>
              </div>
              <textarea
                value={getFilteredLogs()}
                readOnly
                className="w-full h-[250px] bg-black/60 border border-cyan-500/10 text-[9px] font-mono text-slate-300 p-2 rounded resize-none focus:outline-none"
              />
            </div>
          )}

          {/* TAB 3: DATA UTILITIES */}
          {activeTab === 'data' && (
            <div className="flex flex-col gap-3 h-full animate-in fade-in duration-200">
              
              {/* CONFIG IMPORT EXPORT */}
              <div className="flex flex-col gap-2 border-b border-cyan-500/5 pb-3">
                <h4 className="text-[10px] font-mono font-bold tracking-widest uppercase text-slate-400">Configuration Backup & Transfer</h4>
                <div className="flex gap-2">
                  <button
                    onClick={handleExportConfig}
                    className="hud-btn flex-1 py-1 h-8 text-[10px] text-cyan-400 border-cyan-500/10"
                  >
                    EXPORT CONFIG
                  </button>
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="hud-btn flex-1 py-1 h-8 text-[10px] text-cyan-400 border-cyan-500/10"
                  >
                    IMPORT CONFIG
                  </button>
                  <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleImportConfig}
                    accept=".json"
                    className="hidden"
                  />
                </div>
              </div>

              {/* MANUAL DB BACKUPS */}
              <div className="flex flex-col gap-2.5 flex-1">
                <div className="flex justify-between items-center">
                  <h4 className="text-[10px] font-mono font-bold tracking-widest uppercase text-slate-400 flex items-center gap-1">
                    <Database className="w-3.5 h-3.5 text-cyan-400" />
                    Database Restoration Archive
                  </h4>
                  <button
                    onClick={handleBackup}
                    className="hud-btn-active hud-btn py-0.5 px-2 text-[9px] h-6"
                  >
                    BACKUP NOW
                  </button>
                </div>

                <div className="border border-cyan-500/5 bg-black/40 rounded p-1.5 flex flex-col gap-1 max-h-[160px] overflow-y-auto scrollbar-thin">
                  {backups.length === 0 ? (
                    <span className="text-[9px] text-slate-500 italic font-mono p-1">No backups recorded.</span>
                  ) : (
                    backups.map((bak, idx) => (
                      <div key={idx} className="flex justify-between items-center text-[9px] font-mono bg-slate-950/30 px-2 py-1.5 rounded border border-cyan-500/5">
                        <div className="flex flex-col">
                          <span className="text-slate-300 font-bold">{bak.filename}</span>
                          <span className="text-slate-500 text-[8px] mt-0.5">Size: {bak.size} | Type: {bak.type}</span>
                        </div>
                        <button
                          onClick={() => handleRestore(bak.filename)}
                          className="hud-btn py-0 px-2 text-[8px] h-5"
                        >
                          RESTORE
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: SYSTEM INFO */}
          {activeTab === 'system' && (
            <div className="flex flex-col gap-3 h-full animate-in fade-in duration-200">
              <h4 className="text-[10px] font-mono font-bold tracking-widest uppercase text-slate-400 flex items-center gap-1">
                <Shield className="w-3.5 h-3.5 text-cyan-400" />
                Live Systems Specifications
              </h4>

              {systemInfo && healthInfo ? (
                <div className="flex flex-col gap-2 font-mono text-[9px] bg-black/40 p-2.5 rounded border border-cyan-500/5">
                  <div className="flex justify-between border-b border-cyan-500/5 pb-1">
                    <span className="text-slate-500">JARVIS VERSION:</span>
                    <span className="text-cyan-400 font-bold">{systemInfo.jarvisVersion}</span>
                  </div>
                  <div className="flex justify-between border-b border-cyan-500/5 pb-1">
                    <span className="text-slate-500">NODE RUNTIME:</span>
                    <span className="text-slate-300">{systemInfo.nodeVersion}</span>
                  </div>
                  <div className="flex justify-between border-b border-cyan-500/5 pb-1">
                    <span className="text-slate-500">OS PLATFORM:</span>
                    <span className="text-slate-300">{systemInfo.osPlatform} ({systemInfo.osRelease})</span>
                  </div>
                  <div className="flex justify-between border-b border-cyan-500/5 pb-1">
                    <span className="text-slate-500">PORTABLE STORAGE:</span>
                    <span className={systemInfo.isPortable ? "text-amber-400 font-bold" : "text-cyan-400"}>
                      {systemInfo.isPortable ? "YES (PORTABLE MODE)" : "NO (APPDATA)"}
                    </span>
                  </div>
                  <div className="flex justify-between border-b border-cyan-500/5 pb-1">
                    <span className="text-slate-500">DATABASE DIRECTORY:</span>
                    <span className="text-slate-300 select-all text-right max-w-[280px] break-all">{systemInfo.dbLocation}</span>
                  </div>
                  <div className="flex justify-between border-b border-cyan-500/5 pb-1">
                    <span className="text-slate-500">DATABASE FILE SIZE:</span>
                    <span className="text-slate-300">{healthInfo.dbSize}</span>
                  </div>
                  <div className="flex justify-between border-b border-cyan-500/5 pb-1">
                    <span className="text-slate-500">AI COGNITIVE MODEL:</span>
                    <span className="text-cyan-400 font-bold">{systemInfo.activeModel}</span>
                  </div>
                  <div className="flex justify-between border-b border-cyan-500/5 pb-1">
                    <span className="text-slate-500">ACTIVE MCP SERVERS:</span>
                    <span className="text-slate-300">{systemInfo.activeMcpServers.join(', ') || 'None connected'}</span>
                  </div>
                  <div className="flex justify-between border-b border-cyan-500/5 pb-1">
                    <span className="text-slate-500">CPU UPTIME:</span>
                    <span className="text-slate-300">{systemInfo.uptime} Seconds</span>
                  </div>
                  <div className="flex justify-between border-b border-cyan-500/5 pb-1">
                    <span className="text-slate-500">CPU HOST LOAD AVG:</span>
                    <span className="text-slate-300">{healthInfo.cpuLoad}%</span>
                  </div>
                  <div className="flex justify-between border-b border-cyan-500/5 pb-1">
                    <span className="text-slate-500">PROCESS MEMORY RSS:</span>
                    <span className="text-slate-300">{healthInfo.memoryUsage.rss}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">HTTP REQUESTS PROCESSED:</span>
                    <span className="text-slate-300">{healthInfo.requestsProcessed}</span>
                  </div>
                </div>
              ) : (
                <div className="text-[10px] text-slate-500 italic py-6 text-center animate-pulse">Querying system diagnostic streams...</div>
              )}
            </div>
          )}

        </div>

        {/* Modal Footer */}
        <div className="flex justify-end gap-2 border-t border-cyan-500/10 pt-2.5">
          <button
            onClick={() => { sounds.playPing(); onClose(); }}
            className="hud-btn border-cyan-500/20 text-slate-400 hover:text-white text-[10px] py-1 px-4 h-7"
          >
            Cancel
          </button>
          {activeTab === 'settings' && (
            <button
              onClick={handleSave}
              className="hud-btn-active hud-btn text-[10px] py-1 px-4 h-7"
            >
              <Save className="w-3.5 h-3.5" />
              Apply Settings
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
