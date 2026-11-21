import React, { useEffect, useState } from 'react';
import { Edit3, Plus, Receipt, Search, Trash2, X } from 'lucide-react';
import { apiRequest } from '../../services/api.ts';
import { formatINR } from '../../utils/currency.ts';
import type { AppRoute, ExpenseRecord, GroupSummary } from '../../types/index.ts';

interface ExpensesHistoryViewProps {
  initialExpenseId?: number | null;
  onNavigate: (route: AppRoute, params?: { editExpenseId?: number }) => void;
  onToast: (msg: string, tone?: 'success' | 'error') => void;
}

interface ExpenseDetailPayload {
  expense: ExpenseRecord;
  splits: Array<{
    user_id: number;
    full_name: string;
    owed_paise: number;
    item_subtotal_paise: number;
    shared_charges_paise: number;
  }>;
  items: Array<{
    id: number;
    name: string;
    unit_price_paise: number;
    quantity: number;
    total_paise: number;
    consumers: Array<{ user_id: number; full_name: string }>;
  }>;
  canEdit: boolean;
  canDelete: boolean;
}

export const ExpensesHistoryView: React.FC<ExpensesHistoryViewProps> = ({
  initialExpenseId,
  onNavigate,
  onToast,
}) => {
  const [expenses, setExpenses] = useState<ExpenseRecord[]>([]);
  const [groups, setGroups] = useState<GroupSummary[]>([]);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState('');
  const [groupId, setGroupId] = useState('');
  const [category, setCategory] = useState('All');
  const [sort, setSort] = useState('newest');

  const [detail, setDetail] = useState<ExpenseDetailPayload | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);

  const fetchExpenses = () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (groupId) params.set('groupId', groupId);
    if (category !== 'All') params.set('category', category);
    if (search.trim()) params.set('search', search.trim());
    params.set('sort', sort);

    apiRequest<{ expenses: ExpenseRecord[] }>(`/api/expenses?${params.toString()}`)
      .then((res) => setExpenses(res.expenses))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    apiRequest<{ groups: GroupSummary[] }>('/api/groups').then((res) => setGroups(res.groups));
  }, []);

  useEffect(() => {
    fetchExpenses();
  }, [groupId, category, sort]);

  useEffect(() => {
    if (initialExpenseId) {
      openDetail(initialExpenseId);
    }
  }, [initialExpenseId]);

  const openDetail = async (id: number) => {
    try {
      const data = await apiRequest<ExpenseDetailPayload>(`/api/expenses/${id}`);
      setDetail(data);
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Unable to load expense details', 'error');
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await apiRequest(`/api/expenses/${id}`, { method: 'DELETE' });
      setConfirmDeleteId(null);
      setDetail(null);
      onToast('Expense deleted and group balances updated.', 'success');
      fetchExpenses();
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Unable to delete expense', 'error');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900">Expense History</h1>
          <p className="text-sm text-slate-600 mt-0.5">
            Search, inspect itemised breakdowns, edit, or audit every shared bill.
          </p>
        </div>
        <button
          type="button"
          onClick={() => onNavigate('/add-expense')}
          className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-[#065F46] hover:bg-[#047857] rounded-lg cursor-pointer self-start"
        >
          <Plus className="w-4 h-4" />
          <span>Add Expense</span>
        </button>
      </div>

      {/* Filters */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            fetchExpenses();
          }}
          className="relative"
        >
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search title or payer..."
            className="w-full pl-9 pr-3 py-2 text-sm border border-slate-300 rounded-lg"
          />
        </form>

        <select
          value={groupId}
          onChange={(e) => setGroupId(e.target.value)}
          className="px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
        >
          <option value="">All Groups</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>

        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
        >
          {['All', 'Food', 'Travel', 'Groceries', 'Accommodation', 'Utilities', 'Shopping', 'Entertainment', 'Transportation', 'Other'].map(
            (c) => (
              <option key={c} value={c}>
                {c === 'All' ? 'All Categories' : c}
              </option>
            )
          )}
        </select>

        <select
          value={sort}
          onChange={(e) => setSort(e.target.value)}
          className="px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
        >
          <option value="newest">Newest First</option>
          <option value="oldest">Oldest First</option>
          <option value="highest">Highest Amount</option>
          <option value="lowest">Lowest Amount</option>
        </select>
      </div>

      {/* Expense Ledger Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-sm text-slate-500">Loading expense ledger...</div>
        ) : expenses.length === 0 ? (
          <div className="p-12 text-center space-y-2">
            <Receipt className="w-8 h-8 text-slate-400 mx-auto" />
            <p className="font-semibold text-slate-900">No matching expenses</p>
            <p className="text-sm text-slate-500">Adjust your filters or add a new shared expense.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-left text-xs font-semibold text-slate-600">
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Expense</th>
                  <th className="px-4 py-3">Group</th>
                  <th className="px-4 py-3">Paid By</th>
                  <th className="px-4 py-3">Split</th>
                  <th className="px-4 py-3 text-right">Total</th>
                  <th className="px-4 py-3 text-right">Your Share</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {expenses.map((exp) => (
                  <tr
                    key={exp.id}
                    onClick={() => openDetail(exp.id)}
                    className="h-12 hover:bg-slate-50 cursor-pointer transition-colors"
                  >
                    <td className="px-4 py-2.5 font-mono-num text-xs text-slate-500 whitespace-nowrap">
                      {exp.expense_date}
                    </td>
                    <td className="px-4 py-2.5">
                      <p className="font-semibold text-slate-900">{exp.title}</p>
                      <p className="text-xs text-slate-500">{exp.category}</p>
                    </td>
                    <td className="px-4 py-2.5 text-slate-700">{exp.group_name}</td>
                    <td className="px-4 py-2.5 text-slate-700">{exp.payer_name}</td>
                    <td className="px-4 py-2.5 text-xs text-slate-500 capitalize">
                      {exp.split_method} · {exp.participantCount} people
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono-num font-semibold text-slate-900">
                      {formatINR(exp.total_paise)}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono-num text-slate-700">
                      {formatINR(exp.myOwedPaise ?? 0)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Expense Detail Modal */}
      {detail && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto p-6 space-y-5">
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 pb-4">
              <div>
                <p className="text-xs text-[#065F46] font-medium">
                  {detail.expense.group_name} · {detail.expense.category} · {detail.expense.expense_date}
                </p>
                <h2 className="font-display text-xl font-bold text-slate-900 mt-1">{detail.expense.title}</h2>
                {detail.expense.description && (
                  <p className="text-sm text-slate-600 mt-1">{detail.expense.description}</p>
                )}
              </div>
              <button
                type="button"
                onClick={() => setDetail(null)}
                aria-label="Close detail"
                className="text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs bg-[#F8FAFC] border border-slate-200 rounded-xl p-4">
              <div>
                <span className="text-slate-500 block">Total Amount</span>
                <span className="font-mono-num text-base font-bold text-slate-900">
                  {formatINR(detail.expense.total_paise)}
                </span>
              </div>
              <div>
                <span className="text-slate-500 block">Paid By</span>
                <span className="font-semibold text-slate-900">{detail.expense.payer_name}</span>
              </div>
              <div>
                <span className="text-slate-500 block">Logged By</span>
                <span className="font-semibold text-slate-900">{detail.expense.creator_name}</span>
              </div>
              <div>
                <span className="text-slate-500 block">Split Method</span>
                <span className="font-semibold text-slate-900 capitalize">{detail.expense.split_method}</span>
              </div>
            </div>

            {detail.items.length > 0 && (
              <div className="space-y-2">
                <h3 className="font-display text-sm font-bold text-slate-900">Itemised Bill Lines</h3>
                <div className="border border-slate-200 rounded-xl divide-y divide-slate-100">
                  {detail.items.map((item) => (
                    <div key={item.id} className="p-3 flex items-center justify-between gap-4 text-sm">
                      <div>
                        <p className="font-medium text-slate-900">
                          {item.name} × {item.quantity}
                        </p>
                        <p className="text-xs text-slate-500 mt-0.5">
                          Consumed by: {item.consumers.map((c) => c.full_name).join(', ')}
                        </p>
                      </div>
                      <span className="font-mono-num font-semibold text-slate-900">
                        {formatINR(item.total_paise)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {(detail.expense.tax_paise || detail.expense.tip_paise || detail.expense.discount_paise) ? (
              <div className="text-xs text-slate-600 flex flex-wrap gap-4">
                <span>Tax: {formatINR(detail.expense.tax_paise || 0)}</span>
                <span>Tip: {formatINR(detail.expense.tip_paise || 0)}</span>
                <span>Discount: −{formatINR(detail.expense.discount_paise || 0)}</span>
              </div>
            ) : null}

            <div className="space-y-2">
              <h3 className="font-display text-sm font-bold text-slate-900">Participant Shares</h3>
              <div className="border border-slate-200 rounded-xl divide-y divide-slate-100">
                {detail.splits.map((s) => (
                  <div key={s.user_id} className="px-4 py-2.5 flex items-center justify-between text-sm">
                    <span className="text-slate-800">{s.full_name}</span>
                    <span className="font-mono-num font-semibold text-slate-900">
                      {formatINR(s.owed_paise)}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {detail.expense.receipt_data_url && (
              <div className="space-y-2">
                <h3 className="font-display text-sm font-bold text-slate-900">Supporting Receipt</h3>
                <img
                  src={detail.expense.receipt_data_url}
                  alt="Expense receipt"
                  className="max-h-60 rounded-lg border border-slate-200"
                />
              </div>
            )}

            {detail.canEdit && (
              <div className="pt-4 border-t border-slate-200 flex items-center justify-between">
                {detail.canDelete && confirmDeleteId === detail.expense.id ? (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-red-700 font-medium">Confirm delete this expense?</span>
                    <button
                      type="button"
                      onClick={() => handleDelete(detail.expense.id)}
                      className="px-3 py-1.5 text-xs font-semibold bg-red-600 text-white rounded-md cursor-pointer"
                    >
                      Yes, Delete
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteId(null)}
                      className="px-3 py-1.5 text-xs text-slate-600 border border-slate-300 rounded-md cursor-pointer"
                    >
                      Cancel
                    </button>
                  </div>
                ) : detail.canDelete ? (
                  <button
                    type="button"
                    onClick={() => setConfirmDeleteId(detail.expense.id)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50 rounded-lg cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" /> Delete Expense
                  </button>
                ) : <span className="text-xs text-slate-500">Only the creator or a group admin can delete this expense.</span>}

                <button
                  type="button"
                  onClick={() => {
                    const id = detail.expense.id;
                    setDetail(null);
                    onNavigate('/add-expense', { editExpenseId: id });
                  }}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#065F46] hover:bg-[#047857] rounded-lg cursor-pointer"
                >
                  <Edit3 className="w-3.5 h-3.5" /> Edit Expense
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
