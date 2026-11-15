import React, { useMemo, useState } from 'react';
import { Check, Eye, EyeOff, Loader2, Sparkles, Upload } from 'lucide-react';
import { UserAvatar } from '../common/BrandMark.tsx';
import { apiRequest } from '../../services/api.ts';
import { evaluatePasswordStrength } from '../../utils/currency.ts';
import { AuthBackdropLayout } from './AuthBackdropLayout.tsx';
import type { AppRoute, AuthUser } from '../../types/index.ts';

interface RegisterPageProps {
  onNavigate: (route: AppRoute) => void;
  onSuccess: (user: AuthUser, sessionToken?: string, rememberMe?: boolean) => void;
  onDemoLogin: () => Promise<void>;
}

export const RegisterPage: React.FC<RegisterPageProps> = ({ onNavigate, onSuccess, onDemoLogin }) => {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [upiId, setUpiId] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [acceptedTerms, setAcceptedTerms] = useState(true);
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const [demoLoading, setDemoLoading] = useState(false);
  const [error, setError] = useState('');

  const strength = useMemo(() => evaluatePasswordStrength(password), [password]);
  const passwordsMatch = confirmPassword.length > 0 && password === confirmPassword;

  const handleAvatarUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('Please select a valid PNG, JPG, or WebP image.');
      return;
    }
    if (file.size > 900_000) {
      setError('Profile picture must be under 900 KB.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setAvatarUrl(reader.result);
        setError('');
      }
    };
    reader.readAsDataURL(file);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (fullName.trim().length < 2) {
      setError('Please enter your full name (at least 2 characters).');
      return;
    }
    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError('Please enter a valid email address.');
      return;
    }
    if (!strength.checks.length || !strength.checks.upper || !strength.checks.lower || !strength.checks.number) {
      setError('Password must have 8+ characters, 1 uppercase letter, 1 lowercase letter, and 1 number.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Password and Confirm Password do not match.');
      return;
    }
    if (!acceptedTerms) {
      setError('Please accept the Terms & Conditions and Privacy Policy to continue.');
      return;
    }

    setLoading(true);
    try {
      const res = await apiRequest<{ user: AuthUser; sessionToken?: string }>('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({
          fullName: fullName.trim(),
          email: email.trim(),
          upiId: upiId.trim() || undefined,
          password,
          avatarUrl,
        }),
      });
      onSuccess(res.user, res.sessionToken, true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed. Please check your details.');
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
      setError(err instanceof Error ? err.message : 'Unable to open live demo workspace.');
    } finally {
      setDemoLoading(false);
    }
  };

  return (
    <AuthBackdropLayout onNavigate={onNavigate} activeTab="register">
      <div>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h1 className="font-display text-2xl font-bold text-slate-900">Create your account</h1>
            <p className="text-sm text-slate-600 mt-0.5">
              Get started in seconds with a clean personal workspace.
            </p>
          </div>
          <button
            type="button"
            onClick={handleDemo}
            disabled={demoLoading}
            className="px-3 py-2 text-xs font-semibold text-[#065F46] bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-lg transition-colors inline-flex items-center gap-1.5 shrink-0 cursor-pointer disabled:opacity-60"
          >
            {demoLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
            <span>{demoLoading ? 'Opening...' : 'Try Demo First'}</span>
          </button>
        </div>

        {error && (
          <div role="alert" className="mt-4 p-3.5 rounded-xl border border-red-200 bg-red-50 text-sm text-red-800">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          {/* Profile Picture Upload */}
          <div className="flex items-center gap-4 pb-1">
            <UserAvatar name={fullName || 'New User'} avatarUrl={avatarUrl} size="lg" />
            <div>
              <label className="inline-flex items-center gap-2 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer transition-colors">
                <Upload className="w-3.5 h-3.5" />
                <span>Upload Photo (Optional)</span>
                <input type="file" accept="image/*" onChange={handleAvatarUpload} className="sr-only" />
              </label>
              <p className="text-xs text-slate-500 mt-1">PNG or JPG up to 900 KB</p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="reg-name" className="block text-sm font-medium text-slate-700 mb-1.5">
                Full name
              </label>
              <input
                id="reg-name"
                type="text"
                autoComplete="name"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Asfiya Khan"
                className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg bg-white focus:border-[#065F46] focus:ring-2 focus:ring-emerald-500/15 focus:outline-none transition-all"
                required
              />
            </div>

            <div>
              <label htmlFor="reg-upi" className="block text-sm font-medium text-slate-700 mb-1.5">
                UPI ID <span className="text-slate-400 font-normal">(Optional)</span>
              </label>
              <input
                id="reg-upi"
                type="text"
                value={upiId}
                onChange={(e) => setUpiId(e.target.value)}
                placeholder="name@okhdfcbank"
                className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg bg-white focus:border-[#065F46] focus:ring-2 focus:ring-emerald-500/15 focus:outline-none transition-all"
              />
            </div>
          </div>

          <div>
            <label htmlFor="reg-email" className="block text-sm font-medium text-slate-700 mb-1.5">
              Email address
            </label>
            <input
              id="reg-email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@college.edu"
              className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg bg-white focus:border-[#065F46] focus:ring-2 focus:ring-emerald-500/15 focus:outline-none transition-all"
              required
            />
          </div>

          <div>
            <label htmlFor="reg-password" className="block text-sm font-medium text-slate-700 mb-1.5">
              Password
            </label>
            <div className="relative">
              <input
                id="reg-password"
                type={showPass ? 'text' : 'password'}
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="e.g. Campus@2026"
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

            {/* Always-visible clear password requirements */}
            <div className="mt-2.5 space-y-2">
              {password.length > 0 && (
                <>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-500">Password strength</span>
                    <span className="font-semibold text-slate-800">{strength.label}</span>
                  </div>
                  <div className="grid grid-cols-5 gap-1">
                    {[1, 2, 3, 4, 5].map((bar) => (
                      <div
                        key={bar}
                        className={`h-1.5 rounded-full transition-colors ${
                          strength.score >= bar
                            ? strength.score <= 2
                              ? 'bg-red-500'
                              : strength.score === 3
                              ? 'bg-amber-500'
                              : 'bg-[#065F46]'
                            : 'bg-slate-200'
                        }`}
                      />
                    ))}
                  </div>
                </>
              )}
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                <span className={strength.checks.length ? 'text-[#065F46] font-semibold' : ''}>
                  <Check className="w-3 h-3 inline mr-0.5" />8+ chars
                </span>
                <span className={strength.checks.upper ? 'text-[#065F46] font-semibold' : ''}>
                  <Check className="w-3 h-3 inline mr-0.5" />1 uppercase
                </span>
                <span className={strength.checks.lower ? 'text-[#065F46] font-semibold' : ''}>
                  <Check className="w-3 h-3 inline mr-0.5" />1 lowercase
                </span>
                <span className={strength.checks.number ? 'text-[#065F46] font-semibold' : ''}>
                  <Check className="w-3 h-3 inline mr-0.5" />1 number
                </span>
              </div>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label htmlFor="reg-confirm" className="block text-sm font-medium text-slate-700">
                Confirm password
              </label>
              {confirmPassword.length > 0 && (
                <span className={`text-xs font-semibold ${passwordsMatch ? 'text-[#065F46]' : 'text-red-600'}`}>
                  {passwordsMatch ? 'Passwords match' : 'Passwords do not match'}
                </span>
              )}
            </div>
            <input
              id="reg-confirm"
              type={showPass ? 'text' : 'password'}
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Re-enter your password"
              className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg bg-white focus:border-[#065F46] focus:ring-2 focus:ring-emerald-500/15 focus:outline-none transition-all"
              required
            />
          </div>

          <label className="flex items-start gap-2.5 text-sm text-slate-600 cursor-pointer pt-1">
            <input
              type="checkbox"
              checked={acceptedTerms}
              onChange={(e) => setAcceptedTerms(e.target.checked)}
              className="mt-0.5 rounded border-slate-300 text-[#065F46] focus:ring-[#065F46]"
            />
            <span>
              I accept the{' '}
              <button
                type="button"
                onClick={() => onNavigate('/terms')}
                className="text-[#065F46] font-medium hover:underline cursor-pointer"
              >
                Terms &amp; Conditions
              </button>{' '}
              and{' '}
              <button
                type="button"
                onClick={() => onNavigate('/privacy')}
                className="text-[#065F46] font-medium hover:underline cursor-pointer"
              >
                Privacy Policy
              </button>
              .
            </span>
          </label>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 px-4 text-sm font-semibold text-white bg-[#065F46] hover:bg-[#047857] rounded-lg transition-all shadow-sm flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60"
          >
            {loading && <Loader2 className="w-4 h-4 animate-spin" />}
            <span>{loading ? 'Creating account...' : 'Create Account'}</span>
          </button>
        </form>

        <p className="mt-5 text-center text-sm text-slate-600">
          Already have an account?{' '}
          <button
            type="button"
            onClick={() => onNavigate('/login')}
            className="font-semibold text-[#065F46] hover:underline cursor-pointer"
          >
            Sign in
          </button>
        </p>
      </div>
    </AuthBackdropLayout>
  );
};
