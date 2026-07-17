import { useEffect, useRef, useState } from 'react';
import { 
  Lightbulb, Shield, Play, Pause, SkipForward, 
  Volume2, BatteryCharging, Battery, Navigation, 
  Tv, Compass, Activity, ShieldAlert, ShieldCheck, Square
} from 'lucide-react';
import { sounds } from '../utils/sounds';
import { defaultTrackList } from '../utils/jarvisEngine';
import { API_BASE } from '../utils/apiConfig';

interface IoTGridWidgetsProps {
  devices: any; // returned by useIoTDevices
}

export function IoTGridWidgets({ devices }: IoTGridWidgetsProps) {
  const {
    lights, thermostat, locks, vacuum, media, cameraAlert, cameraLog, powerUsage,
    setLightState, setLightColor, setLightBrightness,
    setThermostatState, setThermostatTemp, setThermostat,
    setLockState, setVacuumState, setMediaState, setMediaVolume, playMediaTrack, triggerCameraAlert, setMedia
  } = devices;

  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  // Sync play/pause state with iframe postMessages
  useEffect(() => {
    if (!iframeRef.current || !media.videoId) return;
    const contentWindow = iframeRef.current.contentWindow;
    if (!contentWindow) return;

    if (media.playing) {
      contentWindow.postMessage(JSON.stringify({ event: 'command', func: 'playVideo', args: [] }), '*');
    } else {
      contentWindow.postMessage(JSON.stringify({ event: 'command', func: 'pauseVideo', args: [] }), '*');
    }
  }, [media.playing, media.videoId]);

  // Sync volume state with iframe postMessages
  useEffect(() => {
    if (!iframeRef.current || !media.videoId) return;
    const contentWindow = iframeRef.current.contentWindow;
    if (!contentWindow) return;

    contentWindow.postMessage(JSON.stringify({ event: 'command', func: 'setVolume', args: [media.volume] }), '*');
  }, [media.volume, media.videoId]);

  // WhatsApp Link HUD states
  const [waEnabled, setWaEnabled] = useState(false);
  const [waStatus, setWaStatus] = useState('DISCONNECTED');
  const [waQr, setWaQr] = useState('');
  const [waContacts, setWaContacts] = useState<{ name: string; number: string; role: string }[]>([]);
  const [waDelaySeconds, setWaDelaySeconds] = useState(360);
  const [mcpStatus, setMcpStatus] = useState<Record<string, boolean>>({
    playwright: false,
    filesystem: false,
    sqlite: true,
    github: false
  });

  const [newContactName, setNewContactName] = useState('');
  const [newContactNumber, setNewContactNumber] = useState('');
  const [newContactRole, setNewContactRole] = useState('FRIEND');

  const fetchWaStatus = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/whatsapp/status`);
      if (res.ok) {
        const data = await res.json();
        setWaEnabled(data.enabled);
        setWaStatus(data.status);
        setWaQr(data.qrCodeBase64);
        setWaContacts(data.contacts || []);
        if (typeof data.delaySeconds === 'number') {
          setWaDelaySeconds(data.delaySeconds);
        }
        if (data.mcpStatus) {
          setMcpStatus(data.mcpStatus);
        }
      }
    } catch (err) {
      console.warn('Failed to fetch WhatsApp status:', err);
    }
  };

  useEffect(() => {
    fetchWaStatus();
    const interval = setInterval(fetchWaStatus, 4000);
    return () => clearInterval(interval);
  }, []);

  const handleToggleWa = async () => {
    sounds.playPing();
    const target = !waEnabled;
    try {
      const res = await fetch(`${API_BASE}/api/whatsapp/toggle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: target })
      });
      if (res.ok) {
        const data = await res.json();
        setWaEnabled(data.enabled);
        fetchWaStatus();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleUpdateWaDelay = async (seconds: number) => {
    try {
      const res = await fetch(`${API_BASE}/api/whatsapp/delay`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ delaySeconds: seconds })
      });
      if (res.ok) {
        sounds.playSuccess();
        setWaDelaySeconds(seconds);
      } else {
        sounds.playError();
      }
    } catch (err) {
      console.error(err);
      sounds.playError();
    }
  };

  const handleAddContact = async () => {
    if (!newContactName.trim() || !newContactNumber.trim()) {
      sounds.playError();
      return;
    }
    sounds.playSuccess();
    const updated = [
      ...waContacts,
      { name: newContactName.trim(), number: newContactNumber.trim().replace(/\D/g, ''), role: newContactRole }
    ];
    setWaContacts(updated);
    setNewContactName('');
    setNewContactNumber('');
    try {
      await fetch(`${API_BASE}/api/whatsapp/contacts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contacts: updated })
      });
    } catch (err) {
      console.error(err);
    }
  };

  const handleRemoveContact = async (idx: number) => {
    sounds.playPing();
    const updated = waContacts.filter((_, i) => i !== idx);
    setWaContacts(updated);
    try {
      await fetch(`${API_BASE}/api/whatsapp/contacts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contacts: updated })
      });
    } catch (err) {
      console.error(err);
    }
  };

  // Power usage history tracker
  const [powerHistory, setPowerHistory] = useState<number[]>(new Array(15).fill(120));
  const powerCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // Update power history every 3s
  useEffect(() => {
    setPowerHistory(prev => [...prev.slice(1), powerUsage]);
  }, [powerUsage]);

  // Draw Power History Graph
  useEffect(() => {
    const canvas = powerCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const width = canvas.width;
    const height = canvas.height;
    
    // Draw background grids
    ctx.strokeStyle = 'rgba(0, 240, 255, 0.05)';
    ctx.lineWidth = 1;
    for (let i = 0; i < width; i += 20) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i, height);
      ctx.stroke();
    }
    for (let i = 0; i < height; i += 15) {
      ctx.beginPath();
      ctx.moveTo(0, i);
      ctx.lineTo(width, i);
      ctx.stroke();
    }

    // Plot line
    const maxVal = 600; // max expected watts
    const points = powerHistory.map((val, idx) => {
      const x = (idx / (powerHistory.length - 1)) * (width - 20) + 10;
      // invert y (0 at bottom)
      const ratio = val / maxVal;
      const y = height - ratio * (height - 20) - 10;
      return { x, y };
    });

    // Draw area gradient fill
    const grad = ctx.createLinearGradient(0, 0, 0, height);
    grad.addColorStop(0, 'rgba(0, 240, 255, 0.25)');
    grad.addColorStop(1, 'transparent');
    ctx.fillStyle = grad;
    
    ctx.beginPath();
    ctx.moveTo(points[0].x, height);
    points.forEach(p => ctx.lineTo(p.x, p.y));
    ctx.lineTo(points[points.length - 1].x, height);
    ctx.closePath();
    ctx.fill();

    // Draw glowing line
    ctx.strokeStyle = '#00f0ff';
    ctx.lineWidth = 2;
    ctx.shadowColor = 'rgba(0, 240, 255, 0.5)';
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    points.forEach(p => ctx.lineTo(p.x, p.y));
    ctx.stroke();
    ctx.shadowBlur = 0; // Reset

    // Draw dot on the last coordinate
    const lastP = points[points.length - 1];
    ctx.beginPath();
    ctx.arc(lastP.x, lastP.y, 4, 0, Math.PI * 2);
    ctx.fillStyle = '#00ff87';
    ctx.fill();

  }, [powerHistory]);


  // Camera 1 visualizer canvas
  const cameraCanvasRef = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const canvas = cameraCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId: number;
    let sweepAngle = 0;

    const drawCam = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const w = canvas.width;
      const h = canvas.height;

      // Draw camera noise/grid lines
      ctx.fillStyle = 'rgba(10, 15, 30, 0.9)';
      ctx.fillRect(0, 0, w, h);

      // Draw green scanning grid
      ctx.strokeStyle = 'rgba(0, 240, 255, 0.08)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 0; i < w; i += 25) {
        ctx.moveTo(i, 0); ctx.lineTo(i, h);
      }
      for (let j = 0; j < h; j += 20) {
        ctx.moveTo(0, j); ctx.lineTo(w, j);
      }
      ctx.stroke();

      // Radar Sweep
      sweepAngle += 0.01;
      ctx.strokeStyle = 'rgba(0, 240, 255, 0.15)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(w / 2, h / 2, Math.min(w, h) * 0.45, 0, Math.PI * 2);
      ctx.stroke();

      // Radar sweeping line
      ctx.save();
      ctx.translate(w / 2, h / 2);
      ctx.rotate(sweepAngle);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(0, -Math.min(w, h) * 0.45);
      ctx.strokeStyle = 'rgba(0, 240, 255, 0.3)';
      ctx.stroke();
      ctx.restore();

      // Simulated thermal dots
      ctx.fillStyle = 'rgba(0, 255, 135, 0.5)';
      ctx.beginPath();
      ctx.arc(w * 0.3, h * 0.4, 3, 0, Math.PI * 2);
      ctx.arc(w * 0.7, h * 0.6, 2, 0, Math.PI * 2);
      ctx.fill();

      // HUD Overlay texts
      ctx.font = '9px monospace';
      ctx.fillStyle = 'rgba(0, 240, 255, 0.6)';
      ctx.fillText("CAM_01: MAIN ENTRY", 10, 15);
      ctx.fillText("COORD: 45.92.A1", 10, h - 10);
      
      const timeStr = new Date().toLocaleTimeString();
      ctx.fillText(timeStr, w - 75, 15);

      // Blinking RED rec dot
      if (Math.floor(Date.now() / 600) % 2 === 0) {
        ctx.fillStyle = '#ff0055';
        ctx.beginPath();
        ctx.arc(w - 15, h - 12, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(255, 0, 85, 0.5)';
        ctx.fillText("REC", w - 40, h - 9);
      }

      // Intrusion Warning overlay
      if (cameraAlert) {
        ctx.fillStyle = 'rgba(255, 0, 85, 0.15)';
        ctx.fillRect(0, 0, w, h);
        
        ctx.strokeStyle = '#ff0055';
        ctx.lineWidth = 2;
        ctx.strokeRect(5, 5, w - 10, h - 10);

        if (Math.floor(Date.now() / 300) % 2 === 0) {
          ctx.fillStyle = '#ff0055';
          ctx.font = 'bold 11px Orbitron';
          ctx.fillText("!!! INTRUSION DETECTED !!!", w / 2 - 80, h / 2 + 4);
        }
      }

      // Add static grain overlay
      for (let i = 0; i < 150; i++) {
        const x = Math.random() * w;
        const y = Math.random() * h;
        ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
        ctx.fillRect(x, y, 1, 1);
      }

      animId = requestAnimationFrame(drawCam);
    };

    drawCam();

    return () => cancelAnimationFrame(animId);
  }, [cameraAlert]);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      
      {/* 1. SMART LIGHTING CARD */}
      <div className="hud-panel flex flex-col gap-3">
        <div className="hud-corner-tl"></div>
        <div className="hud-corner-tr"></div>
        <div className="hud-corner-bl"></div>

        <h3 className="text-sm tracking-wider uppercase font-header font-bold flex items-center gap-2 border-b border-cyan-500/10 pb-1.5 glow-text-cyan">
          <Lightbulb className="w-4 h-4 text-cyan-400" />
          Lighting Control Grid
        </h3>

        <div className="flex flex-col gap-3 py-1">
          {Object.entries(lights).map(([key, value]: [string, any]) => (
            <div key={key} className="flex flex-col gap-1.5 border border-cyan-500/5 bg-slate-950/20 p-2.5 rounded">
              <div className="flex justify-between items-center">
                <span className="text-xs uppercase font-mono text-slate-300 font-bold">{value.name}</span>
                <div className="flex items-center gap-2">
                  {/* color preview indicator */}
                  {value.on && (
                    <span 
                      className="w-3.5 h-3.5 rounded-full border border-white/20 shadow-md"
                      style={{ backgroundColor: value.color, boxShadow: `0 0 10px ${value.color}` }}
                    />
                  )}
                  {/* Power Button */}
                  <button
                    onClick={() => {
                      sounds.playPing();
                      setLightState(key, !value.on);
                    }}
                    className={`hud-btn py-0.5 px-2 text-[10px] ${
                      value.on ? 'hud-btn-active' : ''
                    }`}
                  >
                    {value.on ? 'ON' : 'OFF'}
                  </button>
                </div>
              </div>

              {value.on && (
                <div className="flex flex-col gap-2 mt-1">
                  {/* Brightness */}
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] uppercase font-mono text-slate-400 w-16">BRIGHT: {value.brightness}%</span>
                    <input
                      type="range"
                      min="10"
                      max="100"
                      value={value.brightness}
                      onChange={(e) => setLightBrightness(key, parseInt(e.target.value))}
                      className="hud-slider flex-1"
                    />
                  </div>

                  {/* Spectral Color Select */}
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] uppercase font-mono text-slate-400 w-16">SPECTRUM:</span>
                    <div className="flex gap-1.5 flex-1">
                      {['#00f0ff', '#bd00ff', '#00ff87', '#ff0055', '#ffaa00', '#ffffff'].map((c) => (
                        <button
                          key={c}
                          onClick={() => { sounds.playPing(); setLightColor(key, c); }}
                          className={`w-4 h-4 rounded-full border ${
                            value.color === c ? 'border-white scale-110 shadow-lg' : 'border-transparent'
                          }`}
                          style={{ backgroundColor: c }}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* 2. CLIMATE CONTROL GRID */}
      <div className="hud-panel flex flex-col gap-3">
        <div className="hud-corner-tl"></div>
        <div className="hud-corner-tr"></div>
        <div className="hud-corner-bl"></div>

        <h3 className="text-sm tracking-wider uppercase font-header font-bold flex items-center gap-2 border-b border-cyan-500/10 pb-1.5 glow-text-cyan">
          <Compass className="w-4 h-4 text-cyan-400" />
          Climate Control
        </h3>

        <div className="flex-1 flex flex-col justify-between py-1">
          <div className="bg-slate-950/20 p-3 rounded border border-cyan-500/5 flex flex-col gap-3.5">
            <div className="flex justify-between items-center">
              <span className="text-xs uppercase font-mono text-slate-300 font-bold">Ambient Regulator</span>
              <button
                onClick={() => { sounds.playPing(); setThermostatState(!thermostat.on); }}
                className={`hud-btn py-0.5 px-2 text-[10px] ${thermostat.on ? 'hud-btn-active font-bold' : 'text-slate-500'}`}
              >
                {thermostat.on ? 'ON' : 'OFF'}
              </button>
            </div>

            {thermostat.on && (
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between border-t border-cyan-500/5 pt-2">
                  <span className="text-xs text-slate-400">CALIBRATED TEMPERATURE</span>
                  <span className="text-2xl font-header glow-text-cyan font-bold">{thermostat.temp}°C</span>
                </div>

                <input
                  type="range"
                  min="16"
                  max="30"
                  value={thermostat.temp}
                  onChange={(e) => setThermostatTemp(parseInt(e.target.value))}
                  className="hud-slider"
                />

                <div className="flex gap-2 justify-between">
                  {['cool', 'heat', 'eco'].map((m) => (
                    <button
                      key={m}
                      onClick={() => { sounds.playPing(); setThermostat((t: any) => ({ ...t, mode: m })); }}
                      className={`hud-btn flex-1 py-1 text-[10px] text-center ${thermostat.mode === m ? 'hud-btn-active font-bold' : ''}`}
                    >
                      {m.toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="text-[10px] font-mono text-slate-500 mt-2 flex items-center justify-between px-1">
            <span>GRID LOAD COMPLIANCE: 100%</span>
            <span>HUMIDITY RATIO: STABLE</span>
          </div>
        </div>
      </div>

      {/* 3. SECURITY SYSTEMS CAMERA */}
      <div className="hud-panel flex flex-col gap-3">
        <div className="hud-corner-tl"></div>
        <div className="hud-corner-tr"></div>
        <div className="hud-corner-bl"></div>

        <h3 className="text-sm tracking-wider uppercase font-header font-bold flex justify-between items-center border-b border-cyan-500/10 pb-1.5 glow-text-cyan">
          <span className="flex items-center gap-2">
            <Tv className="w-4 h-4 text-cyan-400" />
            Perimeter Scanners
          </span>
          <button 
            onClick={triggerCameraAlert}
            className={`p-1 text-[9px] rounded font-mono ${cameraAlert ? 'bg-red-600 text-white animate-pulse' : 'bg-slate-900 border border-cyan-500/20 text-cyan-400'}`}
          >
            TEST ALERT
          </button>
        </h3>

        {/* Live Feed Canvas */}
        <div className="relative border border-cyan-500/15 rounded overflow-hidden h-[120px]">
          <canvas ref={cameraCanvasRef} width={280} height={120} className="w-full h-full block" />
          <div className="absolute top-2 right-2 bg-black/60 px-1 py-0.5 rounded text-[8px] font-mono text-cyan-400">
            FEED: L_REC
          </div>
        </div>

        {/* Camera Logs */}
        <div className="flex-1 flex flex-col gap-1.5 bg-black/40 p-2 rounded border border-cyan-500/5 h-[90px] overflow-y-auto scrollbar-thin font-mono text-[9px]">
          {cameraLog.map((log: string, idx: number) => (
            <div key={idx} className={`leading-3 ${log.includes('WARNING') ? 'text-red-400 font-bold' : 'text-slate-400'}`}>
              {log}
            </div>
          ))}
        </div>
      </div>

      {/* 4. SMART LOCKS */}
      <div className="hud-panel flex flex-col gap-3">
        <div className="hud-corner-tl"></div>
        <div className="hud-corner-tr"></div>
        <div className="hud-corner-bl"></div>

        <h3 className="text-sm tracking-wider uppercase font-header font-bold flex items-center gap-2 border-b border-cyan-500/10 pb-1.5 glow-text-cyan">
          <Shield className="w-4 h-4 text-cyan-400" />
          Security Access locks
        </h3>

        <div className="flex flex-col gap-2.5 py-1">
          {Object.entries(locks).map(([key, value]: [string, any]) => (
            <div key={key} className="flex justify-between items-center border border-cyan-500/5 bg-slate-950/20 p-2.5 rounded">
              <div className="flex flex-col">
                <span className="text-xs uppercase font-mono text-slate-300 font-bold">{value.name}</span>
                <span className="text-[9px] font-mono text-slate-500 mt-0.5 leading-3">
                  {value.log[0] || 'No activity log'}
                </span>
              </div>
              <button
                onClick={() => {
                  sounds.playSuccess();
                  setLockState(key, !value.locked);
                }}
                className={`hud-btn gap-1 py-0.5 px-2 text-[10px] ${
                  value.locked 
                    ? 'border-red-500/30 text-red-400 bg-red-950/5 hover:bg-red-950/20 hover:border-red-500 hover:shadow-[0_0_8px_rgba(255,0,85,0.3)]' 
                    : 'border-green-500/30 text-green-400 bg-green-950/5 hover:bg-green-950/20 hover:border-green-500 hover:shadow-[0_0_8px_rgba(0,255,135,0.3)]'
                }`}
              >
                {value.locked ? <ShieldAlert className="w-3 h-3" /> : <ShieldCheck className="w-3 h-3" />}
                {value.locked ? 'LOCKED' : 'SECURED'}
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* 5. ROBOTIC CLEANER */}
      <div className="hud-panel flex flex-col gap-3">
        <div className="hud-corner-tl"></div>
        <div className="hud-corner-tr"></div>
        <div className="hud-corner-bl"></div>

        <h3 className="text-sm tracking-wider uppercase font-header font-bold flex items-center gap-2 border-b border-cyan-500/10 pb-1.5 glow-text-cyan">
          <Navigation className="w-4 h-4 text-cyan-400" />
          Autonomous Vacuum Grid
        </h3>

        <div className="flex-1 flex flex-col justify-between py-1">
          <div className="grid grid-cols-2 gap-3 mb-2">
            {/* Battery Indicator */}
            <div className="border border-cyan-500/5 bg-slate-950/20 p-2.5 rounded flex items-center justify-between">
              <div className="flex flex-col">
                <span className="text-[10px] text-slate-400">BATTERY</span>
                <span className="text-sm font-header glow-text-cyan font-bold">{vacuum.battery}%</span>
              </div>
              {vacuum.status === 'docked' || vacuum.status === 'charging' ? (
                <BatteryCharging className="w-5 h-5 text-green-400 glow-text-green animate-pulse" />
              ) : (
                <Battery className="w-5 h-5 text-cyan-400" />
              )}
            </div>

            {/* Clean Area */}
            <div className="border border-cyan-500/5 bg-slate-950/20 p-2.5 rounded flex flex-col justify-center">
              <span className="text-[10px] text-slate-400">CLEANED SECTORS</span>
              <span className="text-sm font-header glow-text-cyan font-bold">{vacuum.cleanArea} m²</span>
            </div>
          </div>

          {/* Action Log / Control */}
          <div className="flex flex-col gap-2">
            <div className="flex gap-2">
              <button
                onClick={() => { sounds.playPing(); setVacuumState('cleaning'); }}
                className={`hud-btn flex-1 py-1 text-[10px] ${vacuum.status === 'cleaning' ? 'hud-btn-active' : ''}`}
              >
                SWEEP
              </button>
              <button
                onClick={() => { sounds.playPing(); setVacuumState('docked'); }}
                className={`hud-btn flex-1 py-1 text-[10px] ${vacuum.status === 'docked' ? 'hud-btn-active' : ''}`}
              >
                DOCK / CHARGE
              </button>
              <button
                onClick={() => { sounds.playPing(); setVacuumState('paused'); }}
                className={`hud-btn flex-1 py-1 text-[10px] ${vacuum.status === 'paused' ? 'hud-btn-active' : ''}`}
              >
                HOLD
              </button>
            </div>

            <div className="bg-black/30 p-2 rounded text-[9px] font-mono text-slate-400 border border-cyan-500/5 h-[40px] overflow-y-auto leading-3">
              {vacuum.log[0]}
            </div>
          </div>
        </div>
      </div>

      {/* 6. MEDIA PLAYBACK HUB */}
      <div className="hud-panel flex flex-col gap-3">
        <div className="hud-corner-tl"></div>
        <div className="hud-corner-tr"></div>
        <div className="hud-corner-bl"></div>

        <h3 className="text-sm tracking-wider uppercase font-header font-bold flex items-center gap-2 border-b border-cyan-500/10 pb-1.5 glow-text-cyan">
          <Volume2 className="w-4 h-4 text-cyan-400" />
          Neural Sound Server
        </h3>

        <div className="flex-1 flex flex-col justify-between py-1">
          <div className="flex flex-col gap-2">
            {/* Playing track */}
            <div className="bg-slate-950/30 p-2.5 rounded border border-cyan-500/5">
              <div className="flex items-center justify-between text-xs font-bold text-slate-300">
                <span className="truncate max-w-[170px] uppercase font-mono tracking-wide">
                  {media.title || defaultTrackList[media.trackIndex].title}
                </span>
                <span className="text-[9px] text-cyan-400 font-mono">
                  TRK #0{media.trackIndex + 1}
                </span>
              </div>
              <div className="text-[10px] text-slate-500 mt-0.5 truncate font-mono">
                COMPOSER: {media.artist || defaultTrackList[media.trackIndex].artist}
              </div>

              {/* simulated progress bar */}
              <div className="w-full bg-slate-900 border border-cyan-500/10 h-1.5 rounded-full mt-2.5 overflow-hidden">
                <div 
                  className="bg-cyan-500 h-full glow-text-cyan shadow-[0_0_8px_rgba(0,240,255,0.6)]" 
                  style={{ width: `${media.progress}%` }} 
                />
              </div>

              {/* Embedded Player Iframe */}
              {media.videoId && (
                <div className="relative border border-cyan-500/15 rounded overflow-hidden aspect-video w-full mt-2 bg-black">
                  <iframe
                    ref={iframeRef}
                    src={`https://www.youtube.com/embed/${media.videoId}?enablejsapi=1&autoplay=1&controls=1`}
                    title="JARVIS Media Player"
                    className="w-full h-full border-none"
                    allow="autoplay; encrypted-media"
                    allowFullScreen
                  />
                </div>
              )}
            </div>

            {/* Play controls */}
            <div className="flex justify-between items-center gap-2 mt-1">
              <div className="flex gap-1.5">
                <button
                  onClick={() => {
                    sounds.playPing();
                    setMediaState(!media.playing);
                  }}
                  className="hud-btn p-1.5 px-3"
                  title={media.playing ? "Pause" : "Play"}
                >
                  {media.playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                </button>
                <button
                  onClick={() => {
                    sounds.playPing();
                    setMedia((prev: any) => ({ ...prev, playing: false, videoId: '', title: 'No media loaded', artist: '' }));
                  }}
                  className="hud-btn p-1.5 px-3"
                  title="Stop"
                >
                  <Square className="w-4 h-4" />
                </button>
                <button
                  onClick={() => {
                    sounds.playPing();
                    const next = (media.trackIndex + 1) % defaultTrackList.length;
                    playMediaTrack(next);
                  }}
                  className="hud-btn p-1.5 px-3"
                  title="Next Track"
                >
                  <SkipForward className="w-4 h-4" />
                </button>
              </div>

              {/* Volume */}
              <div className="flex items-center gap-2 bg-black/40 px-2 py-1.5 rounded border border-cyan-500/5 flex-1">
                <Volume2 className="w-3.5 h-3.5 text-cyan-400" />
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={media.volume}
                  onChange={(e) => setMediaVolume(parseInt(e.target.value))}
                  className="hud-slider flex-1"
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 8. WHATSAPP COMMAND UPLINK CARD */}
      <div className="hud-panel flex flex-col gap-3">
        <div className="hud-corner-tl"></div>
        <div className="hud-corner-tr"></div>
        <div className="hud-corner-bl"></div>

        <h3 className="text-sm tracking-wider uppercase font-header font-bold flex justify-between items-center border-b border-cyan-500/10 pb-1.5 glow-text-cyan">
          <span className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-cyan-400" />
            WhatsApp Uplink Core
          </span>
          <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded font-bold ${
            waStatus === 'CONNECTED' ? 'bg-green-500/20 text-green-400 border border-green-500/30' :
            waStatus === 'SCANNING_QR' ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30 animate-pulse' :
            waStatus === 'INITIALIZING' ? 'bg-purple-500/20 text-purple-400 border border-purple-500/30 animate-pulse' :
            'bg-slate-900 border border-cyan-500/20 text-slate-400'
          }`}>
            {waStatus}
          </span>
        </h3>

        {/* Core Services Status Indicators */}
        <div className="grid grid-cols-2 gap-x-2 gap-y-1 bg-black/40 border border-cyan-500/5 p-2 rounded text-[9px] font-mono">
          <div className="flex items-center gap-1.5">
            <span className={mcpStatus.playwright ? "text-green-400 font-bold" : "text-red-400 font-bold"}>
              {mcpStatus.playwright ? "🟢" : "🔴"}
            </span>
            <span className="text-slate-400 uppercase">Playwright {mcpStatus.playwright ? "Connected" : "Disconnected"}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className={mcpStatus.filesystem ? "text-green-400 font-bold" : "text-red-400 font-bold"}>
              {mcpStatus.filesystem ? "🟢" : "🔴"}
            </span>
            <span className="text-slate-400 uppercase">Filesystem {mcpStatus.filesystem ? "Connected" : "Disconnected"}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-green-400 font-bold">🟢</span>
            <span className="text-slate-400 uppercase">SQLite Connected</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className={mcpStatus.github ? "text-green-400 font-bold" : "text-red-400 font-bold"}>
              {mcpStatus.github ? "🟢" : "🔴"}
            </span>
            <span className="text-slate-400 uppercase">GitHub {mcpStatus.github ? "Connected" : "Disconnected"}</span>
          </div>
          <div className="flex items-center gap-1.5 col-span-2 border-t border-cyan-500/5 pt-1.5 mt-0.5">
            <span className={waStatus === 'CONNECTED' ? "text-green-400 font-bold" : "text-red-400 font-bold"}>
              {waStatus === 'CONNECTED' ? "🟢" : "🔴"}
            </span>
            <span className="text-slate-400 uppercase">WhatsApp {waStatus === 'CONNECTED' ? "Connected" : "Disconnected"}</span>
          </div>
        </div>

        <div className="flex-1 flex flex-col justify-between py-1 gap-2.5">
          <div className="flex justify-between items-center bg-slate-950/20 p-2 rounded border border-cyan-500/5">
            <span className="text-xs uppercase font-mono text-slate-300 font-bold">WhatsApp Assistant</span>
            <button
              onClick={handleToggleWa}
              className={`hud-btn py-0.5 px-2 text-[10px] ${waEnabled ? 'hud-btn-active' : ''}`}
            >
              {waEnabled ? 'ACTIVE' : 'STANDBY'}
            </button>
          </div>

          {/* QR Scan Display */}
          {waEnabled && waStatus === 'SCANNING_QR' && waQr && (
            <div className="flex flex-col items-center gap-1.5 p-2 bg-white rounded self-center border border-cyan-500/20">
              <img src={waQr} alt="WhatsApp Login QR" className="w-[130px] h-[130px] block animate-fade-in" />
              <span className="text-[9px] font-mono text-black font-bold tracking-wider uppercase">Scan with WhatsApp</span>
            </div>
          )}

          {waEnabled && waStatus === 'INITIALIZING' && (
            <div className="text-[10px] font-mono text-cyan-400/70 text-center py-4 animate-pulse">
              [SYSTEM INITIALIZING CHROMIUM UPLINK...]
            </div>
          )}

          {/* Contacts Section */}
          <div className="flex flex-col gap-1.5">
            <span className="text-[10px] uppercase font-mono text-slate-400 font-bold">Authorized Contacts list</span>
            <div className="max-h-[90px] overflow-y-auto border border-cyan-500/5 bg-black/40 rounded p-1.5 flex flex-col gap-1 scrollbar-thin">
              {waContacts.length === 0 ? (
                <span className="text-[9px] font-mono text-slate-600 italic">No contacts registered. Security locked.</span>
              ) : (
                waContacts.map((contact, idx) => (
                  <div key={idx} className="flex justify-between items-center text-[10px] font-mono bg-slate-950/30 px-2 py-1 rounded border border-cyan-500/5">
                    <div className="flex flex-col">
                      <span className="text-slate-300 font-bold">{contact.name}</span>
                      <span className="text-slate-500 text-[9px]">{contact.number} [{contact.role}]</span>
                    </div>
                    <button 
                      onClick={() => handleRemoveContact(idx)} 
                      className="text-red-400 hover:text-red-300 px-1 hover:scale-105 font-bold"
                    >
                      ×
                    </button>
                  </div>
                ))
              )}
            </div>

            {/* Add Contact inputs */}
            <div className="flex flex-col gap-1 border-t border-cyan-500/5 pt-1.5">
              <div className="grid grid-cols-2 gap-1.5">
                <input 
                  type="text" 
                  placeholder="Name (e.g. Sarah)"
                  value={newContactName}
                  onChange={e => setNewContactName(e.target.value)}
                  className="hud-input text-[9px] p-1 h-6"
                />
                <input 
                  type="text" 
                  placeholder="Number (e.g. 9199...)"
                  value={newContactNumber}
                  onChange={e => setNewContactNumber(e.target.value)}
                  className="hud-input text-[9px] p-1 h-6"
                />
              </div>
              <div className="flex gap-1.5 mt-1">
                <select 
                  value={newContactRole} 
                  onChange={e => setNewContactRole(e.target.value)}
                  className="hud-select text-[9px] py-0.5 px-1.5 h-6 flex-1 bg-slate-950/40 border border-cyan-500/10 text-cyan-400"
                >
                  <option value="OWNER">Owner (Full Tools)</option>
                  <option value="FAMILY">Family (Restricted)</option>
                  <option value="FRIEND">Friend (Restricted)</option>
                  <option value="GUEST">Guest (Chat Only)</option>
                </select>
                <button 
                  onClick={handleAddContact}
                  className="hud-btn py-0 px-3.5 text-[9px] h-6"
                >
                  ADD LINK
                </button>
              </div>
            </div>

            {/* Silent Mode delay settings */}
            <div className="flex flex-col gap-1 border-t border-cyan-500/5 pt-2 mt-1">
              <span className="text-[10px] uppercase font-mono text-slate-400 font-bold">Silent Mode Delay (seconds)</span>
              <div className="flex gap-2">
                <input 
                  type="number" 
                  min="0"
                  value={waDelaySeconds}
                  onChange={e => setWaDelaySeconds(parseInt(e.target.value) || 0)}
                  className="hud-input text-[10px] p-1 h-6 flex-1 text-center font-mono text-cyan-400"
                />
                <button
                  onClick={() => handleUpdateWaDelay(waDelaySeconds)}
                  className="hud-btn py-0 px-3 text-[9px] h-6"
                >
                  SAVE DELAY
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 7. ENERGY CENTRAL HUD (Full width on large screens) */}
      <div className="hud-panel col-span-1 md:col-span-2 lg:col-span-3 flex flex-col gap-3">
        <div className="hud-corner-tl"></div>
        <div className="hud-corner-tr"></div>
        <div className="hud-corner-bl"></div>

        <div className="flex justify-between items-center border-b border-cyan-500/10 pb-1.5">
          <h3 className="text-sm tracking-wider uppercase font-header font-bold flex items-center gap-2 glow-text-cyan">
            <Activity className="w-4 h-4 text-cyan-400" />
            Central Power Grid Monitor
          </h3>
          <div className="flex items-center gap-4 text-xs font-mono">
            <div>LOAD DRAIN: <span className="text-cyan-400 font-bold font-header glow-text-cyan">{powerUsage} W</span></div>
            <div>CORES OPERATING: <span className="text-green-400 font-bold">100%</span></div>
          </div>
        </div>

        <div className="flex flex-col lg:flex-row gap-4 items-center">
          {/* Realtime plot */}
          <div className="flex-1 w-full border border-cyan-500/15 rounded bg-black/40 overflow-hidden h-[95px] relative">
            <div className="absolute top-1 left-2 text-[9px] font-mono text-cyan-400/60 pointer-events-none">
              HISTORICAL DRAW RATE (W) - ROLLING WINDOW
            </div>
            <canvas ref={powerCanvasRef} width={800} height={95} className="w-full h-full block" />
          </div>

          {/* Quick Metrics display list */}
          <div className="w-full lg:w-[320px] grid grid-cols-3 gap-2 text-center text-xs font-mono">
            <div className="border border-cyan-500/10 bg-slate-950/20 p-2 rounded flex flex-col justify-center">
              <span className="text-[9px] text-slate-500 uppercase">VOLTAGE</span>
              <span className="text-sm font-header glow-text-cyan font-bold">230.4 V</span>
            </div>
            <div className="border border-cyan-500/10 bg-slate-950/20 p-2 rounded flex flex-col justify-center">
              <span className="text-[9px] text-slate-500 uppercase">FREQUENCY</span>
              <span className="text-sm font-header glow-text-cyan font-bold">50.02 Hz</span>
            </div>
            <div className="border border-cyan-500/10 bg-slate-950/20 p-2 rounded flex flex-col justify-center">
              <span className="text-[9px] text-slate-500 uppercase">DAILY ACCUM</span>
              <span className="text-sm font-header glow-text-cyan font-bold">4.82 kWh</span>
            </div>
          </div>
        </div>
      </div>

    </div>
  );
}
