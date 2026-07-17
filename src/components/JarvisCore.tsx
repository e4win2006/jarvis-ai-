import { useEffect, useRef, useState } from 'react';
import { Mic, Volume2, RefreshCw } from 'lucide-react';
import { speech } from '../utils/speech';
import { sounds } from '../utils/sounds';
import { jarvisEngine } from '../utils/jarvisEngine';

interface JarvisCoreProps {
  state: 'idle' | 'listening' | 'thinking' | 'speaking';
  setState: (state: 'idle' | 'listening' | 'thinking' | 'speaking') => void;
  onCommandProcessed: (cmd: string) => void;
}

export function JarvisCore({ state, setState, onCommandProcessed }: JarvisCoreProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animationRef = useRef<number | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Initialize Mic stream for real-time STT and audio visualizer
  const toggleListening = async () => {
    if (state === 'listening') {
      speech.stopListening();
      stopMicStream();
      setState('idle');
      sounds.playPing();
      return;
    }

    if (!speech.isRecognitionSupported()) {
      setErrorMsg("Voice recognition not supported in this browser. Use input console.");
      sounds.playError();
      return;
    }

    sounds.playActivation();
    setState('listening');
    jarvisEngine.addLog('system', "Microphone activated. Listening for voice instructions...");

    // Start real-time mic visualizer
    await initMicStream();

    speech.startListening(
      async (result) => {
        // Result captured
        stopMicStream();
        onCommandProcessed(result);
      },
      () => {
        // Handled on complete
        stopMicStream();
        if ((state as string) === 'listening') setState('idle');
      },
      (err) => {
        console.error("STT Error:", err);
        stopMicStream();
        setState('idle');
        sounds.playError();
        jarvisEngine.addLog('error', `Speech Recognition Error: ${err.error || 'Unknown error'}`);
      }
    );
  };

  const initMicStream = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      micStreamRef.current = stream;

      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      const audioContext = new AudioContextClass();
      audioContextRef.current = audioContext;

      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 64;
      analyserRef.current = analyser;

      const source = audioContext.createMediaStreamSource(stream);
      source.connect(analyser);
    } catch (err) {
      console.warn("Failed to hook visualizer to mic:", err);
    }
  };

  const stopMicStream = () => {
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach(track => track.stop());
      micStreamRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    analyserRef.current = null;
  };

  // Continuous Wake-Word loop when idle
  useEffect(() => {
    if (state === 'idle') {
      speech.startWakeWordListener(() => {
        toggleListening();
      });
    } else {
      speech.stopWakeWordListener();
    }

    return () => {
      speech.stopWakeWordListener();
    };
  }, [state]);

  // Drawing Loop for Canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let angle = 0;
    const dataArray = new Uint8Array(32);

    const render = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const centerX = canvas.width / 2;
      const centerY = canvas.height / 2;
      const baseRadius = 60;
      
      angle += 0.015;

      // Draw background sci-fi rotating circle ticks
      ctx.save();
      ctx.translate(centerX, centerY);
      ctx.rotate(angle * (state === 'thinking' ? 2.5 : state === 'listening' ? 0.6 : 0.4));
      
      // Draw 24 outer dashboard ticks
      ctx.strokeStyle = state === 'thinking' 
        ? 'rgba(189, 0, 255, 0.4)' 
        : state === 'listening' 
        ? 'rgba(255, 170, 0, 0.4)' 
        : state === 'speaking' 
        ? 'rgba(0, 255, 135, 0.4)' 
        : 'rgba(0, 240, 255, 0.3)';
      ctx.lineWidth = 2;
      for (let i = 0; i < 24; i++) {
        ctx.rotate((Math.PI * 2) / 24);
        ctx.beginPath();
        ctx.moveTo(baseRadius + 15, 0);
        ctx.lineTo(baseRadius + 22, 0);
        ctx.stroke();
      }
      ctx.restore();

      // Read audio data if available
      let audioAverage = 0;
      if (analyserRef.current) {
        analyserRef.current.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          sum += dataArray[i];
        }
        audioAverage = sum / dataArray.length;
      }

      // Draw responsive core orb
      let radiusScale = 1.0;
      let glowColor = 'rgba(0, 240, 255, 0.7)'; // Cyan
      let innerGlow = 'rgba(0, 240, 255, 0.2)';

      if (state === 'listening') {
        // Mic response
        radiusScale = 1.0 + (audioAverage / 120) * 0.3;
        glowColor = 'rgba(255, 170, 0, 0.8)'; // Amber
        innerGlow = 'rgba(255, 170, 0, 0.3)';
      } else if (state === 'speaking') {
        // Voice sync simulation (Math.sin waves)
        const voicePulse = Math.sin(Date.now() * 0.012) * 0.08 + 0.08;
        radiusScale = 1.0 + voicePulse;
        glowColor = 'rgba(0, 255, 135, 0.8)'; // Green
        innerGlow = 'rgba(0, 255, 135, 0.3)';
      } else if (state === 'thinking') {
        // Quick pulsating
        radiusScale = 1.0 + Math.sin(Date.now() * 0.02) * 0.05;
        glowColor = 'rgba(189, 0, 255, 0.8)'; // Purple
        innerGlow = 'rgba(189, 0, 255, 0.3)';
      } else {
        // Slow breathing pulse
        radiusScale = 1.0 + Math.sin(Date.now() * 0.002) * 0.03;
      }

      const activeRadius = baseRadius * radiusScale;

      // Glow effect
      ctx.shadowBlur = 25;
      ctx.shadowColor = glowColor;

      // Outer glowing ring
      ctx.beginPath();
      ctx.arc(centerX, centerY, activeRadius, 0, Math.PI * 2);
      ctx.strokeStyle = glowColor;
      ctx.lineWidth = 3;
      ctx.stroke();

      // Inner fill gradient
      const gradient = ctx.createRadialGradient(centerX, centerY, activeRadius * 0.2, centerX, centerY, activeRadius);
      gradient.addColorStop(0, '#ffffff');
      gradient.addColorStop(0.3, glowColor);
      gradient.addColorStop(1, 'transparent');
      
      ctx.shadowBlur = 0; // reset shadow for inner fill
      ctx.beginPath();
      ctx.arc(centerX, centerY, activeRadius - 2, 0, Math.PI * 2);
      ctx.fillStyle = gradient;
      ctx.fill();

      // Draw concentric circuit ring lines
      ctx.strokeStyle = innerGlow;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(centerX, centerY, activeRadius - 10, 0, Math.PI * 2);
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(centerX, centerY, activeRadius + 30, 0, Math.PI * 2);
      ctx.stroke();

      // If speaking, draw digital voice ripples
      if (state === 'speaking' || state === 'listening') {
        ctx.strokeStyle = glowColor;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        for (let i = 0; i < 360; i += 5) {
          const rad = (i * Math.PI) / 180;
          let offset = 0;
          
          if (state === 'listening' && audioAverage > 0) {
            offset = dataArray[i % dataArray.length] * 0.15;
          } else {
            // Simulated sine wave
            offset = Math.sin(rad * 8 + Date.now() * 0.01) * 8 * Math.sin(Date.now() * 0.003);
          }
          
          const x1 = centerX + (activeRadius + 8) * Math.cos(rad);
          const y1 = centerY + (activeRadius + 8) * Math.sin(rad);
          const x2 = centerX + (activeRadius + 8 + offset) * Math.cos(rad);
          const y2 = centerY + (activeRadius + 8 + offset) * Math.sin(rad);
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
        }
        ctx.stroke();
      }

      animationRef.current = requestAnimationFrame(render);
    };

    render();

    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
      stopMicStream();
    };
  }, [state]);

  // Clean up speaker voice on unmount
  useEffect(() => {
    return () => {
      speech.stopSpeaking();
    };
  }, []);

  return (
    <div className="flex flex-col items-center justify-center p-4">
      {/* Visualizer Canvas container */}
      <div className="relative w-[220px] h-[220px] flex items-center justify-center">
        <canvas 
          ref={canvasRef} 
          width={220} 
          height={220} 
          className="absolute top-0 left-0 w-full h-full pointer-events-none"
        />
        
        {/* Absolute center button */}
        <button
          onClick={toggleListening}
          className={`z-10 rounded-full w-20 h-20 flex flex-col items-center justify-center border transition-all duration-300 ${
            state === 'listening'
              ? 'bg-amber-500/10 border-amber-500 text-amber-400 shadow-[0_0_20px_rgba(255,170,0,0.4)]'
              : state === 'thinking'
              ? 'bg-purple-500/10 border-purple-500 text-purple-400 shadow-[0_0_20px_rgba(189,0,255,0.4)]'
              : state === 'speaking'
              ? 'bg-green-500/10 border-green-500 text-green-400 shadow-[0_0_20px_rgba(0,255,135,0.4)]'
              : 'bg-cyan-500/5 border-cyan-500/30 text-cyan-400 hover:border-cyan-500 hover:text-white hover:shadow-[0_0_15px_rgba(0,240,255,0.3)]'
          }`}
        >
          {state === 'listening' ? (
            <Mic className="w-8 h-8 animate-pulse" />
          ) : state === 'thinking' ? (
            <RefreshCw className="w-8 h-8 animate-spin" />
          ) : state === 'speaking' ? (
            <Volume2 className="w-8 h-8 animate-bounce" />
          ) : (
            <Mic className="w-8 h-8" />
          )}
          <span className="text-[9px] font-header font-bold tracking-widest mt-1 block uppercase">
            {state}
          </span>
        </button>
      </div>

      {/* Info status logs below visualizer */}
      <div className="mt-4 text-center">
        {state === 'listening' && (
          <p className="text-xs font-mono glow-text-amber animate-pulse font-semibold uppercase">
            &gt; SYSTEM LISTENING... SPEAK NOW
          </p>
        )}
        {state === 'thinking' && (
          <p className="text-xs font-mono glow-text-purple animate-pulse font-semibold uppercase">
            &gt; NEURAL INTERACTION PROCESSING...
          </p>
        )}
        {state === 'speaking' && (
          <p className="text-xs font-mono glow-text-green animate-pulse font-semibold uppercase">
            &gt; JARVIS EMITTING RESPONSE OVERLAY
          </p>
        )}
        {state === 'idle' && (
          <p className="text-xs font-mono text-cyan-400/60 uppercase">
            &gt; CORE SECURED. TAP MICROPHONE
          </p>
        )}
        
        {errorMsg && (
          <p className="text-[10px] font-mono text-red-400 mt-1 max-w-[200px] border border-red-500/20 bg-red-950/20 px-2 py-0.5 rounded">
            {errorMsg}
          </p>
        )}
      </div>
    </div>
  );
}
