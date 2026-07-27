import { useState, useEffect } from 'react';
import { 
  BookOpen, Plus, Clock, CheckCircle2, AlertCircle, Loader2, 
  Trash2, Play, Sparkles, FileText, X, Copy, Download, RefreshCw, Check
} from 'lucide-react';
import { API_BASE, WS_BASE } from '../utils/apiConfig';
import { sounds } from '../utils/sounds';

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

export function AssignmentWidget() {
  const [assignments, setAssignments] = useState<AssignmentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedSolutionItem, setSelectedSolutionItem] = useState<AssignmentItem | null>(null);
  const [copied, setCopied] = useState(false);

  // New assignment form state
  const [newTitle, setNewTitle] = useState('');
  const [newSubject, setNewSubject] = useState('Mathematics');
  const [newDueDate, setNewDueDate] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newAutoDo, setNewAutoDo] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const fetchAssignments = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/assignments`);
      if (res.ok) {
        const data = await res.json();
        setAssignments(data.assignments || []);
      }
    } catch (err) {
      console.warn('Failed to fetch assignments:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAssignments();
    const interval = setInterval(fetchAssignments, 5000);

    // WebSocket listener for realtime updates
    const ws = new WebSocket(WS_BASE);
    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (
          data.event === 'assignment_created' ||
          data.event === 'assignment_updated' ||
          data.event === 'assignment_completed' ||
          data.event === 'assignment_failed' ||
          data.event === 'assignment_deleted'
        ) {
          fetchAssignments();
          if (data.event === 'assignment_completed') {
            sounds.playSuccess();
          } else if (data.event === 'assignment_failed') {
            sounds.playError();
          }
        }
      } catch (err) {}
    };

    return () => {
      clearInterval(interval);
      ws.close();
    };
  }, []);

  const handleCreateAssignment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) {
      sounds.playError();
      return;
    }
    setSubmitting(true);
    sounds.playPing();

    try {
      const res = await fetch(`${API_BASE}/api/assignments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: newTitle.trim(),
          subject: newSubject.trim() || 'General',
          description: newDescription.trim(),
          dueDate: newDueDate ? new Date(newDueDate).toISOString() : '',
          autoDo: newAutoDo
        })
      });

      if (res.ok) {
        sounds.playSuccess();
        setNewTitle('');
        setNewDescription('');
        setNewDueDate('');
        setShowAddModal(false);
        fetchAssignments();
      } else {
        sounds.playError();
      }
    } catch (err) {
      console.error(err);
      sounds.playError();
    } finally {
      setSubmitting(false);
    }
  };

  const handleSolveNow = async (id: number) => {
    sounds.playPing();
    // Optimistic status update
    setAssignments(prev => prev.map(a => a.id === id ? { ...a, status: 'in_progress' } : a));

    try {
      const res = await fetch(`${API_BASE}/api/assignments/${id}/do`, {
        method: 'POST'
      });
      if (res.ok) {
        sounds.playSuccess();
        fetchAssignments();
      } else {
        sounds.playError();
      }
    } catch (err) {
      console.error(err);
      sounds.playError();
    }
  };

  const handleDelete = async (id: number) => {
    if (!window.confirm('Are you sure you want to delete this assignment?')) return;
    sounds.playPing();
    try {
      const res = await fetch(`${API_BASE}/api/assignments/${id}`, {
        method: 'DELETE'
      });
      if (res.ok) {
        sounds.playSuccess();
        if (selectedSolutionItem?.id === id) {
          setSelectedSolutionItem(null);
        }
        fetchAssignments();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleToggleAutoDo = async (item: AssignmentItem) => {
    sounds.playPing();
    const updatedVal = item.auto_do === 1 ? 0 : 1;
    try {
      await fetch(`${API_BASE}/api/assignments/${item.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ auto_do: updatedVal })
      });
      fetchAssignments();
    } catch (err) {}
  };

  const handleCopySolution = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    sounds.playSuccess();
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownloadSolution = (item: AssignmentItem) => {
    const filename = `${item.title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_solution.md`;
    const content = `# Assignment: ${item.title}\nSubject: ${item.subject}\nDue Date: ${item.due_date || 'N/A'}\nCompleted by: JARVIS AI Assistant\n\n---\n\n## Instructions\n${item.description || 'N/A'}\n\n---\n\n## Solution Output\n\n${item.solution}`;
    
    const element = document.createElement('a');
    const file = new Blob([content], { type: 'text/markdown' });
    element.href = URL.createObjectURL(file);
    element.download = filename;
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
    sounds.playSuccess();
  };

  const getTimeRemainingText = (dueDateStr: string) => {
    if (!dueDateStr) return null;
    const due = new Date(dueDateStr);
    const now = new Date();
    const diffMs = due.getTime() - now.getTime();

    if (diffMs < 0) {
      const pastMins = Math.abs(Math.floor(diffMs / (1000 * 60)));
      if (pastMins < 60) return { text: `Overdue by ${pastMins}m`, overdue: true };
      const pastHours = Math.floor(pastMins / 60);
      if (pastHours < 24) return { text: `Overdue by ${pastHours}h`, overdue: true };
      const pastDays = Math.floor(pastHours / 24);
      return { text: `Overdue by ${pastDays}d`, overdue: true };
    }

    const mins = Math.floor(diffMs / (1000 * 60));
    if (mins < 60) return { text: `Due in ${mins}m`, overdue: false };
    const hours = Math.floor(mins / 60);
    if (hours < 24) return { text: `Due in ${hours}h`, overdue: false };
    const days = Math.floor(hours / 24);
    return { text: `Due in ${days}d`, overdue: false };
  };

  const pendingCount = assignments.filter(a => a.status === 'pending').length;
  const inProgressCount = assignments.filter(a => a.status === 'in_progress').length;
  const completedCount = assignments.filter(a => a.status === 'completed').length;

  return (
    <div className="hud-panel col-span-1 md:col-span-2 lg:col-span-3 flex flex-col gap-3 relative">
      <div className="hud-corner-tl"></div>
      <div className="hud-corner-tr"></div>
      <div className="hud-corner-bl"></div>

      {/* Header */}
      <div className="flex justify-between items-center border-b border-cyan-500/10 pb-2">
        <div className="flex items-center gap-2">
          <BookOpen className="w-4 h-4 text-cyan-400 animate-pulse" />
          <h3 className="text-sm tracking-wider uppercase font-header font-bold text-cyan-400 glow-text-cyan">
            Assignment Automation Engine
          </h3>
          <span className="text-[10px] bg-cyan-500/10 border border-cyan-500/30 text-cyan-300 font-mono px-2 py-0.5 rounded">
            JARVIS SOLVER ACTIVE
          </span>
        </div>

        <div className="flex items-center gap-3">
          {/* Quick Metrics */}
          <div className="hidden sm:flex items-center gap-2 text-[10px] font-mono">
            <span className="text-slate-400">PENDING: <strong className="text-amber-400">{pendingCount}</strong></span>
            <span className="text-slate-400 font-mono">|</span>
            <span className="text-slate-400">SOLVING: <strong className="text-cyan-400">{inProgressCount}</strong></span>
            <span className="text-slate-400 font-mono">|</span>
            <span className="text-slate-400">SOLVED: <strong className="text-green-400">{completedCount}</strong></span>
          </div>

          <button
            onClick={() => { sounds.playPing(); setShowAddModal(true); }}
            className="hud-btn py-1 px-3 text-[10px] flex items-center gap-1.5 bg-cyan-500/20 hover:bg-cyan-500/30 border-cyan-400 text-cyan-200"
          >
            <Plus className="w-3.5 h-3.5" />
            ADD ASSIGNMENT
          </button>
        </div>
      </div>

      {/* Main List Grid */}
      {loading ? (
        <div className="flex items-center justify-center py-8 gap-2 text-cyan-400 font-mono text-xs">
          <Loader2 className="w-4 h-4 animate-spin" />
          SYNCHRONIZING ASSIGNMENT MATRIX...
        </div>
      ) : assignments.length === 0 ? (
        <div className="py-8 text-center border border-dashed border-cyan-500/20 rounded bg-slate-950/20 flex flex-col items-center justify-center gap-2">
          <Sparkles className="w-6 h-6 text-cyan-400/40" />
          <p className="text-xs font-mono text-slate-400">No active assignments recorded.</p>
          <p className="text-[10px] text-cyan-400/60 font-mono">
            Add an assignment above or ask JARVIS naturally: <i>"JARVIS, add an assignment due Friday"</i>
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {assignments.map(item => {
            const timeInfo = getTimeRemainingText(item.due_date);
            return (
              <div 
                key={item.id}
                className={`hud-card p-3 flex flex-col justify-between border ${
                  item.status === 'completed' 
                    ? 'border-green-500/30 bg-green-950/10' 
                    : item.status === 'in_progress'
                    ? 'border-cyan-400/50 bg-cyan-950/20 shadow-[0_0_15px_rgba(0,240,255,0.15)]'
                    : timeInfo?.overdue 
                    ? 'border-red-500/40 bg-red-950/10'
                    : 'border-cyan-500/20 bg-slate-950/40'
                }`}
              >
                <div>
                  {/* Top Badges */}
                  <div className="flex justify-between items-start gap-2 mb-2">
                    <span className="text-[9px] font-mono font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-cyan-500/10 border border-cyan-500/20 text-cyan-300">
                      {item.subject || 'GENERAL'}
                    </span>

                    <div className="flex items-center gap-1.5">
                      {/* Auto-Do Indicator */}
                      <button
                        onClick={() => handleToggleAutoDo(item)}
                        title={item.auto_do === 1 ? "Auto-Solve Enabled: JARVIS will solve before due date" : "Auto-Solve Disabled"}
                        className={`text-[8px] font-mono px-1.5 py-0.5 rounded border transition-colors ${
                          item.auto_do === 1 
                            ? 'bg-purple-500/20 border-purple-400/50 text-purple-300' 
                            : 'bg-slate-800/40 border-slate-700 text-slate-500'
                        }`}
                      >
                        {item.auto_do === 1 ? '⚡ AUTO-SOLVE' : 'MANUAL'}
                      </button>

                      {/* Status Pill */}
                      {item.status === 'completed' && (
                        <span className="text-[9px] font-mono font-bold text-green-400 flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3" /> SOLVED
                        </span>
                      )}
                      {item.status === 'in_progress' && (
                        <span className="text-[9px] font-mono font-bold text-cyan-400 flex items-center gap-1 animate-pulse">
                          <Loader2 className="w-3 h-3 animate-spin" /> WORKING...
                        </span>
                      )}
                      {item.status === 'failed' && (
                        <span className="text-[9px] font-mono font-bold text-red-400 flex items-center gap-1">
                          <AlertCircle className="w-3 h-3" /> FAILED
                        </span>
                      )}
                      {item.status === 'pending' && (
                        <span className="text-[9px] font-mono text-amber-400 flex items-center gap-1">
                          <Clock className="w-3 h-3" /> PENDING
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Title */}
                  <h4 className="text-xs font-bold font-header text-slate-200 line-clamp-1 mb-1" title={item.title}>
                    {item.title}
                  </h4>

                  {/* Description preview */}
                  {item.description && (
                    <p className="text-[10px] text-slate-400 font-mono line-clamp-2 mb-2 bg-black/30 p-1.5 rounded border border-cyan-500/5">
                      {item.description}
                    </p>
                  )}

                  {/* Due Date Indicator */}
                  {item.due_date && (
                    <div className="flex items-center gap-1.5 text-[9px] font-mono mb-3">
                      <Clock className={`w-3 h-3 ${timeInfo?.overdue ? 'text-red-400' : 'text-cyan-400'}`} />
                      <span className={timeInfo?.overdue ? 'text-red-400 font-bold' : 'text-slate-300'}>
                        {new Date(item.due_date).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </span>
                      {timeInfo && (
                        <span className={`px-1 rounded ${timeInfo.overdue ? 'bg-red-500/20 text-red-300 font-bold' : 'bg-cyan-500/10 text-cyan-400'}`}>
                          ({timeInfo.text})
                        </span>
                      )}
                    </div>
                  )}
                </div>

                {/* Card Actions */}
                <div className="flex items-center justify-between border-t border-cyan-500/10 pt-2 mt-1">
                  <button
                    onClick={() => handleDelete(item.id)}
                    className="text-slate-500 hover:text-red-400 p-1 transition-colors"
                    title="Delete Assignment"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>

                  <div className="flex items-center gap-1.5">
                    {item.status === 'completed' && item.solution ? (
                      <button
                        onClick={() => { sounds.playPing(); setSelectedSolutionItem(item); }}
                        className="hud-btn py-1 px-2.5 text-[9px] flex items-center gap-1 bg-green-500/20 hover:bg-green-500/30 border-green-400 text-green-300"
                      >
                        <FileText className="w-3 h-3" />
                        VIEW SOLUTION
                      </button>
                    ) : (
                      <button
                        disabled={item.status === 'in_progress'}
                        onClick={() => handleSolveNow(item.id)}
                        className={`hud-btn py-1 px-2.5 text-[9px] flex items-center gap-1 ${
                          item.status === 'in_progress' 
                            ? 'opacity-50 cursor-not-allowed bg-cyan-500/10 text-cyan-400 border-cyan-500/20' 
                            : 'bg-cyan-500/20 hover:bg-cyan-500/40 border-cyan-400 text-cyan-200'
                        }`}
                      >
                        {item.status === 'in_progress' ? (
                          <>
                            <Loader2 className="w-3 h-3 animate-spin" />
                            SOLVING...
                          </>
                        ) : (
                          <>
                            <Play className="w-3 h-3 fill-current text-cyan-300" />
                            DO ON BEHALF OF ME
                          </>
                        )}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* --- ADD ASSIGNMENT MODAL --- */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="hud-panel max-w-lg w-full p-5 flex flex-col gap-4 border border-cyan-500/40 bg-slate-950/90 shadow-[0_0_30px_rgba(0,240,255,0.2)]">
            <div className="flex justify-between items-center border-b border-cyan-500/20 pb-2">
              <h3 className="text-sm font-header font-bold text-cyan-400 uppercase tracking-wider flex items-center gap-2 glow-text-cyan">
                <Plus className="w-4 h-4" /> Add New Assignment
              </h3>
              <button 
                onClick={() => setShowAddModal(false)}
                className="text-slate-400 hover:text-cyan-400 p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateAssignment} className="flex flex-col gap-3">
              <div>
                <label className="text-[10px] font-mono text-cyan-400 uppercase block mb-1">
                  Assignment Title / Name *
                </label>
                <input 
                  type="text"
                  required
                  placeholder="e.g. Calculus Chapter 4 Exercises"
                  value={newTitle}
                  onChange={e => setNewTitle(e.target.value)}
                  className="hud-input text-xs w-full p-2"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-mono text-cyan-400 uppercase block mb-1">
                    Subject / Course
                  </label>
                  <input 
                    type="text"
                    placeholder="e.g. Mathematics"
                    value={newSubject}
                    onChange={e => setNewSubject(e.target.value)}
                    className="hud-input text-xs w-full p-2"
                  />
                </div>

                <div>
                  <label className="text-[10px] font-mono text-cyan-400 uppercase block mb-1">
                    Due Date & Time
                  </label>
                  <input 
                    type="datetime-local"
                    value={newDueDate}
                    onChange={e => setNewDueDate(e.target.value)}
                    className="hud-input text-xs w-full p-2 font-mono text-cyan-300"
                  />
                </div>
              </div>

              <div>
                <label className="text-[10px] font-mono text-cyan-400 uppercase block mb-1">
                  Questions, Instructions & Requirements
                </label>
                <textarea 
                  rows={4}
                  placeholder="Enter assignment questions, topic instructions, guidelines, or specific questions for JARVIS to answer..."
                  value={newDescription}
                  onChange={e => setNewDescription(e.target.value)}
                  className="hud-input text-xs w-full p-2 font-mono"
                />
              </div>

              <div className="flex items-center gap-2 border border-cyan-500/15 p-2 rounded bg-slate-900/40">
                <input 
                  type="checkbox"
                  id="autoDoCheck"
                  checked={newAutoDo}
                  onChange={e => setNewAutoDo(e.target.checked)}
                  className="accent-cyan-500 w-4 h-4"
                />
                <label htmlFor="autoDoCheck" className="text-xs font-mono text-slate-300 cursor-pointer">
                  <strong>Enable Auto-Solve on my behalf</strong> (JARVIS will automatically solve before due date)
                </label>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-cyan-500/10">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="hud-btn py-1.5 px-4 text-xs bg-slate-800 hover:bg-slate-700 text-slate-300"
                >
                  CANCEL
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="hud-btn py-1.5 px-5 text-xs bg-cyan-500/20 hover:bg-cyan-500/40 border-cyan-400 text-cyan-200 flex items-center gap-1.5"
                >
                  {submitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                  CREATE ASSIGNMENT
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* --- VIEW SOLUTION MODAL --- */}
      {selectedSolutionItem && (
        <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-4">
          <div className="hud-panel max-w-3xl w-full p-5 flex flex-col gap-4 border border-green-500/40 bg-slate-950/95 shadow-[0_0_40px_rgba(0,255,150,0.15)] max-h-[85vh]">
            {/* Modal Header */}
            <div className="flex justify-between items-start border-b border-cyan-500/20 pb-3">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[9px] font-mono uppercase px-2 py-0.5 rounded bg-green-500/20 border border-green-400 text-green-300">
                    {selectedSolutionItem.subject}
                  </span>
                  <span className="text-[10px] font-mono text-slate-400">
                    Completed on: {selectedSolutionItem.completed_at ? new Date(selectedSolutionItem.completed_at).toLocaleString() : 'Recently'}
                  </span>
                </div>
                <h3 className="text-base font-bold font-header text-slate-100">
                  {selectedSolutionItem.title}
                </h3>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleCopySolution(selectedSolutionItem.solution)}
                  className="hud-btn py-1 px-3 text-[10px] flex items-center gap-1 bg-cyan-500/10 hover:bg-cyan-500/20 border-cyan-400 text-cyan-300"
                >
                  {copied ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
                  {copied ? 'COPIED!' : 'COPY'}
                </button>
                <button
                  onClick={() => handleDownloadSolution(selectedSolutionItem)}
                  className="hud-btn py-1 px-3 text-[10px] flex items-center gap-1 bg-purple-500/10 hover:bg-purple-500/20 border-purple-400 text-purple-300"
                >
                  <Download className="w-3 h-3" />
                  EXPORT .MD
                </button>
                <button 
                  onClick={() => setSelectedSolutionItem(null)}
                  className="text-slate-400 hover:text-cyan-400 p-1 ml-2"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Solution Content */}
            <div className="flex-1 overflow-y-auto pr-2 text-xs font-mono text-slate-200 bg-black/60 p-4 rounded border border-cyan-500/15 leading-relaxed whitespace-pre-wrap">
              {selectedSolutionItem.solution || 'No solution content available.'}
            </div>

            {/* Modal Footer */}
            <div className="flex justify-between items-center border-t border-cyan-500/10 pt-2">
              <button
                onClick={() => {
                  const id = selectedSolutionItem.id;
                  setSelectedSolutionItem(null);
                  handleSolveNow(id);
                }}
                className="hud-btn py-1 px-3 text-[10px] flex items-center gap-1 bg-amber-500/10 hover:bg-amber-500/20 border-amber-400 text-amber-300"
              >
                <RefreshCw className="w-3 h-3" />
                RE-SOLVE ON MY BEHALF
              </button>

              <button
                onClick={() => setSelectedSolutionItem(null)}
                className="hud-btn py-1 px-4 text-xs bg-slate-800 text-slate-300"
              >
                CLOSE
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
