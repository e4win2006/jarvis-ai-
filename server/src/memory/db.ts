import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { getDataPath, getBackupsPath } from '../utils/appPaths';

const DB_DIR = getDataPath();
const dbPath = path.join(DB_DIR, 'jarvis.db');

// Run auto-backup on startup before initializing tables
if (fs.existsSync(dbPath) && fs.statSync(dbPath).size > 0) {
  const backupsDir = getBackupsPath();
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDbName = `jarvis_auto_backup_${timestamp}.db`;
  const backupDbPath = path.join(backupsDir, backupDbName);
  const backupMetaPath = path.join(backupsDir, `jarvis_auto_backup_${timestamp}.json`);
  
  try {
    fs.copyFileSync(dbPath, backupDbPath);
    const sizeBytes = fs.statSync(backupDbPath).size;
    fs.writeFileSync(backupMetaPath, JSON.stringify({
      timestamp: new Date().toISOString(),
      size: `${(sizeBytes / 1024).toFixed(2)} KB`,
      version: "0.0.0",
      type: "auto"
    }, null, 2));
    console.log(`[Database] Auto-backup completed on startup: ${backupDbName}`);
    
    // Prune old auto-backups (keep max 5)
    const files = fs.readdirSync(backupsDir)
      .filter(f => f.startsWith('jarvis_auto_backup_') && f.endsWith('.db'))
      .sort();
    while (files.length > 5) {
      const oldestDb = files.shift();
      if (oldestDb) {
        fs.unlinkSync(path.join(backupsDir, oldestDb));
        const metaFile = oldestDb.replace('.db', '.json');
        try {
          fs.unlinkSync(path.join(backupsDir, metaFile));
        } catch {}
      }
    }
  } catch (err) {
    console.error('[Database] Startup auto-backup failed:', err);
  }
}

export let db = new Database(dbPath);

export function reopenDatabase() {
  try {
    db.close();
  } catch {}
  db = new Database(dbPath);
}

// Initialize Tables
db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );
  
  CREATE TABLE IF NOT EXISTS chat_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    role TEXT,
    content TEXT,
    session_id TEXT DEFAULT 'default'
  );
  
  CREATE TABLE IF NOT EXISTS vector_memory (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    text TEXT,
    metadata TEXT,
    embedding TEXT
  );
  
  CREATE TABLE IF NOT EXISTS users (
    username TEXT PRIMARY KEY,
    displayName TEXT,
    role TEXT,
    allowed INTEGER,
    passwordHash TEXT,
    email TEXT
  );
`);

// Alter table safety check for existing databases
try {
  db.prepare("SELECT session_id FROM chat_history LIMIT 1").get();
} catch {
  try {
    db.exec("ALTER TABLE chat_history ADD COLUMN session_id TEXT DEFAULT 'default'");
  } catch (err) {
    console.error("Migration error adding session_id column:", err);
  }
}

try {
  db.prepare("SELECT email FROM users LIMIT 1").get();
} catch {
  try {
    db.exec("ALTER TABLE users ADD COLUMN email TEXT");
  } catch (err) {
    console.error("Migration error adding email column:", err);
  }
}

// Backfill default owner email if missing
try {
  db.prepare("UPDATE users SET email = 'edwintomjoseph41@gmail.com' WHERE role = 'owner' AND (email IS NULL OR email = '')").run();
} catch {}

import { isSensitiveKey, encryptSecret, decryptSecret } from '../utils/crypto';

const decryptedCache = new Map<string, string>();

export const SettingsDb = {
  get(key: string, defaultValue: string = ''): string {
    if (decryptedCache.has(key)) {
      return decryptedCache.get(key)!;
    }
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
    return row ? row.value : defaultValue;
  },
  set(key: string, value: string): void {
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value);
    if (decryptedCache.has(key)) {
      decryptedCache.set(key, value);
    }
  },
  async setSecure(key: string, value: string): Promise<void> {
    if (isSensitiveKey(key) && value) {
      const encrypted = await encryptSecret(value);
      const prefixed = `enc:${encrypted}`;
      db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, prefixed);
      decryptedCache.set(key, value);
    } else {
      this.set(key, value);
    }
  },
  async initializeCryptoCache(): Promise<void> {
    try {
      const rows = db.prepare('SELECT key, value FROM settings').all() as { key: string, value: string }[];
      for (const row of rows) {
        if (isSensitiveKey(row.key) && row.value) {
          const decrypted = await decryptSecret(row.value);
          decryptedCache.set(row.key, decrypted);
        }
      }
      console.log(`[Database] Credentials credentials cache loaded (${decryptedCache.size} item(s)).`);
    } catch (err) {
      console.error('[Database] Failed to load credentials cache:', err);
    }
  }
};

export const HistoryDb = {
  add(role: 'user' | 'assistant' | 'system', content: string, sessionId: string = 'default'): void {
    db.prepare('INSERT INTO chat_history (role, content, session_id) VALUES (?, ?, ?)').run(role, content, sessionId);
  },
  getRecent(limit: number = 20, sessionId: string = 'default') {
    return db.prepare('SELECT role, content FROM chat_history WHERE session_id = ? ORDER BY id DESC LIMIT ?')
      .all(sessionId, limit)
      .reverse() as { role: string; content: string }[];
  },
  clear(sessionId: string = 'default'): void {
    db.prepare('DELETE FROM chat_history WHERE session_id = ?').run(sessionId);
  }
};

export interface VectorItem {
  id: number;
  text: string;
  metadata: Record<string, any>;
  embedding: number[];
}

export const VectorDb = {
  insert(text: string, metadata: Record<string, any>, embedding: number[]): void {
    db.prepare('INSERT INTO vector_memory (text, metadata, embedding) VALUES (?, ?, ?)')
      .run(text, JSON.stringify(metadata), JSON.stringify(embedding));
  },
  getAll(): VectorItem[] {
    const rows = db.prepare('SELECT id, text, metadata, embedding FROM vector_memory').all() as any[];
    return rows.map(r => ({
      id: r.id,
      text: r.text,
      metadata: JSON.parse(r.metadata),
      embedding: JSON.parse(r.embedding)
    }));
  }
};

export default db;
