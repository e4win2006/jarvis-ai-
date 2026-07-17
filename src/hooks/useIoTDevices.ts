import { useState, useEffect, useCallback, useRef } from 'react';
import { jarvisEngine, defaultTrackList } from '../utils/jarvisEngine';
import type { IoTController } from '../utils/jarvisEngine';

export function useIoTDevices() {
  // Lights
  const [lights, setLights] = useState({
    'living room': { name: "Living Room Light", on: true, brightness: 80, color: "#00f0ff" },
    'kitchen': { name: "Kitchen Light", on: false, brightness: 70, color: "#ffffff" },
    'bedroom': { name: "Bedroom Light", on: true, brightness: 50, color: "#bd00ff" },
  });

  // Thermostat
  const [thermostat, setThermostat] = useState({
    on: true,
    temp: 22,
    mode: 'cool'
  });

  // Smart Locks
  const [locks, setLocks] = useState({
    'main': { name: "Main Entrance", locked: true, log: ["08:00 AM - Security locked by SYSTEM"] },
    'back': { name: "Back Garden Entrance", locked: true, log: ["08:00 AM - Security locked by SYSTEM"] },
  });

  // Vacuum
  const [vacuum, setVacuum] = useState({
    status: 'docked' as 'cleaning' | 'docked' | 'charging' | 'paused',
    battery: 100,
    cleanArea: 120, // sq meters
    log: ["06:30 AM - Autonomous cycle completed"]
  });

  // Media
  const [media, setMedia] = useState({
    playing: false,
    trackIndex: 0,
    volume: 50,
    progress: 15,
    videoId: '',
    title: 'No media loaded',
    artist: ''
  });

  // Camera Alert state
  const [cameraAlert, setCameraAlert] = useState(false);
  const [cameraLog, setCameraLog] = useState<string[]>([
    "08:15 AM - Motion detected in Sector B (Normal)",
    "08:00 AM - Perimeter checks completed: SECURE"
  ]);

  // Keep references to state for power calculation so callbacks have latest
  const stateRef = useRef({ lights, thermostat, vacuum, media });
  useEffect(() => {
    stateRef.current = { lights, thermostat, vacuum, media };
  }, [lights, thermostat, vacuum, media]);

  // Calculate power consumption dynamically
  const getPowerUsage = useCallback(() => {
    const s = stateRef.current;
    let power = 0;
    
    // Lights draw up to 15W based on brightness
    Object.values(s.lights).forEach(l => {
      if (l.on) power += Math.round(15 * (l.brightness / 100));
    });

    // Thermostat draws 310W when cooling
    if (s.thermostat.on) power += 310;

    // Vacuum draws 45W when cleaning, 15W when charging
    if (s.vacuum.status === 'cleaning') power += 45;
    else if (s.vacuum.status === 'docked' && s.vacuum.battery < 100) power += 15;

    // Media draws 25W when playing, 5W when idle
    if (s.media.playing) power += 25;
    else power += 5; // standby

    // Ambient house draw (fridge, server, routing)
    power += 112; 

    return power;
  }, []);

  // Setters exposed to Jarvis engine and UI
  const setLightState = useCallback((id: string, on: boolean) => {
    setLights(prev => {
      const target = Object.keys(prev).find(k => k.toLowerCase() === id.toLowerCase());
      if (!target) return prev;
      return {
        ...prev,
        [target]: { ...prev[target as keyof typeof prev], on }
      };
    });
  }, []);

  const setLightColor = useCallback((id: string, color: string) => {
    setLights(prev => {
      const target = Object.keys(prev).find(k => k.toLowerCase() === id.toLowerCase());
      if (!target) return prev;
      return {
        ...prev,
        [target]: { ...prev[target as keyof typeof prev], color }
      };
    });
  }, []);

  const setLightBrightness = useCallback((id: string, val: number) => {
    setLights(prev => {
      const target = Object.keys(prev).find(k => k.toLowerCase() === id.toLowerCase());
      if (!target) return prev;
      return {
        ...prev,
        [target]: { ...prev[target as keyof typeof prev], brightness: val }
      };
    });
  }, []);

  const setThermostatState = useCallback((on: boolean) => {
    setThermostat(prev => ({ ...prev, on }));
  }, []);

  const setThermostatTemp = useCallback((temp: number) => {
    setThermostat(prev => ({ ...prev, temp }));
  }, []);

  const setLockState = useCallback((id: string, locked: boolean) => {
    setLocks(prev => {
      const key = id.toLowerCase().includes('main') ? 'main' : 'back';
      const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const statusText = locked ? 'LOCKED' : 'UNLOCKED';
      const newLog = [`${time} - Security ${statusText} via Voice Assistant`, ...prev[key].log.slice(0, 4)];
      return {
        ...prev,
        [key]: { ...prev[key], locked, log: newLog }
      };
    });
  }, []);

  const setVacuumState = useCallback((status: typeof vacuum.status) => {
    setVacuum(prev => {
      const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const logMsg = status === 'cleaning' ? 'Started sweeping local sectors' : 
                      status === 'docked' ? 'Returned to charger station' :
                      status === 'paused' ? 'Operations paused' : 'Charging';
      return {
        ...prev,
        status,
        log: [`${time} - ${logMsg}`, ...prev.log.slice(0, 4)]
      };
    });
  }, []);

  const setMediaState = useCallback((playing: boolean) => {
    setMedia(prev => ({ ...prev, playing }));
  }, []);

  const setMediaVolume = useCallback((volume: number) => {
    setMedia(prev => ({ ...prev, volume }));
  }, []);

  const playMediaTrack = useCallback((index: number) => {
    const track = defaultTrackList[index];
    setMedia(prev => ({
      ...prev,
      trackIndex: index,
      playing: true,
      progress: 0,
      videoId: track?.videoId || '',
      title: track?.title || 'Unknown Track',
      artist: track?.artist || 'Unknown Artist'
    }));
  }, []);

  const triggerCameraAlert = useCallback(() => {
    setCameraAlert(true);
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    setCameraLog(prev => [`${time} - WARNING: Motion trigger Sector A (Front Door)`, ...prev.slice(0, 4)]);
    
    // Clear alarm automatically after 4 seconds
    setTimeout(() => {
      setCameraAlert(false);
    }, 4000);
  }, []);

  // Register this hook's controllers with the JarvisEngine
  useEffect(() => {
    const controller: IoTController = {
      setLightState,
      setLightColor,
      setLightBrightness,
      setThermostatState,
      setThermostatTemp,
      setLockState,
      setVacuumState,
      setMediaState,
      setMediaVolume,
      playMediaTrack,
      triggerCameraAlert,
      getPowerUsage
    };

    jarvisEngine.registerController(controller);
  }, [
    setLightState,
    setLightColor,
    setLightBrightness,
    setThermostatState,
    setThermostatTemp,
    setLockState,
    setVacuumState,
    setMediaState,
    setMediaVolume,
    playMediaTrack,
    triggerCameraAlert,
    getPowerUsage
  ]);

  // Simulate robotic vacuum battery drain/charge & track progression
  useEffect(() => {
    const interval = setInterval(() => {
      setVacuum(prev => {
        if (prev.status === 'cleaning') {
          const nextBattery = Math.max(prev.battery - 1, 10);
          const areaIncrement = Math.random() > 0.5 ? 1 : 0;
          return {
            ...prev,
            battery: nextBattery,
            cleanArea: prev.cleanArea + areaIncrement,
            status: nextBattery === 10 ? 'docked' : prev.status,
            log: nextBattery === 10 
              ? [`${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} - Critical battery: Docking`, ...prev.log.slice(0, 4)]
              : prev.log
          };
        } else if (prev.status === 'docked' && prev.battery < 100) {
          return {
            ...prev,
            battery: Math.min(prev.battery + 2, 100)
          };
        }
        return prev;
      });

      // Media progress tracker
      setMedia(prev => {
        if (prev.playing) {
          const nextProgress = prev.progress + 2;
          if (nextProgress >= 100) {
            // Loop track
            return {
              ...prev,
              progress: 0
            };
          }
          return { ...prev, progress: nextProgress };
        }
        return prev;
      });
    }, 3000);

    return () => clearInterval(interval);
  }, []);

  return {
    lights,
    thermostat,
    locks,
    vacuum,
    media,
    cameraAlert,
    cameraLog,
    powerUsage: getPowerUsage(),
    // Setters for UI interactions
    setLights,
    setThermostat,
    setLocks,
    setVacuum,
    setMedia,
    setLightState,
    setLightColor,
    setLightBrightness,
    setThermostatState,
    setThermostatTemp,
    setLockState,
    setVacuumState,
    setMediaState,
    setMediaVolume,
    playMediaTrack,
    triggerCameraAlert
  };
}
