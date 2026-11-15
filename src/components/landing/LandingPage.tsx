import React, { useEffect, useMemo, useRef, useState } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { AnimatePresence, motion } from 'motion/react';
import {
  ArrowRight,
  BarChart3,
  Check,
  ChevronDown,
  Loader2,
  Pause,
  Play,
  QrCode,
  Receipt,
  Scale,
  ShieldCheck,
  Sparkles,
  Users,
} from 'lucide-react';
import { BrandMark } from '../common/BrandMark.tsx';
import { HeroVaultScene } from '../three/HeroVaultScene.tsx';
import { formatINR } from '../../utils/currency.ts';
import type { AppRoute } from '../../types/index.ts';

gsap.registerPlugin(ScrollTrigger);

interface LandingPageProps {
  onNavigate: (route: AppRoute) => void;
  onDemoLogin: () => Promise<void>;
  isAuthenticated: boolean;
}

const DEMO_FRIENDS = ['Aarav', 'Diya', 'Rohan', 'Meera', 'Kabir'];

const WALKTHROUGH_STEPS = [
  {
    id: 'tea',
    title: '1. Masala Chai (₹100 ÷ 4)',
    caption: 'Aarav, Diya, Rohan & Meera share 4 cups of tea (₹25 each). Kabir skips tea.',
  },
  {
    id: 'coffee',
    title: '2. Iced Coffee (₹120 ÷ 1)',
    caption: 'Only Kabir ordered specialty coffee—so ₹120 is attributed strictly to Kabir.',
  },
  {
    id: 'samosas',
    title: '3. Crispy Samosas (₹150 ÷ 5)',
    caption: 'All five friends share the samosa plate equally at ₹30 per person.',
  },
  {
    id: 'final',
    title: '4. Verified Fair Shares',
    caption: 'Four friends pay ₹55 each instead of ₹74, while Kabir pays ₹150. Zero paise lost.',
  },
] as const;

const FAQS = [
  {
    q: 'How is SettleUp different from splitting everything equally?',
    a: 'SettleUp supports item-wise bill splitting. When four friends drink tea (₹100) and one orders expensive coffee (₹120) while everyone shares samosas (₹150), only tea drinkers pay for tea and only the coffee drinker pays for coffee—automatically computing ₹55 each for four friends and ₹150 for the fifth.',
  },
  {
    q: 'Why does SettleUp calculate amounts in integer paise instead of decimals?',
    a: 'Floating-point arithmetic in computers can introduce ₹0.01 rounding errors (such as 0.1 + 0.2 ≠ 0.3). Storing and dividing every rupee in exact integer paise guarantees that individual shares always add up to the exact bill total.',
  },
  {
    q: 'Is SettleUp a bank or payment gateway?',
    a: 'No. SettleUp is an expense-sharing ledger and settlement coordinator. It generates standard UPI payment QR codes for convenience, then uses an honest two-step confirmation workflow where the recipient confirms once money arrives.',
  },
  {
    q: 'How does debt simplification reduce group transfers?',
    a: 'Instead of everyone paying multiple people back and forth, SettleUp calculates each member’s net balance and matches largest creditors with largest debtors—reducing N×(N-1)/2 possible IOUs into at most N-1 clean transfers.',
  },
];

export const LandingPage: React.FC<LandingPageProps> = ({
  onNavigate,
  onDemoLogin,
  isAuthenticated,
}) => {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [demoLoading, setDemoLoading] = useState(false);
  const [demoError, setDemoError] = useState('');
  const [openFaq, setOpenFaq] = useState<number | null>(0);

  // Interactive 5-Friend Tea/Coffee/Samosa Demo State + Animated Walkthrough
  const [teaTotalRupees, setTeaTotalRupees] = useState(100);
  const [coffeeTotalRupees, setCoffeeTotalRupees] = useState(120);
  const [samosaTotalRupees, setSamosaTotalRupees] = useState(150);
  const [teaConsumers, setTeaConsumers] = useState<boolean[]>([true, true, true, true, false]);
  const [coffeeConsumers, setCoffeeConsumers] = useState<boolean[]>([false, false, false, false, true]);
  const [samosaConsumers, setSamosaConsumers] = useState<boolean[]>([true, true, true, true, true]);
  const [compareMode, setCompareMode] = useState<'itemized' | 'equal'>('itemized');
  const [autoPlay, setAutoPlay] = useState(true);
  const [activeStepIdx, setActiveStepIdx] = useState(0);

  useEffect(() => {
    if (!autoPlay) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const timer = window.setInterval(() => {
      setActiveStepIdx((prev) => (prev + 1) % WALKTHROUGH_STEPS.length);
    }, 2600);
    return () => window.clearInterval(timer);
  }, [autoPlay]);

  const demoBreakdown = useMemo(() => {
    const items = [
      { key: 'tea', label: 'Tea', color: 'bg-[#065F46]', paise: Math.max(0, Math.round(teaTotalRupees * 100)), mask: teaConsumers },
      { key: 'coffee', label: 'Coffee', color: 'bg-[#D97706]', paise: Math.max(0, Math.round(coffeeTotalRupees * 100)), mask: coffeeConsumers },
      { key: 'samosas', label: 'Samosas', color: 'bg-[#0D9488]', paise: Math.max(0, Math.round(samosaTotalRupees * 100)), mask: samosaConsumers },
    ];

    const billTotalPaise = items.reduce((acc, i) => acc + (i.mask.some(Boolean) ? i.paise : 0), 0);
    const equalBase = Math.floor(billTotalPaise / DEMO_FRIENDS.length);
    const equalRem = billTotalPaise % DEMO_FRIENDS.length;

    const perFriend = DEMO_FRIENDS.map((name, idx) => {
      let total = 0;
      const segments: Array<{ key: string; label: string; paise: number; color: string }> = [];
      items.forEach((it) => {
        const count = it.mask.filter(Boolean).length;
        if (it.mask[idx] && count > 0) {
          const base = Math.floor(it.paise / count);
          const rem = it.paise % count;
          const activeOrder = it.mask.slice(0, idx).filter(Boolean).length;
          const share = base + (activeOrder < rem ? 1 : 0);
          total += share;
          segments.push({ key: it.key, label: it.label, paise: share, color: it.color });
        }
      });
      const equalSharePaise = equalBase + (idx < equalRem ? 1 : 0);
      return { name, totalPaise: total, equalSharePaise, segments };
    });

    const maxFriendPaise = Math.max(1, ...perFriend.map((f) => Math.max(f.totalPaise, f.equalSharePaise)));
    return { perFriend, billTotalPaise, equalBase, maxFriendPaise };
  }, [teaTotalRupees, coffeeTotalRupees, samosaTotalRupees, teaConsumers, coffeeConsumers, samosaConsumers]);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const ctx = gsap.context(() => {
      gsap.from('.hero-stagger', {
        y: 20,
        opacity: 0,
        duration: 0.7,
        stagger: 0.08,
        ease: 'power3.out',
      });
      gsap.utils.toArray<HTMLElement>('.scroll-reveal').forEach((el) => {
        gsap.from(el, {
          y: 22,
          opacity: 0,
          duration: 0.65,
          ease: 'power2.out',
          scrollTrigger: {
            trigger: el,
            start: 'top 86%',
            once: true,
          },
        });
      });
    }, rootRef);
    return () => ctx.revert();
  }, []);

  const toggleMask = (setter: React.Dispatch<React.SetStateAction<boolean[]>>, idx: number) => {
    setAutoPlay(false);
    setter((prev) => {
      const next = [...prev];
      next[idx] = !next[idx];
      if (!next.some(Boolean)) return prev;
      return next;
    });
  };

  const handleDemo = async () => {
    setDemoError('');
    setDemoLoading(true);
    try {
      await onDemoLogin();
    } catch (err) {
      setDemoError(err instanceof Error ? err.message : 'Unable to open live demo workspace.');
    } finally {
      setDemoLoading(false);
    }
  };

  const activeStep = WALKTHROUGH_STEPS[activeStepIdx];

  return (
    <div ref={rootRef} className="min-h-screen bg-[#F8FAFC] text-[#0F172A]">
      {/* Strict 3-Zone Single-Row Top Bar */}
      <header className="sticky top-0 z-30 bg-[#F8FAFC]/90 backdrop-blur-md border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between gap-6">
          <button
            type="button"
            onClick={() => onNavigate('/')}
            className="flex items-center gap-2.5 font-display text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <BrandMark size={28} />
            <span>SettleUp</span>
          </button>

          <nav className="hidden md:flex items-center gap-7 text-sm font-medium text-slate-600" aria-label="Main navigation">
            <a href="#live-demo" className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0">
              Live Demo
            </a>
            <a href="#how-it-works" className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0">
              How It Works
            </a>
            <a href="#features" className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0">
              Features
            </a>
            <button
              type="button"
              onClick={() => onNavigate('/help')}
              className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Help
            </button>
          </nav>

          <div className="flex items-center gap-3 shrink-0">
            {!isAuthenticated && (
              <button
                type="button"
                onClick={() => onNavigate('/login')}
                className="px-3.5 py-2 text-sm font-semibold text-slate-700 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                Sign In
              </button>
            )}
            <button
              type="button"
              onClick={() => onNavigate(isAuthenticated ? '/dashboard' : '/register')}
              className="px-4 py-2 text-sm font-semibold text-white bg-[#065F46] hover:bg-[#047857] rounded-lg transition-colors whitespace-nowrap shrink-0 shadow-xs cursor-pointer"
            >
              {isAuthenticated ? 'Open Dashboard' : 'Get Started'}
            </button>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="relative overflow-hidden">
        <div
          className="pointer-events-none absolute -top-28 right-0 w-[34rem] h-[34rem] rounded-full bg-emerald-400/12 blur-3xl"
          aria-hidden="true"
        />
        <div
          className="pointer-events-none absolute top-24 -left-24 w-[26rem] h-[26rem] rounded-full bg-amber-300/12 blur-3xl"
          aria-hidden="true"
        />

        <div className="max-w-7xl mx-auto px-6 pt-12 pb-16 lg:pt-16 lg:pb-22">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-12 items-center">
            <div className="lg:col-span-6 space-y-6">
              <p className="hero-stagger text-sm font-semibold text-[#065F46] tracking-wide">
                Collaborative Group Expense Ledger · INR Paise Precision
              </p>
              <h1 className="hero-stagger font-display text-4xl sm:text-5xl lg:text-[3.5rem] font-bold tracking-tight leading-[1.08] text-slate-900 text-balance">
                Split every shared bill fairly.
              </h1>
              <p className="hero-stagger text-base sm:text-lg text-slate-600 leading-relaxed max-w-lg">
                Track group expenses, split down to individual items, and settle balances in seconds.
              </p>

              {demoError && (
                <div role="alert" className="p-3 rounded-xl border border-red-200 bg-red-50 text-sm text-red-800">
                  {demoError}
                </div>
              )}

              <div className="hero-stagger flex flex-wrap items-center gap-3.5 pt-1">
                <button
                  type="button"
                  onClick={() => onNavigate(isAuthenticated ? '/dashboard' : '/register')}
                  className="inline-flex items-center gap-2 px-6 py-3 text-sm font-semibold text-white bg-[#065F46] hover:bg-[#047857] rounded-xl shadow-sm transition-all cursor-pointer"
                >
                  <span>{isAuthenticated ? 'Go to Dashboard' : 'Create Free Account'}</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={handleDemo}
                  disabled={demoLoading}
                  className="inline-flex items-center gap-2 px-5 py-3 text-sm font-semibold text-slate-900 bg-white border border-slate-300 hover:border-[#065F46] hover:bg-emerald-50/40 rounded-xl shadow-xs transition-all cursor-pointer disabled:opacity-60"
                >
                  {demoLoading ? (
                    <Loader2 className="w-4 h-4 animate-spin text-[#065F46]" />
                  ) : (
                    <Sparkles className="w-4 h-4 text-[#D97706]" />
                  )}
                  <span>{demoLoading ? 'Opening Demo...' : 'Explore Live Demo Workspace'}</span>
                </button>
                {!isAuthenticated && (
                  <button
                    type="button"
                    onClick={() => onNavigate('/login')}
                    className="px-3 py-2 text-sm font-semibold text-slate-700 hover:text-[#065F46] underline underline-offset-4 cursor-pointer"
                  >
                    Sign in
                  </button>
                )}
              </div>

              <div className="hero-stagger pt-5 border-t border-slate-200 grid grid-cols-3 gap-6 max-w-lg">
                <div>
                  <p className="font-mono-num text-xl font-bold text-slate-900">5 Modes</p>
                  <p className="text-xs text-slate-500 mt-0.5">Including item-wise bills</p>
                </div>
                <div>
                  <p className="font-mono-num text-xl font-bold text-[#065F46]">₹0.01</p>
                  <p className="text-xs text-slate-500 mt-0.5">Zero floating-point drift</p>
                </div>
                <div>
                  <p className="font-mono-num text-xl font-bold text-[#D97706]">N − 1</p>
                  <p className="text-xs text-slate-500 mt-0.5">Minimal group transfers</p>
                </div>
              </div>
            </div>

            {/* Upgraded 3D Showcase Frame with Subtle Floating Corner Telemetry */}
            <div className="lg:col-span-6 relative">
              <div className="rounded-2xl border border-slate-200 bg-gradient-to-br from-white via-emerald-50/25 to-amber-50/30 p-3 shadow-xl shadow-slate-900/5 relative overflow-hidden">
                <HeroVaultScene />

                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.35, duration: 0.5 }}
                  className="hidden sm:flex items-center justify-between gap-4 px-4 py-2.5 mt-1 rounded-xl bg-white/90 backdrop-blur-md border border-slate-200 text-xs"
                >
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                    <span className="font-semibold text-slate-800">3D Debt Graph &amp; Ledger Prism</span>
                  </div>
                  <span className="text-slate-500">Drag sculpture to rotate · 5-node orbit</span>
                </motion.div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Animated Interactive Live Tea / Coffee / Samosa Split Demonstration */}
      <section id="live-demo" className="scroll-reveal bg-white border-y border-slate-200 py-16 lg:py-20">
        <div className="max-w-7xl mx-auto px-6">
          <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6 mb-10">
            <div className="max-w-2xl">
              <p className="text-xs font-bold uppercase tracking-wider text-[#065F46]">
                Animated Problem Demonstration
              </p>
              <h2 className="font-display text-2xl sm:text-3xl font-bold text-slate-900 mt-2 text-balance">
                See why item-wise splitting beats equal splits—live
              </h2>
              <p className="text-slate-600 mt-2">
                Toggle consumers or prices below, or switch between Fair Item-Wise and Equal Split to watch shares recalculate in exact integer paise.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3 shrink-0">
              <button
                type="button"
                onClick={() => setAutoPlay((v) => !v)}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 cursor-pointer"
              >
                {autoPlay ? <Pause className="w-3.5 h-3.5 text-[#065F46]" /> : <Play className="w-3.5 h-3.5 text-[#065F46]" />}
                <span>{autoPlay ? 'Pause Animation' : 'Play Walkthrough'}</span>
              </button>

              <div className="inline-flex p-1 rounded-lg bg-slate-100 border border-slate-200">
                <button
                  type="button"
                  onClick={() => setCompareMode('itemized')}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all cursor-pointer ${
                    compareMode === 'itemized'
                      ? 'bg-[#065F46] text-white shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Fair Item-Wise
                </button>
                <button
                  type="button"
                  onClick={() => setCompareMode('equal')}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all cursor-pointer ${
                    compareMode === 'equal'
                      ? 'bg-[#E11D48] text-white shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Equal Split Trap
                </button>
              </div>
            </div>
          </div>

          {/* Animated Walkthrough Timeline Stepper */}
          <div className="mb-8 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {WALKTHROUGH_STEPS.map((st, idx) => {
              const isCurrent = idx === activeStepIdx;
              return (
                <button
                  key={st.id}
                  type="button"
                  onClick={() => {
                    setAutoPlay(false);
                    setActiveStepIdx(idx);
                  }}
                  className={`text-left p-3.5 rounded-xl border transition-all cursor-pointer relative overflow-hidden ${
                    isCurrent
                      ? 'bg-emerald-50/70 border-[#065F46] shadow-xs'
                      : 'bg-[#F8FAFC] border-slate-200 hover:border-slate-300'
                  }`}
                >
                  {isCurrent && autoPlay && (
                    <motion.div
                      key={activeStep.id}
                      initial={{ scaleX: 0 }}
                      animate={{ scaleX: 1 }}
                      transition={{ duration: 2.5, ease: 'linear' }}
                      style={{ transformOrigin: 'left' }}
                      className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#065F46]"
                    />
                  )}
                  <p className={`text-xs font-bold ${isCurrent ? 'text-[#065F46]' : 'text-slate-800'}`}>
                    {st.title}
                  </p>
                  <p className="text-xs text-slate-600 mt-1 line-clamp-2">{st.caption}</p>
                </button>
              );
            })}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
            {/* Left Interactive Bill Table */}
            <div className="lg:col-span-7 border border-slate-200 rounded-2xl overflow-hidden bg-[#F8FAFC] shadow-xs">
              <div className="grid grid-cols-12 gap-2 px-4 py-3 bg-slate-100 border-b border-slate-200 text-xs font-semibold text-slate-600">
                <div className="col-span-4">Bill Item</div>
                <div className="col-span-3">Price (₹)</div>
                <div className="col-span-5">Who Consumed It?</div>
              </div>

              {/* Tea Row */}
              <motion.div
                animate={{
                  backgroundColor: activeStep.id === 'tea' ? '#ECFDF5' : '#FFFFFF',
                }}
                transition={{ duration: 0.35 }}
                className="grid grid-cols-12 gap-2 px-4 py-4 border-b border-slate-200 items-center"
              >
                <div className="col-span-4">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-[#065F46] shrink-0" />
                    <p className="font-semibold text-sm text-slate-900">Masala Chai</p>
                  </div>
                  <p className="text-xs text-slate-500 pl-4.5">
                    {teaConsumers.filter(Boolean).length} consumers
                  </p>
                </div>
                <div className="col-span-3">
                  <input
                    type="number"
                    min={0}
                    value={teaTotalRupees}
                    onChange={(e) => {
                      setAutoPlay(false);
                      setTeaTotalRupees(Math.max(0, Number(e.target.value) || 0));
                    }}
                    aria-label="Tea total price in rupees"
                    className="w-24 px-2.5 py-1.5 text-sm font-mono-num border border-slate-300 rounded-lg bg-white focus:border-[#065F46] focus:outline-none"
                  />
                </div>
                <div className="col-span-5 flex flex-wrap gap-1.5">
                  {DEMO_FRIENDS.map((friend, i) => (
                    <motion.button
                      whileTap={{ scale: 0.94 }}
                      key={friend}
                      type="button"
                      onClick={() => toggleMask(setTeaConsumers, i)}
                      className={`px-2.5 py-1 text-xs font-semibold rounded-md border transition-colors cursor-pointer ${
                        teaConsumers[i]
                          ? 'bg-[#065F46] text-white border-[#065F46]'
                          : 'bg-white text-slate-600 border-slate-300 hover:border-slate-400'
                      }`}
                    >
                      {friend}
                    </motion.button>
                  ))}
                </div>
              </motion.div>

              {/* Coffee Row */}
              <motion.div
                animate={{
                  backgroundColor: activeStep.id === 'coffee' ? '#FFFBEB' : '#FFFFFF',
                }}
                transition={{ duration: 0.35 }}
                className="grid grid-cols-12 gap-2 px-4 py-4 border-b border-slate-200 items-center"
              >
                <div className="col-span-4">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-[#D97706] shrink-0" />
                    <p className="font-semibold text-sm text-slate-900">Iced Coffee</p>
                  </div>
                  <p className="text-xs text-slate-500 pl-4.5">
                    {coffeeConsumers.filter(Boolean).length} consumer
                  </p>
                </div>
                <div className="col-span-3">
                  <input
                    type="number"
                    min={0}
                    value={coffeeTotalRupees}
                    onChange={(e) => {
                      setAutoPlay(false);
                      setCoffeeTotalRupees(Math.max(0, Number(e.target.value) || 0));
                    }}
                    aria-label="Coffee total price in rupees"
                    className="w-24 px-2.5 py-1.5 text-sm font-mono-num border border-slate-300 rounded-lg bg-white focus:border-[#D97706] focus:outline-none"
                  />
                </div>
                <div className="col-span-5 flex flex-wrap gap-1.5">
                  {DEMO_FRIENDS.map((friend, i) => (
                    <motion.button
                      whileTap={{ scale: 0.94 }}
                      key={friend}
                      type="button"
                      onClick={() => toggleMask(setCoffeeConsumers, i)}
                      className={`px-2.5 py-1 text-xs font-semibold rounded-md border transition-colors cursor-pointer ${
                        coffeeConsumers[i]
                          ? 'bg-[#D97706] text-white border-[#D97706]'
                          : 'bg-white text-slate-600 border-slate-300 hover:border-slate-400'
                      }`}
                    >
                      {friend}
                    </motion.button>
                  ))}
                </div>
              </motion.div>

              {/* Samosa Row */}
              <motion.div
                animate={{
                  backgroundColor: activeStep.id === 'samosas' ? '#F0FDFA' : '#FFFFFF',
                }}
                transition={{ duration: 0.35 }}
                className="grid grid-cols-12 gap-2 px-4 py-4 items-center"
              >
                <div className="col-span-4">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-[#0D9488] shrink-0" />
                    <p className="font-semibold text-sm text-slate-900">Crispy Samosas</p>
                  </div>
                  <p className="text-xs text-slate-500 pl-4.5">
                    {samosaConsumers.filter(Boolean).length} consumers
                  </p>
                </div>
                <div className="col-span-3">
                  <input
                    type="number"
                    min={0}
                    value={samosaTotalRupees}
                    onChange={(e) => {
                      setAutoPlay(false);
                      setSamosaTotalRupees(Math.max(0, Number(e.target.value) || 0));
                    }}
                    aria-label="Samosas total price in rupees"
                    className="w-24 px-2.5 py-1.5 text-sm font-mono-num border border-slate-300 rounded-lg bg-white focus:border-[#0D9488] focus:outline-none"
                  />
                </div>
                <div className="col-span-5 flex flex-wrap gap-1.5">
                  {DEMO_FRIENDS.map((friend, i) => (
                    <motion.button
                      whileTap={{ scale: 0.94 }}
                      key={friend}
                      type="button"
                      onClick={() => toggleMask(setSamosaConsumers, i)}
                      className={`px-2.5 py-1 text-xs font-semibold rounded-md border transition-colors cursor-pointer ${
                        samosaConsumers[i]
                          ? 'bg-[#0D9488] text-white border-[#0D9488]'
                          : 'bg-white text-slate-600 border-slate-300 hover:border-slate-400'
                      }`}
                    >
                      {friend}
                    </motion.button>
                  ))}
                </div>
              </motion.div>
            </div>

            {/* Right Animated Calculated Output Panel */}
            <div className="lg:col-span-5 border border-slate-200 rounded-2xl bg-white p-6 shadow-sm">
              <div className="flex items-baseline justify-between pb-4 border-b border-slate-200">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                    {compareMode === 'itemized' ? 'Verified Fair Breakdown' : 'Unfair Equal Division'}
                  </p>
                  <p className="font-display text-lg font-bold text-slate-900">
                    {compareMode === 'itemized' ? 'Per-Person Item Share' : 'If Split Equally (÷ 5)'}
                  </p>
                </div>
                <p className="font-mono-num text-2xl font-bold text-[#065F46]">
                  {formatINR(demoBreakdown.billTotalPaise)}
                </p>
              </div>

              <div className="space-y-4 mt-4">
                {demoBreakdown.perFriend.map((f) => {
                  const shownPaise = compareMode === 'itemized' ? f.totalPaise : f.equalSharePaise;
                  const diffPaise = f.equalSharePaise - f.totalPaise;
                  return (
                    <motion.div
                      layout
                      key={f.name}
                      className="p-3 rounded-xl border border-slate-200/80 bg-[#F8FAFC] space-y-2"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="font-semibold text-sm text-slate-900">{f.name}</p>
                            {compareMode === 'itemized' && diffPaise > 0 && (
                              <span className="text-[11px] font-semibold text-[#065F46]">
                                Saves {formatINR(diffPaise)}
                              </span>
                            )}
                            {compareMode === 'equal' && diffPaise > 0 && (
                              <span className="text-[11px] font-semibold text-[#E11D48]">
                                Overcharged {formatINR(diffPaise)}
                              </span>
                            )}
                            {compareMode === 'equal' && diffPaise < 0 && (
                              <span className="text-[11px] font-semibold text-[#D97706]">
                                Underpays {formatINR(Math.abs(diffPaise))}
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-slate-500 mt-0.5 truncate">
                            {compareMode === 'itemized'
                              ? f.segments.length > 0
                                ? f.segments.map((s) => `${s.label} ${formatINR(s.paise)}`).join(' + ')
                                : 'Did not consume any item'
                              : 'Forced equal share regardless of order'}
                          </p>
                        </div>

                        <AnimatePresence mode="wait">
                          <motion.span
                            key={`${f.name}-${shownPaise}-${compareMode}`}
                            initial={{ opacity: 0, y: -4 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: 4 }}
                            transition={{ duration: 0.22 }}
                            className={`font-mono-num text-base font-bold shrink-0 ${
                              compareMode === 'equal' && diffPaise > 0 ? 'text-[#E11D48]' : 'text-slate-900'
                            }`}
                          >
                            {formatINR(shownPaise)}
                          </motion.span>
                        </AnimatePresence>
                      </div>

                      {/* Animated Proportional Split Bar */}
                      <div className="h-2.5 w-full rounded-full bg-slate-200 overflow-hidden flex">
                        {compareMode === 'itemized' ? (
                          f.segments.map((seg) => {
                            const pct = (seg.paise / demoBreakdown.maxFriendPaise) * 100;
                            return (
                              <motion.div
                                key={seg.key}
                                initial={{ width: 0 }}
                                animate={{ width: `${pct}%` }}
                                transition={{ type: 'spring', stiffness: 180, damping: 24 }}
                                className={`h-full ${seg.color}`}
                              />
                            );
                          })
                        ) : (
                          <motion.div
                            initial={{ width: 0 }}
                            animate={{ width: `${(f.equalSharePaise / demoBreakdown.maxFriendPaise) * 100}%` }}
                            transition={{ type: 'spring', stiffness: 180, damping: 24 }}
                            className="h-full bg-[#E11D48]"
                          />
                        )}
                      </div>
                    </motion.div>
                  );
                })}
              </div>

              <div className="mt-4 pt-4 border-t border-slate-200 flex items-center justify-between text-xs text-slate-500">
                <span>Legend: Emerald Chai · Amber Coffee · Teal Samosas</span>
                <button
                  type="button"
                  onClick={() => {
                    setTeaTotalRupees(100);
                    setCoffeeTotalRupees(120);
                    setSamosaTotalRupees(150);
                    setTeaConsumers([true, true, true, true, false]);
                    setCoffeeConsumers([false, false, false, false, true]);
                    setSamosaConsumers([true, true, true, true, true]);
                    setCompareMode('itemized');
                    setAutoPlay(true);
                  }}
                  className="font-semibold text-[#065F46] hover:underline cursor-pointer shrink-0 ml-2"
                >
                  Reset example
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* How SettleUp Works (Animated Cards with Vibrant Pop Accents) */}
      <section id="how-it-works" className="scroll-reveal max-w-7xl mx-auto px-6 py-16 lg:py-24">
        <div className="max-w-2xl mb-12">
          <p className="text-xs font-bold uppercase tracking-wider text-[#065F46]">Workflow</p>
          <h2 className="font-display text-2xl sm:text-3xl font-bold text-slate-900 mt-2">
            Three deliberate steps from shared receipt to zero balance
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <motion.div
            whileHover={{ y: -4 }}
            transition={{ type: 'spring', stiffness: 280, damping: 22 }}
            className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4 shadow-xs hover:shadow-md transition-shadow relative overflow-hidden"
          >
            <div className="h-1.5 w-16 rounded-full bg-gradient-to-r from-[#065F46] to-[#10B981]" />
            <p className="font-mono-num text-xs font-bold text-[#065F46]">01. GROUP &amp; INVITE</p>
            <h3 className="font-display text-lg font-bold text-slate-900">Create a group space</h3>
            <p className="text-sm text-slate-600 leading-relaxed">
              Organize roommates, college outings, or travel trips into isolated workspaces with expiring invite links and QR codes.
            </p>
          </motion.div>

          <motion.div
            whileHover={{ y: -4 }}
            transition={{ type: 'spring', stiffness: 280, damping: 22 }}
            className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4 shadow-xs hover:shadow-md transition-shadow relative overflow-hidden"
          >
            <div className="h-1.5 w-16 rounded-full bg-gradient-to-r from-[#D97706] to-[#F59E0B]" />
            <p className="font-mono-num text-xs font-bold text-[#D97706]">02. LOG &amp; VERIFY</p>
            <h3 className="font-display text-lg font-bold text-slate-900">Split by item, share, or %</h3>
            <p className="text-sm text-slate-600 leading-relaxed">
              Choose equal, exact, percentage, shares, or item-wise billing with proportional tax and discount allocation in integer paise.
            </p>
          </motion.div>

          <motion.div
            whileHover={{ y: -4 }}
            transition={{ type: 'spring', stiffness: 280, damping: 22 }}
            className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4 shadow-xs hover:shadow-md transition-shadow relative overflow-hidden"
          >
            <div className="h-1.5 w-16 rounded-full bg-gradient-to-r from-[#4F46E5] to-[#0D9488]" />
            <p className="font-mono-num text-xs font-bold text-[#4F46E5]">03. SIMPLIFY &amp; SETTLE</p>
            <h3 className="font-display text-lg font-bold text-slate-900">Confirm UPI transfers</h3>
            <p className="text-sm text-slate-600 leading-relaxed">
              Minimize group IOUs into the fewest transfers, pay with a generated UPI QR, and confirm receipt before balances clear.
            </p>
          </motion.div>
        </div>
      </section>

      {/* Core Feature Bento Grid with Animated Micro-Visualizations */}
      <section id="features" className="scroll-reveal bg-white border-y border-slate-200 py-16 lg:py-24">
        <div className="max-w-7xl mx-auto px-6">
          <div className="max-w-2xl mb-12">
            <p className="text-xs font-bold uppercase tracking-wider text-[#065F46]">Capabilities</p>
            <h2 className="font-display text-2xl sm:text-3xl font-bold text-slate-900 mt-2">
              Engineered for financial accuracy and group transparency
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
            {/* Bento Card 1 */}
            <motion.div
              whileHover={{ y: -3 }}
              className="md:col-span-7 border border-slate-200 rounded-2xl p-6 bg-gradient-to-br from-[#F8FAFC] to-emerald-50/40 flex flex-col justify-between shadow-xs"
            >
              <div>
                <div className="w-11 h-11 rounded-xl bg-emerald-100 border border-emerald-200 flex items-center justify-center mb-4">
                  <Receipt className="w-5 h-5 text-[#065F46]" />
                </div>
                <h3 className="font-display text-xl font-bold text-slate-900">
                  Item-Wise Receipt Engine with Proportional Tax &amp; Tip
                </h3>
                <p className="text-sm text-slate-600 mt-2 leading-relaxed max-w-xl">
                  Assign exact consumers per item and let the Hamilton Largest-Remainder allocator distribute GST, service tips, and discounts with zero paise lost.
                </p>

                {/* Animated Live Ratio Bar Preview */}
                <div className="mt-5 p-3.5 rounded-xl bg-white border border-slate-200 space-y-2">
                  <div className="flex justify-between text-xs font-semibold text-slate-700">
                    <span>Subtotal + 5% GST + Tip</span>
                    <span className="font-mono-num text-[#065F46]">100.00% Checksum Verified</span>
                  </div>
                  <div className="h-2.5 rounded-full bg-slate-100 overflow-hidden flex gap-0.5">
                    <motion.div
                      animate={{ width: ['38%', '44%', '38%'] }}
                      transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
                      className="bg-[#065F46] h-full rounded-l-full"
                    />
                    <motion.div
                      animate={{ width: ['32%', '28%', '32%'] }}
                      transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
                      className="bg-[#0D9488] h-full"
                    />
                    <motion.div
                      animate={{ width: ['30%', '28%', '30%'] }}
                      transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
                      className="bg-[#D97706] h-full rounded-r-full"
                    />
                  </div>
                </div>
              </div>
              <div className="mt-5 pt-4 border-t border-slate-200 flex items-center gap-6 text-xs text-slate-600">
                <span>Equal &amp; Exact Splits</span>
                <span aria-hidden="true">·</span>
                <span>Percentage &amp; Shares</span>
                <span aria-hidden="true">·</span>
                <span>Receipt Attachments</span>
              </div>
            </motion.div>

            {/* Bento Card 2 */}
            <motion.div
              whileHover={{ y: -3 }}
              className="md:col-span-5 border border-slate-200 rounded-2xl p-6 bg-gradient-to-br from-white to-amber-50/40 shadow-xs flex flex-col justify-between"
            >
              <div>
                <div className="w-11 h-11 rounded-xl bg-amber-100 border border-amber-200 flex items-center justify-center mb-4">
                  <Scale className="w-5 h-5 text-[#D97706]" />
                </div>
                <h3 className="font-display text-xl font-bold text-slate-900">
                  Greedy Debt Graph Simplification
                </h3>
                <p className="text-sm text-slate-600 mt-2 leading-relaxed">
                  Reduces circular multi-friend IOUs to the fewest net transfers—preserving every historical expense untouched.
                </p>
              </div>
              <div className="mt-5 p-3.5 rounded-xl bg-white border border-slate-200 flex items-center justify-between text-xs">
                <div className="text-slate-500">
                  <p className="font-semibold text-slate-800">Before Simplification</p>
                  <p className="font-mono-num">10 Circular IOUs</p>
                </div>
                <motion.div
                  animate={{ x: [0, 5, 0] }}
                  transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
                  className="text-[#D97706] font-bold"
                >
                  →
                </motion.div>
                <div className="text-right">
                  <p className="font-semibold text-[#065F46]">After Graph Match</p>
                  <p className="font-mono-num font-bold text-slate-900">≤ N − 1 Transfers</p>
                </div>
              </div>
            </motion.div>

            {/* Bento Card 3 */}
            <motion.div
              whileHover={{ y: -3 }}
              className="md:col-span-5 border border-slate-200 rounded-2xl p-6 bg-gradient-to-br from-white to-indigo-50/40 shadow-xs flex flex-col justify-between"
            >
              <div>
                <div className="w-11 h-11 rounded-xl bg-indigo-100 border border-indigo-200 flex items-center justify-center mb-4">
                  <QrCode className="w-5 h-5 text-[#4F46E5]" />
                </div>
                <h3 className="font-display text-xl font-bold text-slate-900">
                  Honest UPI QR &amp; Two-Step Confirmation
                </h3>
                <p className="text-sm text-slate-600 mt-2 leading-relaxed">
                  Generate standard <code className="font-mono-num text-xs bg-slate-100 px-1 py-0.5 rounded">upi://pay</code> QRs. Scanning never auto-settles—payers submit their UTR and recipients confirm receipt.
                </p>
              </div>
              <div className="mt-5 p-3.5 rounded-xl bg-white border border-slate-200 flex items-center justify-between text-xs">
                <span className="font-semibold text-slate-700">1. Scan &amp; Pay</span>
                <span className="text-slate-400">·</span>
                <span className="font-semibold text-[#D97706]">2. Recorded</span>
                <span className="text-slate-400">·</span>
                <span className="inline-flex items-center gap-1 font-semibold text-[#065F46]">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                  3. Confirmed
                </span>
              </div>
            </motion.div>

            {/* Bento Card 4 */}
            <motion.div
              whileHover={{ y: -3 }}
              className="md:col-span-7 border border-slate-200 rounded-2xl p-6 bg-gradient-to-br from-[#F8FAFC] to-teal-50/50 shadow-xs flex flex-col justify-between"
            >
              <div>
                <div className="w-11 h-11 rounded-xl bg-teal-100 border border-teal-200 flex items-center justify-center mb-4">
                  <BarChart3 className="w-5 h-5 text-[#0D9488]" />
                </div>
                <h3 className="font-display text-xl font-bold text-slate-900">
                  SQL Analytics, CSV/PDF Reports &amp; AI Guidance
                </h3>
                <p className="text-sm text-slate-600 mt-2 leading-relaxed max-w-xl">
                  Inspect real-time monthly trends, category breakdowns, and member contributions. Export CSV ledgers, print PDF summaries, or ask the SettleUp AI Help Assistant how any balance works.
                </p>
              </div>

              {/* Animated Mini SQL Bar Visualization */}
              <div className="mt-5 p-3.5 rounded-xl bg-white border border-slate-200 flex items-end justify-between gap-2 h-20">
                {[38, 62, 48, 84, 56, 92, 70].map((h, idx) => (
                  <motion.div
                    key={idx}
                    initial={{ height: '20%' }}
                    whileInView={{ height: `${h}%` }}
                    viewport={{ once: true }}
                    transition={{ duration: 0.6, delay: idx * 0.06, ease: 'easeOut' }}
                    className={`flex-1 rounded-t-md ${
                      idx === 5 ? 'bg-[#065F46]' : idx === 3 ? 'bg-[#D97706]' : 'bg-[#0D9488]/70'
                    }`}
                  />
                ))}
              </div>
            </motion.div>
          </div>
        </div>
      </section>

      {/* Trust & Security */}
      <section className="scroll-reveal max-w-7xl mx-auto px-6 py-16">
        <div className="border border-slate-200 rounded-2xl bg-gradient-to-br from-[#0F172A] via-[#0F2922] to-[#065F46] text-white p-8 lg:p-12 grid grid-cols-1 lg:grid-cols-12 gap-8 items-center shadow-lg">
          <div className="lg:col-span-7 space-y-4">
            <div className="inline-flex items-center gap-2 text-emerald-300 text-xs font-semibold uppercase tracking-wider">
              <ShieldCheck className="w-4 h-4" />
              <span>Security &amp; Data Integrity</span>
            </div>
            <h2 className="font-display text-2xl sm:text-3xl font-bold text-balance">
              Built with relational ACID transactions, salted scrypt hashing, and strict group access control.
            </h2>
            <p className="text-slate-300 text-sm sm:text-base leading-relaxed max-w-2xl">
              Your group expenses remain private to verified group members. Every financial mutation executes inside an atomic database transaction with foreign-key enforcement and server-side validation.
            </p>
          </div>
          <div className="lg:col-span-5 grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
            {[
              'Salted scrypt passwords',
              'HTTP-only + token auth',
              'ACID financial commits',
              'Role-based group guards',
            ].map((item) => (
              <div key={item} className="flex items-center gap-2.5 bg-white/10 border border-white/15 rounded-xl px-4 py-3">
                <Check className="w-4 h-4 text-emerald-300 shrink-0" />
                <span className="text-slate-100">{item}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="scroll-reveal max-w-4xl mx-auto px-6 py-12 pb-20">
        <h2 className="font-display text-2xl font-bold text-slate-900 mb-6">Frequently Asked Questions</h2>
        <div className="divide-y divide-slate-200 border border-slate-200 rounded-2xl bg-white overflow-hidden">
          {FAQS.map((faq, idx) => (
            <div key={faq.q}>
              <button
                type="button"
                onClick={() => setOpenFaq(openFaq === idx ? null : idx)}
                className="w-full px-6 py-4 text-left flex items-center justify-between gap-4 hover:bg-slate-50 transition-colors cursor-pointer"
              >
                <span className="font-medium text-slate-900 text-sm sm:text-base">{faq.q}</span>
                <ChevronDown
                  className={`w-4 h-4 text-slate-500 shrink-0 transition-transform ${
                    openFaq === idx ? 'rotate-180' : ''
                  }`}
                />
              </button>
              {openFaq === idx && (
                <div className="px-6 pb-5 text-sm text-slate-600 leading-relaxed">{faq.a}</div>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* Quiet Footer */}
      <footer className="border-t border-slate-200 bg-white">
        <div className="max-w-7xl mx-auto px-6 py-10 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
          <div className="flex items-center gap-3">
            <BrandMark size={24} />
            <div>
              <p className="font-display font-bold text-slate-900 text-sm">SettleUp</p>
              <p className="text-xs text-slate-500">Transparent group expense &amp; settlement ledger</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-6 text-sm text-slate-600">
            <button type="button" onClick={() => onNavigate('/help')} className="hover:text-slate-900 cursor-pointer">
              Help Centre
            </button>
            <button type="button" onClick={() => onNavigate('/privacy')} className="hover:text-slate-900 cursor-pointer">
              Privacy Policy
            </button>
            <button type="button" onClick={() => onNavigate('/terms')} className="hover:text-slate-900 cursor-pointer">
              Terms &amp; Conditions
            </button>
            <button type="button" onClick={() => onNavigate('/login')} className="hover:text-slate-900 cursor-pointer">
              Sign In
            </button>
            <button type="button" onClick={() => onNavigate('/register')} className="hover:text-slate-900 cursor-pointer">
              Sign Up
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
};
