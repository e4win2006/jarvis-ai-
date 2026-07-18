import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { LogIn, ShieldCheck, UserPlus, Shield } from 'lucide-react';
import { createOwner, hasOwner, requestAccess, signIn, type JarvisSession } from '../utils/auth';
import { IS_GITHUB_PAGES_WITHOUT_API } from '../utils/apiConfig';
import { sounds } from '../utils/sounds';

interface SignInPageProps {
  onSignedIn: (session: JarvisSession) => void;
}

export function SignInPage({ onSignedIn }: SignInPageProps) {
  const [ownerExists, setOwnerExists] = useState<boolean | null>(null);
  const [mode, setMode] = useState<'signin' | 'request' | 'owner' | 'chooser'>('signin');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [isBusy, setIsBusy] = useState(false);

  useEffect(() => {
    hasOwner().then(exists => {
      setOwnerExists(exists);
      if (!exists) {
        if (IS_GITHUB_PAGES_WITHOUT_API) {
          setMode('chooser');
        } else {
          setMode('owner');
        }
        setUsername('');
        setDisplayName('');
      } else {
        setMode('signin');
      }
    });
  }, []);

  if (ownerExists === null) {
    return (
      <div className="auth-shell">
        <div className="auth-panel" style={{ alignItems: 'center', justifyContent: 'center', minHeight: 200 }}>
          <p className="auth-copy font-mono animate-pulse">[LOADING AUTHENTICATION MODULE...]</p>
        </div>
      </div>
    );
  }

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setMessage('');
    setIsBusy(true);

    try {
      if (mode === 'owner') {
        const session = await createOwner(username, displayName, password);
        onSignedIn(session);
      } else if (mode === 'request') {
        await requestAccess(username, displayName, password);
        setMessage('Access request saved. The owner must approve it from the admin dashboard.');
        setMode('signin');
      } else {
        const session = await signIn(username, password);
        onSignedIn(session);
      }
    } catch (error: any) {
      setMessage(error.message || 'Authentication failed.');
    } finally {
      setIsBusy(false);
    }
  };

  if (mode === 'chooser') {
    return (
      <div className="auth-shell">
        <div className="auth-panel" style={{ gap: '16px', padding: '32px', textAlign: 'center' }}>
          <div className="flex justify-center mb-1">
            <div className="auth-mark mx-auto">
              <Shield size={24} className="text-cyan-400" />
            </div>
          </div>
          <h1 className="font-bold font-header uppercase tracking-wider text-cyan-400 text-lg">Select Connection</h1>
          <p className="auth-copy text-xs leading-relaxed text-slate-400">
            Establish link parameter to the central server, or launch a standalone sandbox local demo.
          </p>

          <div className="flex flex-col gap-3.5 mt-2">
            <button
              type="button"
              className="auth-submit w-full py-2 flex items-center justify-center gap-1.5"
              style={{ backgroundColor: '#00f0ff', color: '#000', fontWeight: 'bold' }}
              onClick={() => {
                const url = prompt('Enter your JARVIS Core Server public URL (e.g., https://your-subdomain.loca.lt):');
                if (url) {
                  const cleanUrl = url.trim().replace(/\/+$/, '');
                  localStorage.setItem('jarvis_api_base', cleanUrl);
                  localStorage.removeItem('jarvis_session');
                  window.location.reload();
                }
              }}
            >
              Connect to Edwin's Server
            </button>

            <button
              type="button"
              className="w-full py-2 text-[10px] tracking-wider font-mono border border-cyan-500/20 text-cyan-400 hover:bg-cyan-500/5 uppercase font-bold rounded transition-all"
              style={{ background: 'rgba(0,240,255,0.03)', cursor: 'pointer' }}
              onClick={() => {
                sounds.playPing();
                setMode('owner');
                setMessage('Create your owner account first. Only this account can approve users.');
              }}
            >
              Local Sandbox Demo
            </button>
          </div>
        </div>
      </div>
    );
  }

  const title = mode === 'owner' ? 'Owner Setup' : mode === 'request' ? 'Request Access' : 'Secure Sign In';

  return (
    <div className="auth-shell">
      <form className="auth-panel" onSubmit={handleSubmit}>
        <div className="auth-mark">
          <ShieldCheck size={28} />
        </div>
        <h1>{title}</h1>
        <p className="auth-copy">
          {mode === 'signin'
            ? 'Authorized users only. JARVIS remains locked until a permitted account signs in.'
            : mode === 'request'
              ? 'Create a user request for the owner to approve.'
              : 'Set up the primary system owner account. Keep this password private.'}
        </p>

        <label className="auth-label" htmlFor="username">Username</label>
        <input
          id="username"
          className="auth-input"
          value={username}
          onChange={event => setUsername(event.target.value)}
          autoComplete="username"
          placeholder={mode === 'owner' ? "Choose username (e.g. admin)" : "Enter username"}
          required
        />

        {(mode === 'request' || mode === 'owner') && (
          <>
            <label className="auth-label" htmlFor="display-name">Display Name</label>
            <input
              id="display-name"
              className="auth-input"
              value={displayName}
              onChange={event => setDisplayName(event.target.value)}
              autoComplete="name"
              placeholder={mode === 'owner' ? "Your Name (e.g. John Doe)" : "Your Name"}
              required
            />
          </>
        )}

        <label className="auth-label" htmlFor="password">Password</label>
        <input
          id="password"
          className="auth-input"
          type="password"
          value={password}
          onChange={event => setPassword(event.target.value)}
          autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
          minLength={6}
          required
        />

        {message && <p className="auth-message">{message}</p>}

        <button className="auth-submit" type="submit" disabled={isBusy}>
          {mode === 'request' ? <UserPlus size={16} /> : <LogIn size={16} />}
          {isBusy ? 'Working...' : mode === 'request' ? 'Submit Request' : mode === 'owner' ? 'Create Owner' : 'Sign In'}
        </button>

        {ownerExists && (
          <button
            className="auth-link"
            type="button"
            onClick={() => {
              setMessage('');
              setMode(mode === 'request' ? 'signin' : 'request');
            }}
          >
            {mode === 'request' ? 'Return to sign in' : 'Request a user account'}
          </button>
        )}

        <div className="border-t border-cyan-500/10 mt-5 pt-4 text-center font-mono text-[10px]">
          {localStorage.getItem('jarvis_api_base') ? (
            <div className="flex flex-col gap-2">
              <span className="text-green-400/80 uppercase">Linked to server:</span>
              <span className="text-slate-400 break-all">{localStorage.getItem('jarvis_api_base')}</span>
              <button
                type="button"
                style={{ color: '#ff0055', background: 'none', border: 'none', cursor: 'pointer', textTransform: 'uppercase', fontSize: '9px', marginTop: '4px' }}
                className="hover:underline"
                onClick={() => {
                  localStorage.removeItem('jarvis_api_base');
                  localStorage.removeItem('jarvis_session');
                  window.location.reload();
                }}
              >
                Disconnect Server (Sandbox Mode)
              </button>
            </div>
          ) : (
            <div>
              <button
                type="button"
                style={{ color: '#00f0ff', background: 'none', border: 'none', cursor: 'pointer', textTransform: 'uppercase', textShadow: '0 0 6px rgba(0, 240, 255, 0.4)' }}
                className="hover:underline font-bold"
                onClick={() => {
                  const url = prompt('Enter your JARVIS Core Server public URL (e.g., https://your-subdomain.loca.lt):');
                  if (url) {
                    const cleanUrl = url.trim().replace(/\/+$/, '');
                    localStorage.setItem('jarvis_api_base', cleanUrl);
                    localStorage.removeItem('jarvis_session');
                    window.location.reload();
                  }
                }}
              >
                Link Core Server DB
              </button>
            </div>
          )}
        </div>
      </form>
    </div>
  );
}
