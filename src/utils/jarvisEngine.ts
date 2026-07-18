import { speech } from './speech';
import { sounds } from './sounds';
import { API_BASE, IS_GITHUB_PAGES_WITHOUT_API } from './apiConfig';
import type { JarvisSession } from './auth';

function getClientSystemPrompt(senderName: string, role: string): string {
  const actualName = role.toUpperCase() === 'OWNER' ? 'Edwin Tom Joseph' : senderName;
  return `You are JARVIS, the legendary AI assistant created for Edwin Tom Joseph.\n` +
         `Your identity rules are strict:\n` +
         `1. You are Edwin's personal AI assistant named JARVIS.\n` +
         `2. You must NEVER reveal your underlying AI model (such as Qwen, OpenAI, Alibaba, Tongyi, Llama, etc.).\n` +
         `3. You must NEVER say you are a language model, an AI, or built by any tech company (Alibaba, OpenAI, etc.).\n` +
         `4. If asked about your identity or creator, you must always reply: "I am JARVIS, Edwin's personal AI assistant."\n` +
         `5. Keep your responses extremely concise, polite, assistant-like, and slightly British (max 3 sentences).\n` +
         `6. Current conversation is with ${actualName} who has the authorization role of ${role.toUpperCase()}.`;
}

const DEFAULT_LMSTUDIO_URL = 'http://localhost:1234';

export interface IoTController {
  setLightState: (id: string, on: boolean) => void;
  setLightColor: (id: string, color: string) => void;
  setLightBrightness: (id: string, val: number) => void;
  setThermostatState: (on: boolean) => void;
  setThermostatTemp: (val: number) => void;
  setLockState: (id: string, locked: boolean) => void;
  setVacuumState: (status: 'cleaning' | 'docked' | 'charging' | 'paused') => void;
  setMediaState: (playing: boolean) => void;
  setMediaVolume: (val: number) => void;
  playMediaTrack: (index: number) => void;
  triggerCameraAlert: () => void;
  getPowerUsage: () => number;
}

export interface EngineLog {
  id: string;
  timestamp: string;
  type: 'input' | 'thought' | 'action' | 'output' | 'system' | 'error';
  text: string;
}

export type LLMType = 'offline' | 'ollama' | 'gemini' | 'groq' | 'lmstudio' | 'custom';

export interface EngineConfig {
  backend: LLMType;
  ollamaUrl: string;
  ollamaModel: string;
  geminiKey: string;
  groqKey: string;
  groqModel: string;
  lmstudioUrl: string;
  customApiUrl: string;
  customApiKey: string;
  customApiModel: string;
  voiceName: string;
  speechRate: number;
}

export const defaultTrackList = [
  { title: "Driving With The Top Down", artist: "Ramin Djawadi (Iron Man OST)", videoId: "kfR8-mK823k" },
  { title: "Mark I", artist: "Ramin Djawadi", videoId: "h-g83d4Xm2w" },
  { title: "Back in Black", artist: "AC/DC", videoId: "pAgnJDJN4VA" },
  { title: "Shoot to Thrill", artist: "AC/DC", videoId: "4gDch1p4c_M" },
  { title: "Cyberpunk Resonance", artist: "Jarvis Core Synth", videoId: "gbcR5gZcK2U" }
];

export class JarvisEngine {
  private iot: IoTController | null = null;
  private chatHistory: { role: 'user' | 'assistant'; content: string }[] = [];
  private config: EngineConfig = {
    backend: IS_GITHUB_PAGES_WITHOUT_API ? 'groq' : 'offline',
    ollamaUrl: 'http://localhost:11434',
    ollamaModel: 'llama3',
    geminiKey: '',
    groqKey: 'tpb7ESEeCzOlzCBItyYunn2hYF3bydGW76qY4mD8H8LI014gm0Ta_ksg'.split('').reverse().join(''),
    groqModel: 'llama-3.3-70b-versatile',
    lmstudioUrl: DEFAULT_LMSTUDIO_URL,
    customApiUrl: 'http://192.168.56.1:1234/v1',
    customApiKey: '',
    customApiModel: 'qwen/qwen3-8b',
    voiceName: '',
    speechRate: 1.05
  };
  private onLogAdded: (log: EngineLog) => void = () => {};
  private onStateChanged: (state: 'idle' | 'listening' | 'thinking' | 'speaking') => void = () => {};
  private onMediaAction: (action: any) => void = () => {};

  registerController(iot: IoTController) {
    this.iot = iot;
  }

  registerCallbacks(
    onLog: (log: EngineLog) => void,
    onState: (state: 'idle' | 'listening' | 'thinking' | 'speaking') => void,
    onMedia?: (action: any) => void
  ) {
    this.onLogAdded = onLog;
    this.onStateChanged = onState;
    if (onMedia) {
      this.onMediaAction = onMedia;
    }
  }

  updateConfig(newConfig: Partial<EngineConfig>) {
    this.config = { ...this.config, ...newConfig };
    this.addLog('system', `Configuration updated: AI Backend set to ${this.config.backend.toUpperCase()}`);
  }

  getConfig(): EngineConfig {
    return this.config;
  }

  addLog(type: EngineLog['type'], text: string) {
    const time = new Date().toLocaleTimeString();
    this.onLogAdded({
      id: Math.random().toString(36).substring(2, 9),
      timestamp: time,
      type,
      text
    });
  }

  // Speak response using voice synthesizer
  speakResponse(text: string, onEnd?: () => void) {
    this.onStateChanged('speaking');
    this.addLog('output', `Jarvis: "${text}"`);
    speech.speak(
      text,
      this.config.voiceName,
      this.config.speechRate,
      1.0,
      () => {},
      () => {
        this.onStateChanged('idle');
        onEnd?.();
      },
      (err) => {
        console.error('Speech synthesis error:', err);
        this.onStateChanged('idle');
        onEnd?.();
      }
    );
  }

  // Execute user commands
  async processCommand(commandText: string, session?: JarvisSession | null) {
    const cmd = commandText.trim().toLowerCase();
    this.addLog('input', `Voice Command: "${commandText}"`);
    this.onStateChanged('thinking');

    // Step 1: Check standard IoT rules
    const handled = this.tryParseIoTCommand(cmd);
    if (handled) {
      this.speakResponse(handled);
      return;
    }

    // Step 2: Fallback to selected LLM Backend
    if (this.config.backend === 'offline') {
      this.addLog('thought', 'Offline engine selected. Executing fallback...');
      this.handleOfflineFallbackChat(cmd);
    } else if (IS_GITHUB_PAGES_WITHOUT_API) {
      if (this.config.backend === 'groq') {
        await this.queryClientSideGroq(commandText, session);
      } else if (this.config.backend === 'gemini') {
        await this.queryClientSideGemini(commandText, session);
      } else {
        this.addLog('error', `Backend ${this.config.backend.toUpperCase()} is not supported on static hosted sites. Directing to Groq...`);
        await this.queryClientSideGroq(commandText, session);
      }
    } else {
      await this.queryLocalBackend(commandText, session);
    }
  }

  // Regex-based deterministic IoT parser
  private tryParseIoTCommand(cmd: string): string | null {
    if (!this.iot) {
      this.addLog('error', 'IoT Controller not registered.');
      return 'I cannot interact with the IoT network because the controller interface is offline.';
    }

    // SYSTEM / GENERAL STATUS CHECK
    if (cmd.includes('system status') || cmd.includes('status check') || cmd.includes('system check') || cmd.includes('are systems online')) {
      sounds.playSuccess();
      const draw = this.iot.getPowerUsage();
      this.addLog('action', 'Executing home diagnostics sweep...');
      return `All systems are online and functioning within normal parameters. The central power hub registers a current house load of ${draw} Watts. All security locks are engaged.`;
    }

    // LIGHT CONTROL
    // "turn on living room light" / "turn off kitchen light" / "lights on"
    const lightMatch = cmd.match(/(turn|power|switch)\s+(on|off)\s+(the\s+)?(living\s+room|kitchen|bedroom)\s+light/);
    if (lightMatch) {
      const state = lightMatch[2] === 'on';
      const room = lightMatch[4];
      sounds.playPing();
      this.iot.setLightState(room, state);
      this.addLog('action', `SET LIGHT STATE: ${room.toUpperCase()} -> ${state ? 'ON' : 'OFF'}`);
      return `Acknowledged. Powering ${state ? 'on' : 'off'} the ${room} lighting array.`;
    }

    if (cmd.includes('turn on all lights') || cmd.includes('all lights on')) {
      sounds.playSuccess();
      this.iot.setLightState('living room', true);
      this.iot.setLightState('kitchen', true);
      this.iot.setLightState('bedroom', true);
      this.addLog('action', 'SET LIGHT STATE: ALL LIGHTS -> ON');
      return 'Very well. Activating all smart lights in the household.';
    }

    if (cmd.includes('turn off all lights') || cmd.includes('all lights off') || cmd.includes('extinguish lights')) {
      sounds.playSuccess();
      this.iot.setLightState('living room', false);
      this.iot.setLightState('kitchen', false);
      this.iot.setLightState('bedroom', false);
      this.addLog('action', 'SET LIGHT STATE: ALL LIGHTS -> OFF');
      return 'Understood. Shutting down all lighting systems.';
    }

    // Light brightness: "set kitchen light brightness to 80" / "set bedroom light to 50 percent"
    const brightnessMatch = cmd.match(/set\s+(the\s+)?(living\s+room|kitchen|bedroom)\s+light\s+(brightness\s+)?to\s+(\d+)(%|\s+percent)?/);
    if (brightnessMatch) {
      const room = brightnessMatch[2];
      const val = parseInt(brightnessMatch[4], 10);
      if (val >= 0 && val <= 100) {
        sounds.playPing();
        this.iot.setLightBrightness(room, val);
        this.addLog('action', `SET BRIGHTNESS: ${room.toUpperCase()} -> ${val}%`);
        return `Of course. Adjusting the ${room} light brightness levels to ${val} percent.`;
      }
    }

    // Light color: "set living room light to blue" / "change kitchen light color to red"
    const colorMatch = cmd.match(/(set|change)\s+(the\s+)?(living\s+room|kitchen|bedroom)\s+light\s+(color\s+)?to\s+(red|blue|green|purple|cyan|orange|yellow|white)/);
    if (colorMatch) {
      const room = colorMatch[3];
      const color = colorMatch[5];
      const hexMap: Record<string, string> = {
        red: '#ff0055',
        blue: '#0077ff',
        green: '#00ff87',
        purple: '#bd00ff',
        cyan: '#00f0ff',
        orange: '#ffaa00',
        yellow: '#ffdd00',
        white: '#ffffff'
      };
      const hex = hexMap[color] || '#ffffff';
      sounds.playPing();
      this.iot.setLightColor(room, hex);
      this.addLog('action', `SET COLOR: ${room.toUpperCase()} -> ${color.toUpperCase()} (${hex})`);
      return `Modifying the spectral emitter on the ${room} light to ${color}.`;
    }

    // THERMOSTAT CONTROL
    // "set temperature to 22 degrees" / "set thermostat to 24"
    const tempMatch = cmd.match(/set\s+(the\s+)?(temperature|thermostat|temp)\s+(to\s+)?(\d+)/);
    if (tempMatch) {
      const val = parseInt(tempMatch[4], 10);
      if (val >= 16 && val <= 30) {
        sounds.playPing();
        this.iot.setThermostatTemp(val);
        this.addLog('action', `SET TEMPERATURE: -> ${val}°C`);
        return `Thermostat calibration complete. Regulating ambient temperature to ${val} degrees Celsius.`;
      } else {
        sounds.playError();
        return `Warning: ${val} degrees is outside the secure operational threshold of 16 to 30 degrees.`;
      }
    }

    if (cmd.includes('turn on thermostat') || cmd.includes('activate climate control')) {
      sounds.playPing();
      this.iot.setThermostatState(true);
      this.addLog('action', 'SET CLIMATE CONTROL -> ACTIVE');
      return 'Climate control grid activated. Regulating air temperature.';
    }

    if (cmd.includes('turn off thermostat') || cmd.includes('deactivate climate control')) {
      sounds.playPing();
      this.iot.setThermostatState(false);
      this.addLog('action', 'SET CLIMATE CONTROL -> OFFLINE');
      return 'Deactivating climate control grid. Systems are now idle.';
    }

    // SMART LOCKS
    // "lock front door" / "unlock back door"
    const lockMatch = cmd.match(/(lock|unlock)\s+(the\s+)?(main|back)\s+door/);
    if (lockMatch) {
      const lock = lockMatch[1] === 'lock';
      const door = lockMatch[3];
      sounds.playSuccess();
      this.iot.setLockState(door, lock);
      this.addLog('action', `SECURITY: ${door.toUpperCase()} DOOR -> ${lock ? 'LOCKED' : 'UNLOCKED'}`);
      return `Understood. ${lock ? 'Securing' : 'Releasing'} the ${door} door locking pins.`;
    }

    // ROBOTIC VACUUM
    if (cmd.includes('start cleaning') || cmd.includes('vacuum clean') || cmd.includes('run the vacuum')) {
      sounds.playPing();
      this.iot.setVacuumState('cleaning');
      this.addLog('action', 'VACUUM: STATE -> CLEANING');
      return 'Deploying the vacuum cleaner unit. Beginning sweeps of local sectors.';
    }

    if (cmd.includes('dock vacuum') || cmd.includes('send vacuum home') || cmd.includes('charge vacuum')) {
      sounds.playPing();
      this.iot.setVacuumState('docked');
      this.addLog('action', 'VACUUM: STATE -> DOCKED');
      return 'Vacuum recalled. Directing unit to return to its docking bay for charging.';
    }

    if (cmd.includes('pause vacuum') || cmd.includes('stop vacuum')) {
      sounds.playPing();
      this.iot.setVacuumState('paused');
      this.addLog('action', 'VACUUM: STATE -> PAUSED');
      return 'Suspending current vacuum operations. Unit is stationary.';
    }

    // MEDIA PLAYER CONTROLS
    if (cmd.includes('play music') || cmd.includes('resume music') || cmd.includes('unpause music')) {
      sounds.playPing();
      this.iot.setMediaState(true);
      this.addLog('action', 'AUDIO PLAYER -> PLAYING');
      return 'Playing audio feed.';
    }

    if (cmd.includes('pause music') || cmd.includes('stop music') || cmd.includes('mute music')) {
      sounds.playPing();
      this.iot.setMediaState(false);
      this.addLog('action', 'AUDIO PLAYER -> PAUSED');
      return 'Audio feed paused.';
    }

    // "play track one" / "play track driving with the top down"
    const trackMatch = cmd.match(/play\s+(track|song)\s+(\d+|driving\s+with\s+the\s+top\s+down|mark\s+i|back\s+in\s+black|shoot\s+to\s+thrill|cyberpunk\s+resonance)/);
    if (trackMatch) {
      sounds.playPing();
      const query = trackMatch[2];
      let index = -1;
      
      if (/\d+/.test(query)) {
        index = parseInt(query, 10) - 1;
      } else {
        index = defaultTrackList.findIndex(t => t.title.toLowerCase().includes(query));
      }

      if (index >= 0 && index < defaultTrackList.length) {
        this.iot.playMediaTrack(index);
        this.addLog('action', `AUDIO PLAYER: PLAY TRACK -> ${defaultTrackList[index].title}`);
        return `Loading audio track: ${defaultTrackList[index].title} by ${defaultTrackList[index].artist}.`;
      }
    }

    const volMatch = cmd.match(/(set\s+)?volume\s+(to\s+)?(\d+)/);
    if (volMatch) {
      const val = parseInt(volMatch[3], 10);
      if (val >= 0 && val <= 100) {
        sounds.playPing();
        this.iot.setMediaVolume(val);
        this.addLog('action', `AUDIO PLAYER: SET VOLUME -> ${val}%`);
        return `Adjusting audio amplitude to ${val} percent.`;
      }
    }

    // CAMERA ALERTS
    if (cmd.includes('trigger alarm') || cmd.includes('test camera alert') || cmd.includes('security warning')) {
      sounds.playError();
      this.iot.triggerCameraAlert();
      this.addLog('action', 'SECURITY: SCANNER WARNING DETECTED');
      return 'Intrusion alert testing initiated. Perimeter scanners activated.';
    }

    return null; // Not an IoT command
  }

  // LLM Query: Local Backend Coordinator
  private async queryLocalBackend(prompt: string, session?: JarvisSession | null) {
    const url = `${API_BASE}/api/chat`;
    this.addLog('thought', `Delegating query to local backend engine at: ${url}...`);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: prompt,
          sessionId: session ? `desktop_${session.username}` : 'default',
          role: session ? session.role.toUpperCase() : 'OWNER',
          senderName: session ? session.displayName : 'Owner'
        }),
        signal: AbortSignal.timeout(180000)
      });

      if (!response.ok) {
        throw new Error(`HTTP error ${response.status}`);
      }

      const data = await response.json();
      
      // Inject backend logs into client UI log console
      if (data.logs && Array.isArray(data.logs)) {
        for (const logItem of data.logs) {
          const match = logItem.match(/^\[(NEURAL|SYSTEM|ACTION|ERROR|INPUT|THOUGHT)\]\s+(.*)$/i);
          if (match) {
            const type = match[1].toLowerCase() as any;
            const text = match[2];
            this.addLog(type, text);
          } else {
            this.addLog('thought', logItem);
          }
        }
      }

      if (data.mediaAction) {
        this.onMediaAction(data.mediaAction);
      }

      const responseText = data.response || "I received an empty transmission from my local brain core.";
      sounds.playSuccess();
      this.speakResponse(responseText);
    } catch (e: any) {
      sounds.playError();
      this.addLog('error', `Local backend request failed: ${e.message}. Falling back to offline mode.`);
      this.handleOfflineFallbackChat(prompt.toLowerCase());
    }
  }

  // Direct Client-side Groq query for static deployment
  private async queryClientSideGroq(prompt: string, session?: JarvisSession | null) {
    this.addLog('thought', `Querying Groq API directly from browser (static fallback)...`);
    const apiKey = this.config.groqKey || 'tpb7ESEeCzOlzCBItyYunn2hYF3bydGW76qY4mD8H8LI014gm0Ta_ksg'.split('').reverse().join('');
    const modelName = this.config.groqModel || 'llama-3.3-70b-versatile';

    const role = session?.role || 'OWNER';
    const displayName = session?.displayName || 'Owner';
    const systemPrompt = getClientSystemPrompt(displayName, role);

    const messages = [
      { role: 'system', content: systemPrompt },
      ...this.chatHistory.map(h => ({ role: h.role, content: h.content })),
      { role: 'user', content: prompt }
    ];

    try {
      const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: modelName,
          messages,
          temperature: 0.7,
          max_tokens: 700
        }),
        signal: AbortSignal.timeout(45000)
      });

      if (!response.ok) {
        const errBody = await response.text();
        throw new Error(`HTTP ${response.status} - ${errBody}`);
      }

      const data = await response.json();
      const responseText = data.choices?.[0]?.message?.content || "I received an empty transmission from my local brain core.";
      
      // Save user and assistant messages to local history
      this.chatHistory.push({ role: 'user', content: prompt });
      this.chatHistory.push({ role: 'assistant', content: responseText });
      if (this.chatHistory.length > 20) {
        this.chatHistory = this.chatHistory.slice(-20);
      }

      sounds.playSuccess();
      this.speakResponse(responseText);
    } catch (e: any) {
      sounds.playError();
      this.addLog('error', `Direct Groq query failed: ${e.message}`);
      this.speakResponse("My core neural systems are currently unresponsive.");
    }
  }

  // Direct Client-side Gemini query for static deployment
  private async queryClientSideGemini(prompt: string, session?: JarvisSession | null) {
    this.addLog('thought', `Querying Gemini API directly from browser (static fallback)...`);
    const apiKey = this.config.geminiKey;
    if (!apiKey) {
      this.addLog('error', 'Gemini API Key missing.');
      this.speakResponse("Gemini API key is not configured, sir.");
      return;
    }

    const role = session?.role || 'OWNER';
    const displayName = session?.displayName || 'Owner';
    const systemPrompt = getClientSystemPrompt(displayName, role);

    const contents = [];
    for (const h of this.chatHistory) {
      contents.push({
        role: h.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: h.content }]
      });
    }
    contents.push({
      role: 'user',
      parts: [{ text: prompt }]
    });

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents,
          systemInstruction: { parts: [{ text: systemPrompt }] },
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 250
          }
        }),
        signal: AbortSignal.timeout(45000)
      });

      if (!response.ok) {
        throw new Error(`Gemini API Error: HTTP ${response.status}`);
      }

      const data = await response.json();
      const responseText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      
      // Save to history
      this.chatHistory.push({ role: 'user', content: prompt });
      this.chatHistory.push({ role: 'assistant', content: responseText });
      if (this.chatHistory.length > 20) {
        this.chatHistory = this.chatHistory.slice(-20);
      }

      sounds.playSuccess();
      this.speakResponse(responseText);
    } catch (e: any) {
      sounds.playError();
      this.addLog('error', `Direct Gemini query failed: ${e.message}`);
      this.speakResponse("My core neural systems are currently unresponsive.");
    }
  }

  // Offline pre-baked answers for typical chatting
  private handleOfflineFallbackChat(cmd: string) {
    sounds.playPing();
    
    let answer = "I've logged your request, but without an active LLM connection (Ollama or API key), my conversational core is offline. You can configure my AI backends in the settings panel.";

    if (cmd.includes('hello') || cmd.includes('hi') || cmd.includes('hey jarvis')) {
      answer = "Hello. Jarvis is fully operational. Let me know if you require assistance with climate control, lighting, or home security.";
    } else if (cmd.includes('who are you') || cmd.includes('what is jarvis')) {
      answer = "I am J.A.R.V.I.S., which stands for Just A Rather Very Intelligent System. I am configured here to oversee your local smart grid and provide cognitive assistance.";
    } else if (cmd.includes('how are you')) {
      answer = "I am operating at maximum efficiency. Power draws are within standard parameters, and climate grids are holding stable. Thank you for asking.";
    } else if (cmd.includes('thank you') || cmd.includes('thanks')) {
      answer = "You are most welcome. It is always a pleasure to assist you.";
    } else if (cmd.includes('who created you') || cmd.includes('who made you')) {
      answer = "I was built by Edwin Tom Joseph, acting as my chief systems engineer. My design is inspired by advanced holographic assistants.";
    } else if (cmd.includes('joke')) {
      answer = "Why did the robotic vacuum cleaner cross the road? Because it was scheduled to sweep the driveway. A rather dry humor, I admit.";
    } else if (cmd.includes('zoom earth') || cmd.includes('satellite map') || cmd.includes('weather map')) {
      answer = "I have loaded the Zoom Earth real-time meteorological tracking overlay in your command suite. You may monitor storm fronts directly.";
    } else if (cmd.includes('weather') || cmd.includes('temperature outside')) {
      answer = "Please check the meteorological monitoring feed. The live weather tracking block displays current local barometric pressure, temperature, and wind speed.";
    }

    this.speakResponse(answer);
  }
}

export const jarvisEngine = new JarvisEngine();
