import path from 'path';
import fs from 'fs';

const isPortable = process.env.PORTABLE_MODE === 'true';

export function getAppDataDir(): string {
  if (isPortable && process.env.APP_DIR) {
    return path.join(process.env.APP_DIR, 'portable_data');
  }
  const isProd = process.env.NODE_ENV === 'production' || __dirname.includes('app.asar');
  if (isProd && process.env.APPDATA) {
    return path.join(process.env.APPDATA, 'JARVIS');
  }
  // Local project folder for local development
  return path.join(__dirname, '../../../data');
}

export function getDataPath(): string {
  const dir = path.join(getAppDataDir(), 'data');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

export function getLogsPath(): string {
  const dir = path.join(getAppDataDir(), 'logs');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

export function getConfigPath(): string {
  const dir = path.join(getAppDataDir(), 'config');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

export function getBackupsPath(): string {
  const dir = path.join(getAppDataDir(), 'backups');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

export function getAuthPath(): string {
  const dir = path.join(getAppDataDir(), 'auth');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}
