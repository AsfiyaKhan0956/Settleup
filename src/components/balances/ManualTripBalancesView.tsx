import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Check,
  History,
  Link2,
  Pencil,
  Plus,
  Scale,
  Sparkles,
  Trash2,
  UserCheck,
  Users,
  X,
} from 'lucide-react';
import { ApiError, apiRequest } from '../../services/api.ts';
import { formatINR, rupeesToPaise } from '../../utils/currency.ts';
import type {
  ManualBalanceEntry,
  TripLedgerDetail,
  TripLedgerSummary,
} from '../../types/index.ts';

interface ManualTripBalancesViewProps {
  onToast: (msg: string, tone?: 'success' | 'error') => void;
}

function todayYmd(): string {
  return new Date().toISOString().slice(0, 10);
}

export const ManualTripBalancesView: React.FC<ManualTripBalancesViewProps> = ({ onToast }) => {
  const [ledgers, setLedgers] = useState<TripLedgerSummary[]>([]);
  const [selectedLedgerId, setSelectedLedgerId] = useState<number | null>(null);
  const [detail, setDetail] = useState<TripLedgerDetail | null>(null);
  const [mode, setMode] = useState<'manual' | 'simplify'>('manual');
  const [loading, setLoading] = useState(true);

  // Create ledger modal
  const [createLedgerOpen, setCreateLedgerOpen] = useState(false);
  const [ledgerTitle, setLedgerTitle] = useState('');
  const [ledgerDesc, setLedgerDesc] = useState('');
  const [ledgerDate, setLedgerDate] = useState(todayYmd());

  // Add / Edit Manual Balance modal
  const [entryModalOpen, setEntryModalOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<ManualBalanceEntry | null>(null);
  const [personName, setPersonName] = useState('');
  const [direction, setDirection] = useState<'to_pay' | 'to_receive'>('to_pay');
  const [amountStr, setAmountStr] = useState('');
  const [contactRef, setContactRef] = useState('');
  const [description, setDescription] = useState('');
  const [entryDate, setEntryDate] = useState(todayYmd());
  const [participantType, setParticipantType] = useState<'external' | 'registered'>('external');
  const [duplicateWarning, setDuplicateWarning] = useState('');

  // Partial / manual settlement modal
  const [settleModalEntry, setSettleModalEntry] = useState<ManualBalanceEntry | null>(null);
  const [settleAmountStr, setSettleAmountStr] = useState('');

  // Link external participant modal
  const [linkParticipantId, setLinkParticipantId] = useState<number | null>(null);
  const [linkEmail, setLinkEmail] = useState('');

  const loadLedgers = async (keepId?: number | null) => {
    setLoading(true);
    try {
      const res = await apiRequest<{ ledgers: TripLedgerSummary[] }>('/api/manual-balances/ledgers');
      setLedgers(res.ledgers);
      const nextId = keepId ?? (selectedLedgerId && res.ledgers.some((l) => l.id === selectedLedgerId) ? selectedLedgerId : res.ledgers[0]?.id ?? null);
      setSelectedLedgerId(nextId);
      if (nextId) {
        const d = await apiRequest<TripLedgerDetail>(`/api/manual-balances/ledgers/${nextId}`);
        setDetail(d);
      } else {
        setDetail(null);
      }
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Unable to load trip ledgers', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadLedgers();
  }, []);

  const selectLedger = async (id: number) => {
    setSelectedLedgerId(id);
    try {
      const d = await apiRequest<TripLedgerDetail>(`/api/manual-balances/ledgers/${id}`);
      setDetail(d);
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Unable to load ledger details', 'error');
    }
  };

  const handleCreateLedger = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await apiRequest<{ ledgerId: number }>('/api/manual-balances/ledgers', {
        method: 'POST',
        body: JSON.stringify({
          title: ledgerTitle.trim(),
          description: ledgerDesc.trim(),
          eventDate: ledgerDate,
        }),
      });
      setCreateLedgerOpen(false);
      setLedgerTitle('');
      setLedgerDesc('');
      onToast('Large-trip manual ledger created.', 'success');
      await loadLedgers(res.ledgerId);
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Unable to create ledger', 'error');
    }
  };

  const openAddEntry = () => {
    setEditingEntry(null);
    setPersonName('');
    setDirection('to_pay');
    setAmountStr('');
    setContactRef('');
    setDescription('');
    setEntryDate(todayYmd());
    setParticipantType('external');
    setDuplicateWarning('');
    setEntryModalOpen(true);
  };

  const openEditEntry = (entry: ManualBalanceEntry) => {
    setEditingEntry(entry);
    setPersonName(entry.person_name);
    setDirection(entry.direction);
    setAmountStr((entry.amount_paise / 100).toFixed(2));
    setContactRef(entry.contact_ref || '');
    setDescription(entry.description || '');
    setEntryDate(entry.entry_date);
    setParticipantType(entry.participant_type);
    setDuplicateWarning('');
    setEntryModalOpen(true);
  };

  const submitEntry = async (allowDuplicate = false) => {
    if (!selectedLedgerId) return;
    const paise = rupeesToPaise(amountStr);
    if (paise <= 0) {
      onToast('Amount must be greater than ₹0.', 'error');
      return;
    }

    try {
      if (editingEntry) {
        await apiRequest(`/api/manual-balances/entries/${editingEntry.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            personName: personName.trim(),
            direction,
            amountPaise: paise,
            contactRef: contactRef.trim(),
            description: description.trim(),
            entryDate,
          }),
        });
        onToast('Manual balance updated.', 'success');
      } else {
        await apiRequest(`/api/manual-balances/ledgers/${selectedLedgerId}/entries`, {
          method: 'POST',
          body: JSON.stringify({
            personName: personName.trim(),
            direction,
            amountPaise: paise,
            contactRef: contactRef.trim(),
            description: description.trim(),
            entryDate,
            participantType,
            allowDuplicate,
          }),
        });
        onToast('Manual balance added.', 'success');
      }
      setEntryModalOpen(false);
      setDuplicateWarning('');
      await loadLedgers(selectedLedgerId);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'DUPLICATE_MANUAL_BALANCE') {
        setDuplicateWarning(err.message);
      } else {
        onToast(err instanceof Error ? err.message : 'Unable to save manual balance', 'error');
      }
    }
  };

  const handleManualSettlement = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!settleModalEntry || !selectedLedgerId) return;
    const payPaise = rupeesToPaise(settleAmountStr);
    if (payPaise <= 0) {
      onToast('Payment amount must be greater than ₹0.', 'error');
      return;
    }
    try {
      await apiRequest(`/api/manual-balances/entries/${settleModalEntry.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ recordSettlementPaise: payPaise }),
      });
      setSettleModalEntry(null);
      setSettleAmountStr('');
      onToast('Manual settlement recorded.', 'success');
      await loadLedgers(selectedLedgerId);
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Unable to record settlement', 'error');
    }
  };

  const handleMarkSettled = async (entryId: number) => {
    if (!selectedLedgerId) return;
    try {
      await apiRequest(`/api/manual-balances/entries/${entryId}`, {
        method: 'PATCH',
        body: JSON.stringify({ markSettled: true }),
      });
      onToast('Marked as settled.', 'success');
      await loadLedgers(selectedLedgerId);
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Unable to update status', 'error');
    }
  };

  const handleDeleteEntry = async (entryId: number) => {
    if (!selectedLedgerId) return;
    try {
      await apiRequest(`/api/manual-balances/entries/${entryId}`, { method: 'DELETE' });
      onToast('Entry removed.', 'success');
      await loadLedgers(selectedLedgerId);
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Unable to remove entry', 'error');
    }
  };

  const handleLinkParticipant = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!linkParticipantId || !selectedLedgerId) return;
    try {
      const res = await apiRequest<{ linkedUserName: string }>(
        `/api/manual-balances/participants/${linkParticipantId}/link`,
        {
          method: 'POST',
          body: JSON.stringify({ targetEmail: linkEmail.trim() }),
        }
      );
      setLinkParticipantId(null);
      setLinkEmail('');
      onToast(`Linked participant to verified member ${res.linkedUserName}.`, 'success');
      await loadLedgers(selectedLedgerId);
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Unable to link participant', 'error');
    }
  };

  if (loading && !detail && ledgers.length === 0) {
    return <div className="h-64 bg-white border border-slate-200 rounded-xl animate-pulse" />;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900">Large Trips &amp; Manual Balances</h1>
          <p className="text-sm text-slate-600 mt-0.5">
            Track who has to pay or receive for large trips with external participants, then manage manually or simplify with SettleUp.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setCreateLedgerOpen(true)}
          className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-[#065F46] hover:bg-[#047857] rounded-lg cursor-pointer self-start"
        >
          <Plus className="w-4 h-4" />
          <span>New Trip Ledger</span>
        </button>
      </div>

      {/* Ledger Selector */}
      {ledgers.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-10 text-center space-y-3">
          <Users className="w-8 h-8 text-slate-400 mx-auto" />
          <p className="font-display font-bold text-slate-900">No large-trip manual ledgers yet</p>
          <p className="text-sm text-slate-600 max-w-md mx-auto">
            Create a manual ledger when friends who haven&apos;t signed up yet join a trip or event and you want to record or simplify balances.
          </p>
          <button
            type="button"
            onClick={() => setCreateLedgerOpen(true)}
            className="px-4 py-2 text-sm font-semibold text-white bg-[#065F46] rounded-lg cursor-pointer"
          >
            Create Trip Ledger
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left Rail: Ledger List */}
          <div className="lg:col-span-4 space-y-3">
            {ledgers.map((l) => {
              const active = l.id === selectedLedgerId;
              return (
                <button
                  key={l.id}
                  type="button"
                  onClick={() => selectLedger(l.id)}
                  className={`w-full text-left p-4 rounded-xl border transition-colors cursor-pointer ${
                    active
                      ? 'bg-emerald-50/60 border-[#065F46]'
                      : 'bg-white border-slate-200 hover:border-slate-300'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-display text-sm font-bold text-slate-900">{l.title}</p>
                    <span className="font-mono-num text-[11px] text-slate-500">{l.event_date}</span>
                  </div>
                  {l.description && <p className="text-xs text-slate-600 mt-1 line-clamp-1">{l.description}</p>}
                  <div className="mt-3 pt-2.5 border-t border-slate-200/70 flex items-center justify-between text-xs">
                    <span className="text-slate-600">{l.entryCount} entries</span>
                    <span className="font-mono-num font-semibold text-slate-900">
                      {l.transfers.length} simplified {l.transfers.length === 1 ? 'transfer' : 'transfers'}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Main Workspace */}
          {detail && (
            <div className="lg:col-span-8 space-y-6">
              <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200 pb-4">
                  <div>
                    <h2 className="font-display text-xl font-bold text-slate-900">{detail.ledger.title}</h2>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {detail.ledger.event_date} {detail.ledger.description ? `· ${detail.ledger.description}` : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={openAddEntry}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-[#065F46] hover:bg-[#047857] rounded-lg cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Add Manual Balance</span>
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        await apiRequest(`/api/manual-balances/ledgers/${detail.ledger.id}`, { method: 'DELETE' });
                        onToast('Trip ledger deleted.', 'success');
                        await loadLedgers(null);
                      }}
                      className="p-2 text-slate-400 hover:text-red-700 rounded-lg border border-slate-200 cursor-pointer"
                      aria-label="Delete trip ledger"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Summary Strip */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="border border-slate-200 rounded-lg p-4">
                    <p className="text-xs text-slate-500">Remaining To Pay</p>
                    <p className="font-mono-num text-xl font-bold text-[#B91C1C] mt-1">
                      {formatINR(detail.summary.remainingToPayPaise)}
                    </p>
                  </div>
                  <div className="border border-slate-200 rounded-lg p-4">
                    <p className="text-xs text-slate-500">Remaining To Receive</p>
                    <p className="font-mono-num text-xl font-bold text-[#065F46] mt-1">
                      {formatINR(detail.summary.remainingToReceivePaise)}
                    </p>
                  </div>
                  <div className="border border-slate-200 rounded-lg p-4">
                    <p className="text-xs text-slate-500">Ledger Balance Check</p>
                    <p className="font-mono-num text-sm font-bold text-slate-900 mt-1.5">
                      {detail.summary.isBalanced
                        ? 'Balanced (Payables = Receivables)'
                        : `Difference: ${formatINR(Math.abs(detail.summary.imbalancePaise))}`}
                    </p>
                  </div>
                </div>

                {!detail.summary.isBalanced && (
                  <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-900 flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    <span>
                      Note: Total remaining amounts to pay ({formatINR(detail.summary.remainingToPayPaise)}) and receive ({formatINR(detail.summary.remainingToReceivePaise)}) differ by{' '}
                      <strong>{formatINR(Math.abs(detail.summary.imbalancePaise))}</strong>. Simplify with SettleUp resolves all matched pairs and flags any leftover imbalance honestly.
                    </span>
                  </div>
                )}

                {/* Two-Mode Toggle */}
                <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-xl w-fit">
                  <button
                    type="button"
                    onClick={() => setMode('manual')}
                    className={`px-4 py-2 text-xs font-semibold rounded-lg cursor-pointer inline-flex items-center gap-1.5 ${
                      mode === 'manual' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
                    }`}
                  >
                    <Scale className="w-3.5 h-3.5" />
                    <span>Mode 1: Manual Management</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setMode('simplify')}
                    className={`px-4 py-2 text-xs font-semibold rounded-lg cursor-pointer inline-flex items-center gap-1.5 ${
                      mode === 'simplify' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
                    }`}
                  >
                    <Sparkles className="w-3.5 h-3.5 text-[#065F46]" />
                    <span>Mode 2: Simplify with SettleUp</span>
                  </button>
                </div>

                {/* Mode 1: Manual Entries Table */}
                {mode === 'manual' && (
                  <div className="space-y-4">
                    {detail.entries.length === 0 ? (
                      <p className="text-sm text-slate-500 py-6 text-center">
                        No manual balances recorded in this ledger yet. Click &ldquo;Add Manual Balance&rdquo; above.
                      </p>
                    ) : (
                      <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl">
                        {detail.entries.map((entry) => {
                          const remaining = Math.max(0, entry.amount_paise - entry.settled_paise);
                          return (
                            <div key={entry.id} className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                              <div className="space-y-1 min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="font-semibold text-sm text-slate-900">{entry.person_name}</span>
                                  <span className="text-[11px] font-medium text-slate-500">
                                    · {entry.participant_type === 'registered' || entry.linked_user_id ? 'Registered Member' : 'External Participant'}
                                  </span>
                                  <span
                                    className={`text-[11px] font-semibold ${
                                      entry.status === 'settled'
                                        ? 'text-[#065F46]'
                                        : entry.status === 'partially_settled'
                                        ? 'text-amber-700'
                                        : 'text-slate-600'
                                    }`}
                                  >
                                    · {entry.status === 'settled' ? 'Settled' : entry.status === 'partially_settled' ? 'Partially Settled' : 'Pending'}
                                  </span>
                                </div>
                                <p className="text-xs text-slate-600">
                                  {entry.direction === 'to_pay' ? 'Has to Pay' : 'Has to Receive'} · {entry.entry_date}
                                  {entry.description ? ` · ${entry.description}` : ''}
                                  {entry.contact_ref ? ` · Ref: ${entry.contact_ref}` : ''}
                                </p>
                              </div>

                              <div className="flex flex-wrap items-center gap-2 shrink-0">
                                <div className="text-right mr-2">
                                  <p
                                    className={`font-mono-num text-sm font-bold ${
                                      entry.direction === 'to_pay' ? 'text-[#B91C1C]' : 'text-[#065F46]'
                                    }`}
                                  >
                                    {formatINR(remaining)}
                                  </p>
                                  {entry.settled_paise > 0 && (
                                    <p className="font-mono-num text-[11px] text-slate-500">
                                      of {formatINR(entry.amount_paise)}
                                    </p>
                                  )}
                                </div>

                                {entry.status !== 'settled' && (
                                  <>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setSettleModalEntry(entry);
                                        setSettleAmountStr((remaining / 100).toFixed(2));
                                      }}
                                      className="px-2.5 py-1 text-xs font-semibold text-slate-800 bg-slate-100 hover:bg-slate-200 rounded cursor-pointer"
                                    >
                                      Record Payment
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => handleMarkSettled(entry.id)}
                                      className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-white bg-[#065F46] hover:bg-[#047857] rounded cursor-pointer"
                                    >
                                      <Check className="w-3 h-3" /> Settled
                                    </button>
                                  </>
                                )}
                                <button
                                  type="button"
                                  onClick={() => openEditEntry(entry)}
                                  aria-label="Edit entry"
                                  className="p-1.5 text-slate-400 hover:text-slate-800 cursor-pointer"
                                >
                                  <Pencil className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteEntry(entry.id)}
                                  aria-label="Delete entry"
                                  className="p-1.5 text-slate-400 hover:text-red-700 cursor-pointer"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}

                {/* Mode 2: Simplify with SettleUp */}
                {mode === 'simplify' && (
                  <div className="space-y-4">
                    <div className="p-3.5 rounded-lg bg-[#F8FAFC] border border-slate-200 text-xs text-slate-600">
                      Computed with SettleUp&apos;s min-cash-flow debt simplification algorithm across all remaining unsettled balances in this ledger.
                    </div>
                    {detail.summary.transfers.length === 0 ? (
                      <p className="text-sm text-slate-500 py-6 text-center">
                        No transfers required — all paired balances are settled.
                      </p>
                    ) : (
                      <div className="space-y-2.5">
                        {detail.summary.transfers.map((t, i) => (
                          <div
                            key={i}
                            className="border border-slate-200 rounded-lg p-4 flex items-center justify-between gap-3"
                          >
                            <div>
                              <p className="text-sm font-semibold text-slate-900">
                                {t.fromName} <ArrowRight className="w-3.5 h-3.5 inline text-slate-400" /> {t.toName}
                              </p>
                              <p className="text-xs text-slate-500 mt-0.5">
                                Suggested simplified manual settlement
                              </p>
                            </div>
                            <span className="font-mono-num text-sm font-bold text-[#065F46]">
                              {formatINR(t.amountPaise)}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* External Participants & Account Linking */}
              {detail.participants.length > 0 && (
                <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-3">
                  <h3 className="font-display text-sm font-bold text-slate-900 flex items-center gap-2">
                    <UserCheck className="w-4 h-4 text-[#065F46]" />
                    <span>External Participants &amp; Optional SettleUp Linking</span>
                  </h3>
                  <p className="text-xs text-slate-500">
                    External contacts stay private to this ledger. When a friend joins a shared SettleUp group with you, you can link their record using their verified email.
                  </p>
                  <div className="divide-y divide-slate-100">
                    {detail.participants.map((p) => (
                      <div key={p.id} className="py-2.5 flex items-center justify-between gap-3 text-xs">
                        <div>
                          <span className="font-semibold text-slate-900">{p.display_name}</span>
                          {p.linked_user_name ? (
                            <span className="text-[#065F46] font-medium ml-2">
                              · Linked to {p.linked_user_name}
                            </span>
                          ) : (
                            <span className="text-slate-500 ml-2">· External participant</span>
                          )}
                        </div>
                        {!p.linked_user_id && (
                          <button
                            type="button"
                            onClick={() => {
                              setLinkParticipantId(p.id);
                              setLinkEmail(p.email || '');
                            }}
                            className="inline-flex items-center gap-1 text-xs font-semibold text-[#065F46] hover:underline cursor-pointer"
                          >
                            <Link2 className="w-3 h-3" /> Link Account
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Activity Log */}
              {detail.events.length > 0 && (
                <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-3">
                  <h3 className="font-display text-sm font-bold text-slate-900 flex items-center gap-2">
                    <History className="w-4 h-4 text-slate-500" />
                    <span>Manual Ledger Activity Log</span>
                  </h3>
                  <div className="space-y-2 text-xs">
                    {detail.events.slice(0, 10).map((ev) => (
                      <div key={ev.id} className="flex items-center justify-between gap-3 py-1.5 border-b border-slate-100 last:border-0">
                        <span className="text-slate-700">{ev.note}</span>
                        <span className="font-mono-num text-slate-400 shrink-0">
                          {ev.created_at.slice(0, 10)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Create Ledger Modal */}
      {createLedgerOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-2xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-lg font-bold text-slate-900">Create Large-Trip Ledger</h2>
              <button type="button" onClick={() => setCreateLedgerOpen(false)} className="text-slate-400 hover:text-slate-700 cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleCreateLedger} className="space-y-3.5">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Trip / Event Name</label>
                <input
                  type="text"
                  value={ledgerTitle}
                  onChange={(e) => setLedgerTitle(e.target.value)}
                  placeholder="Enter trip or event name"
                  required
                  className="w-full px-3.5 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Description (Optional)</label>
                <input
                  type="text"
                  value={ledgerDesc}
                  onChange={(e) => setLedgerDesc(e.target.value)}
                  placeholder="Optional trip details"
                  className="w-full px-3.5 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Trip Date</label>
                <input
                  type="date"
                  value={ledgerDate}
                  onChange={(e) => setLedgerDate(e.target.value)}
                  className="w-full px-3.5 py-2 text-sm font-mono-num border border-slate-300 rounded-lg"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setCreateLedgerOpen(false)} className="px-4 py-2 text-sm border border-slate-300 rounded-lg cursor-pointer">
                  Cancel
                </button>
                <button type="submit" className="px-4 py-2 text-sm font-semibold text-white bg-[#065F46] rounded-lg cursor-pointer">
                  Create Ledger
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add / Edit Manual Balance Modal */}
      {entryModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-2xl max-w-lg w-full p-6 space-y-4 max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-lg font-bold text-slate-900">
                {editingEntry ? 'Edit Manual Balance' : 'Add Manual Balance'}
              </h2>
              <button type="button" onClick={() => setEntryModalOpen(false)} className="text-slate-400 hover:text-slate-700 cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>

            {duplicateWarning && (
              <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900 space-y-2">
                <p>{duplicateWarning}</p>
                <button
                  type="button"
                  onClick={() => submitEntry(true)}
                  className="px-3 py-1.5 text-xs font-semibold bg-amber-700 text-white rounded cursor-pointer"
                >
                  Save Duplicate Entry Anyway
                </button>
              </div>
            )}

            <form
              onSubmit={(e) => {
                e.preventDefault();
                submitEntry(false);
              }}
              className="space-y-3.5"
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Person&apos;s Name</label>
                  <input
                    type="text"
                    value={personName}
                    onChange={(e) => setPersonName(e.target.value)}
                    placeholder="Enter person's name"
                    required
                    className="w-full px-3.5 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Participant Type</label>
                  <select
                    value={participantType}
                    onChange={(e) => setParticipantType(e.target.value as 'external' | 'registered')}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="external">External Participant (Not on SettleUp)</option>
                    <option value="registered">Registered SettleUp Member</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Balance Direction</label>
                  <select
                    value={direction}
                    onChange={(e) => setDirection(e.target.value as 'to_pay' | 'to_receive')}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="to_pay">Has to Pay (Owes Trip Pool)</option>
                    <option value="to_receive">Has to Receive (Paid Upfront)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Amount (₹ INR)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    value={amountStr}
                    onChange={(e) => setAmountStr(e.target.value)}
                    placeholder="0.00"
                    required
                    className="w-full px-3.5 py-2 text-sm font-mono-num border border-slate-300 rounded-lg"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Mobile / Contact Ref (Optional)</label>
                  <input
                    type="text"
                    value={contactRef}
                    onChange={(e) => setContactRef(e.target.value)}
                    placeholder="Enter mobile number or email"
                    className="w-full px-3.5 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Date</label>
                  <input
                    type="date"
                    value={entryDate}
                    onChange={(e) => setEntryDate(e.target.value)}
                    className="w-full px-3.5 py-2 text-sm font-mono-num border border-slate-300 rounded-lg"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Description / Reason</label>
                <input
                  type="text"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Enter reason (e.g., bus booking, villa advance)"
                  className="w-full px-3.5 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setEntryModalOpen(false)} className="px-4 py-2 text-sm border border-slate-300 rounded-lg cursor-pointer">
                  Cancel
                </button>
                <button type="submit" className="px-5 py-2 text-sm font-semibold text-white bg-[#065F46] rounded-lg cursor-pointer">
                  {editingEntry ? 'Save Changes' : 'Add Entry'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Manual Settlement Payment Modal */}
      {settleModalEntry && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-2xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-lg font-bold text-slate-900">Record Manual Settlement</h2>
              <button type="button" onClick={() => setSettleModalEntry(null)} className="text-slate-400 hover:text-slate-700 cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-xs text-slate-600">
              Recording manual payment for <strong>{settleModalEntry.person_name}</strong>. Remaining balance:{' '}
              <span className="font-mono-num font-semibold">
                {formatINR(Math.max(0, settleModalEntry.amount_paise - settleModalEntry.settled_paise))}
              </span>
            </p>
            <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-900">
              Manual settlement records offline/UPI cash exchanges you confirm directly with participants; SettleUp does not transfer bank funds automatically.
            </div>
            <form onSubmit={handleManualSettlement} className="space-y-3.5">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Amount Settled Now (₹ INR)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={settleAmountStr}
                  onChange={(e) => setSettleAmountStr(e.target.value)}
                  required
                  className="w-full px-3.5 py-2 text-sm font-mono-num border border-slate-300 rounded-lg"
                />
              </div>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setSettleModalEntry(null)} className="px-4 py-2 text-sm border border-slate-300 rounded-lg cursor-pointer">
                  Cancel
                </button>
                <button type="submit" className="px-4 py-2 text-sm font-semibold text-white bg-[#065F46] rounded-lg cursor-pointer">
                  Record Settlement
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Link External Participant Modal */}
      {linkParticipantId && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-2xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-lg font-bold text-slate-900">Link to SettleUp Member</h2>
              <button type="button" onClick={() => setLinkParticipantId(null)} className="text-slate-400 hover:text-slate-700 cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-xs text-slate-600">
              For privacy, you can link an external participant once you share a SettleUp group with them.
            </p>
            <form onSubmit={handleLinkParticipant} className="space-y-3.5">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Member&apos;s Registered Email Address</label>
                <input
                  type="email"
                  value={linkEmail}
                  onChange={(e) => setLinkEmail(e.target.value)}
                  placeholder="Enter member's email address"
                  required
                  className="w-full px-3.5 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setLinkParticipantId(null)} className="px-4 py-2 text-sm border border-slate-300 rounded-lg cursor-pointer">
                  Cancel
                </button>
                <button type="submit" className="px-4 py-2 text-sm font-semibold text-white bg-[#065F46] rounded-lg cursor-pointer">
                  Verify &amp; Link
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
