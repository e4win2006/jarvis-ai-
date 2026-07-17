const { app, BrowserWindow, ipcMain, Notification, dialog, shell, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const net = require('net');
const http = require('http');

const gotTheLock = app.requestSingleInstanceLock();
let mainWindow = null;
let splashWindow = null;
let serverProcess = null;
let serverPort = 3000;
let safeMode = false;
let isShuttingDown = false;

if (!gotTheLock) {
  app.quit();
  return;
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

const isPackaged = app.isPackaged;
const exeDir = isPackaged ? path.dirname(process.execPath) : __dirname;
const isPortable = fs.existsSync(path.join(exeDir, 'portable.flag'));

const appDataDir = isPortable 
  ? path.join(exeDir, 'portable_data') 
  : path.join(process.env.APPDATA || path.join(require('os').homedir(), 'AppData', 'Roaming'), 'JARVIS');

const logsDir = path.join(appDataDir, 'logs');
const configDir = path.join(appDataDir, 'config');

if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
if (!fs.existsSync(configDir)) fs.mkdirSync(configDir, { recursive: true });

const electronLogStream = fs.createWriteStream(path.join(logsDir, 'electron.log'), { flags: 'a' });
const backendLogStream = fs.createWriteStream(path.join(logsDir, 'backend.log'), { flags: 'a' });
const mcpLogStream = fs.createWriteStream(path.join(logsDir, 'mcp.log'), { flags: 'a' });
const whatsappLogStream = fs.createWriteStream(path.join(logsDir, 'whatsapp.log'), { flags: 'a' });

function logElectron(msg) {
  const text = `[${new Date().toISOString()}] ${msg}\n`;
  console.log(text.trim());
  electronLogStream.write(text);
}

// Track launch status to catch boot failures
const launchStatusFile = path.join(configDir, 'launch_status.json');
let launchStatus = { consecutiveFailures: 0 };
if (fs.existsSync(launchStatusFile)) {
  try {
    launchStatus = JSON.parse(fs.readFileSync(launchStatusFile, 'utf-8'));
  } catch {}
}


function getNextAvailablePort(startPort) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(startPort, () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
    server.on('error', () => {
      resolve(getNextAvailablePort(startPort + 1));
    });
  });
}

async function startBackend() {
  serverPort = await getNextAvailablePort(3000);
  logElectron(`Selected port: ${serverPort}`);

  // In packaged builds, extraResources are placed at process.resourcesPath
  // In dev, run TypeScript directly with ts-node-dev
  const serverScript = isPackaged
    ? path.join(process.resourcesPath, 'server/dist/index.js')
    : path.join(__dirname, 'server/src/index.ts');

  // Resolve Node.js: check extraResources/node.exe first, then system PATH
  let execPath = 'node';
  if (isPackaged) {
    const bundledNode = path.join(process.resourcesPath, 'node.exe');
    if (fs.existsSync(bundledNode)) {
      execPath = bundledNode;
    }
    // else use system node on PATH (installer prereq)
  } else {
    execPath = 'npx';
  }

  const finalArgs = isPackaged
    ? [serverScript]
    : ['ts-node-dev', '--respawn', '--transpile-only', serverScript];

  logElectron(`Spawning server: ${execPath} ${finalArgs.join(' ')}`);

  const env = {
    ...process.env,
    PORT: String(serverPort),
    PORTABLE_MODE: isPortable ? 'true' : 'false',
    APP_DIR: exeDir,
    SAFE_MODE: safeMode ? 'true' : 'false',
    NODE_ENV: isPackaged ? 'production' : 'development'
  };

  const spawnCwd = isPackaged ? process.resourcesPath : __dirname;

  serverProcess = spawn(execPath, finalArgs, {
    cwd: spawnCwd,
    env,
    stdio: ['ignore', 'pipe', 'pipe', 'ipc']
  });

  serverProcess.on('error', (err) => {
    logElectron(`Failed to spawn server process: ${err.message}`);
  });

  serverProcess.stdout.on('data', (data) => {
    const text = data.toString();
    backendLogStream.write(text);
    if (text.includes('[WhatsApp')) {
      whatsappLogStream.write(text);
    }
    if (text.includes('[MCP')) {
      mcpLogStream.write(text);
    }
  });

  serverProcess.stderr.on('data', (data) => {
    const text = data.toString();
    backendLogStream.write(`[STDERR] ${text}`);
    logElectron(`[Backend STDERR] ${text.trim()}`);
  });

  // Handle IPC encryption requests
  serverProcess.on('message', (msg) => {
    if (msg && msg.type === 'encrypt') {
      try {
        const cipherHex = safeStorage.encryptString(msg.data).toString('hex');
        serverProcess.send({ type: 'crypto_response', data: cipherHex, id: msg.id });
      } catch (err) {
        logElectron(`Encryption error: ${err.message}`);
        serverProcess.send({ type: 'crypto_response', data: msg.data, id: msg.id });
      }
    } else if (msg && msg.type === 'decrypt') {
      try {
        const buffer = Buffer.from(msg.data, 'hex');
        const plainText = safeStorage.decryptString(buffer);
        serverProcess.send({ type: 'crypto_response', data: plainText, id: msg.id });
      } catch (err) {
        logElectron(`Decryption error: ${err.message}`);
        serverProcess.send({ type: 'crypto_response', data: msg.data, id: msg.id });
      }
    } else if (msg && msg.type === 'toast') {
      new Notification({
        title: msg.title || 'JARVIS Alert',
        body: msg.body || ''
      }).show();
    }
  });

  serverProcess.on('close', (code) => {
    logElectron(`Backend process closed with code ${code}`);
    if (code !== 0 && code !== null && !isShuttingDown) {
      showErrorWindow();
    }
  });
}

function createSplashWindow() {
  splashWindow = new BrowserWindow({
    width: 480,
    height: 320,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    webPreferences: {
      nodeIntegration: false
    }
  });
  splashWindow.loadFile(path.join(__dirname, 'splash.html'));
}

function checkHealth() {
  return new Promise((resolve) => {
    const req = http.get(`http://localhost:${serverPort}/api/whatsapp/status`, (res) => {
      if (res.statusCode === 200) {
        resolve(true);
      } else {
        resolve(false);
      }
    });
    req.on('error', () => resolve(false));
    req.end();
  });
}

async function pollHealthAndLaunch() {
  let attempts = 0;
  const maxAttempts = 300; // 60 seconds maximum boot wait
  
  while (attempts < maxAttempts) {
    const ok = await checkHealth();
    if (ok) {
      // Reset crash failures counter on successful boot!
      launchStatus.consecutiveFailures = 0;
      fs.writeFileSync(launchStatusFile, JSON.stringify(launchStatus, null, 2));

      createMainWindow();
      if (splashWindow) {
        splashWindow.close();
        splashWindow = null;
      }
      return;
    }
    await new Promise(r => setTimeout(r, 200));
    attempts++;
  }
  
  logElectron('Server health check failed to respond in 60s.');
  showErrorWindow();
}

let errorWindow = null;
function showErrorWindow() {
  if (splashWindow) {
    splashWindow.close();
    splashWindow = null;
  }
  if (mainWindow) {
    mainWindow.close();
    mainWindow = null;
  }

  errorWindow = new BrowserWindow({
    width: 600,
    height: 480,
    title: 'JARVIS Diagnostics Suite',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });
  
  errorWindow.loadFile(path.join(__dirname, 'error.html'));
  
  ipcMain.handle('get-diagnostics', async () => {
    let logTail = 'No logs recorded.';
    try {
      const logFile = path.join(logsDir, 'backend.log');
      if (fs.existsSync(logFile)) {
        const content = fs.readFileSync(logFile, 'utf-8');
        logTail = content.split('\n').slice(-25).join('\n');
      }
    } catch (e) {
      logTail = `Log read error: ${e.message}`;
    }

    return {
      port: serverPort,
      safeMode,
      databaseStatus: fs.existsSync(path.join(appDataDir, 'data', 'jarvis.db')) ? '🟢 ACTIVE' : '🔴 MISSING',
      whatsappStatus: safeMode ? '⚪ BYPASSED (SAFE MODE)' : '🟠 INITIALISING',
      mcpStatus: safeMode ? '⚪ BYPASSED (SAFE MODE)' : '🟠 INITIALISING',
      logTail
    };
  });
}

ipcMain.on('retry-boot', () => {
  app.relaunch();
  app.exit();
});

ipcMain.on('open-logs-folder', () => {
  shell.openPath(logsDir);
});

ipcMain.on('exit-app', () => {
  app.quit();
});

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    title: 'JARVIS',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  if (!isPackaged) {
    mainWindow.loadURL('http://localhost:5173');
  } else {
    mainWindow.loadURL(`http://localhost:${serverPort}`);
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

async function cleanShutdown() {
  if (isShuttingDown) return;
  isShuttingDown = true;
  logElectron('Graceful close triggered. Stopping server and database handlers...');
  
  if (serverProcess) {
    serverProcess.kill('SIGINT');
    
    // Wait up to 3s for child exit
    let waitCycles = 0;
    while (serverProcess && waitCycles < 15) {
      await new Promise(r => setTimeout(r, 200));
      waitCycles++;
    }
    
    if (serverProcess) {
      logElectron('Force terminating lingering backend process tree.');
      serverProcess.kill('SIGKILL');
    }
  }
  
  app.quit();
}

app.on('ready', async () => {
  if (launchStatus.consecutiveFailures >= 3) {
    const choice = dialog.showMessageBoxSync({
      type: 'warning',
      buttons: ['Launch in Safe Mode (Recommended)', 'Launch Normally', 'Exit'],
      defaultId: 0,
      title: 'Safe Mode Triggered',
      message: 'JARVIS has failed to initialize repeatedly.\n\nWould you like to start in Safe Mode? This will bypass loading WhatsApp and MCP servers so you can fix configuration issues in the Settings.',
    });
    if (choice === 0) {
      safeMode = true;
    } else if (choice === 2) {
      app.quit();
      return;
    }
  }

  // Increment failure counter
  launchStatus.consecutiveFailures += 1;
  fs.writeFileSync(launchStatusFile, JSON.stringify(launchStatus, null, 2));

  createSplashWindow();
  await startBackend();
  pollHealthAndLaunch();
});

app.on('window-all-closed', () => {
  cleanShutdown();
});

app.on('will-quit', () => {
  cleanShutdown();
});
