import React, { useEffect, useState } from 'react';
import { CheckCircle2, Loader2 } from 'lucide-react';
import { apiRequest } from '../../services/api.ts';
import { AuthBackdropLayout } from './AuthBackdropLayout.tsx';
import type { AppRoute } from '../../types/index.ts';

export const ForgotPasswordPage: React.FC<{ onNavigate: (route: AppRoute) => void }> = ({ onNavigate }) => {
  const [step, setStep] = useState<'request' | 'reset' | 'done'>(() => new URLSearchParams(window.location.search).get('token') ? 'reset' : 'request');
  const [email, setEmail] = useState('');
  const [token, setToken] = useState(() => new URLSearchParams(window.location.search).get('token') || '');
  const [requestNotice, setRequestNotice] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (token && window.location.search.includes('token=')) {
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, [token]);

  const handleRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await apiRequest<{ message: string }>('/api/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ email: email.trim() }),
      });
      setRequestNotice(res.message);
      setStep('request');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed.');
    } finally {
      setLoading(false);
    }
  };

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await apiRequest('/api/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify({ token: token.trim(), newPassword }),
      });
      setStep('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reset password.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthBackdropLayout onNavigate={onNavigate} activeTab="recovery">
      <div>
        <h1 className="font-display text-2xl font-bold text-slate-900">Account Recovery</h1>
        <p className="text-sm text-slate-600 mt-1 mb-5">
          Request a secure password-reset link. Links expire after 30 minutes.
        </p>

        {error && (
          <div role="alert" className="mb-4 p-3 rounded-xl border border-red-200 bg-red-50 text-sm text-red-800">
            {error}
          </div>
        )}

        {step === 'request' && (
          <form onSubmit={handleRequest} className="space-y-4">
            {requestNotice && <div role="status" className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-900">{requestNotice}</div>}
            <div>
              <label htmlFor="fp-email" className="block text-sm font-medium text-slate-700 mb-1.5">
                Registered email address
              </label>
              <input
                id="fp-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Enter your email address"
                required
                className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg bg-white focus:border-[#065F46] focus:outline-none"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 px-4 text-sm font-semibold text-white bg-[#065F46] hover:bg-[#047857] rounded-lg flex items-center justify-center gap-2 cursor-pointer"
            >
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              <span>Send Reset Link</span>
            </button>
          </form>
        )}

        {step === 'reset' && (
          <form onSubmit={handleReset} className="space-y-4">
            <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-900">Enter the reset token from your SettleUp password-recovery email.</div>
            <div>
              <label htmlFor="fp-token" className="block text-sm font-medium text-slate-700 mb-1.5">
                Recovery Token
              </label>
              <input
                id="fp-token"
                type="text"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                required
                className="w-full px-3.5 py-2 text-xs font-mono-num border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label htmlFor="fp-newpass" className="block text-sm font-medium text-slate-700 mb-1.5">
                New Password
              </label>
              <input
                id="fp-newpass"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Create a new password"
                required
                className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 px-4 text-sm font-semibold text-white bg-[#065F46] hover:bg-[#047857] rounded-lg flex items-center justify-center gap-2 cursor-pointer"
            >
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              <span>Reset Password</span>
            </button>
          </form>
        )}

        {step === 'done' && (
          <div className="text-center space-y-4 py-4">
            <CheckCircle2 className="w-10 h-10 text-[#065F46] mx-auto" />
            <h2 className="font-display text-lg font-bold text-slate-900">Password Updated</h2>
            <p className="text-sm text-slate-600">
              Your password has been updated and older sessions have been signed out for security.
            </p>
            <button
              type="button"
              onClick={() => onNavigate('/login')}
              className="w-full py-2.5 px-4 text-sm font-semibold text-white bg-[#065F46] hover:bg-[#047857] rounded-lg cursor-pointer"
            >
              Continue to Sign In
            </button>
          </div>
        )}
      </div>
    </AuthBackdropLayout>
  );
};
