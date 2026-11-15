import React, { useState } from 'react';
import { ArrowRight, Check, MousePointerClick, X } from 'lucide-react';
import type { AppRoute } from '../../types/index.ts';

interface OnboardingTourProps {
  onClose: () => void;
  onNavigate: (route: AppRoute) => void;
}

const STEPS = [
  {
    title: 'Welcome to Your SettleUp Workspace',
    description:
      'Your Dashboard summarizes everything you owe, everything owed to you, and real-time spending trends across your groups.',
    tip: 'All financial figures are stored in integer paise so ₹ splits never drift by rounding errors.',
    targetRoute: '/dashboard' as AppRoute,
    cta: 'Show Groups',
  },
  {
    title: 'Step 1: Create Groups & Share QR Invites',
    description:
      'Use My Groups to create shared spaces for roommates, college teams, or trips. Each group generates an expiring invite link and scannable QR code.',
    tip: 'Admins can manage roles and safely remove members once their group balance is ₹0.00.',
    targetRoute: '/groups' as AppRoute,
    cta: 'Explore Item-Wise Splitting',
  },
  {
    title: 'Step 2: Split Bills Item-by-Item',
    description:
      'In Add Expense, pick Item-wise mode to log Tea (₹100 ÷ 4), Coffee (₹120 ÷ 1), and Samosas (₹150 ÷ 5). Only actual consumers pay for each item.',
    tip: 'Use "Load Tea, Coffee & Samosas Example" on the Add Expense screen to test it in one click.',
    targetRoute: '/add-expense' as AppRoute,
    cta: 'See Simplified Balances',
  },
  {
    title: 'Step 3: Understand Balances & Confirm UPI Settlements',
    description:
      'Balances uses greedy min-cash-flow simplification to reduce transfers. Generate a UPI QR, pay in GPay/PhonePe, and let the recipient confirm receipt.',
    tip: 'You can replay this tour anytime from Profile & Settings or ask the AI Help Assistant below.',
    targetRoute: '/balances' as AppRoute,
    cta: 'Finish Tour',
  },
];

export const OnboardingTour: React.FC<OnboardingTourProps> = ({ onClose, onNavigate }) => {
  const [stepIdx, setStepIdx] = useState(0);
  const step = STEPS[stepIdx];

  const handleNext = () => {
    if (stepIdx < STEPS.length - 1) {
      const nextStep = STEPS[stepIdx + 1];
      onNavigate(nextStep.targetRoute);
      setStepIdx(stepIdx + 1);
    } else {
      onNavigate('/dashboard');
      onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/45 flex items-end sm:items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Interactive SettleUp Onboarding Tour"
    >
      <div className="bg-white border border-slate-200 rounded-2xl max-w-md w-full p-6 shadow-xl space-y-4">
        <div className="flex items-center justify-between">
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#065F46]">
            <MousePointerClick className="w-4 h-4" />
            <span>
              Guided Tour · Step {stepIdx + 1} of {STEPS.length}
            </span>
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Skip tour"
            className="text-slate-400 hover:text-slate-700 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Step indicator bar */}
        <div className="grid grid-cols-4 gap-1.5">
          {STEPS.map((s, i) => (
            <div
              key={s.title}
              className={`h-1.5 rounded-full transition-colors ${
                i <= stepIdx ? 'bg-[#065F46]' : 'bg-slate-200'
              }`}
            />
          ))}
        </div>

        <h2 className="font-display text-lg font-bold text-slate-900">{step.title}</h2>
        <p className="text-sm text-slate-600 leading-relaxed">{step.description}</p>
        <div className="p-3 rounded-lg bg-[#F8FAFC] border border-slate-200 text-xs text-slate-700">
          {step.tip}
        </div>

        <div className="flex items-center justify-between pt-2">
          <button
            type="button"
            onClick={onClose}
            className="text-xs font-medium text-slate-500 hover:text-slate-800 cursor-pointer"
          >
            Skip tour
          </button>

          <button
            type="button"
            onClick={handleNext}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-white bg-[#065F46] hover:bg-[#047857] rounded-lg cursor-pointer"
          >
            <span>{step.cta}</span>
            {stepIdx < STEPS.length - 1 ? <ArrowRight className="w-4 h-4" /> : <Check className="w-4 h-4" />}
          </button>
        </div>
      </div>
    </div>
  );
};
