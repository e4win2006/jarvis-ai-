const getApiBase = () => {
  const override = localStorage.getItem('jarvis_api_base');
  if (override) return override.trim().replace(/\/+$/, '');
  return (import.meta.env.VITE_API_BASE || '').replace(/\/+$/, '');
};

const isProduction = import.meta.env.PROD;
const configuredApiBase = getApiBase();
export const HAS_CONFIGURED_API_BASE = Boolean(configuredApiBase);
export const IS_GITHUB_PAGES_WITHOUT_API = isProduction && window.location.hostname.endsWith('github.io') && !HAS_CONFIGURED_API_BASE;
export const API_BASE = configuredApiBase || (isProduction ? window.location.origin : 'http://localhost:3000');
export const WS_BASE = isProduction
  ? (configuredApiBase
    ? `${configuredApiBase.replace(/^http/, 'ws')}`
    : `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}`)
  : 'ws://localhost:3000';
