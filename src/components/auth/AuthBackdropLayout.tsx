import React from 'react';
import { ArrowLeft, CheckCircle2, QrCode, Scale } from 'lucide-react';
import { motion } from 'motion/react';
import { BrandMark } from '../common/BrandMark.tsx';
import { HeroVaultScene } from '../three/HeroVaultScene.tsx';
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
    <div className="min-h-screen relative overflow-hidden bg-[#F8FAFC] text-[#0F172A] flex flex-col">
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 min-h-screen">
        {/* Left Column (~42% width): Alabaster Off-White User Input Panel */}
        <div className="lg:col-span-5 flex flex-col justify-between p-6 sm:p-10 lg:px-12 lg:py-8 bg-[#F8FAFC] border-r border-slate-200 relative z-10">
          <div className="flex items-center justify-between gap-4">
            <button
              type="button"
              onClick={() => onNavigate('/')}
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-xs font-semibold text-slate-700 hover:text-slate-900 hover:border-slate-300 shadow-xs transition-all cursor-pointer"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Back to SettleUp</span>
            </button>

            <button
              type="button"
              onClick={() => onNavigate('/help')}
              className="text-xs font-semibold text-slate-600 hover:text-[#065F46] cursor-pointer"
            >
              Help Centre
            </button>
          </div>

          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, ease: 'easeOut' }}
            className="my-auto py-8 max-w-md w-full mx-auto"
          >
            <div className="bg-white border border-slate-200 rounded-2xl shadow-lg shadow-slate-900/5 p-6 sm:p-8">
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

          <p className="text-xs text-slate-500 text-center lg:text-left">
            Integer-paise ledger accuracy · Salted scrypt security · Instant Demo available
          </p>
        </div>

        {/* Right Column (~58% width): Deep Charcoal & Forest Emerald 3D Architectural Backdrop */}
        <div className="hidden lg:flex lg:col-span-7 relative flex-col justify-between p-10 bg-gradient-to-br from-[#0F172A] via-[#0B241E] to-[#065F46] text-white overflow-hidden">
          <div className="pointer-events-none absolute inset-0" aria-hidden="true">
            <div className="absolute -top-24 -right-24 w-[28rem] h-[28rem] rounded-full bg-emerald-400/15 blur-3xl" />
            <div className="absolute bottom-10 -left-24 w-[24rem] h-[24rem] rounded-full bg-amber-400/10 blur-3xl" />
            <div
              className="absolute inset-0 opacity-[0.14]"
              style={{
                backgroundImage:
                  'linear-gradient(to right, rgba(255,255,255,0.2) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.2) 1px, transparent 1px)',
                backgroundSize: '48px 48px',
              }}
            />
          </div>

          <div className="relative z-10 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-emerald-300">
                Interactive 3D Financial Engine
              </p>
              <h2 className="font-display text-2xl font-bold mt-1">
                Every rupee, item, and group transfer in sync.
              </h2>
            </div>
            <span className="text-xs font-mono-num text-emerald-200/90 border border-emerald-400/30 bg-white/5 px-3 py-1 rounded-lg">
              Drag 3D Scene
            </span>
          </div>

          {/* Live Three.js HeroVaultScene Injected Directly into Auth Backdrop */}
          <div className="relative z-10 my-auto">
            <HeroVaultScene />
          </div>

          {/* Bottom Architectural Summary Strip */}
          <div className="relative z-10 grid grid-cols-3 gap-4">
            <div className="rounded-xl bg-white/10 backdrop-blur-md border border-white/15 p-3.5">
              <div className="flex items-center gap-2 text-emerald-300 text-xs font-semibold">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>Item-Wise Split</span>
              </div>
              <p className="text-xs text-slate-200 mt-1">
                Tea ₹55 · Coffee ₹150 — exact paise allocation.
              </p>
            </div>
            <div className="rounded-xl bg-white/10 backdrop-blur-md border border-white/15 p-3.5">
              <div className="flex items-center gap-2 text-amber-300 text-xs font-semibold">
                <Scale className="w-4 h-4 shrink-0" />
                <span>N − 1 Graph</span>
              </div>
              <p className="text-xs text-slate-200 mt-1">
                Simplifies circular IOUs into minimal payments.
              </p>
            </div>
            <div className="rounded-xl bg-white/10 backdrop-blur-md border border-white/15 p-3.5">
              <div className="flex items-center gap-2 text-teal-300 text-xs font-semibold">
                <QrCode className="w-4 h-4 shrink-0" />
                <span>Verified UPI QR</span>
              </div>
              <p className="text-xs text-slate-200 mt-1">
                Two-step confirmation prevents premature clears.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
