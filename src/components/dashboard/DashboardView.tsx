import React, { useEffect, useState } from 'react';
import {
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  FolderPlus,
  PiggyBank,
  Plus,
  Receipt,
  Scale,
  Users,
} from 'lucide-react';
import { apiRequest } from '../../services/api.ts';
import { formatINR } from '../../utils/currency.ts';
import { CategoryDonutChart, MonthlyTrendChart, type CategoryPoint, type MonthlyPoint } from '../charts/FinancialCharts.tsx';
import type {
  ActivityRecord,
  AppRoute,
  AuthUser,
  ExpenseRecord,
  GroupSummary,
  PersonalSummaryPayload,
  SimplifiedTransfer,
} from '../../types/index.ts';

interface DashboardViewProps {
  user: AuthUser;
  onNavigate: (route: AppRoute, params?: { groupId?: number; expenseId?: number }) => void;
  onReplayOnboarding: () => void;
}

const AnimatedRupeeCounter: React.FC<{ targetPaise: number; className?: string }> = ({
  targetPaise,
  className = '',
}) => {
  const [displayPaise, setDisplayPaise] = useState(0);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setDisplayPaise(targetPaise);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const duration = 520;
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplayPaise(Math.round(targetPaise * eased));
      if (progress < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [targetPaise]);

  return <span className={`font-mono-num tabular-nums ${className}`}>{formatINR(displayPaise)}</span>;
};

export const DashboardView: React.FC<DashboardViewProps> = ({
  user,
  onNavigate,
  onReplayOnboarding,
}) => {
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState({
    totalIOwePaise: 0,
    totalOwedToMePaise: 0,
    netBalancePaise: 0,
    totalGroupExpenditurePaise: 0,
    myTotalContributionsPaise: 0,
    pendingSettlementsCount: 0,
  });
  const [groups, setGroups] = useState<GroupSummary[]>([]);
  const [recentExpenses, setRecentExpenses] = useState<ExpenseRecord[]>([]);
  const [transfers, setTransfers] = useState<SimplifiedTransfer[]>([]);
  const [activities, setActivities] = useState<ActivityRecord[]>([]);
  const [monthlyTrend, setMonthlyTrend] = useState<MonthlyPoint[]>([]);
  const [byCategory, setByCategory] = useState<CategoryPoint[]>([]);
  const [personalSummary, setPersonalSummary] = useState<PersonalSummaryPayload['summary'] | null>(null);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError('');
    Promise.all([
      apiRequest<{
        summary: typeof summary;
        suggestedTransfers: SimplifiedTransfer[];
      }>('/api/balances/overview'),
      apiRequest<{ groups: GroupSummary[] }>('/api/groups'),
      apiRequest<{ expenses: ExpenseRecord[] }>('/api/expenses'),
      apiRequest<{ monthlyTrend: MonthlyPoint[]; byCategory: CategoryPoint[] }>('/api/analytics/summary?days=180'),
      apiRequest<{ activities: ActivityRecord[] }>('/api/notifications'),
      apiRequest<PersonalSummaryPayload>('/api/personal/summary?period=monthly').catch(() => null),
    ])
      .then(([bal, grp, exp, ana, act, pers]) => {
        if (!active) return;
        setSummary(bal.summary);
        setTransfers(bal.suggestedTransfers.slice(0, 4));
        setGroups(grp.groups);
        setRecentExpenses(exp.expenses.slice(0, 6));
        setMonthlyTrend(ana.monthlyTrend);
        setByCategory(ana.byCategory);
        setActivities(act.activities.slice(0, 6));
        setPersonalSummary(pers?.summary ?? null);
      })
      .catch((err) => {
        if (!active) return;
        setLoadError(err instanceof Error ? err.message : 'Unable to load dashboard data.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  if (loadError) {
    return (
      <div className="bg-white border border-red-200 rounded-xl p-6 max-w-lg mx-auto my-8 text-center space-y-3">
        <p className="font-display font-bold text-slate-900">Unable to load your workspace</p>
        <p className="text-sm text-red-700">{loadError}</p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="px-4 py-2 text-sm font-semibold text-white bg-[#065F46] hover:bg-[#047857] rounded-lg cursor-pointer"
        >
          Retry
        </button>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="h-10 w-64 bg-slate-200 rounded-lg" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="h-28 bg-white border border-slate-200 rounded-xl" />
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="h-72 bg-white border border-slate-200 rounded-xl" />
          <div className="h-72 bg-white border border-slate-200 rounded-xl" />
        </div>
      </div>
    );
  }

  // Meaningful Empty State for freshly registered accounts
  if (groups.length === 0) {
    return (
      <div className="max-w-3xl mx-auto py-8 space-y-6">
        <div className="bg-white border border-slate-200 rounded-2xl p-8 text-center space-y-4">
          <div className="w-14 h-14 rounded-xl bg-emerald-50 text-[#065F46] flex items-center justify-center mx-auto">
            <Users className="w-7 h-7" />
          </div>
          <h1 className="font-display text-2xl font-bold text-slate-900">
            Welcome to SettleUp, {user.fullName.split(' ')[0]}
          </h1>
          <p className="text-sm text-slate-600 max-w-md mx-auto leading-relaxed">
            Your financial ledger starts clean. Create your first group for roommates, campus outings, or travel—or replay the interactive guided tour to see how item-wise splitting works.
          </p>
          <div className="pt-2 flex flex-wrap justify-center gap-3">
            <button
              type="button"
              onClick={() => onNavigate('/groups')}
              className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-white bg-[#065F46] hover:bg-[#047857] rounded-lg cursor-pointer"
            >
              <FolderPlus className="w-4 h-4" />
              <span>Create Your First Group</span>
            </button>
            <button
              type="button"
              onClick={onReplayOnboarding}
              className="px-4 py-2.5 text-sm font-medium text-slate-700 bg-white border border-slate-300 hover:border-slate-400 rounded-lg cursor-pointer"
            >
              Take Guided Tour
            </button>
            <button
              type="button"
              onClick={() => onNavigate('/personal')}
              className="px-4 py-2.5 text-sm font-medium text-[#065F46] bg-emerald-50 border border-emerald-200 rounded-lg cursor-pointer"
            >
              Open Personal Tracker
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header & Quick Actions */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900">
            Good day, {user.fullName.split(' ')[0]}
          </h1>
          <p className="text-sm text-slate-600 mt-0.5">
            Live balances and spending computed across {groups.length} active {groups.length === 1 ? 'group' : 'groups'}.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            id="tour-add-expense"
            onClick={() => onNavigate('/add-expense')}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-white bg-[#065F46] hover:bg-[#047857] rounded-lg cursor-pointer whitespace-nowrap"
          >
            <Plus className="w-4 h-4" />
            <span>Add Expense</span>
          </button>
          <button
            type="button"
            onClick={() => onNavigate('/groups')}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 hover:border-slate-400 rounded-lg cursor-pointer whitespace-nowrap"
          >
            <FolderPlus className="w-4 h-4" />
            <span>New Group</span>
          </button>
          <button
            type="button"
            onClick={() => onNavigate('/settlements')}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 hover:border-slate-400 rounded-lg cursor-pointer whitespace-nowrap"
          >
            <Scale className="w-4 h-4" />
            <span>Settle Up</span>
          </button>
        </div>
      </div>

      {/* 6 Financial KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4" id="tour-kpi-strip">
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>Net Balance</span>
            <span>Receivable − Payable</span>
          </div>
          <p
            className={`text-2xl font-bold mt-2 ${
              summary.netBalancePaise >= 0 ? 'text-[#065F46]' : 'text-[#B91C1C]'
            }`}
          >
            <AnimatedRupeeCounter targetPaise={summary.netBalancePaise} />
          </p>
          <p className="text-xs text-slate-500 mt-1">
            {summary.netBalancePaise > 0
              ? 'Overall you are owed money'
              : summary.netBalancePaise < 0
              ? 'Overall you owe friends'
              : 'All settled across groups'}
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>Others Owe You</span>
            <ArrowDownLeft className="w-4 h-4 text-[#059669]" />
          </div>
          <p className="text-2xl font-bold text-[#065F46] mt-2">
            <AnimatedRupeeCounter targetPaise={summary.totalOwedToMePaise} />
          </p>
          <p className="text-xs text-slate-500 mt-1">Confirmed receivables across groups</p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>You Owe Others</span>
            <ArrowUpRight className="w-4 h-4 text-[#B91C1C]" />
          </div>
          <p className="text-2xl font-bold text-[#B91C1C] mt-2">
            <AnimatedRupeeCounter targetPaise={summary.totalIOwePaise} />
          </p>
          <p className="text-xs text-slate-500 mt-1">Confirmed payables across groups</p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <p className="text-xs font-medium text-slate-500">Total Group Expenditure</p>
          <p className="text-2xl font-bold text-slate-900 mt-2">
            <AnimatedRupeeCounter targetPaise={summary.totalGroupExpenditurePaise} />
          </p>
          <p className="text-xs text-slate-500 mt-1">Combined bills logged in your groups</p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <p className="text-xs font-medium text-slate-500">My Total Contributions</p>
          <p className="text-2xl font-bold text-slate-900 mt-2">
            <AnimatedRupeeCounter targetPaise={summary.myTotalContributionsPaise} />
          </p>
          <p className="text-xs text-slate-500 mt-1">Expenses you paid upfront</p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>Pending Settlements</span>
            <button
              type="button"
              onClick={() => onNavigate('/settlements')}
              className="text-[#065F46] hover:underline cursor-pointer"
            >
              Review
            </button>
          </div>
          <p className="font-mono-num text-2xl font-bold text-slate-900 mt-2">
            {summary.pendingSettlementsCount}
          </p>
          <p className="text-xs text-slate-500 mt-1">Awaiting payment or confirmation</p>
        </div>
      </div>

      {/* Separated Personal Finance Snapshot */}
      {personalSummary && (
        <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-lg bg-emerald-50 text-[#065F46] flex items-center justify-center shrink-0">
              <PiggyBank className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-display text-sm font-bold text-slate-900">
                Personal Expense Tracker (This Month)
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Kept separate from shared group ledgers to prevent double-counting.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-6 text-xs">
            <div>
              <span className="text-slate-500 block">Personal Income</span>
              <span className="font-mono-num font-bold text-[#065F46] text-sm">
                {formatINR(personalSummary.totalIncomePaise)}
              </span>
            </div>
            <div>
              <span className="text-slate-500 block">Personal Expenses</span>
              <span className="font-mono-num font-bold text-slate-900 text-sm">
                {formatINR(personalSummary.totalExpensePaise)}
              </span>
            </div>
            <div>
              <span className="text-slate-500 block">Remaining</span>
              <span className="font-mono-num font-bold text-slate-900 text-sm">
                {formatINR(personalSummary.remainingBalancePaise)}
              </span>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('/personal')}
              className="px-3.5 py-2 text-xs font-semibold text-white bg-[#065F46] hover:bg-[#047857] rounded-lg cursor-pointer"
            >
              Open Personal Tracker
            </button>
          </div>
        </div>
      )}

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="font-display text-base font-bold text-slate-900">Monthly Expenditure Trend</h2>
              <p className="text-xs text-slate-500">Group bills vs your personal share (last 6 months)</p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('/analytics')}
              className="text-xs font-semibold text-[#065F46] hover:underline cursor-pointer"
            >
              Full Analytics
            </button>
          </div>
          <MonthlyTrendChart data={monthlyTrend} />
        </div>

        <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-6">
          <div className="mb-4">
            <h2 className="font-display text-base font-bold text-slate-900">Category Breakdown</h2>
            <p className="text-xs text-slate-500">Where your shared groups spend most</p>
          </div>
          <CategoryDonutChart data={byCategory} />
        </div>
      </div>

      {/* Groups + Suggested Settlements */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-display text-base font-bold text-slate-900">My Groups</h2>
            <button
              type="button"
              onClick={() => onNavigate('/groups')}
              className="text-xs font-semibold text-[#065F46] hover:underline cursor-pointer"
            >
              View All
            </button>
          </div>

          <div className="divide-y divide-slate-100">
            {groups.slice(0, 4).map((g) => (
              <div
                key={g.id}
                onClick={() => onNavigate('/groups', { groupId: g.id })}
                className="py-3.5 flex items-center justify-between gap-4 hover:bg-slate-50 -mx-2 px-2 rounded-lg cursor-pointer transition-colors"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div
                    className="w-10 h-10 rounded-lg text-white font-display font-bold text-sm flex items-center justify-center shrink-0"
                    style={{ backgroundColor: g.coverColor }}
                  >
                    {g.name.slice(0, 2).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <p className="font-semibold text-sm text-slate-900 truncate">{g.name}</p>
                    <p className="text-xs text-slate-500">
                      {g.category} · {g.memberCount} members · {g.expenseCount} expenses
                    </p>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <p
                    className={`font-mono-num text-sm font-semibold ${
                      g.myNetBalancePaise > 0
                        ? 'text-[#065F46]'
                        : g.myNetBalancePaise < 0
                        ? 'text-[#B91C1C]'
                        : 'text-slate-500'
                    }`}
                  >
                    {g.myNetBalancePaise > 0
                      ? `+${formatINR(g.myNetBalancePaise)}`
                      : formatINR(g.myNetBalancePaise)}
                  </p>
                  <p className="text-[11px] text-slate-500">
                    {g.myNetBalancePaise > 0 ? 'owed to you' : g.myNetBalancePaise < 0 ? 'you owe' : 'settled'}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-display text-base font-bold text-slate-900">Suggested Settlements</h2>
            <button
              type="button"
              onClick={() => onNavigate('/balances')}
              className="text-xs font-semibold text-[#065F46] hover:underline cursor-pointer"
            >
              Who Owes Whom
            </button>
          </div>

          {transfers.length === 0 ? (
            <p className="text-sm text-slate-500 py-6 text-center">
              All your group balances are settled.
            </p>
          ) : (
            <div className="space-y-3">
              {transfers.map((t, idx) => (
                <div
                  key={`${t.groupId}-${t.fromUserId}-${t.toUserId}-${idx}`}
                  className="border border-slate-200 rounded-lg p-3.5 flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <p className="text-xs text-slate-500 truncate">{t.groupName}</p>
                    <p className="text-sm font-medium text-slate-900 mt-0.5">
                      {t.fromUserId === user.id ? 'You' : t.fromName}{' '}
                      <ArrowRight className="w-3.5 h-3.5 inline text-slate-400" />{' '}
                      {t.toUserId === user.id ? 'You' : t.toName}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="font-mono-num text-sm font-bold text-slate-900">
                      {formatINR(t.amountPaise)}
                    </p>
                    <button
                      type="button"
                      onClick={() => onNavigate('/settlements')}
                      className="text-xs font-semibold text-[#065F46] hover:underline cursor-pointer"
                    >
                      Settle
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Recent Transactions & Recent Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-display text-base font-bold text-slate-900">Recent Transactions</h2>
            <button
              type="button"
              onClick={() => onNavigate('/expenses')}
              className="text-xs font-semibold text-[#065F46] hover:underline cursor-pointer"
            >
              All Expenses
            </button>
          </div>
          <div className="divide-y divide-slate-100">
            {recentExpenses.map((exp) => (
              <div
                key={exp.id}
                onClick={() => onNavigate('/expenses', { expenseId: exp.id })}
                className="py-3 flex items-center justify-between gap-3 hover:bg-slate-50 -mx-2 px-2 rounded-lg cursor-pointer transition-colors"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-9 h-9 rounded-lg bg-slate-100 text-slate-700 flex items-center justify-center shrink-0">
                    <Receipt className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-900 truncate">{exp.title}</p>
                    <p className="text-xs text-slate-500 truncate">
                      {exp.group_name} · Paid by {exp.payer_name} · {exp.expense_date}
                    </p>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <p className="font-mono-num text-sm font-semibold text-slate-900">
                    {formatINR(exp.total_paise)}
                  </p>
                  <p className="text-[11px] text-slate-500">
                    Your share {formatINR(exp.myOwedPaise ?? 0)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-display text-base font-bold text-slate-900">Recent Activity</h2>
            <button
              type="button"
              onClick={() => onNavigate('/notifications')}
              className="text-xs font-semibold text-[#065F46] hover:underline cursor-pointer"
            >
              Activity Log
            </button>
          </div>
          <div className="space-y-3.5">
            {activities.map((act) => (
              <div key={act.id} className="text-sm border-b border-slate-100 pb-3 last:border-0 last:pb-0">
                <p className="text-slate-800">{act.summary}</p>
                <p className="text-xs text-slate-500 mt-0.5">
                  {act.group_name ? `${act.group_name} · ` : ''}
                  {new Date(act.created_at + 'Z').toLocaleDateString('en-IN', {
                    month: 'short',
                    day: 'numeric',
                  })}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
