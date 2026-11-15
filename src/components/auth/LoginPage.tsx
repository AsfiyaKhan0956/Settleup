import React, { useState } from 'react';
import { Eye, EyeOff, KeyRound, Loader2, Sparkles } from 'lucide-react';
import { apiRequest } from '../../services/api.ts';
import { AuthBackdropLayout } from './AuthBackdropLayout.tsx';
import type { AppRoute, AuthUser } from '../../types/index.ts';

interface LoginPageProps {
  onNavigate: (route: AppRoute) => void;
  onSuccess: (user: AuthUser, sessionToken?: string, rememberMe?: boolean) => void;
  onDemoLogin: () => Promise<void>;
}

export const LoginPage: React.FC<LoginPageProps> = ({ onNavigate, onSuccess, onDemoLogin }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [loading, setLoading] = useState(false);
  const [demoLoading, setDemoLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!email.trim() || !password) {
      setError('Please enter both your email address and password.');
      return;
    }

    setLoading(true);
    try {
      const res = await apiRequest<{ user: AuthUser; sessionToken?: string }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: email.trim(), password, rememberMe }),
      });
      onSuccess(res.user, res.sessionToken, rememberMe);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to sign in. Please check your credentials.');
    } finally {
      setLoading(false);
    }
  };

  const handleDemo = async () => {
    setError('');
    setDemoLoading(true);
    try {
      await onDemoLogin();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to open demo workspace.');
    } finally {
      setDemoLoading(false);
    }
  };

  const fillDemoCredentials = () => {
    setEmail('aarav@settleup.app');
    setPassword('Demo@1234');
    setError('');
  };

  return (
    <AuthBackdropLayout onNavigate={onNavigate} activeTab="login">
      <div>
        <h1 className="font-display text-2xl font-bold text-slate-900">Welcome back</h1>
        <p className="text-sm text-slate-600 mt-1">
          Sign in to manage group expenses, itemised bills, and UPI settlements.
        </p>

        {/* Prominent 1-Click Demo Banner */}
        <div className="mt-5 p-3.5 rounded-xl bg-gradient-to-r from-emerald-50 via-teal-50/70 to-amber-50/60 border border-emerald-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <p className="text-xs font-bold text-[#065F46]">Want to explore right away?</p>
            <p className="text-xs text-slate-600 mt-0.5">
              Demo account: <code className="font-mono-num text-slate-800">aarav@settleup.app</code> /{' '}
              <code className="font-mono-num text-slate-800">Demo@1234</code>
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={fillDemoCredentials}
              className="px-2.5 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:border-slate-400 rounded-lg transition-colors cursor-pointer inline-flex items-center gap-1"
            >
              <KeyRound className="w-3 h-3" />
              <span>Fill</span>
            </button>
            <button
              type="button"
              onClick={handleDemo}
              disabled={demoLoading}
              className="px-3 py-1.5 text-xs font-semibold text-white bg-[#065F46] hover:bg-[#047857] rounded-lg transition-colors cursor-pointer inline-flex items-center gap-1.5 disabled:opacity-60"
            >
              {demoLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
              <span>{demoLoading ? 'Opening...' : '1-Click Demo'}</span>
            </button>
          </div>
        </div>

        {error && (
          <div role="alert" className="mt-4 p-3.5 rounded-xl border border-red-200 bg-red-50 text-sm text-red-800">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          <div>
            <label htmlFor="login-email" className="block text-sm font-medium text-slate-700 mb-1.5">
              Email address
            </label>
            <input
              id="login-email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg bg-white focus:border-[#065F46] focus:ring-2 focus:ring-emerald-500/15 focus:outline-none transition-all"
              required
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label htmlFor="login-password" className="block text-sm font-medium text-slate-700">
                Password
              </label>
              <button
                type="button"
                onClick={() => onNavigate('/forgot-password')}
                className="text-xs font-semibold text-[#065F46] hover:underline cursor-pointer"
              >
                Forgot password?
              </button>
            </div>
            <div className="relative">
              <input
                id="login-password"
                type={showPass ? 'text' : 'password'}
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter your password"
                className="w-full px-3.5 py-2.5 pr-10 text-sm border border-slate-300 rounded-lg bg-white focus:border-[#065F46] focus:ring-2 focus:ring-emerald-500/15 focus:outline-none transition-all"
                required
              />
              <button
                type="button"
                onClick={() => setShowPass(!showPass)}
                aria-label={showPass ? 'Hide password' : 'Show password'}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
            <input
              type="checkbox"
              checked={rememberMe}
              onChange={(e) => setRememberMe(e.target.checked)}
              className="rounded border-slate-300 text-[#065F46] focus:ring-[#065F46]"
            />
            <span>Keep me signed in for 30 days</span>
          </label>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 px-4 text-sm font-semibold text-white bg-[#065F46] hover:bg-[#047857] rounded-lg transition-all shadow-sm flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60"
          >
            {loading && <Loader2 className="w-4 h-4 animate-spin" />}
            <span>{loading ? 'Signing in...' : 'Sign In'}</span>
          </button>
        </form>

        <p className="mt-5 text-center text-sm text-slate-600">
          Don&apos;t have an account yet?{' '}
          <button
            type="button"
            onClick={() => onNavigate('/register')}
            className="font-semibold text-[#065F46] hover:underline cursor-pointer"
          >
            Create a free account
          </button>
        </p>
      </div>
    </AuthBackdropLayout>
  );
};
