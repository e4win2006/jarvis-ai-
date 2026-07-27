import db from '../memory/db';
import { DesktopHelper } from '../automation/desktop';
import { Orchestrator } from '../ai/orchestrator';

// Initialize assignments table
db.exec(`
  CREATE TABLE IF NOT EXISTS assignments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    subject TEXT DEFAULT 'General',
    description TEXT,
    due_date TEXT,
    status TEXT DEFAULT 'pending', -- 'pending' | 'in_progress' | 'completed' | 'failed'
    solution TEXT DEFAULT '',
    auto_do INTEGER DEFAULT 1,
    created_at TEXT,
    updated_at TEXT,
    completed_at TEXT
  )
`);

export interface AssignmentItem {
  id: number;
  title: string;
  subject: string;
  description: string;
  due_date: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  solution: string;
  auto_do: number;
  created_at: string;
  updated_at: string;
  completed_at?: string;
}

// WebSocket notifier callback
let wsNotifier: ((event: string, payload: any) => void) | null = null;
export function setAssignmentsNotifier(fn: (event: string, payload: any) => void) {
  wsNotifier = fn;
}

export const AssignmentsManager = {
  getAll(): AssignmentItem[] {
    return db.prepare('SELECT * FROM assignments ORDER BY CASE WHEN status = "pending" THEN 0 WHEN status = "in_progress" THEN 1 ELSE 2 END, due_date ASC, id DESC').all() as AssignmentItem[];
  },

  getById(id: number): AssignmentItem | undefined {
    return db.prepare('SELECT * FROM assignments WHERE id = ?').get(id) as AssignmentItem | undefined;
  },

  add(title: string, subject: string = 'General', description: string = '', dueDate: string = '', autoDo: boolean = true): AssignmentItem {
    const now = new Date().toISOString();
    const info = db.prepare(`
      INSERT INTO assignments (title, subject, description, due_date, status, solution, auto_do, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'pending', '', ?, ?, ?)
    `).run(title, subject, description, dueDate, autoDo ? 1 : 0, now, now);

    const newItem = this.getById(info.lastInsertRowid as number)!;
    if (wsNotifier) {
      wsNotifier('assignment_created', newItem);
    }
    return newItem;
  },

  update(id: number, fields: Partial<AssignmentItem>): AssignmentItem | undefined {
    const existing = this.getById(id);
    if (!existing) return undefined;

    const title = fields.title !== undefined ? fields.title : existing.title;
    const subject = fields.subject !== undefined ? fields.subject : existing.subject;
    const description = fields.description !== undefined ? fields.description : existing.description;
    const dueDate = fields.due_date !== undefined ? fields.due_date : existing.due_date;
    const status = fields.status !== undefined ? fields.status : existing.status;
    const solution = fields.solution !== undefined ? fields.solution : existing.solution;
    const autoDo = fields.auto_do !== undefined ? fields.auto_do : existing.auto_do;
    const completedAt = fields.completed_at !== undefined ? fields.completed_at : existing.completed_at;
    const updatedAt = new Date().toISOString();

    db.prepare(`
      UPDATE assignments
      SET title = ?, subject = ?, description = ?, due_date = ?, status = ?, solution = ?, auto_do = ?, completed_at = ?, updated_at = ?
      WHERE id = ?
    `).run(title, subject, description, dueDate, status, solution, autoDo, completedAt, updatedAt, id);

    const updatedItem = this.getById(id);
    if (wsNotifier && updatedItem) {
      wsNotifier('assignment_updated', updatedItem);
    }
    return updatedItem;
  },

  delete(id: number): boolean {
    const info = db.prepare('DELETE FROM assignments WHERE id = ?').run(id);
    if (info.changes > 0 && wsNotifier) {
      wsNotifier('assignment_deleted', { id });
    }
    return info.changes > 0;
  },

  async solveAssignment(id: number): Promise<AssignmentItem> {
    const item = this.getById(id);
    if (!item) {
      throw new Error(`Assignment #${id} not found.`);
    }

    // Mark status as in_progress
    this.update(id, { status: 'in_progress' });
    DesktopHelper.showNotification('JARVIS Assignment Engine', `Working on assignment: "${item.title}" on your behalf...`);

    const prompt = `
[ASSIGNMENT TASK REQUEST]
Subject: ${item.subject || 'General'}
Assignment Title: ${item.title}
Due Date: ${item.due_date || 'Not specified'}
Detailed Instructions & Questions:
${item.description || 'Please provide a thorough and comprehensive completion for this assignment.'}

You are JARVIS operating on behalf of your user. Please complete this assignment thoroughly, step by step, with full detail, formatted clearly in Markdown. Provide accurate answers, research, explanations, or code where applicable.
`;

    try {
      const logs: string[] = [];
      const logCallback = (type: string, text: string) => {
        logs.push(`[${type}] ${text}`);
      };

      const result = await Orchestrator.processCommand(
        prompt,
        logCallback,
        `assignment_${id}`,
        'OWNER',
        'System Auto-Solver'
      );

      const solutionContent = result.response || 'Assignment completion was generated successfully.';
      const now = new Date().toISOString();

      const completedItem = this.update(id, {
        status: 'completed',
        solution: solutionContent,
        completed_at: now
      })!;

      DesktopHelper.showNotification(
        'JARVIS Assignment Completed',
        `Successfully completed "${item.title}" on your behalf!`
      );

      if (wsNotifier) {
        wsNotifier('assignment_completed', completedItem);
      }

      return completedItem;
    } catch (err: any) {
      console.error(`Failed to solve assignment #${id}:`, err);
      const failedItem = this.update(id, {
        status: 'failed',
        solution: `Error solving assignment: ${err.message || String(err)}`
      })!;

      DesktopHelper.showNotification(
        'JARVIS Assignment Failed',
        `Failed to complete "${item.title}": ${err.message || 'Unknown error'}`
      );

      if (wsNotifier) {
        wsNotifier('assignment_failed', failedItem);
      }

      return failedItem;
    }
  },

  // Auto-solve check called in scheduler ticker
  async checkAutoSolve(): Promise<void> {
    const pendingItems = db.prepare(`
      SELECT * FROM assignments 
      WHERE status = 'pending' AND auto_do = 1
    `).all() as AssignmentItem[];

    if (pendingItems.length === 0) return;

    const now = new Date();
    for (const item of pendingItems) {
      if (!item.due_date) continue;
      const targetTime = new Date(item.due_date);
      // Auto-trigger if due date is within 2 hours or overdue
      const timeDiffMs = targetTime.getTime() - now.getTime();
      if (timeDiffMs <= 2 * 60 * 60 * 1000) {
        console.log(`[Assignments] Auto-triggering background solver for assignment #${item.id}: "${item.title}"`);
        this.solveAssignment(item.id).catch(err => console.error(`Auto-solve error for #${item.id}:`, err));
      }
    }
  }
};
