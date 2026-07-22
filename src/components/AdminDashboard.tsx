import { useEffect, useMemo, useState } from 'react';
import { Shield, Trash2, UserCheck, UserX, X, Users, Activity, FileText, Copy, Check } from 'lucide-react';
import { fetchUsers, approveUser, removeUser, type JarvisUser } from '../utils/auth';
import { API_BASE } from '../utils/apiConfig';

interface AdminDashboardProps {
  currentUsername: string;
  onClose: () => void;
}

export function AdminDashboard({ currentUsername, onClose }: AdminDashboardProps) {
  const [users, setUsers] = useState<JarvisUser[]>([]);
  const [isBusy, setIsBusy] = useState(true);
  const [activeTab, setActiveTab] = useState<'users' | 'server' | 'logs'>('users');
  
  // Health & Server Load stats states
  const [health, setHealth] = useState<any>(null);
  const [healthError, setHealthError] = useState<string | null>(null);

  // Log Viewer states
  const [logType, setLogType] = useState('backend');
  const [logs, setLogs] = useState('');
  const [logSearch, setLogSearch] = useState('');
  const [copied, setCopied] = useState(false);

  const pendingCount = useMemo(() => users.filter(user => !user.allowed).length, [users]);

  // Load User Registry
  const loadUsers = async () => {
    try {
      const data = await fetchUsers(currentUsername);
      setUsers(data);
    } catch (err) {
      console.error('Failed to load users:', err);
    } finally {
      setIsBusy(false);
    }
  };

  useEffect(() => {
    loadUsers();
    // Poll user registry for online status updates
    const interval = setInterval(loadUsers, 5000);
    return () => clearInterval(interval);
  }, []);

  // Poll Health Stats when on Server tab
  const fetchHealth = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/system/health`);
      if (res.ok) {
        const data = await res.json();
        setHealth(data);
        setHealthError(null);
      } else {
        throw new Error();
      }
    } catch {
      setHealthError('Failed to retrieve server diagnostics. Ensure backend is active.');
    }
  };

  useEffect(() => {
    if (activeTab === 'server') {
      fetchHealth();
      const interval = setInterval(fetchHealth, 5000);
      return () => clearInterval(interval);
    }
  }, [activeTab]);

  // Poll Logs when on Logs tab
  const fetchLogs = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/logs?type=${logType}`);
      if (res.ok) {
        const data = await res.json();
        setLogs(data.logs || '');
      }
    } catch (err) {
      setLogs('[System Error] Failed to retrieve server logs.');
    }
  };

  useEffect(() => {
    if (activeTab === 'logs') {
      fetchLogs();
      const interval = setInterval(fetchLogs, 5000);
      return () => clearInterval(interval);
    }
  }, [activeTab, logType]);

  const handleApprove = async (username: string, allowed: boolean) => {
    try {
      await approveUser(username, allowed, currentUsername);
      setUsers(prev => prev.map(u => u.username === username ? { ...u, allowed } : u));
    } catch (err) {
      alert('Failed to update user approval status.');
    }
  };

  const handleRemove = async (username: string) => {
    if (username === currentUsername) return;
    if (!confirm(`Are you sure you want to remove user "${username}"?`)) return;
    try {
      await removeUser(username, currentUsername);
      setUsers(prev => prev.filter(u => u.username !== username));
    } catch (err) {
      alert('Failed to remove user account.');
    }
  };

  const handleCopyLogs = () => {
    navigator.clipboard.writeText(logs);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const filteredLogs = useMemo(() => {
    if (!logSearch.trim()) return logs;
    return logs
      .split('\n')
      .filter(line => line.toLowerCase().includes(logSearch.toLowerCase()))
      .join('\n');
  }, [logs, logSearch]);

  if (isBusy) {
    return (
      <div className="admin-overlay">
        <section className="admin-panel" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 300 }}>
          <p className="auth-copy font-mono animate-pulse">[LOADING COMMAND MATRIX CORE USER DATABASE...]</p>
        </section>
      </div>
    );
  }

  return (
    <div className="admin-overlay">
      <section className="admin-panel max-w-[650px] w-full flex flex-col max-h-[85vh]">
        <div className="admin-header flex justify-between items-center border-b border-cyan-500/10 pb-3 mb-4">
          <div>
            <span className="admin-kicker flex items-center gap-1"><Shield size={14} /> Owner Console</span>
            <h2>Admin Panel</h2>
          </div>
          <button className="icon-btn" onClick={onClose} title="Close admin dashboard">
            <X size={18} />
          </button>
        </div>

        {/* Tab Navigation Menu */}
        <div className="flex gap-2 border-b border-cyan-500/10 pb-2.5 mb-4 font-mono text-[10px] uppercase tracking-wider">
          <button
            onClick={() => setActiveTab('users')}
            className={`px-3 py-1.5 rounded transition flex items-center gap-1.5 ${
              activeTab === 'users'
                ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/40'
            }`}
          >
            <Users size={12} /> Users ({users.length})
          </button>
          <button
            onClick={() => setActiveTab('server')}
            className={`px-3 py-1.5 rounded transition flex items-center gap-1.5 ${
              activeTab === 'server'
                ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/40'
            }`}
          >
            <Activity size={12} /> Server Load
          </button>
          <button
            onClick={() => setActiveTab('logs')}
            className={`px-3 py-1.5 rounded transition flex items-center gap-1.5 ${
              activeTab === 'logs'
                ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/40'
            }`}
          >
            <FileText size={12} /> Logs
          </button>
        </div>

        {/* Tab content area */}
        <div className="flex-1 overflow-y-auto min-h-[300px]">
          
          {/* TAB 1: USERS */}
          {activeTab === 'users' && (
            <div className="flex flex-col gap-4">
              <div className="admin-stats grid grid-cols-2 gap-3">
                <div className="bg-black/30 border border-cyan-500/10 p-3 rounded text-center">
                  <span className="text-xl font-bold font-header text-cyan-400">{users.length}</span>
                  <p className="text-[10px] text-slate-500 uppercase tracking-wider font-mono">Total Users</p>
                </div>
                <div className="bg-black/30 border border-cyan-500/10 p-3 rounded text-center">
                  <span className="text-xl font-bold font-header text-cyan-400">{pendingCount}</span>
                  <p className="text-[10px] text-slate-500 uppercase tracking-wider font-mono">Pending Approval</p>
                </div>
              </div>

              <div className="admin-list flex flex-col gap-2">
                {users.map(user => (
                  <div className="admin-user flex justify-between items-center p-3 rounded border border-cyan-500/5 bg-slate-950/20" key={user.username}>
                    <div>
                      <div className="flex items-center gap-2">
                        <strong className="text-sm font-semibold">{user.displayName}</strong>
                        {user.isOnline ? (
                          <span className="text-[8px] font-mono text-green-400 bg-green-500/10 border border-green-500/20 px-1 py-0.2 rounded font-bold uppercase tracking-wider">● ONLINE</span>
                        ) : (
                          <span className="text-[8px] font-mono text-slate-500 bg-slate-800 border border-slate-700 px-1 py-0.2 rounded font-bold uppercase tracking-wider">● OFFLINE</span>
                        )}
                      </div>
                      <p className="text-xs text-slate-400 font-mono">
                        {user.username} {user.email ? `(${user.email})` : ''} · {user.role === 'owner' ? 'Owner' : user.allowed ? 'Allowed user' : 'Pending user'}
                      </p>
                    </div>
                    <div className="admin-actions flex items-center gap-1.5">
                      {user.role !== 'owner' && (
                        <button
                          className={`admin-action font-mono text-[9px] uppercase px-2.5 py-1 rounded border flex items-center gap-1 ${
                            user.allowed 
                              ? 'bg-red-500/10 border-red-500/20 text-red-400 hover:bg-red-500/20' 
                              : 'bg-green-500/10 border-green-500/20 text-green-400 hover:bg-green-500/20'
                          }`}
                          onClick={() => handleApprove(user.username, !user.allowed)}
                        >
                          {user.allowed ? <UserX size={10} /> : <UserCheck size={10} />}
                          {user.allowed ? 'Block' : 'Approve'}
                        </button>
                      )}
                      {user.username !== currentUsername && (
                        <button 
                          className="admin-action danger font-mono text-[9px] uppercase px-2.5 py-1 rounded border bg-red-500/10 border-red-500/20 text-red-400 hover:bg-red-500/20 flex items-center gap-1" 
                          onClick={() => handleRemove(user.username)}
                        >
                          <Trash2 size={10} />
                          Remove
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB 2: SERVER LOAD */}
          {activeTab === 'server' && (
            <div className="flex flex-col gap-4 font-mono text-xs">
              {healthError ? (
                <div className="bg-red-500/10 border border-red-500/20 p-3 rounded text-red-400 text-center">
                  {healthError}
                </div>
              ) : !health ? (
                <div className="text-center text-slate-500 py-8 animate-pulse">[AWAITING SYSTEMS DIAGNOSTIC LINK...]</div>
              ) : (
                <div className="grid grid-cols-2 gap-3.5">
                  <div className="col-span-2 bg-black/40 border border-cyan-500/15 p-3 rounded flex justify-between items-center">
                    <div>
                      <span className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">Server Status</span>
                      <h4 className="text-sm text-green-400 font-bold uppercase mt-0.5">🟢 ACTIVE & LISTENING</h4>
                    </div>
                    <div className="text-right">
                      <span className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">Uptime</span>
                      <p className="text-sm font-bold text-cyan-400 mt-0.5">{Math.floor(health.uptime / 60)}m {health.uptime % 60}s</p>
                    </div>
                  </div>

                  <div className="bg-black/30 border border-cyan-500/10 p-3 rounded flex flex-col gap-1">
                    <span className="text-[9px] text-slate-500 uppercase font-bold">CPU Load</span>
                    <strong className="text-lg text-cyan-400 font-header">{health.cpuLoad}%</strong>
                  </div>

                  <div className="bg-black/30 border border-cyan-500/10 p-3 rounded flex flex-col gap-1">
                    <span className="text-[9px] text-slate-500 uppercase font-bold">Database Size</span>
                    <strong className="text-lg text-cyan-400 font-header">{health.dbSize}</strong>
                  </div>

                  <div className="bg-black/30 border border-cyan-500/10 p-3 rounded flex flex-col gap-1 col-span-2">
                    <span className="text-[9px] text-slate-500 uppercase font-bold">Memory Footprint</span>
                    <div className="grid grid-cols-3 gap-2 mt-1 text-[10px]">
                      <div>
                        <span className="text-slate-500 uppercase">Heap Used</span>
                        <p className="text-cyan-400 font-bold">{health.memoryUsage.heapUsed}</p>
                      </div>
                      <div>
                        <span className="text-slate-500 uppercase">Heap Total</span>
                        <p className="text-cyan-400 font-bold">{health.memoryUsage.heapTotal}</p>
                      </div>
                      <div>
                        <span className="text-slate-500 uppercase">RSS Size</span>
                        <p className="text-cyan-400 font-bold">{health.memoryUsage.rss}</p>
                      </div>
                    </div>
                  </div>

                  <div className="bg-black/30 border border-cyan-500/10 p-3 rounded flex flex-col gap-1">
                    <span className="text-[9px] text-slate-500 uppercase font-bold">Requests Processed</span>
                    <strong className="text-lg text-cyan-400 font-header">{health.requestsProcessed}</strong>
                  </div>

                  <div className="bg-black/30 border border-cyan-500/10 p-3 rounded flex flex-col gap-1">
                    <span className="text-[9px] text-slate-500 uppercase font-bold">MCP Servers Link</span>
                    <strong className="text-lg text-cyan-400 font-header">{health.mcpServersCount} ACTIVE</strong>
                  </div>

                  <div className="bg-black/30 border border-cyan-500/10 p-3 rounded flex flex-col gap-1 col-span-2">
                    <span className="text-[9px] text-slate-500 uppercase font-bold">AI Core Model</span>
                    <strong className="text-[10px] text-cyan-400 uppercase break-words mt-1">{health.activeAiBackend}</strong>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB 3: SYSTEM LOGS */}
          {activeTab === 'logs' && (
            <div className="flex flex-col gap-3 h-full font-mono text-xs">
              <div className="flex justify-between items-center gap-2">
                <select
                  value={logType}
                  onChange={(e) => setLogType(e.target.value)}
                  className="hud-select text-[10px] py-1 px-2 bg-slate-950/60 border border-cyan-500/20 text-cyan-400 font-mono"
                >
                  <option value="backend">Backend (Core Server)</option>
                  <option value="electron">Electron (Host App)</option>
                  <option value="whatsapp">WhatsApp (Uplink Service)</option>
                  <option value="mcp">MCP (Plugin Processes)</option>
                </select>
                <input
                  type="text"
                  placeholder="Filter logs..."
                  value={logSearch}
                  onChange={(e) => setLogSearch(e.target.value)}
                  className="hud-input text-[10px] p-1.5 h-7 flex-1 max-w-[170px] text-cyan-400"
                />
                <button 
                  onClick={handleCopyLogs}
                  className="hud-btn h-7 py-0 px-3 text-[10px] flex items-center gap-1 text-cyan-400 border border-cyan-500/20 bg-cyan-500/5"
                  title="Copy logs to clipboard"
                >
                  {copied ? <Check size={11} /> : <Copy size={11} />}
                  {copied ? 'COPIED' : 'COPY'}
                </button>
              </div>

              <pre className="flex-1 bg-black/50 border border-cyan-500/10 rounded p-2.5 max-h-[350px] overflow-y-auto text-[9px] text-cyan-300/80 leading-relaxed scrollbar-thin font-mono break-all whitespace-pre-wrap">
                {filteredLogs ? filteredLogs : `[System] No logs matching "${logSearch}" found.`}
              </pre>
            </div>
          )}

        </div>
      </section>
    </div>
  );
}
