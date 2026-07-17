import { useState, useEffect } from 'react';
import { Cloud, CloudRain, Sun, Wind, Compass, Droplets, Radio, Navigation } from 'lucide-react';
import { sounds } from '../utils/sounds';

interface WeatherData {
  temp: number;
  humidity: number;
  apparentTemp: number;
  windSpeed: number;
  weatherCode: number;
  isDay: boolean;
}

export function WeatherPanel() {
  const [coords, setCoords] = useState({ lat: 9.9312, lon: 76.2673, city: 'Kochi, IN' }); // Default Kochi
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mapLayer, setMapLayer] = useState<'satellite' | 'radar' | 'wind' | 'temp'>('satellite');

  // Fetch coordinates using geolocation
  const handleAutoLocate = () => {
    sounds.playPing();
    if (!navigator.geolocation) {
      setError("Geolocation not supported by browser.");
      return;
    }
    setLoading(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = parseFloat(pos.coords.latitude.toFixed(4));
        const lon = parseFloat(pos.coords.longitude.toFixed(4));
        setCoords({ lat, lon, city: `LAT: ${lat}, LON: ${lon}` });
        setError(null);
      },
      (err) => {
        console.warn("Geolocation error:", err);
        setError("Location request denied. Using default sector Kochi.");
        setLoading(false);
      },
      { timeout: 8000 }
    );
  };

  // Fetch weather data from Open-Meteo
  useEffect(() => {
    let active = true;
    async function fetchWeather() {
      try {
        setLoading(true);
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${coords.lat}&longitude=${coords.lon}&current=temperature_2m,relative_humidity_2m,apparent_temperature,is_day,weather_code,wind_speed_10m`;
        const res = await fetch(url);
        if (!res.ok) throw new Error("Weather service offline");
        const data = await res.json();
        
        if (active) {
          setWeather({
            temp: Math.round(data.current.temperature_2m),
            humidity: data.current.relative_humidity_2m,
            apparentTemp: Math.round(data.current.apparent_temperature),
            windSpeed: Math.round(data.current.wind_speed_10m),
            weatherCode: data.current.weather_code,
            isDay: data.current.is_day === 1,
          });
          setLoading(false);
        }
      } catch (err: any) {
        console.error(err);
        if (active) {
          setError("Failed to sync weather satellite.");
          setLoading(false);
        }
      }
    }

    fetchWeather();
    return () => { active = false; };
  }, [coords.lat, coords.lon]);

  // Decode WMO Weather Codes
  const getWeatherDesc = (code: number) => {
    if (code === 0) return { label: 'Clear Skies', icon: <Sun className="w-8 h-8 text-yellow-400 glow-text-amber" /> };
    if (code >= 1 && code <= 3) return { label: 'Partly Cloudy', icon: <Cloud className="w-8 h-8 text-blue-300 glow-text-cyan" /> };
    if (code >= 45 && code <= 48) return { label: 'Foggy conditions', icon: <Cloud className="w-8 h-8 text-gray-400" /> };
    if (code >= 51 && code <= 67) return { label: 'Drizzle / Rain', icon: <CloudRain className="w-8 h-8 text-blue-400 glow-text-cyan" /> };
    if (code >= 71 && code <= 77) return { label: 'Snow Flurries', icon: <CloudRain className="w-8 h-8 text-white" /> };
    if (code >= 80 && code <= 82) return { label: 'Rain Showers', icon: <CloudRain className="w-8 h-8 text-blue-500 glow-text-cyan" /> };
    if (code >= 95) return { label: 'Electrical Storm', icon: <CloudRain className="w-8 h-8 text-purple-400 glow-text-purple animate-pulse" /> };
    return { label: 'Overcast', icon: <Cloud className="w-8 h-8 text-gray-300" /> };
  };

  const weatherInfo = weather ? getWeatherDesc(weather.weatherCode) : { label: 'Syncing...', icon: <Radio className="w-8 h-8 text-cyan-400 animate-pulse" /> };

  // Calculate zoom earth URL parameters
  const getZoomEarthUrl = () => {
    // Zoom Earth URL structure for standard views
    // Defaulting to satellite view centered at coords
    const base = "https://zoom.earth/maps/satellite/#view=";
    
    switch (mapLayer) {
      case 'radar':
        return `${base}${coords.lat},${coords.lon},5z&overlays=radar`;
      case 'wind':
        return `https://zoom.earth/maps/wind-speed/#view=${coords.lat},${coords.lon},5z`;
      case 'temp':
        return `https://zoom.earth/maps/temperature/#view=${coords.lat},${coords.lon},5z`;
      default:
        return `${base}${coords.lat},${coords.lon},6z`;
    }
  };

  return (
    <div className="hud-panel h-full flex flex-col gap-4">
      <div className="hud-corner-tl"></div>
      <div className="hud-corner-tr"></div>
      <div className="hud-corner-bl"></div>
      
      {/* Header */}
      <div className="flex justify-between items-center border-b border-cyan-500/10 pb-2">
        <h3 className="text-sm tracking-wider glow-text-cyan uppercase flex items-center gap-2 font-bold">
          <Navigation className="w-4 h-4 animate-pulse" />
          Satellite weather Grid
        </h3>
        <button 
          onClick={handleAutoLocate}
          className="hud-btn p-1 px-2 text-[10px]"
          title="Detect Current Grid Coordinate"
        >
          Auto Detect
        </button>
      </div>

      {/* Grid Coordinates */}
      <div className="grid grid-cols-2 gap-2 text-[11px] font-mono border-b border-cyan-500/10 pb-2 text-slate-400">
        <div>SECTOR: <span className="text-cyan-400">{coords.city}</span></div>
        <div className="text-right">COORD: <span className="text-cyan-400">{coords.lat}°N, {coords.lon}°E</span></div>
      </div>

      {/* Live Conditions */}
      {loading ? (
        <div className="flex items-center justify-center py-6 flex-col gap-2">
          <Radio className="w-8 h-8 text-cyan-400 animate-pulse" />
          <span className="text-xs font-mono text-cyan-400 animate-pulse">ESTABLISHING METEOROLOGICAL LINK...</span>
        </div>
      ) : error && !weather ? (
        <div className="text-xs font-mono text-red-400 py-6">{error}</div>
      ) : weather ? (
        <div className="grid grid-cols-3 gap-2 py-1 items-center">
          {/* Main Info */}
          <div className="flex flex-col items-center border-r border-cyan-500/10">
            {weatherInfo.icon}
            <span className="text-[12px] font-bold mt-1 text-slate-300">{weatherInfo.label}</span>
          </div>
          
          {/* Metrics */}
          <div className="col-span-2 grid grid-cols-2 gap-3 px-2">
            <div className="flex items-center gap-2">
              <Sun className="w-4 h-4 text-cyan-400" />
              <div className="flex flex-col">
                <span className="text-[10px] text-slate-400 uppercase">Temp</span>
                <span className="text-sm font-header font-bold glow-text-cyan">{weather.temp}°C</span>
              </div>
            </div>
            
            <div className="flex items-center gap-2">
              <Droplets className="w-4 h-4 text-cyan-400" />
              <div className="flex flex-col">
                <span className="text-[10px] text-slate-400 uppercase">Humidity</span>
                <span className="text-sm font-header font-bold glow-text-cyan">{weather.humidity}%</span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Wind className="w-4 h-4 text-cyan-400" />
              <div className="flex flex-col">
                <span className="text-[10px] text-slate-400 uppercase">Wind</span>
                <span className="text-sm font-header font-bold glow-text-cyan">{weather.windSpeed} km/h</span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Compass className="w-4 h-4 text-cyan-400" />
              <div className="flex flex-col">
                <span className="text-[10px] text-slate-400 uppercase">Apparent</span>
                <span className="text-sm font-header font-bold glow-text-cyan">{weather.apparentTemp}°C</span>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* Zoom Earth Iframe Radar */}
      <div className="relative flex-1 min-h-[220px] rounded border border-cyan-500/15 overflow-hidden group">
        <div className="scan-bar"></div>
        <div className="absolute top-2 left-2 z-20 flex gap-1">
          <button 
            onClick={() => { sounds.playPing(); setMapLayer('satellite'); }}
            className={`p-1 px-2 text-[9px] rounded font-mono ${mapLayer === 'satellite' ? 'bg-cyan-500 text-black font-bold' : 'bg-black/60 text-cyan-400 border border-cyan-500/30'}`}
          >
            SATELLITE
          </button>
          <button 
            onClick={() => { sounds.playPing(); setMapLayer('radar'); }}
            className={`p-1 px-2 text-[9px] rounded font-mono ${mapLayer === 'radar' ? 'bg-cyan-500 text-black font-bold' : 'bg-black/60 text-cyan-400 border border-cyan-500/30'}`}
          >
            RADAR
          </button>
          <button 
            onClick={() => { sounds.playPing(); setMapLayer('wind'); }}
            className={`p-1 px-2 text-[9px] rounded font-mono ${mapLayer === 'wind' ? 'bg-cyan-500 text-black font-bold' : 'bg-black/60 text-cyan-400 border border-cyan-500/30'}`}
          >
            WIND
          </button>
          <button 
            onClick={() => { sounds.playPing(); setMapLayer('temp'); }}
            className={`p-1 px-2 text-[9px] rounded font-mono ${mapLayer === 'temp' ? 'bg-cyan-500 text-black font-bold' : 'bg-black/60 text-cyan-400 border border-cyan-500/30'}`}
          >
            TEMP
          </button>
        </div>
        
        <iframe
          src={getZoomEarthUrl()}
          className="w-full h-full border-none opacity-80 group-hover:opacity-100 transition-opacity"
          title="Zoom Earth weather radar"
          sandbox="allow-scripts allow-same-origin allow-popups"
        />

        <div className="absolute bottom-2 right-2 bg-black/70 px-2 py-0.5 rounded text-[8px] font-mono text-cyan-400 border border-cyan-500/20 pointer-events-none">
          ZOOM EARTH REALTIME meteorology
        </div>
      </div>
    </div>
  );
}
