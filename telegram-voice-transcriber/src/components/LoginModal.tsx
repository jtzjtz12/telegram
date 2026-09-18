import { useState } from 'react';
import { Lock, ShieldAlert, CheckCircle2, ArrowRight } from 'lucide-react';

interface LoginModalProps {
  onLoginSuccess: (token: string) => void;
}

export function LoginModal({ onLoginSuccess }: LoginModalProps) {
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        localStorage.setItem('admin_token', data.token);
        onLoginSuccess(data.token);
      } else {
        setError(data.error || 'Invalid credentials. Please check ADMIN_USERNAME and ADMIN_PASSWORD.');
      }
    } catch (err) {
      setError('Network error contacting backend. Make sure the server is running.');
    } finally {
      setLoading(false);
    }
  };

  const handleDevBypass = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'admin', password: '' }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        localStorage.setItem('admin_token', data.token);
        onLoginSuccess(data.token);
      } else {
        setError(data.error || 'Password required. Enter the password configured in .env');
      }
    } catch {
      setError('Connection failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div id="login-modal-overlay" className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
      <div id="login-modal-card" className="w-full max-w-md bg-white rounded-xl border border-slate-200 shadow-2xl overflow-hidden">
        <div className="p-6 bg-slate-900 text-white">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-indigo-500/20 border border-indigo-400/30 flex items-center justify-center text-indigo-400">
              <Lock className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-semibold tracking-tight">Admin Authorization</h2>
              <p className="text-xs text-slate-400">Telegram Voice Transcriber Control Panel</p>
            </div>
          </div>
        </div>

        <div className="p-6">
          {error && (
            <div id="login-error-alert" className="mb-5 p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-start gap-2">
              <ShieldAlert className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600 mb-1.5">
                Username
              </label>
              <input
                id="admin-username-input"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                className="w-full px-3.5 py-2 text-sm bg-slate-50 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-colors"
                placeholder="admin"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600 mb-1.5">
                Password
              </label>
              <input
                id="admin-password-input"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3.5 py-2 text-sm bg-slate-50 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-colors"
                placeholder="ADMIN_PASSWORD from .env"
              />
              <p className="text-[11px] text-slate-500 mt-1">
                Protected via <code className="bg-slate-100 px-1 py-0.5 rounded text-slate-700">ADMIN_USERNAME</code> and <code className="bg-slate-100 px-1 py-0.5 rounded text-slate-700">ADMIN_PASSWORD</code> in <code className="bg-slate-100 px-1 py-0.5 rounded text-slate-700">.env</code>
              </p>
            </div>

            <button
              id="admin-login-submit-button"
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg transition shadow-sm disabled:opacity-50 cursor-pointer"
            >
              {loading ? 'Authenticating...' : 'Sign In to Dashboard'}
              <ArrowRight className="w-4 h-4" />
            </button>
          </form>

          <div className="mt-6 pt-5 border-t border-slate-100 text-center">
            <button
              type="button"
              id="admin-quick-connect-button"
              onClick={handleDevBypass}
              className="text-xs text-slate-600 hover:text-indigo-600 font-medium transition cursor-pointer"
            >
              Default/Development Access Check →
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
