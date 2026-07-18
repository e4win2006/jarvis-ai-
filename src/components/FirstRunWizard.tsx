import { useState, useEffect } from 'react';
import { Shield, Cpu, ArrowRight, Check } from 'lucide-react';
import { sounds } from '../utils/sounds';
import { API_BASE } from '../utils/apiConfig';

interface FirstRunWizardProps {
  onComplete: () => void;
}

export function FirstRunWizard({ onComplete }: FirstRunWizardProps) {
  const [step, setStep] = useState(1);
  const [aiBackend, setAiBackend] = useState('offline');
  const [geminiKey, setGeminiKey] = useState('');
  const [ollamaUrl, setOllamaUrl] = useState('http://localhost:11434');
  const [lmstudioUrl, setLmstudioUrl] = useState('http://192.168.56.1:1234');
  
  // WhatsApp onboarding
  const [waEnabled, setWaEnabled] = useState(false);
  const [waStatus, setWaStatus] = useState('DISCONNECTED');
  const [waQr, setWaQr] = useState('');

  // MCP policies onboarding
  const [mcpPolicies, setMcpPolicies] = useState<Record<string, 'enabled' | 'disabled' | 'manual'>>({
    playwright: 'enabled',
    filesystem: 'enabled',
    github: 'enabled'
  });

  const handleStorageSelect = async (portable: boolean) => {
    sounds.playPing();
    try {
      await fetch(`${API_BASE}/api/system/set-portable`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ portable })
      });
    } catch (e) {
      console.error(e);
    }
    setStep(2);
  };

  const handleSaveAIConfig = async () => {
    sounds.playPing();
    try {
      await fetch(`${API_BASE}/api/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ai_backend: aiBackend.toUpperCase(),
          gemini_key: geminiKey,
          ollama_url: ollamaUrl,
          lmstudio_url: lmstudioUrl
        })
      });
    } catch (e) {
      console.error(e);
    }
    setStep(3);
  };

  const handleSaveMCPPolicies = async () => {
    sounds.playPing();
    // Prepare updated config
    const mcpServers = {
      playwright: {
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-playwright"],
        startupPolicy: mcpPolicies.playwright
      },
      filesystem: {
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-filesystem", "C:\\Users"],
        startupPolicy: mcpPolicies.filesystem
      },
      github: {
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-github"],
        startupPolicy: mcpPolicies.github
      }
    };
    try {
      // Save config json to server
      await fetch(`${API_BASE}/api/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mcp_servers_json: JSON.stringify(mcpServers)
        })
      });
      // Force mcp reload
      await fetch(`${API_BASE}/api/mcp/reload`, { method: 'POST' });
    } catch (e) {
      console.error(e);
    }
    setStep(4);
  };

  const handleToggleWhatsApp = async () => {
    sounds.playPing();
    const target = !waEnabled;
    setWaEnabled(target);
    try {
      await fetch(`${API_BASE}/api/whatsapp/toggle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: target })
      });
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    if (step !== 4) return;
    const fetchStatus = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/whatsapp/status`);
        if (res.ok) {
          const data = await res.json();
          setWaStatus(data.status);
          setWaQr(data.qrCodeBase64);
        }
      } catch {}
    };

    fetchStatus();
    const interval = setInterval(fetchStatus, 3000);
    return () => clearInterval(interval);
  }, [step]);

  const handleFinish = () => {
    sounds.playSuccess();
    localStorage.setItem('jarvis_onboarding_done', 'true');
    onComplete();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950 p-4 font-mono select-none">
      <div className="hud-panel w-full max-w-lg flex flex-col gap-5 p-6 relative">
        <div className="hud-corner-tl"></div>
        <div className="hud-corner-tr"></div>
        <div className="hud-corner-bl"></div>

        {/* Header */}
        <div className="border-b border-cyan-500/20 pb-3 flex justify-between items-center">
          <h2 className="text-md tracking-wider uppercase font-bold text-cyan-400 flex items-center gap-2 glow-text-cyan">
            <Shield className="w-5 h-5 text-cyan-400" />
            JARVIS Onboarding Core
          </h2>
          <span className="text-[10px] text-slate-500">STEP {step} / 5</span>
        </div>

        {/* Step Body */}
        <div className="flex-1 min-h-[220px]">
          
          {/* STEP 1: WELCOME & STORAGE MODE */}
          {step === 1 && (
            <div className="flex flex-col gap-4 animate-in fade-in duration-200">
              <p className="text-xs leading-relaxed text-slate-400">
                Welcome to JARVIS, the advanced personal system assistant. Let us configure your local storage link parameter.
              </p>
              <div className="flex flex-col gap-2 pt-2">
                <button
                  onClick={() => handleStorageSelect(false)}
                  className="border border-cyan-500/20 hover:border-cyan-400 bg-black/40 hover:bg-cyan-500/5 p-3 rounded text-left flex flex-col justify-between transition-all"
                >
                  <span className="text-xs font-bold text-cyan-400 uppercase">Standard Installation (AppData)</span>
                  <span className="text-[9px] text-slate-500 mt-1">Saves all configuration, databases, and logs in standard user AppData (Recommended for standard Windows PCs).</span>
                </button>
                <button
                  onClick={() => handleStorageSelect(true)}
                  className="border border-cyan-500/20 hover:border-cyan-400 bg-black/40 hover:bg-cyan-500/5 p-3 rounded text-left flex flex-col justify-between transition-all"
                >
                  <span className="text-xs font-bold text-cyan-400 uppercase">Portable mode</span>
                  <span className="text-[9px] text-slate-500 mt-1">Stores everything inside the application folder beside JARVIS.exe. Highly suited for USB flash drives and portable setups.</span>
                </button>
              </div>
            </div>
          )}

          {/* STEP 2: AI BACKEND */}
          {step === 2 && (
            <div className="flex flex-col gap-3.5 animate-in fade-in duration-200">
              <label className="text-[10px] uppercase text-slate-400 font-bold flex items-center gap-1.5">
                <Cpu className="w-3.5 h-3.5 text-cyan-400" />
                Select AI Cognitive Brain Provider
              </label>
              <div className="grid grid-cols-2 gap-2">
                {['offline', 'gemini', 'ollama', 'lmstudio'].map((backend) => (
                  <button
                    key={backend}
                    onClick={() => { sounds.playPing(); setAiBackend(backend); }}
                    className={`border p-2 rounded text-left transition-all ${
                      aiBackend === backend 
                        ? 'bg-cyan-500/10 border-cyan-500' 
                        : 'bg-black/30 border-cyan-500/10 hover:border-cyan-500/30'
                    }`}
                  >
                    <span className="text-[10px] font-bold uppercase text-slate-300 block">{backend}</span>
                  </button>
                ))}
              </div>

              {aiBackend === 'gemini' && (
                <div className="flex flex-col gap-1 pt-1.5">
                  <label className="text-[10px] uppercase text-slate-500">Gemini developer API Key</label>
                  <input
                    type="password"
                    placeholder="Enter key..."
                    value={geminiKey}
                    onChange={(e) => setGeminiKey(e.target.value)}
                    className="hud-input text-xs p-1.5 h-8 w-full"
                  />
                </div>
              )}

              {aiBackend === 'ollama' && (
                <div className="flex flex-col gap-1 pt-1.5">
                  <label className="text-[10px] uppercase text-slate-500">Ollama API Connection URL</label>
                  <input
                    type="text"
                    value={ollamaUrl}
                    onChange={(e) => setOllamaUrl(e.target.value)}
                    className="hud-input text-xs p-1.5 h-8 w-full"
                  />
                </div>
              )}

              {aiBackend === 'lmstudio' && (
                <div className="flex flex-col gap-1 pt-1.5">
                  <label className="text-[10px] uppercase text-slate-500">LM Studio Local Server URL</label>
                  <input
                    type="text"
                    value={lmstudioUrl}
                    onChange={(e) => setLmstudioUrl(e.target.value)}
                    className="hud-input text-xs p-1.5 h-8 w-full"
                  />
                </div>
              )}

              <button
                onClick={handleSaveAIConfig}
                className="hud-btn-active hud-btn py-1 h-8 mt-2 self-end px-6 flex items-center gap-1.5"
              >
                Continue <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* STEP 3: MCP POLICIES */}
          {step === 3 && (
            <div className="flex flex-col gap-3.5 animate-in fade-in duration-200">
              <label className="text-[10px] uppercase text-slate-400 font-bold">
                Configure MCP Server Startup Policies
              </label>
              <p className="text-[9px] text-slate-500 leading-normal">
                Determine which native tools auto-launch on boot to optimize hardware memory.
              </p>
              
              <div className="flex flex-col gap-2 mt-1">
                {['playwright', 'filesystem', 'github'].map((srv) => (
                  <div key={srv} className="flex justify-between items-center bg-black/40 border border-cyan-500/5 p-2 rounded">
                    <span className="text-[11px] font-bold uppercase text-slate-300">{srv} Server</span>
                    <select
                      value={mcpPolicies[srv]}
                      onChange={(e) => setMcpPolicies({ ...mcpPolicies, [srv]: e.target.value as any })}
                      className="hud-select text-[9px] py-0.5 px-2 bg-slate-950 border border-cyan-500/10 text-cyan-400 font-mono"
                    >
                      <option value="enabled">Enabled (Auto-start)</option>
                      <option value="disabled">Disabled (Do not run)</option>
                      <option value="manual">Manual (On reload)</option>
                    </select>
                  </div>
                ))}
              </div>

              <button
                onClick={handleSaveMCPPolicies}
                className="hud-btn-active hud-btn py-1 h-8 mt-2 self-end px-6 flex items-center gap-1.5"
              >
                Continue <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* STEP 4: WHATSAPP QR SCAN */}
          {step === 4 && (
            <div className="flex flex-col gap-3 animate-in fade-in duration-200 text-center items-center">
              <label className="text-[10px] uppercase text-slate-400 font-bold tracking-wider">
                WhatsApp Assistant Uplink Setup
              </label>
              
              {!waEnabled ? (
                <div className="py-6 flex flex-col items-center gap-4">
                  <p className="text-xs text-slate-500 max-w-sm">
                    Activate the WhatsApp Assistant link. This is entirely optional and can be managed later.
                  </p>
                  <button
                    onClick={handleToggleWhatsApp}
                    className="hud-btn-active hud-btn py-1 h-8 px-6 text-xs uppercase"
                  >
                    Activate Uplink
                  </button>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-3">
                  {waStatus === 'INITIALIZING' && (
                    <span className="text-[10px] text-cyan-400 animate-pulse my-6">[INITIALISING CHROMIUM CONTROLLERS...]</span>
                  )}
                  {waStatus === 'SCANNING_QR' && waQr ? (
                    <div className="flex flex-col items-center gap-1.5 p-2 bg-white rounded border border-cyan-500/20">
                      <img src={waQr} alt="WhatsApp QR" className="w-[120px] h-[120px] block" />
                      <span className="text-[8px] font-mono text-black font-bold uppercase tracking-wider">Scan with WhatsApp</span>
                    </div>
                  ) : waStatus === 'CONNECTED' ? (
                    <div className="text-green-400 font-bold text-xs flex flex-col items-center gap-2 my-6">
                      <Check className="w-6 h-6 text-green-400" />
                      <span>🟢 LINK OPERATIONALLY ACTIVE</span>
                    </div>
                  ) : null}

                  <button
                    onClick={() => handleToggleWhatsApp()}
                    className="text-[9px] text-red-400 hover:text-red-300 font-bold uppercase underline"
                  >
                    Deactivate Uplink
                  </button>
                </div>
              )}

              <button
                onClick={() => setStep(5)}
                className="hud-btn border-cyan-500/20 text-slate-400 py-1 h-8 mt-2 self-end px-6 flex items-center gap-1.5 hover:text-white"
              >
                Skip / Continue <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* STEP 5: ONBOARDING COMPLETION */}
          {step === 5 && (
            <div className="flex flex-col gap-4 text-center items-center py-4 animate-in fade-in duration-200">
              <div className="w-12 h-12 rounded-full border border-cyan-500 flex items-center justify-center bg-cyan-500/5 shadow-[0_0_15px_rgba(0,240,255,0.3)] animate-pulse">
                <Check className="w-6 h-6 text-cyan-400" />
              </div>
              <h3 className="text-sm font-bold text-cyan-400 uppercase tracking-widest glow-text-cyan mt-2">SYSTEM CONFIGURATION NOMINAL</h3>
              <p className="text-[10px] text-slate-500 max-w-sm leading-relaxed">
                Onboarding successfully completed. System files initialized, secrets encryption active, and configurations loaded. Accessing central console dashboard...
              </p>
              <button
                onClick={handleFinish}
                className="hud-btn-active hud-btn py-1 h-8 px-10 text-xs uppercase mt-3"
              >
                Access Dashboard
              </button>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
