import React, { useState } from 'react';
import { ArrowLeft, Search, ShieldAlert, Clock, FileQuestion } from 'lucide-react';
import { BrandMark } from '../common/BrandMark.tsx';
import type { AppRoute } from '../../types/index.ts';

const HELP_ARTICLES = [
  {
    category: 'Expenses & Splitting',
    title: 'How Item-Wise Splitting Works (Tea, Coffee & Samosas)',
    body: 'Choose "Item-wise" when logging an expense. Enter each item with its price and quantity, then select only the group members who consumed that item. SettleUp converts everything to integer paise, divides each item among its consumers, and distributes tax, tips, or discounts proportionally using the Largest-Remainder method.',
  },
  {
    category: 'Balances & Debt Simplification',
    title: 'How Net Balance & Simplified Transfers Are Calculated',
    body: 'Your Net Balance equals (Total Paid by You) − (Your Total Splits Owed) + (Confirmed Settlements Paid) − (Confirmed Settlements Received). SettleUp pairs the highest creditor with the highest debtor iteratively so a group of N friends settles in at most N − 1 transfers.',
  },
  {
    category: 'Payments & UPI QR',
    title: 'Why Scanning a UPI QR Doesn’t Auto-Settle an Expense',
    body: 'SettleUp is an accounting ledger, not a banking payment processor. After paying through Google Pay, PhonePe, or Paytm via the generated UPI QR, submit your 12-digit UTR reference. The balance adjusts officially once the recipient clicks "Confirm Receipt".',
  },
  {
    category: 'Trip Ledger',
    title: 'How to Track an Itemised Trip Without Inviting Everyone',
    body: 'Create a Trip Ledger and SettleUp adds Person A and Person B automatically. Rename them, add more participants whenever needed, enter each bill item and price, select who consumed it, and choose who paid. The ledger calculates each person’s actual share and suggests who owes whom. Adding a participant later does not change earlier bills.',
  },
  {
    category: 'Groups & Invitations',
    title: 'Sharing Group Invite Links & QR Codes Safely',
    body: 'Open any Group Workspace -> Members & Invites to generate an expiring invite token and scannable QR code. Invitees can open the link in read-only Guest View to see group expenses, balances, analytics, and settlement history without registering. To join and make changes, they must sign in or create an account and accept the invitation. Group admins can revoke tokens anytime.',
  },
];

export const HelpCentrePage: React.FC<{ onNavigate: (route: AppRoute) => void }> = ({ onNavigate }) => {
  const [query, setQuery] = useState('');
  const filtered = HELP_ARTICLES.filter(
    (a) =>
      a.title.toLowerCase().includes(query.toLowerCase()) ||
      a.body.toLowerCase().includes(query.toLowerCase()) ||
      a.category.toLowerCase().includes(query.toLowerCase())
  );

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-[#0F172A]">
      <header className="bg-white border-b border-slate-200 px-6 h-16 flex items-center justify-between">
        <button
          type="button"
          onClick={() => onNavigate('/')}
          className="flex items-center gap-2 font-display font-bold text-slate-900 cursor-pointer"
        >
          <BrandMark size={26} />
          <span>SettleUp Help Centre</span>
        </button>
        <button
          type="button"
          onClick={() => onNavigate('/')}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-900 cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back</span>
        </button>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-12 space-y-8">
        <div>
          <h1 className="font-display text-3xl font-bold text-slate-900">How can we help?</h1>
          <p className="text-slate-600 mt-1">
            Clear documentation on SettleUp’s integer-paise splitting engine, debt simplification, and UPI workflows.
          </p>
          <div className="relative mt-5">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search topics (item-wise, UPI QR, debt simplification, invites)..."
              className="w-full pl-10 pr-4 py-2.5 text-sm bg-white border border-slate-300 rounded-lg focus:border-[#065F46] focus:outline-none"
            />
          </div>
        </div>

        <div className="space-y-4">
          {filtered.map((art) => (
            <article key={art.title} className="bg-white border border-slate-200 rounded-xl p-6">
              <p className="text-xs font-medium text-[#065F46] mb-1">{art.category}</p>
              <h2 className="font-display text-lg font-bold text-slate-900">{art.title}</h2>
              <p className="text-sm text-slate-600 mt-2 leading-relaxed">{art.body}</p>
            </article>
          ))}
        </div>
      </main>
    </div>
  );
};

export const LegalPage: React.FC<{
  mode: 'privacy' | 'terms';
  onNavigate: (route: AppRoute) => void;
}> = ({ mode, onNavigate }) => (
  <div className="min-h-screen bg-[#F8FAFC] text-[#0F172A]">
    <header className="bg-white border-b border-slate-200 px-6 h-16 flex items-center justify-between">
      <button
        type="button"
        onClick={() => onNavigate('/')}
        className="flex items-center gap-2 font-display font-bold text-slate-900 cursor-pointer"
      >
        <BrandMark size={26} />
        <span>SettleUp</span>
      </button>
      <button
        type="button"
        onClick={() => onNavigate('/')}
        className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-900 cursor-pointer"
      >
        <ArrowLeft className="w-4 h-4" />
        <span>Back</span>
      </button>
    </header>

    <main className="max-w-3xl mx-auto px-6 py-12 bg-white border border-slate-200 rounded-xl my-8 space-y-5">
      <h1 className="font-display text-3xl font-bold text-slate-900">
        {mode === 'privacy' ? 'Privacy Policy' : 'Terms & Conditions'}
      </h1>
      <p className="text-xs text-slate-500">Effective Date: November 2026</p>

      {mode === 'privacy' ? (
        <div className="space-y-4 text-sm text-slate-600 leading-relaxed">
          <p>
            <strong>1. Data Isolation &amp; Group Access:</strong> SettleUp stores your name, email address, optional profile photo, optional UPI VPA, and group expense entries strictly to compute shared balances among members of groups you explicitly join.
          </p>
          <p>
            <strong>2. Password &amp; Session Security:</strong> Passwords are hashed using salted cryptographic <code className="font-mono-num text-xs bg-slate-100 px-1 py-0.5 rounded">scrypt</code> digests and never stored in plain text. Sessions are managed via HTTP-only cookies; session tokens are not stored in browser local storage. Group invitation links provide time-limited, read-only access to the specifically invited group and can be revoked by a group admin.
          </p>
          <p>
            <strong>3. AI Help Assistant Privacy:</strong> Queries sent to the SettleUp AI Help Assistant are routed server-side and restricted to feature guidance without exposing private financial records of other users.
          </p>
        </div>
      ) : (
        <div className="space-y-4 text-sm text-slate-600 leading-relaxed">
          <p>
            <strong>1. Nature of Service:</strong> SettleUp is an expense tracking and shared bill calculation tool. It is not a bank, wallet provider, or regulated payment aggregator.
          </p>
          <p>
            <strong>2. Settlement Verification:</strong> UPI QR codes generated inside SettleUp facilitate external payments in user-installed UPI apps. A settlement becomes confirmed in the ledger only after manual confirmation by the recipient or group admin.
          </p>
          <p>
            <strong>3. Audit Trail Integrity:</strong> Deleting an expense or removing a member is safeguarded when unsettled financial balances exist so group ledgers remain mathematically consistent.
          </p>
        </div>
      )}
    </main>
  </div>
);

export const ErrorStatusPage: React.FC<{
  code: '403' | '404' | 'expired';
  onNavigate: (route: AppRoute) => void;
}> = ({ code, onNavigate }) => {
  const config = {
    '403': {
      icon: ShieldAlert,
      title: '403 — Access Denied',
      desc: 'You do not have permission to view this group or financial record.',
      ctaLabel: 'Return to Dashboard',
      ctaRoute: '/dashboard' as AppRoute,
    },
    '404': {
      icon: FileQuestion,
      title: '404 — Page Not Found',
      desc: 'The page or group workspace you requested does not exist or has been moved.',
      ctaLabel: 'Go Home',
      ctaRoute: '/' as AppRoute,
    },
    expired: {
      icon: Clock,
      title: 'Session Expired',
      desc: 'For your financial security, your active session timed out. Please sign in again to continue.',
      ctaLabel: 'Sign In Again',
      ctaRoute: '/login' as AppRoute,
    },
  }[code];

  const Icon = config.icon;

  return (
    <div className="min-h-screen bg-[#F8FAFC] flex items-center justify-center px-6">
      <div className="max-w-md w-full bg-white border border-slate-200 rounded-2xl p-8 text-center space-y-4">
        <div className="w-12 h-12 rounded-xl bg-slate-100 text-slate-700 flex items-center justify-center mx-auto">
          <Icon className="w-6 h-6" />
        </div>
        <h1 className="font-display text-2xl font-bold text-slate-900">{config.title}</h1>
        <p className="text-sm text-slate-600 leading-relaxed">{config.desc}</p>
        <div className="pt-2 flex justify-center gap-3">
          <button
            type="button"
            onClick={() => onNavigate(config.ctaRoute)}
            className="px-5 py-2.5 text-sm font-semibold text-white bg-[#065F46] hover:bg-[#047857] rounded-lg cursor-pointer"
          >
            {config.ctaLabel}
          </button>
        </div>
      </div>
    </div>
  );
};
