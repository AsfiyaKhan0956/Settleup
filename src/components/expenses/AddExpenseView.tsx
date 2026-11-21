import React, { useEffect, useMemo, useState } from 'react';
import { Check, Loader2, Plus, Receipt, Sparkles, Trash2, Upload } from 'lucide-react';
import { apiRequest } from '../../services/api.ts';
import { formatINR, previewSplitCalculation, rupeesToPaise } from '../../utils/currency.ts';
import { todayLocalYmd } from '../../utils/date.ts';
import type { AuthUser, GroupSummary, MemberNetBalance, SplitMethod } from '../../types/index.ts';

interface AddExpenseViewProps {
  currentUser: AuthUser;
  initialGroupId?: number | null;
  editExpenseId?: number | null;
  onSaved: (groupId: number) => void;
  onCancel: () => void;
  onToast: (msg: string, tone?: 'success' | 'error') => void;
}

interface ItemRow {
  id: string;
  name: string;
  unitPriceStr: string;
  quantity: number | '';
  consumerUserIds: number[];
}

const EXPENSE_CATEGORIES = [
  'Food',
  'Travel',
  'Groceries',
  'Accommodation',
  'Utilities',
  'Shopping',
  'Entertainment',
  'Transportation',
  'Other',
];

export const AddExpenseView: React.FC<AddExpenseViewProps> = ({
  currentUser,
  initialGroupId,
  editExpenseId,
  onSaved,
  onCancel,
  onToast,
}) => {
  const [groups, setGroups] = useState<GroupSummary[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState<number | ''>(initialGroupId ?? '');
  const [members, setMembers] = useState<MemberNetBalance[]>([]);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [notes, setNotes] = useState('');
  const [category, setCategory] = useState('Food');
  const [expenseDate, setExpenseDate] = useState(todayLocalYmd());
  const [paidByUserId, setPaidByUserId] = useState<number>(currentUser.id);
  const [splitMethod, setSplitMethod] = useState<SplitMethod>('itemized');
  const [totalAmountStr, setTotalAmountStr] = useState('');
  const [receiptDataUrl, setReceiptDataUrl] = useState<string | null>(null);

  // Per-participant split inputs
  const [selectedParticipants, setSelectedParticipants] = useState<number[]>([]);
  const [exactMap, setExactMap] = useState<Record<number, string>>({});
  const [pctMap, setPctMap] = useState<Record<number, string>>({});
  const [sharesMap, setSharesMap] = useState<Record<number, string>>({});

  // Itemized split state
  const [items, setItems] = useState<ItemRow[]>([
    { id: '1', name: '', unitPriceStr: '', quantity: 1, consumerUserIds: [] },
  ]);
  const [taxStr, setTaxStr] = useState('0');
  const [tipStr, setTipStr] = useState('0');
  const [discountStr, setDiscountStr] = useState('0');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    apiRequest<{ groups: GroupSummary[] }>('/api/groups').then((res) => {
      setGroups(res.groups);
      if (initialGroupId) setSelectedGroupId(initialGroupId);
    });
  }, []);

  useEffect(() => {
    if (!selectedGroupId) return;
    apiRequest<{ members: MemberNetBalance[] }>(`/api/groups/${selectedGroupId}`).then((res) => {
      setMembers(res.members);
      const allIds = res.members.map((m) => m.userId);
      setSelectedParticipants(allIds);
      if (!allIds.includes(paidByUserId) && allIds.length > 0) {
        setPaidByUserId(allIds[0]);
      }
      const eqPct = allIds.length > 0 ? (100 / allIds.length).toFixed(2) : '0';
      const nextPct: Record<number, string> = {};
      const nextShares: Record<number, string> = {};
      const nextExact: Record<number, string> = {};
      allIds.forEach((id) => {
        nextPct[id] = eqPct;
        nextShares[id] = '1';
        nextExact[id] = '0';
      });
      setPctMap(nextPct);
      setSharesMap(nextShares);
      setExactMap(nextExact);
      setItems((prev) =>
        prev.map((it) => ({
          ...it,
          consumerUserIds: it.consumerUserIds.length > 0 ? it.consumerUserIds : allIds,
        }))
      );
    });
  }, [selectedGroupId]);

  useEffect(() => {
    if (!editExpenseId) return;
    apiRequest<{
      expense: {
        group_id: number;
        paid_by_user_id: number;
        title: string;
        description: string;
        notes: string;
        category: string;
        split_method: SplitMethod;
        tax_paise: number;
        tip_paise: number;
        discount_paise: number;
        total_paise: number;
        expense_date: string;
        receipt_data_url: string | null;
      };
      splits: Array<{ user_id: number; owed_paise: number }>;
      items: Array<{
        name: string;
        unit_price_paise: number;
        quantity: number;
        consumers: Array<{ user_id: number }>;
      }>;
    }>(`/api/expenses/${editExpenseId}`).then((res) => {
      const e = res.expense;
      setSelectedGroupId(e.group_id);
      setPaidByUserId(e.paid_by_user_id);
      setTitle(e.title);
      setDescription(e.description || '');
      setNotes(e.notes || '');
      setCategory(e.category);
      setSplitMethod(e.split_method);
      setTotalAmountStr((e.total_paise / 100).toFixed(2));
      setExpenseDate(e.expense_date);
      setReceiptDataUrl(e.receipt_data_url);
      setTaxStr((e.tax_paise / 100).toString());
      setTipStr((e.tip_paise / 100).toString());
      setDiscountStr((e.discount_paise / 100).toString());
      setSelectedParticipants(res.splits.map((s) => s.user_id));

      const nextExact: Record<number, string> = {};
      res.splits.forEach((s) => {
        nextExact[s.user_id] = (s.owed_paise / 100).toFixed(2);
      });
      setExactMap(nextExact);

      if (res.items.length > 0) {
        setItems(
          res.items.map((it, idx) => ({
            id: String(idx + 1),
            name: it.name,
            unitPriceStr: (it.unit_price_paise / 100).toString(),
            quantity: it.quantity,
            consumerUserIds: it.consumers.map((c) => c.user_id),
          }))
        );
      }
    });
  }, [editExpenseId]);

  const loadTeaCoffeeSamosaExample = () => {
    const ids = members.map((m) => m.userId);
    const firstFour = ids.slice(0, Math.max(1, ids.length - 1));
    const fifthOnly = ids.length > 1 ? [ids[ids.length - 1]] : ids;

    setTitle('Cafe Tea, Coffee & Samosas');
    setDescription('4 friends had tea, 1 ordered coffee, and everyone shared samosas.');
    setCategory('Food');
    setSplitMethod('itemized');
    setTaxStr('0');
    setTipStr('0');
    setDiscountStr('0');
    setItems([
      {
        id: 'tea',
        name: 'Masala Chai',
        unitPriceStr: '25',
        quantity: 4,
        consumerUserIds: firstFour,
      },
      {
        id: 'coffee',
        name: 'Iced Espresso Coffee',
        unitPriceStr: '120',
        quantity: 1,
        consumerUserIds: fifthOnly,
      },
      {
        id: 'samosa',
        name: 'Crispy Samosas',
        unitPriceStr: '30',
        quantity: 5,
        consumerUserIds: ids,
      },
    ]);
  };

  const preview = useMemo(() => {
    const activeIds =
      splitMethod === 'itemized'
        ? Array.from(new Set(items.flatMap((i) => i.consumerUserIds)))
        : selectedParticipants;

    return previewSplitCalculation({
      splitMethod,
      totalPaise: rupeesToPaise(totalAmountStr),
      participants: activeIds.map((uid) => ({
        userId: uid,
        exactPaise: rupeesToPaise(exactMap[uid] || '0'),
        percentage: Number(pctMap[uid] || '0') || 0,
        shares: Number(sharesMap[uid] || '1') || 0,
      })),
      items: items.map((it) => ({
        name: it.name,
        unitPricePaise: rupeesToPaise(it.unitPriceStr || '0'),
        quantity: Math.max(1, Math.round(it.quantity || 1)),
        consumerUserIds: it.consumerUserIds,
      })),
      taxPaise: rupeesToPaise(taxStr || '0'),
      tipPaise: rupeesToPaise(tipStr || '0'),
      discountPaise: rupeesToPaise(discountStr || '0'),
    });
  }, [splitMethod, totalAmountStr, selectedParticipants, exactMap, pctMap, sharesMap, items, taxStr, tipStr, discountStr]);

  const handleReceiptUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 1_400_000) {
      setError('Receipt file must be under 1.4 MB.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') setReceiptDataUrl(reader.result);
    };
    reader.readAsDataURL(file);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!selectedGroupId) {
      setError('Please select a group first.');
      return;
    }
    if (!preview.valid) {
      setError(preview.error || 'Please fix the split breakdown before saving.');
      return;
    }

    const activeIds =
      splitMethod === 'itemized'
        ? Array.from(new Set(items.flatMap((i) => i.consumerUserIds)))
        : selectedParticipants;

    const payload = {
      groupId: Number(selectedGroupId),
      paidByUserId,
      title: title.trim(),
      description: description.trim(),
      notes: notes.trim(),
      category,
      splitMethod,
      totalPaise: preview.totalPaise,
      taxPaise: splitMethod === 'itemized' ? rupeesToPaise(taxStr || '0') : 0,
      tipPaise: splitMethod === 'itemized' ? rupeesToPaise(tipStr || '0') : 0,
      discountPaise: splitMethod === 'itemized' ? rupeesToPaise(discountStr || '0') : 0,
      expenseDate,
      receiptDataUrl,
      participants: activeIds.map((uid) => ({
        userId: uid,
        exactPaise: rupeesToPaise(exactMap[uid] || '0'),
        percentage: Number(pctMap[uid] || '0') || 0,
        shares: Number(sharesMap[uid] || '1') || 0,
      })),
      items:
        splitMethod === 'itemized'
          ? items.map((it) => ({
              name: it.name.trim(),
              unitPricePaise: rupeesToPaise(it.unitPriceStr || '0'),
              quantity: Math.max(1, Math.round(it.quantity || 1)),
              consumerUserIds: it.consumerUserIds,
            }))
          : undefined,
    };

    setLoading(true);
    try {
      if (editExpenseId) {
        await apiRequest(`/api/expenses/${editExpenseId}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
        onToast('Expense updated and balances recalculated.', 'success');
      } else {
        await apiRequest('/api/expenses', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        onToast('Expense logged and splits saved atomically.', 'success');
      }
      onSaved(Number(selectedGroupId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save expense.');
    } finally {
      setLoading(false);
    }
  };

  if (groups.length === 0) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-8 text-center max-w-lg mx-auto space-y-3">
        <Receipt className="w-8 h-8 text-slate-400 mx-auto" />
        <h2 className="font-display text-lg font-bold text-slate-900">Create a group first</h2>
        <p className="text-sm text-slate-600">Expenses belong to a shared group. Create a group to start splitting bills.</p>
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 text-sm font-semibold text-white bg-[#065F46] rounded-lg cursor-pointer"
        >
          Go to Groups
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900">
            {editExpenseId ? 'Edit Expense' : 'Add Shared Expense'}
          </h1>
          <p className="text-sm text-slate-600 mt-0.5">
            Exact integer-paise split calculator with item-wise bill attribution.
          </p>
        </div>

        <button
          type="button"
          onClick={loadTeaCoffeeSamosaExample}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-[#065F46] bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 rounded-lg cursor-pointer self-start"
        >
          <Sparkles className="w-3.5 h-3.5" />
          <span>Load Tea, Coffee &amp; Samosas Example</span>
        </button>
      </div>

      {error && (
        <div role="alert" className="p-3.5 rounded-lg border border-red-200 bg-red-50 text-sm text-red-800">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <div className="lg:col-span-8 space-y-6">
          {/* Core Details */}
          <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
            <h2 className="font-display text-base font-bold text-slate-900">1. Expense Details</h2>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Group</label>
                <select
                  value={selectedGroupId}
                  onChange={(e) => setSelectedGroupId(e.target.value ? Number(e.target.value) : '')}
                  disabled={Boolean(editExpenseId)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                >
                  <option value="">Choose a group</option>
                  {groups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Paid By</label>
                <select
                  value={paidByUserId}
                  onChange={(e) => setPaidByUserId(Number(e.target.value))}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                >
                  {members.map((m) => (
                    <option key={m.userId} value={m.userId}>
                      {m.fullName} {m.userId === currentUser.id ? '(You)' : ''}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-slate-700 mb-1">Expense Title</label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g., Udupi Cafe Evening Break"
                  required
                  className="w-full px-3.5 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Date</label>
                <input
                  type="date"
                  value={expenseDate}
                  onChange={(e) => setExpenseDate(e.target.value)}
                  required
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg font-mono-num"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Category</label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                >
                  {EXPENSE_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Description / Purpose</label>
                <input
                  type="text"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Optional context for group members"
                  className="w-full px-3.5 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>
            </div>
          </div>

          {/* Splitting Method */}
          <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <h2 className="font-display text-base font-bold text-slate-900">2. Choose Split Method</h2>

              <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg overflow-x-auto no-scrollbar">
                {(
                  [
                    { id: 'itemized', label: 'Item-wise' },
                    { id: 'equal', label: 'Equal' },
                    { id: 'exact', label: 'Exact ₹' },
                    { id: 'percentage', label: 'Percent %' },
                    { id: 'shares', label: 'Shares' },
                  ] as Array<{ id: SplitMethod; label: string }>
                ).map((mode) => (
                  <button
                    key={mode.id}
                    type="button"
                    onClick={() => setSplitMethod(mode.id)}
                    className={`px-3 py-1.5 text-xs font-semibold rounded-md whitespace-nowrap transition-colors cursor-pointer ${
                      splitMethod === mode.id
                        ? 'bg-[#065F46] text-white'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {mode.label}
                  </button>
                ))}
              </div>
            </div>

            {splitMethod !== 'itemized' ? (
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Total Expense Amount (₹ INR)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    value={totalAmountStr}
                    onChange={(e) => setTotalAmountStr(e.target.value)}
                    className="w-full sm:w-64 px-3.5 py-2 text-base font-mono-num font-semibold border border-slate-300 rounded-lg"
                    required
                  />
                </div>

                <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl">
                  {members.map((m) => {
                    const checked = selectedParticipants.includes(m.userId);
                    return (
                      <div key={m.userId} className="px-4 py-3 flex items-center justify-between gap-3">
                        <label className="flex items-center gap-3 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() =>
                              setSelectedParticipants((prev) =>
                                prev.includes(m.userId)
                                  ? prev.filter((id) => id !== m.userId)
                                  : [...prev, m.userId]
                              )
                            }
                            className="rounded border-slate-300 text-[#065F46]"
                          />
                          <span className="text-sm font-medium text-slate-900">
                            {m.fullName} {m.userId === currentUser.id ? '(You)' : ''}
                          </span>
                        </label>

                        {checked && splitMethod === 'exact' && (
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            value={exactMap[m.userId] ?? '0'}
                            onChange={(e) => setExactMap({ ...exactMap, [m.userId]: e.target.value })}
                            aria-label={`Exact amount for ${m.fullName}`}
                            className="w-28 px-2.5 py-1 text-sm font-mono-num text-right border border-slate-300 rounded"
                          />
                        )}
                        {checked && splitMethod === 'percentage' && (
                          <div className="flex items-center gap-1">
                            <input
                              type="number"
                              step="0.1"
                              min="0"
                              max="100"
                              value={pctMap[m.userId] ?? '0'}
                              onChange={(e) => setPctMap({ ...pctMap, [m.userId]: e.target.value })}
                              aria-label={`Percentage for ${m.fullName}`}
                              className="w-20 px-2.5 py-1 text-sm font-mono-num text-right border border-slate-300 rounded"
                            />
                            <span className="text-xs text-slate-500">%</span>
                          </div>
                        )}
                        {checked && splitMethod === 'shares' && (
                          <div className="flex items-center gap-1.5">
                            <input
                              type="number"
                              step="1"
                              min="0"
                              value={sharesMap[m.userId] ?? '1'}
                              onChange={(e) => setSharesMap({ ...sharesMap, [m.userId]: e.target.value })}
                              aria-label={`Shares for ${m.fullName}`}
                              className="w-16 px-2.5 py-1 text-sm font-mono-num text-right border border-slate-300 rounded"
                            />
                            <span className="text-xs text-slate-500">shares</span>
                          </div>
                        )}
                        {checked && splitMethod === 'equal' && (
                          <span className="font-mono-num text-sm text-slate-600">
                            {formatINR(preview.perUserPaise.get(m.userId) ?? 0)}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              /* Itemized Bill Interface */
              <div className="space-y-4">
                {items.map((item, idx) => (
                  <div key={item.id} className="border border-slate-200 rounded-xl p-4 bg-[#F8FAFC] space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
                      <div className="sm:col-span-5">
                        <label className="block text-xs font-medium text-slate-600 mb-1">
                          Item #{idx + 1} Name
                        </label>
                        <input
                          type="text"
                          value={item.name}
                          onChange={(e) =>
                            setItems((prev) =>
                              prev.map((row) => (row.id === item.id ? { ...row, name: e.target.value } : row))
                            )
                          }
                          placeholder="e.g., Masala Chai"
                          className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-lg bg-white"
                        />
                      </div>
                      <div className="sm:col-span-3">
                        <label className="block text-xs font-medium text-slate-600 mb-1">Unit Price (₹)</label>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={item.unitPriceStr}
                          onChange={(e) =>
                            setItems((prev) =>
                              prev.map((row) =>
                                row.id === item.id ? { ...row, unitPriceStr: e.target.value } : row
                              )
                            )
                          }
                          placeholder="25.00"
                          className="w-full px-3 py-1.5 text-sm font-mono-num border border-slate-300 rounded-lg bg-white"
                        />
                      </div>
                      <div className="sm:col-span-2">
                        <label className="block text-xs font-medium text-slate-600 mb-1">Qty</label>
                        <input
                          type="number"
                          min="1"
                          value={item.quantity}
                          onFocus={() => setItems((prev) => prev.map((row) => row.id === item.id && row.quantity === 1 ? { ...row, quantity: '' } : row))}
                          onBlur={() => setItems((prev) => prev.map((row) => row.id === item.id && row.quantity === '' ? { ...row, quantity: 1 } : row))}
                          onChange={(e) =>
                            setItems((prev) =>
                              prev.map((row) =>
                                row.id === item.id
                                  ? { ...row, quantity: e.target.value === '' ? '' : Math.max(1, Number(e.target.value) || 1) }
                                  : row
                              )
                            )
                          }
                          className="w-full px-3 py-1.5 text-sm font-mono-num border border-slate-300 rounded-lg bg-white"
                        />
                      </div>
                      <div className="sm:col-span-2 flex items-center justify-between sm:justify-end gap-2">
                        <span className="font-mono-num text-sm font-semibold text-slate-800">
                          {formatINR(rupeesToPaise(item.unitPriceStr || '0') * Number(item.quantity || 1))}
                        </span>
                        {items.length > 1 && (
                          <button
                            type="button"
                            onClick={() => setItems((prev) => prev.filter((row) => row.id !== item.id))}
                            aria-label="Remove item"
                            className="p-1.5 text-slate-400 hover:text-red-700 cursor-pointer"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-xs font-medium text-slate-600">Who consumed this item?</span>
                        <button
                          type="button"
                          onClick={() =>
                            setItems((prev) =>
                              prev.map((row) =>
                                row.id === item.id
                                  ? { ...row, consumerUserIds: members.map((m) => m.userId) }
                                  : row
                              )
                            )
                          }
                          className="text-xs font-medium text-[#065F46] hover:underline cursor-pointer"
                        >
                          Select all
                        </button>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {members.map((m) => {
                          const active = item.consumerUserIds.includes(m.userId);
                          return (
                            <button
                              key={m.userId}
                              type="button"
                              onClick={() =>
                                setItems((prev) =>
                                  prev.map((row) => {
                                    if (row.id !== item.id) return row;
                                    const exists = row.consumerUserIds.includes(m.userId);
                                    return {
                                      ...row,
                                      consumerUserIds: exists
                                        ? row.consumerUserIds.filter((id) => id !== m.userId)
                                        : [...row.consumerUserIds, m.userId],
                                    };
                                  })
                                )
                              }
                              className={`px-2.5 py-1 text-xs font-medium rounded-md border transition-colors cursor-pointer ${
                                active
                                  ? 'bg-[#065F46] text-white border-[#065F46]'
                                  : 'bg-white text-slate-600 border-slate-300 hover:border-slate-400'
                              }`}
                            >
                              {active && <Check className="w-3 h-3 inline mr-1" />}
                              {m.fullName.split(' ')[0]}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                ))}

                <button
                  type="button"
                  onClick={() =>
                    setItems((prev) => [
                      ...prev,
                      {
                        id: String(Date.now()),
                        name: '',
                        unitPriceStr: '',
                        quantity: 1,
                        consumerUserIds: members.map((m) => m.userId),
                      },
                    ])
                  }
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add Another Bill Item</span>
                </button>

                {/* Shared Charges: Tax, Tip, Discount */}
                <div className="grid grid-cols-3 gap-4 pt-3 border-t border-slate-200">
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Tax / GST (₹)</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={taxStr}
                      onFocus={() => { if (taxStr === '0') setTaxStr(''); }}
                      onBlur={() => { if (!taxStr.trim()) setTaxStr('0'); }}
                      onChange={(e) => setTaxStr(e.target.value)}
                      className="w-full px-3 py-1.5 text-sm font-mono-num border border-slate-300 rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Tip / Service (₹)</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={tipStr}
                      onFocus={() => { if (tipStr === '0') setTipStr(''); }}
                      onBlur={() => { if (!tipStr.trim()) setTipStr('0'); }}
                      onChange={(e) => setTipStr(e.target.value)}
                      className="w-full px-3 py-1.5 text-sm font-mono-num border border-slate-300 rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Discount (₹)</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={discountStr}
                      onFocus={() => { if (discountStr === '0') setDiscountStr(''); }}
                      onBlur={() => { if (!discountStr.trim()) setDiscountStr('0'); }}
                      onChange={(e) => setDiscountStr(e.target.value)}
                      className="w-full px-3 py-1.5 text-sm font-mono-num border border-slate-300 rounded-lg"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Notes & Receipt Upload */}
            <div className="pt-4 border-t border-slate-200 grid grid-cols-1 sm:grid-cols-2 gap-4 items-center">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Optional Notes</label>
                <input
                  type="text"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Bill number or extra details"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Receipt Attachment</label>
                <label className="inline-flex items-center gap-2 px-3 py-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer">
                  <Upload className="w-3.5 h-3.5" />
                  <span>{receiptDataUrl ? 'Receipt attached (click to replace)' : 'Attach receipt photo'}</span>
                  <input type="file" accept="image/*" onChange={handleReceiptUpload} className="sr-only" />
                </label>
              </div>
            </div>
          </div>
        </div>

        {/* Live Calculation Preview Panel */}
        <div className="lg:col-span-4 bg-white border border-slate-200 rounded-xl p-6 space-y-5 sticky top-20">
          <div className="border-b border-slate-200 pb-4">
            <p className="text-xs font-medium text-slate-500">Live Paise Verification</p>
            <div className="flex items-baseline justify-between mt-1">
              <span className="font-display text-lg font-bold text-slate-900">Bill Total</span>
              <span className="font-mono-num text-2xl font-bold text-[#065F46]">
                {formatINR(preview.totalPaise)}
              </span>
            </div>
          </div>

          <div className="space-y-2.5">
            <p className="text-xs font-semibold text-slate-700">Individual Fair Shares</p>
            {members.map((m) => {
              const owed = preview.perUserPaise.get(m.userId) ?? 0;
              return (
                <div key={m.userId} className="flex items-center justify-between text-sm py-1">
                  <span className="text-slate-700">
                    {m.fullName} {m.userId === paidByUserId ? '(Payer)' : ''}
                  </span>
                  <span className="font-mono-num font-semibold text-slate-900">{formatINR(owed)}</span>
                </div>
              );
            })}
          </div>

          <div
            className={`p-3 rounded-lg text-xs border ${
              preview.valid
                ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                : 'bg-amber-50 border-amber-200 text-amber-900'
            }`}
          >
            {preview.valid
              ? `Verified: Sum of splits equals ${formatINR(preview.totalPaise)} with zero floating-point drift.`
              : preview.error}
          </div>

          <div className="flex flex-col gap-2.5 pt-2">
            <button
              type="submit"
              disabled={loading || !preview.valid}
              className="w-full py-2.5 px-4 text-sm font-semibold text-white bg-[#065F46] hover:bg-[#047857] rounded-lg transition-colors flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
            >
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              <span>{editExpenseId ? 'Save Changes' : 'Save Expense'}</span>
            </button>
            <button
              type="button"
              onClick={onCancel}
              className="w-full py-2 px-4 text-sm font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg cursor-pointer"
            >
              Cancel
            </button>
          </div>
        </div>
      </form>
    </div>
  );
};
