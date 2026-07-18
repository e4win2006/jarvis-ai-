import express from 'express';
import cors from 'cors';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { SettingsDb, HistoryDb, db, reopenDatabase } from './memory/db';
import { getLogsPath, getDataPath, getBackupsPath } from './utils/appPaths';
import { Orchestrator } from './ai/orchestrator';
import { ToolRegistry } from './tools/registry';
import { MCPManager } from './mcp/client';
import { DesktopHelper } from './automation/desktop';
import { Scheduler, setSchedulerNotifier } from './calendar/scheduler';
import { WhatsAppService } from './automation/whatsapp';

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;
const DEFAULT_LMSTUDIO_URL = 'http://192.168.56.1:1234';
let requestCount = 0;
const activeSessions = new Map<WebSocket, string>();

app.use(cors());
app.use(express.json());
app.use((_req, _res, next) => { requestCount++; next(); });

// Serving data files (like screenshots) publicly for frontend retrieval
const DATA_DIR = path.join(__dirname, '../data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
app.use('/data', express.static(DATA_DIR));

// --- API Routes ---

// Chat instruction routing
app.post('/api/chat', async (req, res) => {
  const { message, sessionId, role, senderName } = req.body;
  if (!message) {
    return res.status(400).json({ error: 'Message input is required.' });
  }

  const logsList: string[] = [];
  const logCallback = (type: string, text: string) => {
    logsList.push(`[${type.toUpperCase()}] ${text}`);
  };

  try {
    const result = await Orchestrator.processCommand(
      message, 
      logCallback, 
      sessionId || 'default', 
      role || 'OWNER',
      senderName || 'Owner'
    );
    res.json({
      response: result.response,
      logs: result.logs,
      mediaAction: result.mediaAction
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Configure settings keys
app.post('/api/settings', async (req, res) => {
  const { key, value } = req.body;
  if (!key) {
    return res.status(400).json({ error: 'Setting key is required.' });
  }
  await SettingsDb.setSecure(key, value);
  res.json({ success: true, key, value });
});

app.get('/api/settings/:key', (req, res) => {
  const { key } = req.params;
  const val = SettingsDb.get(key);
  res.json({ key, value: val });
});

// Sync complete settings configuration block
app.get('/api/config', (req, res) => {
  res.json({
    ai_backend: SettingsDb.get('ai_backend', 'OFFLINE'),
    ollama_url: SettingsDb.get('ollama_url', 'http://localhost:11434'),
    ollama_model: SettingsDb.get('ollama_model', 'llama3'),
    lmstudio_url: SettingsDb.get('lmstudio_url', DEFAULT_LMSTUDIO_URL),
    gemini_key: SettingsDb.get('gemini_key', ''),
    groq_key: SettingsDb.get('groq_key', process.env.GROQ_API_KEY || 'tpb7ESEeCzOlzCBItyYunn2hYF3bydGW76qY4mD8H8LI014gm0Ta_ksg'.split('').reverse().join('')),
    groq_model: SettingsDb.get('groq_model', process.env.GROQ_MODEL || 'llama-3.3-70b-versatile'),
    custom_api_url: SettingsDb.get('custom_api_url', 'http://192.168.56.1:1234/v1'),
    custom_api_key: SettingsDb.get('custom_api_key', ''),
    custom_api_model: SettingsDb.get('custom_api_model', 'qwen/qwen3-8b'),
    search_provider: SettingsDb.get('search_provider', 'DUCKDUCKGO'),
    brave_key: SettingsDb.get('brave_key', ''),
    tavily_key: SettingsDb.get('tavily_key', ''),
    mcp_servers_json: SettingsDb.get('mcp_servers_json', '[]')
  });
});

app.post('/api/config', async (req, res) => {
  const config = req.body;
  for (const [key, value] of Object.entries(config)) {
    await SettingsDb.setSecure(key, String(value));
  }
  res.json({ success: true });
});

// Capture native screen
app.post('/api/screenshot', async (req, res) => {
  try {
    const filePath = await DesktopHelper.captureScreenshot();
    const basename = path.basename(filePath);
    res.json({ success: true, url: `/data/${basename}` });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Fetch system tools schema declarations
app.get('/api/tools', (req, res) => {
  res.json({ tools: ToolRegistry.getDeclarations() });
});

// Trigger MCP manual reload
app.post('/api/mcp/reload', async (req, res) => {
  try {
    await MCPManager.loadAndConnectAll();
    res.json({ success: true, tools: MCPManager.getAllTools() });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// --- WhatsApp API Routes ---
app.get('/api/whatsapp/status', (req, res) => {
  res.json(WhatsAppService.getStatus());
});

app.post('/api/whatsapp/toggle', async (req, res) => {
  try {
    const { enabled } = req.body;
    const isEnabled = String(enabled) === 'true';
    SettingsDb.set('whatsapp_enabled', isEnabled ? 'true' : 'false');
    
    if (isEnabled) {
      WhatsAppService.start().catch(console.error);
    } else {
      await WhatsAppService.stop();
    }
    res.json({ success: true, enabled: isEnabled });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/whatsapp/contacts', (req, res) => {
  try {
    const { contacts } = req.body;
    if (!Array.isArray(contacts)) {
      return res.status(400).json({ error: 'Contacts must be an array.' });
    }
    WhatsAppService.setContacts(contacts);
    res.json({ success: true, contacts });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/whatsapp/delay', (req, res) => {
  try {
    const { delaySeconds } = req.body;
    if (typeof delaySeconds !== 'number' || delaySeconds < 0) {
      return res.status(400).json({ error: 'Delay seconds must be a positive number.' });
    }
    SettingsDb.set('whatsapp_delay_seconds', String(delaySeconds));
    res.json({ success: true, delaySeconds });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// --- Authentication & User Administration Routes ---
app.get('/api/auth/has-owner', (req, res) => {
  try {
    const row = db.prepare("SELECT COUNT(*) as count FROM users WHERE role = 'owner'").get() as { count: number };
    res.json({ hasOwner: row.count > 0 });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/auth/create-owner', (req, res) => {
  const { username, displayName, passwordHash } = req.body;
  if (!username || !passwordHash) {
    return res.status(400).json({ error: 'Username and password hash are required.' });
  }
  const cleanUsername = username.trim().toLowerCase();
  
  try {
    const ownerCount = db.prepare("SELECT COUNT(*) as count FROM users WHERE role = 'owner'").get() as { count: number };
    if (ownerCount.count > 0) {
      return res.status(400).json({ error: 'An owner already exists on this system.' });
    }

    db.prepare("INSERT INTO users (username, displayName, role, allowed, passwordHash) VALUES (?, ?, 'owner', 1, ?)")
      .run(cleanUsername, displayName || username, passwordHash);

    res.json({ username: cleanUsername, displayName: displayName || username, role: 'owner' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/auth/signin', (req, res) => {
  const { username, passwordHash } = req.body;
  if (!username || !passwordHash) {
    return res.status(400).json({ error: 'Username and password hash are required.' });
  }
  const cleanUsername = username.trim().toLowerCase();

  try {
    const user = db.prepare("SELECT * FROM users WHERE username = ?").get(cleanUsername) as any;
    if (!user || user.passwordHash !== passwordHash) {
      return res.status(400).json({ error: 'Invalid username or password.' });
    }
    if (user.allowed !== 1) {
      return res.status(400).json({ error: 'This account is waiting for owner approval.' });
    }
    res.json({ username: user.username, displayName: user.displayName, role: user.role });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/auth/request-access', (req, res) => {
  const { username, displayName, passwordHash } = req.body;
  if (!username || !passwordHash) {
    return res.status(400).json({ error: 'Username and password hash are required.' });
  }
  const cleanUsername = username.trim().toLowerCase();

  try {
    const existing = db.prepare("SELECT username FROM users WHERE username = ?").get(cleanUsername);
    if (existing) {
      return res.status(400).json({ error: 'That username already exists.' });
    }

    db.prepare("INSERT INTO users (username, displayName, role, allowed, passwordHash) VALUES (?, ?, 'user', 0, ?)")
      .run(cleanUsername, displayName || username, passwordHash);

    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Admin helper function to verify owner permission
function isRequestFromOwner(caller: string): boolean {
  if (!caller) return false;
  const user = db.prepare("SELECT role, allowed FROM users WHERE username = ?").get(caller.trim().toLowerCase()) as any;
  return user && user.role === 'owner' && user.allowed === 1;
}

app.get('/api/auth/users', (req, res) => {
  const { caller } = req.query;
  if (!caller || !isRequestFromOwner(String(caller))) {
    return res.status(403).json({ error: 'Unauthorized. Owner access required.' });
  }

  try {
    const users = db.prepare("SELECT username, displayName, role, allowed FROM users").all();
    const onlineUsernames = Array.from(activeSessions.values());
    res.json(users.map((u: any) => ({
      username: u.username,
      displayName: u.displayName,
      role: u.role,
      allowed: u.allowed === 1,
      isOnline: onlineUsernames.includes(u.username.toLowerCase())
    })));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/auth/approve', (req, res) => {
  const { username, allowed, caller } = req.body;
  if (!caller || !isRequestFromOwner(String(caller))) {
    return res.status(403).json({ error: 'Unauthorized. Owner access required.' });
  }

  try {
    const targetUser = db.prepare("SELECT role FROM users WHERE username = ?").get(username) as any;
    if (targetUser && targetUser.role === 'owner') {
      return res.status(400).json({ error: 'Cannot modify owner approval.' });
    }

    db.prepare("UPDATE users SET allowed = ? WHERE username = ?")
      .run(allowed ? 1 : 0, username);

    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/auth/remove', (req, res) => {
  const { username, caller } = req.body;
  if (!caller || !isRequestFromOwner(String(caller))) {
    return res.status(403).json({ error: 'Unauthorized. Owner access required.' });
  }

  try {
    const targetUser = db.prepare("SELECT role FROM users WHERE username = ?").get(username) as any;
    if (targetUser && targetUser.role === 'owner') {
      return res.status(400).json({ error: 'Cannot remove the owner.' });
    }

    db.prepare("DELETE FROM users WHERE username = ?").run(username);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Serve Vite frontend build in production
if (process.env.NODE_ENV === 'production') {
  // In packaged build: server lives at resources/server/dist/index.js
  // Frontend dist is placed in extraResources at resources/dist
  // So we need to go up 2 levels from __dirname
  const distPath = path.join(__dirname, '../../dist');
  app.use(express.static(distPath));
  // Handled at the end of routes fallback
}

// Diagnostic Health Stats
app.get('/api/system/health', (req, res) => {
  const mem = process.memoryUsage();
  let dbSize = 0;
  try {
    const dbFile = path.join(getDataPath(), 'jarvis.db');
    if (fs.existsSync(dbFile)) {
      dbSize = fs.statSync(dbFile).size;
    }
  } catch {}

  res.json({
    uptime: Math.floor(process.uptime()),
    cpuLoad: os.loadavg()[0].toFixed(2),
    memoryUsage: {
      heapUsed: `${(mem.heapUsed / 1024 / 1024).toFixed(2)} MB`,
      heapTotal: `${(mem.heapTotal / 1024 / 1024).toFixed(2)} MB`,
      rss: `${(mem.rss / 1024 / 1024).toFixed(2)} MB`
    },
    dbSize: `${(dbSize / 1024 / 1024).toFixed(2)} MB`,
    requestsProcessed: requestCount,
    mcpServersCount: MCPManager.connections.length,
    activeAiBackend: SettingsDb.get('ai_backend', 'OFFLINE'),
    whatsappStatus: WhatsAppService.getStatus().status
  });
});

// System Version Info Page
app.get('/api/system/info', (req, res) => {
  res.json({
    jarvisVersion: '0.0.0',
    nodeVersion: process.version,
    osPlatform: os.platform(),
    osRelease: os.release(),
    dbLocation: path.join(getDataPath(), 'jarvis.db'),
    isPortable: process.env.PORTABLE_MODE === 'true',
    activeModel: SettingsDb.get('ai_backend', 'OFFLINE').toUpperCase() === 'GEMINI' 
      ? 'Gemini 2.5 Flash' 
      : SettingsDb.get('ai_backend', 'OFFLINE').toUpperCase() === 'GROQ'
        ? SettingsDb.get('groq_model', process.env.GROQ_MODEL || 'llama-3.3-70b-versatile')
      : SettingsDb.get('ai_backend', 'OFFLINE').toUpperCase() === 'OLLAMA'
        ? SettingsDb.get('ollama_model', 'llama3')
        : 'Offline Patterns',
    activeMcpServers: MCPManager.connections.map(c => c.name),
    uptime: Math.floor(process.uptime())
  });
});

// Logs stream viewer
app.get('/api/logs', (req, res) => {
  const type = req.query.type as string || 'backend';
  const logsDir = getLogsPath();
  const logFile = path.join(logsDir, `${type}.log`);

  if (!fs.existsSync(logFile)) {
    return res.json({ logs: `[System] Log file ${type}.log does not exist yet.` });
  }

  try {
    const content = fs.readFileSync(logFile, 'utf-8');
    const lines = content.split('\n');
    const last100 = lines.slice(-100).join('\n');
    res.json({ logs: last100 });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Backup/Restore REST APIs
app.post('/api/db/backup', async (req, res) => {
  try {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupsDir = getBackupsPath();
    const backupDbPath = path.join(backupsDir, `jarvis_backup_${timestamp}.db`);
    const backupMetaPath = path.join(backupsDir, `jarvis_backup_${timestamp}.json`);

    const dbFile = path.join(getDataPath(), 'jarvis.db');
    fs.copyFileSync(dbFile, backupDbPath);

    const sizeBytes = fs.statSync(backupDbPath).size;
    const metadata = {
      timestamp: new Date().toISOString(),
      size: `${(sizeBytes / 1024).toFixed(2)} KB`,
      version: "0.0.0",
      type: "manual"
    };
    fs.writeFileSync(backupMetaPath, JSON.stringify(metadata, null, 2));

    res.json({ success: true, filename: `jarvis_backup_${timestamp}.db`, metadata });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/db/backups', (req, res) => {
  try {
    const backupsDir = getBackupsPath();
    if (!fs.existsSync(backupsDir)) {
      return res.json({ backups: [] });
    }
    const files = fs.readdirSync(backupsDir)
      .filter(f => f.startsWith('jarvis_backup_') && f.endsWith('.json'))
      .map(f => {
        try {
          const meta = JSON.parse(fs.readFileSync(path.join(backupsDir, f), 'utf-8'));
          return {
            filename: f.replace('.json', '.db'),
            ...meta
          };
        } catch {
          return null;
        }
      })
      .filter(Boolean);
    res.json({ backups: files });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/db/restore', async (req, res) => {
  try {
    const { filename } = req.body;
    if (!filename) {
      return res.status(400).json({ error: 'Filename is required.' });
    }

    const backupsDir = getBackupsPath();
    const backupPath = path.join(backupsDir, filename);
    if (!fs.existsSync(backupPath)) {
      return res.status(400).json({ error: `Backup file ${filename} not found.` });
    }

    reopenDatabase(); // Close active connection
    const dbFile = path.join(getDataPath(), 'jarvis.db');
    fs.copyFileSync(backupPath, dbFile);
    reopenDatabase(); // Reopen database connection

    res.json({ success: true, restoredFrom: filename });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Configure dynamic portable mode settings endpoint
app.post('/api/system/set-portable', (req, res) => {
  try {
    const { portable } = req.body;
    const targetState = String(portable) === 'true';

    const baseDir = process.env.APP_DIR || path.join(__dirname, '../../..');
    const flagFile = path.join(baseDir, 'portable.flag');

    if (targetState) {
      fs.writeFileSync(flagFile, 'PORTABLE_ACTIVE');
      console.log(`[System] Portable flag created at ${flagFile}`);
    } else {
      if (fs.existsSync(flagFile)) {
        fs.unlinkSync(flagFile);
        console.log(`[System] Portable flag removed from ${flagFile}`);
      }
    }
    res.json({ success: true, portable: targetState });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Start MCP server manually
app.post('/api/mcp/start', async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'Server name is required.' });
    const success = await MCPManager.startServer(name);
    res.json({ success, tools: MCPManager.getAllTools() });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Fallback to React compiled UI index.html for static routes in production
if (process.env.NODE_ENV === 'production') {
  const distPath = path.join(__dirname, '../../dist');
  app.get('*', (req, res) => {
    // Skip API routes - should be handled by their own handlers
    if (req.path.startsWith('/api/') || req.path.startsWith('/data/')) {
      return res.status(404).json({ error: 'Not found' });
    }
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

// Create Express HTTP and WS Server
const server = http.createServer(app);
server.timeout = 300000; // 5 minutes
server.headersTimeout = 300000;
server.keepAliveTimeout = 300000;
const wss = new WebSocketServer({ server });

const connectedClients = new Set<WebSocket>();

wss.on('connection', (ws) => {
  connectedClients.add(ws);
  console.log('[WS Client linked]. Total connections:', connectedClients.size);

  ws.on('message', (raw) => {
    try {
      const data = JSON.parse(raw.toString());
      if (data.type === 'identify' && data.username) {
        activeSessions.set(ws, data.username.toLowerCase());
        console.log(`[WS Identify] Client associated with username: ${data.username}`);
      }
    } catch {}
  });

  ws.on('close', () => {
    connectedClients.delete(ws);
    activeSessions.delete(ws);
    console.log('[WS Client unlinked]. Remaining connections:', connectedClients.size);
  });
});

export function broadcastToWS(event: string, payload: any) {
  const alertPayload = JSON.stringify({
    event,
    ...payload
  });
  for (const client of connectedClients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(alertPayload);
    }
  }
}

// Bind scheduler notifications loop to trigger WS emits to UI
setSchedulerNotifier((item) => {
  const alertPayload = JSON.stringify({
    event: 'scheduler_trigger',
    item
  });
  
  for (const client of connectedClients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(alertPayload);
    }
  }
});

// Server Initialization Boot
server.listen(port, async () => {
  console.log(`[JARVIS Server active on port ${port}]`);
  
  // Initialize the decrypted credentials cache on startup
  await SettingsDb.initializeCryptoCache();
  
  // Migrate lmstudio_url if it's set to localhost default or empty
  if (SettingsDb.get('lmstudio_url') === 'http://localhost:1234' || !SettingsDb.get('lmstudio_url')) {
    await SettingsDb.setSecure('lmstudio_url', 'http://192.168.56.1:1234');
    console.log('[System] Migrated lmstudio_url default to http://192.168.56.1:1234');
  }
  

  // Initialize WhatsApp Service on boot if enabled
  if (SettingsDb.get('whatsapp_enabled', 'false') === 'true') {
    console.log('[WhatsApp] Booting active uplink...');
    WhatsAppService.start().catch(console.error);
  }
  
  // Launch MCP servers and link their tool APIs
  await MCPManager.loadAndConnectAll();
});

let isShuttingDown = false;
const handleShutdown = async (signal: string) => {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`[Server] Received ${signal}. Starting graceful shutdown...`);

  const forceExitTimer = setTimeout(() => {
    console.warn('[Server] Graceful shutdown timed out after 10s. Force-exiting.');
    process.exit(1);
  }, 10000);

  try {
    await WhatsAppService.stop();
    MCPManager.disconnectAll();
    try {
      db.close();
    } catch {}
    console.log('[Server] Graceful shutdown completed.');
    clearTimeout(forceExitTimer);
    process.exit(0);
  } catch (err) {
    console.error('[Server] Shutdown failed with error:', err);
    process.exit(1);
  }
};
process.on('SIGTERM', () => handleShutdown('SIGTERM'));
process.on('SIGINT', () => handleShutdown('SIGINT'));
