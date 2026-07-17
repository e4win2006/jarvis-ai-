const isProduction = import.meta.env.PROD;
export const API_BASE = isProduction ? window.location.origin : 'http://localhost:3000';
export const WS_BASE = isProduction 
  ? `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}` 
  : 'ws://localhost:3000';
