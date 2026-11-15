import React from 'react';
import { ArrowLeft, CheckCircle2, QrCode, Scale, Sparkles } from 'lucide-react';
import { motion } from 'motion/react';
import { BrandMark } from '../common/BrandMark.tsx';
import type { AppRoute } from '../../types/index.ts';

interface AuthBackdropLayoutProps {
  onNavigate: (route: AppRoute) => void;
  activeTab?: 'login' | 'register' | 'recovery';
  children: React.ReactNode;
}

export const AuthBackdropLayout: React.FC<AuthBackdropLayoutProps> = ({
  onNavigate,
  activeTab,
  children,
}) => {
  return (
    <div className="min-h-screen relative overflow-hidden bg-[#F4F7FA] text-[#0F172A] flex flex-col justify-center py-10 px-4 sm:px-6 lg:px-10">
      {/* Layered Architectural Fintech Backdrop */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden" aria-hidden="true">
        <div className="absolute -top-36 -left-24 w-[34rem] h-[34rem] rounded-full bg-emerald-400/15 blur-3xl" />
        <div className="absolute top-1/3 -right-28 w-[32rem] h-[32rem] rounded-full bg-teal-400/15 blur-3xl" />
        <div className="absolute -bottom-32 left-1/3 w-[28rem] h-[28rem] rounded-full bg-amber-300/15 blur-3xl" />
        <div
          className="absolute inset-0 opacity-[0.35]"
          style={{
            backgroundImage:
              'linear-gradient(to right, rgba(148,163,184,0.18) 1px, transparent 1px), linear-gradient(to bottom, rgba(148,163,184,0.18) 1px, transparent 1px)',
            backgroundSize: '44px 44px',
          }}
        />
      </div>

      <div className="relative z-10 max-w-5xl w-full mx-auto">
        <div className="mb-6 flex items-center justify-between">
          <button
            type="button"
            onClick={() => onNavigate('/')}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg bg-white/90 border border-slate-200 text-sm font-medium text-slate-700 hover:text-slate-900 hover:border-slate-300 shadow-xs transition-all cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Back to SettleUp</span>
          </button>

          <button
            type="button"
            onClick={() => onNavigate('/help')}
            className="text-xs font-semibold text-slate-600 hover:text-[#065F46] cursor-pointer"
          >
            Need Help?
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
          {/* Left Editorial Visual Showcase (Desktop) */}
          <motion.div
            initial={{ opacity: 0, x: -18 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.45, ease: 'easeOut' }}
            className="hidden lg:block lg:col-span-5 space-y-6"
          >
            <div className="rounded-2xl bg-gradient-to-br from-[#0F172A] via-[#0F2922] to-[#065F46] text-white p-7 shadow-xl border border-emerald-900/40 relative overflow-hidden">
              <div className="absolute -right-12 -top-12 w-40 h-40 rounded-full bg-emerald-400/20 blur-2xl" />
              <div className="absolute -left-10 -bottom-12 w-36 h-36 rounded-full bg-amber-400/15 blur-2xl" />

              <div className="relative z-10 space-y-5">
                <div className="flex items-center gap-2.5">
                  <BrandMark size={30} />
                  <span className="font-display text-lg font-bold tracking-tight">SettleUp</span>
                </div>

                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wider text-emerald-300">
                    Integer-Paise Precision
                  </p>
                  <h2 className="font-display text-2xl font-bold leading-snug">
                    Fair group bills, simplified transfers, verified UPI settlements.
                  </h2>
                </div>

                {/* Live Mini Preview Card */}
                <div className="rounded-xl bg-white/10 backdrop-blur-md border border-white/15 p-4 space-y-3">
                  <div className="flex items-center justify-between text-xs text-emerald-100">
                    <span className="font-semibold">Campus Chai Run</span>
                    <span className="font-mono-num font-bold text-white">₹370.00</span>
                  </div>
                  <div className="space-y-1.5 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-200">4 Tea Drinkers (Chai + Samosas)</span>
                      <span className="font-mono-num font-semibold text-emerald-300">₹55.00 ea</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-200">Kabir (Iced Coffee + Samosas)</span>
                      <span className="font-mono-num font-semibold text-amber-300">₹150.00</span>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-2.5 pt-1 text-xs text-slate-200">
                  <div className="flex items-center gap-2.5">
                    <Scale className="w-4 h-4 text-emerald-300 shrink-0" />
                    <span>Greedy graph engine cuts group transfers to N − 1</span>
                  </div>
                  <div className="flex items-center gap-2.5">
                    <QrCode className="w-4 h-4 text-amber-300 shrink-0" />
                    <span>Two-step UPI QR confirmation prevents false clears</span>
                  </div>
                  <div className="flex items-center gap-2.5">
                    <CheckCircle2 className="w-4 h-4 text-teal-300 shrink-0" />
                    <span>Salted scrypt passwords &amp; atomic SQL ledger</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-xl bg-white/85 backdrop-blur-sm border border-slate-200 p-4 flex items-center gap-3 shadow-xs">
              <div className="w-9 h-9 rounded-lg bg-emerald-50 border border-emerald-200 flex items-center justify-center shrink-0">
                <Sparkles className="w-4 h-4 text-[#065F46]" />
              </div>
              <div className="text-xs text-slate-600">
                <p className="font-semibold text-slate-900">Instant Demo Available</p>
                <p>Explore 3 seeded groups and 6 expenses in one click—no form required.</p>
              </div>
            </div>
          </motion.div>

          {/* Right Auth Form Card */}
          <motion.div
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: 'easeOut' }}
            className="lg:col-span-7"
          >
            <div className="bg-white/95 backdrop-blur-md border border-slate-200/90 rounded-2xl shadow-xl shadow-slate-900/5 p-6 sm:p-8">
              <div className="flex items-center justify-between gap-4 mb-6">
                <div className="flex items-center gap-2.5">
                  <BrandMark size={28} />
                  <span className="font-display text-lg font-bold text-slate-900">SettleUp</span>
                </div>

                {activeTab && activeTab !== 'recovery' && (
                  <div className="inline-flex items-center p-1 rounded-lg bg-slate-100 border border-slate-200">
                    <button
                      type="button"
                      onClick={() => onNavigate('/login')}
                      className={`px-3.5 py-1.5 text-xs font-semibold rounded-md transition-all cursor-pointer ${
                        activeTab === 'login'
                          ? 'bg-white text-slate-900 shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      Sign In
                    </button>
                    <button
                      type="button"
                      onClick={() => onNavigate('/register')}
                      className={`px-3.5 py-1.5 text-xs font-semibold rounded-md transition-all cursor-pointer ${
                        activeTab === 'register'
                          ? 'bg-white text-slate-900 shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      Sign Up
                    </button>
                  </div>
                )}
              </div>

              {children}
            </div>
          </motion.div>
        </div>
      </div>
    </div>
  );
};
