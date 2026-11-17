import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  Calendar,
  Download,
  Pencil,
  PiggyBank,
  Plus,
  Target,
  Trash2,
  Wallet,
  X,
} from 'lucide-react';
import { apiRequest, downloadAuthenticatedCsv } from '../../services/api.ts';
import { formatINR, rupeesToPaise } from '../../utils/currency.ts';
import type { PersonalSummaryPayload, PersonalTransaction } from '../../types/index.ts';

interface PersonalTrackerViewProps {
  onToast: (msg: string, tone?: 'success' | 'error') => void;
}

const CHART_COLORS = ['#065F46', '#0F172A', '#059669', '#D97706', '#0D9488', '#475569', '#B45309', '#334155'];

function todayYmd(): string {
  return new Date().toISOString().slice(0, 10);
}

export const PersonalTrackerView: React.FC<PersonalTrackerViewProps> = ({ onToast }) => {
  const [period, setPeriod] = useState<'daily' | 'weekly' | 'monthly' | 'custom'>('monthly');
  const [anchorDate, setAnchorDate] = useState<string>(todayYmd());
  const [startDate, setStartDate] = useState<string>(() => {
    const d = new Date();
    d.setDate(1);
    return d.toISOString().slice(0, 10);
  });
  const [endDate, setEndDate] = useState<string>(todayYmd());
  const [selectedCategoryFilter, setSelectedCategoryFilter] = useState<string>('');

  const [data, setData] = useState<PersonalSummaryPayload | null>(null);
  const [loading, setLoading] = useState(true);

  // Add/Edit Transaction modal
  const [txModalOpen, setTxModalOpen] = useState(false);
  const [editingTx, setEditingTx] = useState<PersonalTransaction | null>(null);
  const [txType, setTxType] = useState<'expense' | 'income'>('expense');
  const [txTitle, setTxTitle] = useState('');
  const [txAmount, setTxAmount] = useState('');
  const [txCategory, setTxCategory] = useState('Food and groceries');
  const [txDate, setTxDate] = useState(todayYmd());
  const [txMethod, setTxMethod] = useState('UPI');
  const [txNotes, setTxNotes] = useState('');
  const [newCategoryName, setNewCategoryName] = useState('');
  const [addingCategory, setAddingCategory] = useState(false);
  const [savingTx, setSavingTx] = useState(false);

  // Budget form
  const [budgetModalOpen, setBudgetModalOpen] = useState(false);
  const [budgetScope, setBudgetScope] = useState<'overall' | 'category'>('overall');
  const [budgetCategory, setBudgetCategory] = useState('Food and groceries');
  const [budgetPeriod, setBudgetPeriod] = useState<'monthly' | 'weekly'>('monthly');
  const [budgetLimit, setBudgetLimit] = useState('');

  // Savings goal form
  const [goalModalOpen, setGoalModalOpen] = useState(false);
  const [goalTitle, setGoalTitle] = useState('');
  const [goalTarget, setGoalTarget] = useState('');
  const [goalSaved, setGoalSaved] = useState('');
  const [goalDate, setGoalDate] = useState('');

  const loadSummary = () => {
    setLoading(true);
    const params = new URLSearchParams({ period });
    if (period === 'custom') {
      params.set('startDate', startDate);
      params.set('endDate', endDate);
    } else {
      params.set('date', anchorDate);
    }
    if (selectedCategoryFilter) {
      params.set('category', selectedCategoryFilter);
    }
    apiRequest<PersonalSummaryPayload>(`/api/personal/summary?${params.toString()}`)
      .then((res) => setData(res))
      .catch((err) => onToast(err instanceof Error ? err.message : 'Unable to load personal tracker', 'error'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadSummary();
  }, [period, anchorDate, startDate, endDate, selectedCategoryFilter]);

  const openAddModal = (defaultType: 'expense' | 'income' = 'expense') => {
    setEditingTx(null);
    setTxType(defaultType);
    setTxTitle('');
    setTxAmount('');
    setTxCategory(
      defaultType === 'income'
        ? data?.categories.income[0] || 'Salary & stipend'
        : data?.categories.expense[0] || 'Food and groceries'
    );
    setTxDate(todayYmd());
    setTxMethod('UPI');
    setTxNotes('');
    setAddingCategory(false);
    setTxModalOpen(true);
  };

  const openEditModal = (tx: PersonalTransaction) => {
    setEditingTx(tx);
    setTxType(tx.type);
    setTxTitle(tx.title);
    setTxAmount((tx.amount_paise / 100).toFixed(2));
    setTxCategory(tx.category);
    setTxDate(tx.transaction_date);
    setTxMethod(tx.payment_method || 'UPI');
    setTxNotes(tx.notes || '');
    setAddingCategory(false);
    setTxModalOpen(true);
  };

  const handleSaveTx = async (e: React.FormEvent) => {
    e.preventDefault();
    const paise = rupeesToPaise(txAmount);
    if (paise <= 0) {
      onToast('Amount must be greater than ₹0.', 'error');
      return;
    }
    setSavingTx(true);
    try {
      const payload = {
        title: txTitle.trim(),
        amountPaise: paise,
        type: txType,
        category: txCategory,
        transactionDate: txDate,
        paymentMethod: txMethod,
        notes: txNotes.trim(),
      };
      if (editingTx) {
        await apiRequest(`/api/personal/transactions/${editingTx.id}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
        onToast('Personal transaction updated.', 'success');
      } else {
        await apiRequest('/api/personal/transactions', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        onToast(`Personal ${txType} saved.`, 'success');
      }
      setTxModalOpen(false);
      loadSummary();
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Unable to save transaction', 'error');
    } finally {
      setSavingTx(false);
    }
  };

  const handleDeleteTx = async (id: number) => {
    try {
      await apiRequest(`/api/personal/transactions/${id}`, { method: 'DELETE' });
      onToast('Transaction removed.', 'success');
      loadSummary();
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Unable to delete transaction', 'error');
    }
  };

  const handleCreateCustomCategory = async () => {
    if (newCategoryName.trim().length < 2) {
      onToast('Category name must be at least 2 characters.', 'error');
      return;
    }
    try {
      const res = await apiRequest<{ name: string }>('/api/personal/categories', {
        method: 'POST',
        body: JSON.stringify({ name: newCategoryName.trim(), type: txType }),
      });
      setTxCategory(res.name);
      setNewCategoryName('');
      setAddingCategory(false);
      onToast(`Custom category "${res.name}" created.`, 'success');
      loadSummary();
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Could not create category', 'error');
    }
  };

  const handleSaveBudget = async (e: React.FormEvent) => {
    e.preventDefault();
    const limitPaise = rupeesToPaise(budgetLimit);
    if (limitPaise <= 0) {
      onToast('Budget limit must be greater than ₹0.', 'error');
      return;
    }
    try {
      await apiRequest('/api/personal/budgets', {
        method: 'POST',
        body: JSON.stringify({
          scope: budgetScope,
          category: budgetScope === 'category' ? budgetCategory : '',
          period: budgetPeriod,
          limitPaise,
        }),
      });
      setBudgetModalOpen(false);
      setBudgetLimit('');
      onToast('Personal budget saved.', 'success');
      loadSummary();
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Unable to save budget', 'error');
    }
  };

  const handleCreateGoal = async (e: React.FormEvent) => {
    e.preventDefault();
    const targetPaise = rupeesToPaise(goalTarget);
    const savedPaise = goalSaved.trim() ? rupeesToPaise(goalSaved) : 0;
    if (targetPaise <= 0) {
      onToast('Target amount must be greater than ₹0.', 'error');
      return;
    }
    try {
      await apiRequest('/api/personal/goals', {
        method: 'POST',
        body: JSON.stringify({
          title: goalTitle.trim(),
          targetPaise,
          currentSavedPaise: savedPaise,
          targetDate: goalDate || undefined,
        }),
      });
      setGoalModalOpen(false);
      setGoalTitle('');
      setGoalTarget('');
      setGoalSaved('');
      setGoalDate('');
      onToast('Savings goal added.', 'success');
      loadSummary();
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Unable to save goal', 'error');
    }
  };

  const totalCategoryPaise = useMemo(
    () => (data?.categoryBreakdown ?? []).reduce((acc, c) => acc + c.totalPaise, 0),
    [data]
  );

  const availableCategories = useMemo(() => {
    if (!data) return [];
    return txType === 'income' ? data.categories.income : data.categories.expense;
  }, [data, txType]);

  const budgetAlerts = (data?.budgetStatuses ?? []).filter((b) => b.alertState !== 'ok');

  if (loading && !data) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="h-10 w-64 bg-slate-200 rounded-lg" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-28 bg-white border border-slate-200 rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  const summary = data?.summary;

  return (
    <div className="space-y-7">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900">Personal Expense Tracker</h1>
          <p className="text-sm text-slate-600 mt-0.5">
            Track individual income, daily expenses, optional budgets, and savings — kept strictly separate from shared group bills.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={() => openAddModal('income')}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-800 bg-white border border-slate-300 hover:border-slate-400 rounded-lg cursor-pointer"
          >
            <ArrowDownLeft className="w-3.5 h-3.5 text-[#065F46]" />
            <span>Add Income</span>
          </button>
          <button
            type="button"
            onClick={() => openAddModal('expense')}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#065F46] hover:bg-[#047857] rounded-lg cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add Personal Expense</span>
          </button>
          <button
            type="button"
            onClick={() =>
              downloadAuthenticatedCsv('/api/personal/export.csv', 'settleup-personal-tracker.csv').catch(() =>
                onToast('CSV export failed.', 'error')
              )
            }
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export CSV</span>
          </button>
        </div>
      </div>

      {/* Time Filter Bar */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg self-start">
          {(['daily', 'weekly', 'monthly', 'custom'] as const).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPeriod(p)}
              className={`px-3.5 py-1.5 text-xs font-semibold rounded-md capitalize cursor-pointer ${
                period === p ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {p}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-3 text-xs">
          {period === 'custom' ? (
            <>
              <label className="flex items-center gap-1.5 text-slate-600">
                <span>From</span>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="px-2.5 py-1.5 border border-slate-300 rounded-md font-mono-num"
                />
              </label>
              <label className="flex items-center gap-1.5 text-slate-600">
                <span>To</span>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="px-2.5 py-1.5 border border-slate-300 rounded-md font-mono-num"
                />
              </label>
            </>
          ) : (
            <label className="flex items-center gap-2 text-slate-600">
              <Calendar className="w-3.5 h-3.5 text-slate-400" />
              <span>{period === 'daily' ? 'Selected Day:' : period === 'weekly' ? 'Week Containing:' : 'Month Containing:'}</span>
              <input
                type="date"
                value={anchorDate}
                onChange={(e) => setAnchorDate(e.target.value)}
                className="px-2.5 py-1.5 border border-slate-300 rounded-md font-mono-num"
              />
            </label>
          )}
          {data?.range && (
            <span className="font-mono-num text-slate-500">
              Range: {data.range.start} → {data.range.end}
            </span>
          )}
        </div>
      </div>

      {/* Budget Alert Banner (if any budget >= 80%) */}
      {budgetAlerts.length > 0 && (
        <div className="space-y-2">
          {budgetAlerts.map((b) => (
            <div
              key={b.id}
              className={`p-3.5 rounded-xl border flex items-center justify-between gap-3 text-xs ${
                b.alertState === 'exceeded'
                  ? 'bg-red-50 border-red-200 text-red-900'
                  : 'bg-amber-50 border-amber-200 text-amber-900'
              }`}
            >
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>
                  <strong>
                    {b.scope === 'overall' ? 'Overall' : b.category} ({b.period}) budget:
                  </strong>{' '}
                  Spent {formatINR(b.spentPaise)} of {formatINR(b.limit_paise)} ({b.percentUsed}%).{' '}
                  {b.alertState === 'exceeded' ? 'Budget limit exceeded.' : 'Approaching your budget limit.'}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 5 Summary KPI Cards */}
      {summary && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          <div className="bg-white border border-slate-200 rounded-xl p-5">
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>Total Income</span>
              <ArrowDownLeft className="w-4 h-4 text-[#059669]" />
            </div>
            <p className="font-mono-num tabular-nums text-xl font-bold text-[#065F46] mt-2">
              {formatINR(summary.totalIncomePaise)}
            </p>
            <p className="text-[11px] text-slate-500 mt-1">Recorded personal inflows</p>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-5">
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>Total Expenses</span>
              <ArrowUpRight className="w-4 h-4 text-[#B91C1C]" />
            </div>
            <p className="font-mono-num tabular-nums text-xl font-bold text-slate-900 mt-2">
              {formatINR(summary.totalExpensePaise)}
            </p>
            <p className="text-[11px] text-slate-500 mt-1">Personal outflows in range</p>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-5">
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>Remaining Balance</span>
              <Wallet className="w-4 h-4 text-slate-400" />
            </div>
            <p
              className={`font-mono-num tabular-nums text-xl font-bold mt-2 ${
                summary.remainingBalancePaise >= 0 ? 'text-[#065F46]' : 'text-[#B91C1C]'
              }`}
            >
              {summary.remainingBalancePaise >= 0
                ? formatINR(summary.remainingBalancePaise)
                : `-${formatINR(Math.abs(summary.remainingBalancePaise))}`}
            </p>
            <p className="text-[11px] text-slate-500 mt-1">Income minus expenses</p>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-5">
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>Savings &amp; Rate</span>
              <PiggyBank className="w-4 h-4 text-[#065F46]" />
            </div>
            <p className="font-mono-num tabular-nums text-xl font-bold text-slate-900 mt-2">
              {summary.hasRecordedIncome ? formatINR(summary.savingsPaise) : '—'}
            </p>
            <p className="text-[11px] text-slate-500 mt-1">
              {summary.hasRecordedIncome
                ? `${summary.savingsPercent}% net savings rate`
                : 'Add income to calculate savings %'}
            </p>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-5">
            <p className="text-xs text-slate-500">Highest Spending Category</p>
            <p className="font-display text-base font-bold text-slate-900 mt-2 truncate">
              {summary.highestSpendingCategory ? summary.highestSpendingCategory.category : 'None'}
            </p>
            <p className="font-mono-num text-xs text-slate-600 mt-1">
              {summary.highestSpendingCategory ? formatINR(summary.highestSpendingCategory.totalPaise) : 'No expenses yet'}
            </p>
          </div>
        </div>
      )}

      {/* Charts Grid */}
      {data && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Interactive Category Pie / Donut Chart */}
          <div className="lg:col-span-6 bg-white border border-slate-200 rounded-xl p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-display text-base font-bold text-slate-900">Category Spending Breakdown</h2>
                <p className="text-xs text-slate-500">Click any category slice or row to filter transactions below</p>
              </div>
              {selectedCategoryFilter && (
                <button
                  type="button"
                  onClick={() => setSelectedCategoryFilter('')}
                  className="text-xs font-semibold text-[#065F46] hover:underline cursor-pointer"
                >
                  Clear filter
                </button>
              )}
            </div>

            {data.categoryBreakdown.length === 0 ? (
              <div className="h-52 flex items-center justify-center text-sm text-slate-500 border border-dashed border-slate-200 rounded-lg">
                No personal expenses recorded in this time window.
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-12 gap-4 items-center">
                <div className="sm:col-span-5 flex justify-center relative">
                  <svg width="176" height="176" viewBox="0 0 176 176" role="img" aria-label="Personal category breakdown">
                    <g transform="translate(88,88) rotate(-90)">
                      {(() => {
                        const r = 64;
                        const c = 2 * Math.PI * r;
                        let acc = 0;
                        return data.categoryBreakdown.map((item, idx) => {
                          const frac = totalCategoryPaise > 0 ? item.totalPaise / totalCategoryPaise : 0;
                          const dash = frac * c;
                          const offset = -acc * c;
                          acc += frac;
                          const active = selectedCategoryFilter === item.category;
                          return (
                            <circle
                              key={item.category}
                              r={r}
                              cx="0"
                              cy="0"
                              fill="transparent"
                              stroke={CHART_COLORS[idx % CHART_COLORS.length]}
                              strokeWidth={active ? 25 : 20}
                              strokeDasharray={`${Math.max(0, dash - 1.5)} ${c}`}
                              strokeDashoffset={offset}
                              onClick={() =>
                                setSelectedCategoryFilter(active ? '' : item.category)
                              }
                              className="transition-all cursor-pointer"
                            />
                          );
                        });
                      })()}
                    </g>
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none text-center px-4">
                    <span className="text-[11px] text-slate-500 truncate max-w-[96px]">
                      {selectedCategoryFilter || 'Total Spent'}
                    </span>
                    <span className="font-mono-num text-sm font-bold text-slate-900">
                      {formatINR(
                        selectedCategoryFilter
                          ? data.categoryBreakdown.find((c) => c.category === selectedCategoryFilter)?.totalPaise ?? 0
                          : totalCategoryPaise
                      )}
                    </span>
                  </div>
                </div>

                <div className="sm:col-span-7 space-y-1.5 max-h-52 overflow-y-auto pr-1">
                  {data.categoryBreakdown.map((c, idx) => {
                    const pct = totalCategoryPaise > 0 ? Math.round((c.totalPaise / totalCategoryPaise) * 100) : 0;
                    const active = selectedCategoryFilter === c.category;
                    return (
                      <button
                        key={c.category}
                        type="button"
                        onClick={() => setSelectedCategoryFilter(active ? '' : c.category)}
                        className={`w-full flex items-center justify-between text-xs py-1.5 px-2.5 rounded-md cursor-pointer transition-colors ${
                          active ? 'bg-emerald-50 ring-1 ring-[#065F46]' : 'hover:bg-slate-50'
                        }`}
                      >
                        <span className="flex items-center gap-2 min-w-0">
                          <span
                            className="w-2.5 h-2.5 rounded-sm shrink-0"
                            style={{ backgroundColor: CHART_COLORS[idx % CHART_COLORS.length] }}
                          />
                          <span className="font-medium text-slate-800 truncate">{c.category}</span>
                        </span>
                        <span className="font-mono-num flex items-center gap-2.5 shrink-0">
                          <span className="text-slate-500">{pct}%</span>
                          <span className="font-semibold text-slate-900">{formatINR(c.totalPaise)}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Income vs Expenses + Weekly Bar Chart */}
          <div className="lg:col-span-6 bg-white border border-slate-200 rounded-xl p-6 space-y-5">
            <div>
              <h2 className="font-display text-base font-bold text-slate-900">Income vs Expenses &amp; Weekly Spending</h2>
              <p className="text-xs text-slate-500">Cashflow comparison for selected range and Mon–Sun spending</p>
            </div>

            {summary && (
              <div className="space-y-2.5">
                {(() => {
                  const maxCashflow = Math.max(1, summary.totalIncomePaise, summary.totalExpensePaise);
                  return (
                    <>
                      <div className="space-y-1">
                        <div className="flex justify-between text-xs">
                          <span className="font-medium text-slate-700">Income</span>
                          <span className="font-mono-num font-semibold text-[#065F46]">
                            {formatINR(summary.totalIncomePaise)}
                          </span>
                        </div>
                        <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-[#065F46] rounded-full transition-all"
                            style={{ width: `${Math.round((summary.totalIncomePaise / maxCashflow) * 100)}%` }}
                          />
                        </div>
                      </div>
                      <div className="space-y-1">
                        <div className="flex justify-between text-xs">
                          <span className="font-medium text-slate-700">Expenses</span>
                          <span className="font-mono-num font-semibold text-slate-900">
                            {formatINR(summary.totalExpensePaise)}
                          </span>
                        </div>
                        <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-[#0F172A] rounded-full transition-all"
                            style={{ width: `${Math.round((summary.totalExpensePaise / maxCashflow) * 100)}%` }}
                          />
                        </div>
                      </div>
                    </>
                  );
                })()}
              </div>
            )}

            {/* Weekly Mon-Sun Bars */}
            <div className="pt-2 border-t border-slate-100">
              <p className="text-xs font-semibold text-slate-700 mb-3">Weekly Spending (Mon – Sun)</p>
              <div className="grid grid-cols-7 gap-2 items-end h-28">
                {(() => {
                  const maxDay = Math.max(1, ...data.weeklySpending.map((d) => d.totalPaise));
                  return data.weeklySpending.map((d) => {
                    const heightPct = d.totalPaise === 0 ? 4 : Math.max(10, Math.round((d.totalPaise / maxDay) * 100));
                    return (
                      <div key={d.date} className="flex flex-col items-center justify-end h-full gap-1">
                        <span className="font-mono-num text-[10px] text-slate-500">
                          {d.totalPaise > 0 ? `₹${Math.round(d.totalPaise / 100)}` : ''}
                        </span>
                        <div className="w-full flex-1 flex items-end">
                          <div
                            className={`w-full rounded-t ${d.totalPaise > 0 ? 'bg-[#065F46]' : 'bg-slate-200'}`}
                            style={{ height: `${heightPct}%` }}
                            title={`${d.dayLabel} (${d.date}): ${formatINR(d.totalPaise)}`}
                          />
                        </div>
                        <span className="text-[11px] font-medium text-slate-600">{d.dayLabel}</span>
                      </div>
                    );
                  });
                })()}
              </div>
            </div>
          </div>

          {/* Monthly Trend Comparison */}
          <div className="lg:col-span-6 bg-white border border-slate-200 rounded-xl p-6 space-y-4">
            <h2 className="font-display text-base font-bold text-slate-900">Monthly Income vs Expenses (Last 6 Months)</h2>
            {data.monthlySpending.length === 0 ? (
              <div className="h-44 flex items-center justify-center text-sm text-slate-500 border border-dashed border-slate-200 rounded-lg">
                Add personal transactions to see multi-month comparisons.
              </div>
            ) : (
              <div className="space-y-3">
                {(() => {
                  const maxMonth = Math.max(
                    1,
                    ...data.monthlySpending.map((m) => Math.max(m.income_paise, m.expense_paise))
                  );
                  return data.monthlySpending.map((m) => (
                    <div key={m.month} className="space-y-1.5">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-mono-num font-semibold text-slate-800">{m.month}</span>
                        <span className="font-mono-num text-slate-600">
                          In {formatINR(m.income_paise)} · Out {formatINR(m.expense_paise)}
                        </span>
                      </div>
                      <div className="space-y-1">
                        <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-[#065F46] rounded-full"
                            style={{ width: `${Math.round((m.income_paise / maxMonth) * 100)}%` }}
                          />
                        </div>
                        <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-[#0F172A] rounded-full"
                            style={{ width: `${Math.round((m.expense_paise / maxMonth) * 100)}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  ));
                })()}
              </div>
            )}
          </div>

          {/* Optional Budgets & Savings Goals */}
          <div className="lg:col-span-6 bg-white border border-slate-200 rounded-xl p-6 space-y-5">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-display text-base font-bold text-slate-900">Budgets &amp; Savings Goals (Optional)</h2>
                <p className="text-xs text-slate-500">Set weekly or monthly limits without restricting entries</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setBudgetModalOpen(true)}
                  className="px-2.5 py-1.5 text-xs font-semibold text-[#065F46] bg-emerald-50 border border-emerald-200 rounded-md cursor-pointer"
                >
                  + Budget
                </button>
                <button
                  type="button"
                  onClick={() => setGoalModalOpen(true)}
                  className="px-2.5 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md cursor-pointer"
                >
                  + Goal
                </button>
              </div>
            </div>

            {data.budgetStatuses.length === 0 && data.savingsGoals.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-500 border border-dashed border-slate-200 rounded-lg">
                No personal budgets or savings goals set yet. Add one above whenever you want spending alerts.
              </div>
            ) : (
              <div className="space-y-4">
                {data.budgetStatuses.map((b) => (
                  <div key={b.id} className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-slate-800">
                        {b.scope === 'overall' ? 'Overall' : b.category} · {b.period}
                      </span>
                      <div className="flex items-center gap-2 font-mono-num">
                        <span
                          className={
                            b.alertState === 'exceeded'
                              ? 'text-[#B91C1C] font-semibold'
                              : b.alertState === 'approaching'
                              ? 'text-amber-700 font-semibold'
                              : 'text-slate-700'
                          }
                        >
                          {formatINR(b.spentPaise)} / {formatINR(b.limit_paise)} ({b.percentUsed}%)
                        </span>
                        <button
                          type="button"
                          onClick={async () => {
                            await apiRequest(`/api/personal/budgets/${b.id}`, { method: 'DELETE' });
                            loadSummary();
                          }}
                          aria-label="Delete budget"
                          className="text-slate-400 hover:text-red-700 cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                    <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${
                          b.alertState === 'exceeded'
                            ? 'bg-[#B91C1C]'
                            : b.alertState === 'approaching'
                            ? 'bg-amber-500'
                            : 'bg-[#065F46]'
                        }`}
                        style={{ width: `${Math.min(100, b.percentUsed)}%` }}
                      />
                    </div>
                  </div>
                ))}

                {data.savingsGoals.map((g) => {
                  const pct = g.target_paise > 0 ? Math.min(100, Math.round((g.current_saved_paise / g.target_paise) * 100)) : 0;
                  return (
                    <div key={g.id} className="pt-2 border-t border-slate-100 space-y-1.5">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-semibold text-slate-800 flex items-center gap-1.5">
                          <Target className="w-3.5 h-3.5 text-[#065F46]" />
                          {g.title}
                        </span>
                        <div className="flex items-center gap-2 font-mono-num">
                          <span className="text-slate-700">
                            {formatINR(g.current_saved_paise)} / {formatINR(g.target_paise)} ({pct}%)
                          </span>
                          <button
                            type="button"
                            onClick={async () => {
                              await apiRequest(`/api/personal/goals/${g.id}`, {
                                method: 'PATCH',
                                body: JSON.stringify({ currentSavedPaise: g.current_saved_paise + 50000 }),
                              });
                              onToast('Added ₹500.00 toward savings goal.', 'success');
                              loadSummary();
                            }}
                            className="text-[11px] font-semibold text-[#065F46] hover:underline cursor-pointer"
                          >
                            +₹500
                          </button>
                          <button
                            type="button"
                            onClick={async () => {
                              await apiRequest(`/api/personal/goals/${g.id}`, { method: 'DELETE' });
                              loadSummary();
                            }}
                            aria-label="Delete savings goal"
                            className="text-slate-400 hover:text-red-700 cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                      <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                        <div className="h-full bg-[#059669] rounded-full" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Transactions Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-base font-bold text-slate-900">
              {selectedCategoryFilter ? `Transactions in "${selectedCategoryFilter}"` : 'Personal Transactions'}
            </h2>
            <p className="text-xs text-slate-500">
              {data?.transactions.length ?? 0} entries in selected date range
            </p>
          </div>
          {selectedCategoryFilter && (
            <button
              type="button"
              onClick={() => setSelectedCategoryFilter('')}
              className="px-3 py-1.5 text-xs font-semibold text-[#065F46] bg-emerald-50 border border-emerald-200 rounded-lg cursor-pointer"
            >
              Showing: {selectedCategoryFilter} × Clear
            </button>
          )}
        </div>

        {!data || data.transactions.length === 0 ? (
          <div className="p-10 text-center space-y-2">
            <p className="text-sm font-medium text-slate-800">No personal transactions found for this filter.</p>
            <p className="text-xs text-slate-500">Add an income or expense entry above to start tracking.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-left text-xs font-semibold text-slate-600">
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Title &amp; Notes</th>
                  <th className="px-4 py-3">Category</th>
                  <th className="px-4 py-3">Method</th>
                  <th className="px-4 py-3 text-right">Amount</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.transactions.map((tx) => (
                  <tr key={tx.id} className="h-12 hover:bg-slate-50/70">
                    <td className="px-4 py-2.5 font-mono-num text-xs text-slate-500 whitespace-nowrap">
                      {tx.transaction_date}
                    </td>
                    <td className="px-4 py-2.5">
                      <p className="font-medium text-slate-900">{tx.title}</p>
                      {tx.notes && <p className="text-xs text-slate-500 truncate max-w-xs">{tx.notes}</p>}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-slate-700">{tx.category}</td>
                    <td className="px-4 py-2.5 text-xs text-slate-500">{tx.payment_method || '—'}</td>
                    <td
                      className={`px-4 py-2.5 text-right font-mono-num tabular-nums font-semibold whitespace-nowrap ${
                        tx.type === 'income' ? 'text-[#065F46]' : 'text-slate-900'
                      }`}
                    >
                      {tx.type === 'income' ? `+${formatINR(tx.amount_paise)}` : `-${formatINR(tx.amount_paise)}`}
                    </td>
                    <td className="px-4 py-2.5 text-right whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => openEditModal(tx)}
                        aria-label="Edit transaction"
                        className="p-1.5 text-slate-500 hover:text-slate-900 cursor-pointer"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteTx(tx.id)}
                        aria-label="Delete transaction"
                        className="p-1.5 text-slate-500 hover:text-red-700 cursor-pointer ml-1"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add/Edit Transaction Modal */}
      {txModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-2xl max-w-lg w-full p-6 space-y-4 max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-lg font-bold text-slate-900">
                {editingTx ? 'Edit Personal Entry' : 'Add Personal Entry'}
              </h2>
              <button
                type="button"
                onClick={() => setTxModalOpen(false)}
                aria-label="Close modal"
                className="text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveTx} className="space-y-4">
              <div className="grid grid-cols-2 gap-1 p-1 bg-slate-100 rounded-lg text-xs font-semibold">
                <button
                  type="button"
                  onClick={() => {
                    setTxType('expense');
                    setTxCategory(data?.categories.expense[0] || 'Food and groceries');
                  }}
                  className={`py-2 rounded-md cursor-pointer ${
                    txType === 'expense' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
                  }`}
                >
                  Expense
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setTxType('income');
                    setTxCategory(data?.categories.income[0] || 'Salary & stipend');
                  }}
                  className={`py-2 rounded-md cursor-pointer ${
                    txType === 'income' ? 'bg-white text-[#065F46] shadow-xs' : 'text-slate-600'
                  }`}
                >
                  Income / Savings Inflow
                </button>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Title</label>
                <input
                  type="text"
                  value={txTitle}
                  onChange={(e) => setTxTitle(e.target.value)}
                  placeholder="Enter a short description"
                  required
                  className="w-full px-3.5 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Amount (₹ INR)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    value={txAmount}
                    onChange={(e) => setTxAmount(e.target.value)}
                    placeholder="0.00"
                    required
                    className="w-full px-3.5 py-2 text-sm font-mono-num border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Date</label>
                  <input
                    type="date"
                    value={txDate}
                    onChange={(e) => setTxDate(e.target.value)}
                    required
                    className="w-full px-3.5 py-2 text-sm font-mono-num border border-slate-300 rounded-lg"
                  />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-medium text-slate-700">Category</label>
                  <button
                    type="button"
                    onClick={() => setAddingCategory(!addingCategory)}
                    className="text-xs font-semibold text-[#065F46] hover:underline cursor-pointer"
                  >
                    {addingCategory ? 'Cancel custom category' : '+ Create Custom Category'}
                  </button>
                </div>
                {addingCategory ? (
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={newCategoryName}
                      onChange={(e) => setNewCategoryName(e.target.value)}
                      placeholder="Enter custom category name"
                      className="flex-1 px-3 py-2 text-sm border border-slate-300 rounded-lg"
                    />
                    <button
                      type="button"
                      onClick={handleCreateCustomCategory}
                      className="px-3.5 py-2 text-xs font-semibold text-white bg-[#065F46] rounded-lg cursor-pointer"
                    >
                      Add
                    </button>
                  </div>
                ) : (
                  <select
                    value={txCategory}
                    onChange={(e) => setTxCategory(e.target.value)}
                    className="w-full px-3.5 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                  >
                    {availableCategories.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Payment Method</label>
                  <select
                    value={txMethod}
                    onChange={(e) => setTxMethod(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="UPI">UPI</option>
                    <option value="Bank Transfer">Bank Transfer</option>
                    <option value="Debit / Credit Card">Card</option>
                    <option value="Cash">Cash</option>
                    <option value="Auto-Debit">Auto-Debit</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Notes (Optional)</label>
                  <input
                    type="text"
                    value={txNotes}
                    onChange={(e) => setTxNotes(e.target.value)}
                    placeholder="Optional note"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => setTxModalOpen(false)}
                  className="px-4 py-2 text-sm font-medium text-slate-700 border border-slate-300 rounded-lg cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingTx}
                  className="px-5 py-2 text-sm font-semibold text-white bg-[#065F46] hover:bg-[#047857] rounded-lg cursor-pointer"
                >
                  {savingTx ? 'Saving...' : editingTx ? 'Save Changes' : 'Save Entry'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Budget Modal */}
      {budgetModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-2xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-lg font-bold text-slate-900">Set Personal Budget</h2>
              <button type="button" onClick={() => setBudgetModalOpen(false)} className="text-slate-400 hover:text-slate-700 cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleSaveBudget} className="space-y-3.5">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Scope</label>
                  <select
                    value={budgetScope}
                    onChange={(e) => setBudgetScope(e.target.value as 'overall' | 'category')}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="overall">Overall Spending</option>
                    <option value="category">Specific Category</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Period</label>
                  <select
                    value={budgetPeriod}
                    onChange={(e) => setBudgetPeriod(e.target.value as 'monthly' | 'weekly')}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="monthly">Monthly</option>
                    <option value="weekly">Weekly</option>
                  </select>
                </div>
              </div>
              {budgetScope === 'category' && (
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Category</label>
                  <select
                    value={budgetCategory}
                    onChange={(e) => setBudgetCategory(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                  >
                    {(data?.categories.expense ?? []).map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Spending Limit (₹ INR)</label>
                <input
                  type="number"
                  step="1"
                  min="1"
                  value={budgetLimit}
                  onChange={(e) => setBudgetLimit(e.target.value)}
                  placeholder="Enter budget amount"
                  required
                  className="w-full px-3.5 py-2 text-sm font-mono-num border border-slate-300 rounded-lg"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setBudgetModalOpen(false)} className="px-4 py-2 text-sm border border-slate-300 rounded-lg cursor-pointer">
                  Cancel
                </button>
                <button type="submit" className="px-4 py-2 text-sm font-semibold text-white bg-[#065F46] rounded-lg cursor-pointer">
                  Save Budget
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Savings Goal Modal */}
      {goalModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-2xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-lg font-bold text-slate-900">Add Savings Goal</h2>
              <button type="button" onClick={() => setGoalModalOpen(false)} className="text-slate-400 hover:text-slate-700 cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleCreateGoal} className="space-y-3.5">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Goal Title</label>
                <input
                  type="text"
                  value={goalTitle}
                  onChange={(e) => setGoalTitle(e.target.value)}
                  placeholder="Enter savings goal name"
                  required
                  className="w-full px-3.5 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Target Amount (₹)</label>
                  <input
                    type="number"
                    min="1"
                    value={goalTarget}
                    onChange={(e) => setGoalTarget(e.target.value)}
                    placeholder="0.00"
                    required
                    className="w-full px-3.5 py-2 text-sm font-mono-num border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Already Saved (₹)</label>
                  <input
                    type="number"
                    min="0"
                    value={goalSaved}
                    onChange={(e) => setGoalSaved(e.target.value)}
                    placeholder="0.00"
                    className="w-full px-3.5 py-2 text-sm font-mono-num border border-slate-300 rounded-lg"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Target Date (Optional)</label>
                <input
                  type="date"
                  value={goalDate}
                  onChange={(e) => setGoalDate(e.target.value)}
                  className="w-full px-3.5 py-2 text-sm font-mono-num border border-slate-300 rounded-lg"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setGoalModalOpen(false)} className="px-4 py-2 text-sm border border-slate-300 rounded-lg cursor-pointer">
                  Cancel
                </button>
                <button type="submit" className="px-4 py-2 text-sm font-semibold text-white bg-[#065F46] rounded-lg cursor-pointer">
                  Save Goal
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
