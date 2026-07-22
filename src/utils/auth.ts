import { API_BASE, IS_GITHUB_PAGES_WITHOUT_API } from './apiConfig';

export type JarvisRole = 'owner' | 'user';

export interface JarvisUser {
  username: string;
  displayName: string;
  role: JarvisRole;
  allowed: boolean;
  passwordHash: string;
  email?: string;
  isOnline?: boolean;
}

export interface JarvisSession {
  username: string;
  displayName: string;
  role: JarvisRole;
  email?: string;
}

const USERS_KEY = 'jarvis_allowed_users';
const SESSION_KEY = 'jarvis_session';

const textEncoder = new TextEncoder();

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', textEncoder.encode(value));
  return Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, '0')).join('');
}

// Local storage helpers used for static fallback
export function getLocalUsers(): JarvisUser[] {
  const raw = localStorage.getItem(USERS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveLocalUsers(users: JarvisUser[]) {
  localStorage.setItem(USERS_KEY, JSON.stringify(users));
}

// Public API matching original signature but fully async (supporting API + Static)
export async function hasOwner(): Promise<boolean> {
  if (IS_GITHUB_PAGES_WITHOUT_API) {
    return getLocalUsers().some(user => user.role === 'owner');
  }
  
  try {
    const res = await fetch(`${API_BASE}/api/auth/has-owner`);
    if (!res.ok) throw new Error();
    const data = await res.json();
    return Boolean(data.hasOwner);
  } catch {
    // If backend check fails, fallback to checking local storage
    return getLocalUsers().some(user => user.role === 'owner');
  }
}

export function getSession(): JarvisSession | null {
  const raw = localStorage.getItem(SESSION_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function signOut() {
  localStorage.removeItem(SESSION_KEY);
}

export async function createOwner(username: string, displayName: string, password: string, email?: string): Promise<JarvisSession> {
  const cleanUsername = username.trim().toLowerCase();
  const cleanName = displayName.trim() || username.trim();
  const cleanEmail = (email || 'edwintomjoseph41@gmail.com').trim().toLowerCase();
  const passwordHash = await sha256(password);

  if (IS_GITHUB_PAGES_WITHOUT_API) {
    const user: JarvisUser = {
      username: cleanUsername,
      displayName: cleanName,
      role: 'owner',
      allowed: true,
      passwordHash,
      email: cleanEmail
    };
    saveLocalUsers([user]);
    const session = { username: user.username, displayName: user.displayName, role: user.role, email: user.email };
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    return session;
  }

  const res = await fetch(`${API_BASE}/api/auth/create-owner`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: cleanUsername, displayName: cleanName, passwordHash, email: cleanEmail })
  });

  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Failed to create owner.');
  }

  const user = await res.json();
  const session = { username: user.username, displayName: user.displayName, role: user.role, email: user.email || cleanEmail };
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  return session;
}

export async function signIn(usernameOrEmail: string, password: string): Promise<JarvisSession> {
  const cleanInput = usernameOrEmail.trim().toLowerCase();
  const passwordHash = await sha256(password);

  if (IS_GITHUB_PAGES_WITHOUT_API) {
    const user = getLocalUsers().find(candidate => candidate.username === cleanInput || candidate.email?.toLowerCase() === cleanInput);
    if (!user || user.passwordHash !== passwordHash) {
      throw new Error('Invalid username/email or password.');
    }
    if (!user.allowed) {
      throw new Error('This account is waiting for owner approval.');
    }
    const session = { username: user.username, displayName: user.displayName, role: user.role, email: user.email || (user.role === 'owner' ? 'edwintomjoseph41@gmail.com' : '') };
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    return session;
  }

  const res = await fetch(`${API_BASE}/api/auth/signin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: cleanInput, passwordHash })
  });

  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Authentication failed.');
  }

  const user = await res.json();
  const session = { username: user.username, displayName: user.displayName, role: user.role, email: user.email };
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  return session;
}

export async function requestAccess(username: string, displayName: string, password: string, email?: string): Promise<void> {
  const cleanUsername = username.trim().toLowerCase();
  const cleanEmail = email ? email.trim().toLowerCase() : '';
  const passwordHash = await sha256(password);

  if (IS_GITHUB_PAGES_WITHOUT_API) {
    const users = getLocalUsers();
    if (users.some(user => user.username === cleanUsername || (cleanEmail && user.email?.toLowerCase() === cleanEmail))) {
      throw new Error('That username or email is already registered.');
    }
    users.push({
      username: cleanUsername,
      displayName: displayName.trim() || username.trim(),
      role: 'user',
      allowed: false,
      passwordHash,
      email: cleanEmail
    });
    saveLocalUsers(users);
    return;
  }

  const res = await fetch(`${API_BASE}/api/auth/request-access`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: cleanUsername, displayName, passwordHash, email: cleanEmail })
  });

  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Failed to submit request.');
  }
}

// User Admin Operations (supporting API + Static)
export async function fetchUsers(caller: string): Promise<JarvisUser[]> {
  if (IS_GITHUB_PAGES_WITHOUT_API) {
    return getLocalUsers();
  }

  const res = await fetch(`${API_BASE}/api/auth/users?caller=${encodeURIComponent(caller)}`);
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Failed to fetch users.');
  }
  return await res.json();
}

export async function approveUser(username: string, allowed: boolean, caller: string): Promise<void> {
  if (IS_GITHUB_PAGES_WITHOUT_API) {
    const users = getLocalUsers();
    const updated = users.map(u => u.username === username ? { ...u, allowed } : u);
    saveLocalUsers(updated);
    return;
  }

  const res = await fetch(`${API_BASE}/api/auth/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, allowed, caller })
  });

  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Failed to update user approval.');
  }
}

export async function removeUser(username: string, caller: string): Promise<void> {
  if (IS_GITHUB_PAGES_WITHOUT_API) {
    const users = getLocalUsers();
    const filtered = users.filter(u => u.username !== username);
    saveLocalUsers(filtered);
    return;
  }

  const res = await fetch(`${API_BASE}/api/auth/remove`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, caller })
  });

  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Failed to remove user.');
  }
}
