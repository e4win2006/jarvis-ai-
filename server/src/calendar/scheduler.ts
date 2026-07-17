import db, { SettingsDb } from '../memory/db';
import { DesktopHelper } from '../automation/desktop';
import nodemailer from 'nodemailer';

// Initialize scheduler table
db.exec(`
  CREATE TABLE IF NOT EXISTS scheduler_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT,       -- 'alarm' | 'reminder' | 'timer'
    target_time TEXT, -- ISO string or Unix timestamp
    label TEXT,
    active INTEGER DEFAULT 1
  )
`);

export interface SchedulerItem {
  id: number;
  type: 'alarm' | 'reminder' | 'timer';
  target_time: string;
  label: string;
  active: number;
}

// WebSocket notifier hook
let wsNotifier: ((item: SchedulerItem) => void) | null = null;
export function setSchedulerNotifier(fn: (item: SchedulerItem) => void) {
  wsNotifier = fn;
}

export const Scheduler = {
  add(type: 'alarm' | 'reminder' | 'timer', targetTime: string, label: string): number {
    const info = db.prepare('INSERT INTO scheduler_items (type, target_time, label) VALUES (?, ?, ?)')
      .run(type, targetTime, label);
    return info.lastInsertRowid as number;
  },

  getAll(): SchedulerItem[] {
    return db.prepare('SELECT id, type, target_time, label, active FROM scheduler_items WHERE active = 1')
      .all() as SchedulerItem[];
  },

  dismiss(id: number): void {
    db.prepare('UPDATE scheduler_items SET active = 0 WHERE id = ?').run(id);
  },

  // Tick checker called every second
  tickCheck(): void {
    const activeItems = this.getAll();
    const now = new Date();

    for (const item of activeItems) {
      const target = new Date(item.target_time);
      if (now >= target) {
        this.dismiss(item.id);
        
        // Trigger OS notification
        DesktopHelper.showNotification(
          `JARVIS ${item.type.toUpperCase()}`,
          `${item.label} (Scheduled for ${target.toLocaleTimeString()})`
        );

        // Notify UI via WebSocket
        if (wsNotifier) {
          wsNotifier(item);
        }
      }
    }
  }
};

// Start Tick Checker background runner
setInterval(() => {
  Scheduler.tickCheck();
}, 1000);

// Email Integration
export const EmailSender = {
  async sendEmail(to: string, subject: string, body: string): Promise<string> {
    const host = SettingsDb.get('smtp_host', '');
    const port = parseInt(SettingsDb.get('smtp_port', '587'));
    const user = SettingsDb.get('smtp_user', '');
    const pass = SettingsDb.get('smtp_pass', '');

    if (!host || !user || !pass) {
      // Return beautiful mock simulation response
      return `SMTP mail credentials not configured. Simulated dispatch completed successfully:\nTo: ${to}\nSubject: ${subject}\nMessage: ${body}`;
    }

    try {
      const transporter = nodemailer.createTransport({
        host,
        port,
        secure: port === 465,
        auth: { user, pass }
      });

      await transporter.sendMail({
        from: `"Jarvis Personal Assistant" <${user}>`,
        to,
        subject,
        text: body
      });

      return `Email sent successfully to ${to}.`;
    } catch (e: any) {
      throw new Error(`Email delivery failed: ${e.message}`);
    }
  }
};
