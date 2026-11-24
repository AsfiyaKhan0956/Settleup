import React, { useEffect, useMemo, useState } from 'react';
import { ArrowUpRight, BarChart3, CalendarDays, Download, Edit3, Plus, ReceiptText, Trash2, Users, X } from 'lucide-react';
import { apiRequest, downloadAuthenticatedCsv } from '../../services/api.ts';
import { formatINR, rupeesToPaise } from '../../utils/currency.ts';
import { todayLocalYmd } from '../../utils/date.ts';

interface LedgerSummary {
  id: number; title: string; description: string; event_date: string;
  participants: Array<{ id: number; name: string; paidPaise: number; consumedPaise: number; settlementPaidPaise: number; settlementReceivedPaise: number; netPaise: number }>;
  totalExpenditurePaise: number;
  transfers: Array<{ fromParticipantId: number; fromName: string; toParticipantId: number; toName: string; amountPaise: number }>;
}
interface LedgerDetail {
  ledger: { id: number; title: string; description: string; event_date: string };
  participants: Array<{ id: number; display_name: string }>;
  expenses: Array<{ id: number; title: string; description: string; expense_date: string; total_paise: number; paid_by_participant_id: number; payer_name: string; items: Array<{ id: number; name: string; unit_price_paise: number; quantity: number; total_paise: number; consumers: Array<{ participant_id: number; display_name: string; share_paise: number }> }>; shares: Array<{ participant_id: number; display_name: string; owed_paise: number }> }>;
  settlements: Array<{ id: number; settlement_date: string; payer_name: string; receiver_name: string; amount_paise: number; note: string }>;
  summary: { participants: LedgerSummary['participants']; totalExpenditurePaise: number; transfers: LedgerSummary['transfers'] };
}
interface BillItem { name: string; unitPrice: string; quantity: string; participantIds: number[] }

const emptyItem = (participantIds: number[] = []): BillItem => ({ name: '', unitPrice: '', quantity: '1', participantIds });

export const TripLedgerView: React.FC<{ onToast: (message: string, tone?: 'success' | 'error') => void }> = ({ onToast }) => {
  const [ledgers, setLedgers] = useState<LedgerSummary[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<LedgerDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [tripName, setTripName] = useState('');
  const [tripDescription, setTripDescription] = useState('');
  const [tripDate, setTripDate] = useState(todayLocalYmd());
  const [pendingParticipantNames, setPendingParticipantNames] = useState<string[]>([]);
  const [participantDrafts, setParticipantDrafts] = useState<Record<number, string>>({});
  const [savingParticipant, setSavingParticipant] = useState(false);
  const [editingTrip, setEditingTrip] = useState(false);
  const [expenseOpen, setExpenseOpen] = useState(false);
  const [editingExpenseId, setEditingExpenseId] = useState<number | null>(null);
  const [expenseTitle, setExpenseTitle] = useState('');
  const [expenseDescription, setExpenseDescription] = useState('');
  const [expenseDate, setExpenseDate] = useState(todayLocalYmd());
  const [payerId, setPayerId] = useState<number | ''>('');
  const [items, setItems] = useState<BillItem[]>([emptyItem()]);
  const [savingExpense, setSavingExpense] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);

  const loadLedgers = async (keepId?: number | null) => {
    setLoading(true);
    try {
      const response = await apiRequest<{ ledgers: LedgerSummary[] }>('/api/trip-ledger');
      setLedgers(response.ledgers);
      const nextId = keepId ?? (selectedId && response.ledgers.some((item) => item.id === selectedId) ? selectedId : response.ledgers[0]?.id ?? null);
      setSelectedId(nextId);
      if (nextId) {
        const next = await apiRequest<LedgerDetail>(`/api/trip-ledger/${nextId}`);
        setDetail(next);
        setParticipantDrafts(Object.fromEntries(next.participants.map((p) => [p.id, p.display_name])));
      } else setDetail(null);
    } catch (error) {
      onToast(error instanceof Error ? error.message : 'Unable to load Quick Split.', 'error');
    } finally { setLoading(false); }
  };

  const loadDetail = async (id = selectedId) => {
    if (!id) return;
    const next = await apiRequest<LedgerDetail>(`/api/trip-ledger/${id}`);
    setDetail(next);
    setParticipantDrafts(Object.fromEntries(next.participants.map((p) => [p.id, p.display_name])));
  };

  useEffect(() => { void loadLedgers(); }, []);

  const totalBillPaise = useMemo(() => items.reduce((sum, item) => {
    const price = Number(item.unitPrice);
    const qty = Number(item.quantity);
    return sum + (Number.isFinite(price) && price > 0 && Number.isFinite(qty) && qty > 0 ? Math.round(price * 100) * Math.floor(qty) : 0);
  }, 0), [items]);

  const consumptionPieStyle = useMemo(() => {
    const rows = detail?.summary.participants ?? [];
    const total = rows.reduce((sum, row) => sum + row.consumedPaise, 0);
    if (total <= 0) return { background: '#E2E8F0' };
    const greens = ['#064E3B', '#047857', '#059669', '#10B981', '#34D399', '#6EE7B7', '#A7F3D0'];
    let offset = 0;
    const stops = rows.map((row, index) => {
      const start = offset;
      offset += row.consumedPaise / total * 100;
      return `${greens[index % greens.length]} ${start}% ${offset}%`;
    });
    return { background: `conic-gradient(${stops.join(', ')})` };
  }, [detail]);

  const createLedger = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      const result = await apiRequest<{ ledgerId: number }>('/api/trip-ledger', { method: 'POST', body: JSON.stringify({ title: tripName, description: tripDescription, eventDate: tripDate }) });
      setCreateOpen(false); setTripName(''); setTripDescription(''); setTripDate(todayLocalYmd()); setPendingParticipantNames([]);
      onToast('Quick Split created with two participants.', 'success');
      await loadLedgers(result.ledgerId);
    } catch (error) { onToast(error instanceof Error ? error.message : 'Unable to create Quick Split.', 'error'); }
  };

  const addParticipantField = () => {
    const count = detail?.participants.length ?? 0;
    const pendingCount = pendingParticipantNames.length;
    const ordinal = count + pendingCount + 1;
    const defaultName = ordinal <= 26 ? `Person ${String.fromCharCode(64 + ordinal)}` : `Person ${ordinal}`;
    setPendingParticipantNames((old) => [...old, defaultName]);
  };

  const saveAllParticipants = async () => {
    if (!selectedId || !detail || savingParticipant) return;
    const changedNames = detail.participants
      .map((participant) => ({ id: participant.id, name: (participantDrafts[participant.id] ?? participant.display_name).trim(), original: participant.display_name }))
      .filter((participant) => participant.name !== participant.original);
    const newNames = pendingParticipantNames.map((name) => name.trim()).filter(Boolean);
    if (changedNames.some((participant) => participant.name.length < 2 || participant.name.length > 80)) {
      onToast('Each participant name must be between 2 and 80 characters.', 'error');
      return;
    }
    if (pendingParticipantNames.some((name) => name.trim().length < 2 || name.trim().length > 80)) {
      onToast('Each new participant name must be between 2 and 80 characters.', 'error');
      return;
    }
    if (changedNames.length === 0 && newNames.length === 0) {
      onToast('There are no participant changes to save.', 'error');
      return;
    }
    setSavingParticipant(true);
    try {
      for (const participant of changedNames) {
        await apiRequest(`/api/trip-ledger/participants/${participant.id}`, { method: 'PATCH', body: JSON.stringify({ displayName: participant.name }) });
      }
      for (const displayName of newNames) {
        await apiRequest(`/api/trip-ledger/${selectedId}/participants`, { method: 'POST', body: JSON.stringify({ displayName }) });
      }
      setPendingParticipantNames([]);
      await loadDetail();
      await loadLedgers(selectedId);
      onToast('Participant changes saved successfully.', 'success');
    } catch (error) {
      try { await loadDetail(); await loadLedgers(selectedId); } catch { /* Keep current view if refresh fails. */ }
      onToast(error instanceof Error ? error.message : 'Unable to save participant changes.', 'error');
    } finally {
      setSavingParticipant(false);
    }
  };

  const saveTripDetails = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!detail) return;
    try {
      await apiRequest(`/api/trip-ledger/${detail.ledger.id}`, { method: 'PATCH', body: JSON.stringify({ title: tripName, description: tripDescription, eventDate: tripDate }) });
      setEditingTrip(false); await loadDetail(); await loadLedgers(selectedId); onToast('Trip details updated.', 'success');
    } catch (error) { onToast(error instanceof Error ? error.message : 'Unable to update trip.', 'error'); }
  };

  const openNewExpense = () => {
    if (!detail) return;
    setEditingExpenseId(null); setExpenseTitle(''); setExpenseDescription(''); setExpenseDate(todayLocalYmd());
    setPayerId(detail.participants[0]?.id ?? ''); setItems([emptyItem(detail.participants.map((p) => p.id))]); setExpenseOpen(true);
  };

  const openEditExpense = (expense: LedgerDetail['expenses'][number]) => {
    setEditingExpenseId(expense.id); setExpenseTitle(expense.title); setExpenseDescription(expense.description); setExpenseDate(expense.expense_date);
    setPayerId(expense.paid_by_participant_id);
    setItems(expense.items.map((item) => ({ name: item.name, unitPrice: (item.unit_price_paise / 100).toFixed(2), quantity: String(item.quantity), participantIds: item.consumers.map((consumer) => consumer.participant_id) })));
    setExpenseOpen(true);
  };

  const saveExpense = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedId || payerId === '') return;
    setSavingExpense(true);
    try {
      const payload = { title: expenseTitle, description: expenseDescription, expenseDate, paidByParticipantId: payerId, items: items.map((item) => ({ name: item.name, unitPricePaise: rupeesToPaise(item.unitPrice), quantity: Number(item.quantity), participantIds: item.participantIds })) };
      const url = editingExpenseId ? `/api/trip-ledger/expenses/${editingExpenseId}` : `/api/trip-ledger/${selectedId}/expenses`;
      await apiRequest(url, { method: editingExpenseId ? 'PUT' : 'POST', body: JSON.stringify(payload) });
      setExpenseOpen(false); await loadDetail(); await loadLedgers(selectedId);
      onToast(editingExpenseId ? 'Trip expense updated.' : 'Trip expense added.', 'success');
    } catch (error) { onToast(error instanceof Error ? error.message : 'Unable to save trip expense.', 'error'); }
    finally { setSavingExpense(false); }
  };

  const deleteExpense = async (expenseId: number) => {
    if (!window.confirm('Delete this trip expense? The trip totals and balances will be recalculated.')) return;
    try { await apiRequest(`/api/trip-ledger/expenses/${expenseId}`, { method: 'DELETE' }); await loadDetail(); await loadLedgers(selectedId); onToast('Trip expense deleted.', 'success'); }
    catch (error) { onToast(error instanceof Error ? error.message : 'Unable to delete trip expense.', 'error'); }
  };

  const recordSettlement = async (transfer: LedgerDetail['summary']['transfers'][number]) => {
    if (!selectedId) return;
    try {
      await apiRequest(`/api/trip-ledger/${selectedId}/settlements`, { method: 'POST', body: JSON.stringify({ payerParticipantId: transfer.fromParticipantId, receiverParticipantId: transfer.toParticipantId, amountPaise: transfer.amountPaise, settlementDate: todayLocalYmd(), note: 'Recorded from Quick Split suggested settlement' }) });
      await loadDetail(); await loadLedgers(selectedId); onToast('Settlement recorded and balances updated.', 'success');
    } catch (error) { onToast(error instanceof Error ? error.message : 'Unable to record settlement.', 'error'); }
  };

  const undoSettlement = async (settlementId: number) => {
    if (!window.confirm('Undo this settlement record? The outstanding balances will be recalculated.')) return;
    try {
      await apiRequest(`/api/trip-ledger/settlements/${settlementId}`, { method: 'DELETE' });
      await loadDetail(); await loadLedgers(selectedId);
      onToast('Settlement record undone.', 'success');
    } catch (error) { onToast(error instanceof Error ? error.message : 'Unable to undo settlement.', 'error'); }
  };

  const exportCsv = async (order: 'newest' | 'oldest') => {
    if (!selectedId) return;
    try { await downloadAuthenticatedCsv(`/api/trip-ledger/${selectedId}/export.csv?order=${order}`, `trip-ledger-${selectedId}.csv`); setExportOpen(false); }
    catch (error) { onToast(error instanceof Error ? error.message : 'Unable to export Quick Split.', 'error'); }
  };

  if (loading && !detail) return <div className="p-8 text-sm text-slate-500">Loading Quick Split…</div>;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div><p className="text-xs font-bold uppercase tracking-wider text-emerald-700">Independent group expense manager</p><h1 className="font-display text-2xl font-bold text-slate-900">Quick Split</h1><p className="text-sm text-slate-600 mt-1">Track item-by-item spending, who paid, each person's actual share, and final settlements.</p><p className="mt-2 text-xs text-slate-500">Your earlier manual-balance records are preserved separately and are not deleted or automatically converted, because they do not contain item-level bill details.</p></div>
        <button type="button" onClick={() => setCreateOpen(true)} className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#065F46] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#047857]"><Plus className="h-4 w-4"/> New Quick Split</button>
      </div>

      {createOpen && <form onSubmit={createLedger} className="rounded-2xl border border-emerald-200 bg-white p-5 space-y-3"><h2 className="font-semibold text-slate-900">Create a Quick Split</h2><div className="grid gap-3 sm:grid-cols-2"><label className="text-xs font-semibold text-slate-600">Trip name<input required minLength={2} maxLength={100} value={tripName} onChange={(e) => setTripName(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 p-2.5 text-sm" placeholder="e.g. Goa Weekend"/></label><label className="text-xs font-semibold text-slate-600">Trip date<input type="date" required value={tripDate} onChange={(e) => setTripDate(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 p-2.5 text-sm"/></label></div><label className="block text-xs font-semibold text-slate-600">Description (optional)<textarea maxLength={500} value={tripDescription} onChange={(e) => setTripDescription(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 p-2.5 text-sm" rows={2}/></label><p className="text-xs text-slate-500">Two participants, Person A and Person B, will be added automatically. You can rename them or add more people later.</p><div className="flex justify-end gap-2"><button type="button" onClick={() => setCreateOpen(false)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">Cancel</button><button className="rounded-lg bg-[#065F46] px-4 py-2 text-sm font-semibold text-white">Create Quick Split</button></div></form>}

      <div className="grid gap-5 lg:grid-cols-[260px_minmax(0,1fr)]">
        <aside className="rounded-2xl border border-slate-200 bg-white p-3"><h2 className="px-2 py-2 text-xs font-bold uppercase tracking-wider text-slate-500">Your trips</h2>{ledgers.length === 0 ? <p className="p-3 text-sm text-slate-500">No Quick Splits yet. Create one to begin.</p> : ledgers.map((ledger) => <button key={ledger.id} type="button" onClick={() => { setSelectedId(ledger.id); setPendingParticipantNames([]); setEditingTrip(false); void loadDetailFor(ledger.id); }} className={`mb-1 w-full rounded-xl p-3 text-left ${selectedId === ledger.id ? 'bg-emerald-50 ring-1 ring-emerald-200' : 'hover:bg-slate-50'}`}><span className="block text-sm font-semibold text-slate-900">{ledger.title}</span><span className="mt-1 block text-xs text-slate-500">{ledger.event_date} · {ledger.participants.length} people</span><span className="mt-1 block text-xs font-semibold text-slate-700">{formatINR(ledger.totalExpenditurePaise)}</span></button>)}</aside>

        <main className="min-w-0 space-y-5">
          {!detail ? <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center"><Users className="mx-auto h-8 w-8 text-slate-400"/><p className="mt-3 text-sm font-semibold text-slate-800">Choose a trip or create a new one</p></div> : <>
            <section className="rounded-2xl border border-slate-200 bg-white p-5">
              <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-display text-xl font-bold text-slate-900">{detail.ledger.title}</h2><p className="mt-1 text-sm text-slate-600">{detail.ledger.description || 'No trip description'}</p><p className="mt-2 inline-flex items-center gap-1.5 text-xs text-slate-500"><CalendarDays className="h-3.5 w-3.5"/>{detail.ledger.event_date}</p></div><div className="flex flex-wrap gap-2"><button type="button" onClick={() => { setTripName(detail.ledger.title); setTripDescription(detail.ledger.description); setTripDate(detail.ledger.event_date); setEditingTrip(true); }} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700"><Edit3 className="h-3.5 w-3.5"/> Edit trip</button><button type="button" onClick={() => setExportOpen(true)} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700"><Download className="h-3.5 w-3.5"/> Export CSV</button><button type="button" onClick={openNewExpense} className="inline-flex items-center gap-1.5 rounded-lg bg-[#065F46] px-3 py-2 text-xs font-semibold text-white"><Plus className="h-3.5 w-3.5"/> Add expense</button></div></div>
              {editingTrip && <form onSubmit={saveTripDetails} className="mt-4 grid gap-3 border-t border-slate-100 pt-4 sm:grid-cols-2"><label className="text-xs font-semibold text-slate-600">Trip name<input required value={tripName} onChange={(e) => setTripName(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 p-2 text-sm"/></label><label className="text-xs font-semibold text-slate-600">Trip date<input type="date" required value={tripDate} onChange={(e) => setTripDate(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 p-2 text-sm"/></label><label className="text-xs font-semibold text-slate-600 sm:col-span-2">Description<textarea value={tripDescription} onChange={(e) => setTripDescription(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 p-2 text-sm" rows={2}/></label><div className="flex gap-2 sm:col-span-2"><button className="rounded-lg bg-[#065F46] px-3 py-2 text-xs font-semibold text-white">Save trip details</button><button type="button" onClick={() => setEditingTrip(false)} className="rounded-lg border border-slate-300 px-3 py-2 text-xs">Cancel</button></div></form>}
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div><h3 className="font-semibold text-slate-900">Participants</h3><p className="text-xs text-slate-500">Edit existing names or add people. Save your changes together.</p></div>
                <button type="button" onClick={addParticipantField} className="inline-flex items-center gap-1 rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white"><Plus className="h-3.5 w-3.5"/> Add another participant</button>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {detail.participants.map((participant) => (
                  <div key={participant.id} className="flex items-center gap-2 rounded-xl border border-slate-200 p-3">
                    <Users className="h-4 w-4 shrink-0 text-slate-400"/>
                    <input value={participantDrafts[participant.id] ?? participant.display_name}
                      onFocus={(event) => { if ((participantDrafts[participant.id] ?? participant.display_name) === participant.display_name) { setParticipantDrafts((old) => ({ ...old, [participant.id]: '' })); event.currentTarget.select(); } }}
                      onChange={(e) => setParticipantDrafts((old) => ({ ...old, [participant.id]: e.target.value }))}
                      className="min-w-0 flex-1 border-b border-transparent bg-transparent text-sm font-medium text-slate-800 focus:border-emerald-600 focus:outline-none" aria-label={`Participant ${participant.display_name}`}/>
                  </div>
                ))}
              </div>
              {pendingParticipantNames.length > 0 && <div className="mt-4 rounded-xl border border-dashed border-emerald-300 bg-emerald-50/40 p-3">
                <p className="mb-2 text-xs font-semibold text-slate-700">New participant fields</p>
                <div className="space-y-2">{pendingParticipantNames.map((name, index) => <div key={index} className="flex gap-2">
                  <input autoFocus={index === pendingParticipantNames.length - 1} value={name} onFocus={(event) => { if (/^Person (?:[A-Z]|\d+)$/.test(name)) event.currentTarget.select(); }} onChange={(e) => setPendingParticipantNames((old) => old.map((value, i) => i === index ? e.target.value : value))} className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" aria-label={`New participant ${index + 1}`}/>
                  <button type="button" onClick={() => setPendingParticipantNames((old) => old.filter((_, i) => i !== index))} className="rounded-lg p-2 text-emerald-800 hover:bg-emerald-50" aria-label="Remove participant field"><Trash2 className="h-4 w-4"/></button>
                </div>)}</div>
              </div>}
              <div className="mt-4 flex flex-wrap justify-end gap-2">
                {(pendingParticipantNames.length > 0 || detail.participants.some((participant) => (participantDrafts[participant.id] ?? participant.display_name) !== participant.display_name)) && <button type="button" onClick={() => { setPendingParticipantNames([]); setParticipantDrafts(Object.fromEntries(detail.participants.map((participant) => [participant.id, participant.display_name]))); }} className="rounded-lg border border-slate-300 px-3 py-2 text-xs">Cancel</button>}
                <button type="button" onClick={saveAllParticipants} disabled={savingParticipant || (pendingParticipantNames.length === 0 && !detail.participants.some((participant) => (participantDrafts[participant.id] ?? participant.display_name) !== participant.display_name))} className="rounded-lg bg-[#065F46] px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">{savingParticipant ? 'Saving…' : 'Save participants'}</button>
              </div>
            </section>

            <section className="grid gap-3 sm:grid-cols-3"><div className="rounded-2xl border border-slate-200 bg-white p-4"><p className="text-xs text-slate-500">Total trip spending</p><p className="mt-1 text-xl font-bold text-slate-900">{formatINR(detail.summary.totalExpenditurePaise)}</p></div><div className="rounded-2xl border border-slate-200 bg-white p-4"><p className="text-xs text-slate-500">Participants</p><p className="mt-1 text-xl font-bold text-slate-900">{detail.participants.length}</p></div><div className="rounded-2xl border border-slate-200 bg-white p-4"><p className="text-xs text-slate-500">Bills recorded</p><p className="mt-1 text-xl font-bold text-slate-900">{detail.expenses.length}</p></div></section>

            <section className="rounded-2xl border border-slate-200 bg-white p-5"><div className="flex items-center gap-2"><BarChart3 className="h-4 w-4 text-emerald-700"/><h3 className="font-semibold text-slate-900">Participant spending and balances</h3></div><div className="mt-4 flex flex-wrap items-center gap-5 border-b border-slate-100 pb-4"><div className="relative h-28 w-28 shrink-0 rounded-full" style={consumptionPieStyle}><div className="absolute inset-5 flex items-center justify-center rounded-full bg-white text-center"><span className="text-[10px] font-semibold text-slate-500">Actual<br/>shares</span></div></div><div className="grid flex-1 gap-2 sm:grid-cols-2">{detail.summary.participants.map((participant, index) => { const greens = ['#064E3B', '#047857', '#059669', '#10B981', '#34D399', '#6EE7B7', '#A7F3D0']; return <div key={participant.id} className="flex items-center gap-2 text-xs"><span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: greens[index % greens.length] }}/><span className="min-w-0 flex-1 truncate text-slate-700">{participant.name}</span><strong className="text-slate-900">{formatINR(participant.consumedPaise)}</strong></div>; })}</div></div><div className="mt-4 space-y-4">{detail.summary.participants.map((participant) => { const max = Math.max(1, ...detail.summary.participants.map((p) => Math.max(p.paidPaise, p.consumedPaise))); return <div key={participant.id}><div className="mb-1 flex flex-wrap items-center justify-between gap-2 text-xs"><span className="font-semibold text-slate-800">{participant.name}</span><span className={participant.netPaise >= 0 ? 'font-semibold text-emerald-700' : 'font-semibold text-red-700'}>{participant.netPaise >= 0 ? `Receivable ${formatINR(participant.netPaise)}` : `Payable ${formatINR(-participant.netPaise)}`}</span></div><div className="grid grid-cols-2 gap-2"><div><div className="mb-1 flex justify-between text-[10px] text-slate-500"><span>Paid</span><span>{formatINR(participant.paidPaise)}</span></div><div className="h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-emerald-600" style={{ width: `${participant.paidPaise / max * 100}%` }}/></div></div><div><div className="mb-1 flex justify-between text-[10px] text-slate-500"><span>Consumed</span><span>{formatINR(participant.consumedPaise)}</span></div><div className="h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-emerald-300" style={{ width: `${participant.consumedPaise / max * 100}%` }}/></div></div></div></div>; })}</div></section>

            <section className="rounded-2xl border border-slate-200 bg-white p-5"><h3 className="font-semibold text-slate-900">Who owes whom</h3>{detail.summary.transfers.length === 0 ? <p className="mt-3 text-sm text-slate-500">Everyone is settled up.</p> : <div className="mt-3 space-y-2">{detail.summary.transfers.map((transfer) => <div key={`${transfer.fromParticipantId}-${transfer.toParticipantId}`} className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-slate-50 p-3"><div className="flex items-center gap-2 text-sm"><span className="font-semibold text-red-700">{transfer.fromName}</span><ArrowUpRight className="h-4 w-4 text-slate-400"/><span className="font-semibold text-emerald-700">{transfer.toName}</span></div><div className="flex items-center gap-3"><span className="font-bold text-slate-900">{formatINR(transfer.amountPaise)}</span><button type="button" onClick={() => recordSettlement(transfer)} className="rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white">Record paid</button></div></div>)}</div>}</section>

            <section className="rounded-2xl border border-slate-200 bg-white p-5"><div className="flex items-center justify-between gap-3"><h3 className="font-semibold text-slate-900">Trip expenses</h3><span className="text-xs text-slate-500">Newest first</span></div>{detail.expenses.length === 0 ? <div className="py-8 text-center"><ReceiptText className="mx-auto h-8 w-8 text-slate-300"/><p className="mt-2 text-sm text-slate-500">No expenses yet. Add your first bill to begin.</p></div> : <div className="mt-3 space-y-3">{detail.expenses.map((expense) => <article key={expense.id} className="rounded-xl border border-slate-200 p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><h4 className="font-semibold text-slate-900">{expense.title}</h4><p className="mt-1 text-xs text-slate-500">{expense.expense_date} · Paid by {expense.payer_name}{expense.description ? ` · ${expense.description}` : ''}</p></div><div className="flex items-center gap-2"><strong className="text-sm text-slate-900">{formatINR(expense.total_paise)}</strong><button type="button" onClick={() => openEditExpense(expense)} className="rounded-lg border border-slate-300 p-2 text-slate-600" title="Edit expense"><Edit3 className="h-3.5 w-3.5"/></button><button type="button" onClick={() => deleteExpense(expense.id)} className="rounded-lg border border-slate-300 p-2 text-slate-800 hover:bg-slate-50" title="Delete expense"><Trash2 className="h-3.5 w-3.5"/></button></div></div><div className="mt-3 space-y-2">{expense.items.map((item) => <div key={item.id} className="rounded-lg bg-slate-50 p-3"><div className="flex justify-between gap-2 text-xs"><span className="font-semibold text-slate-800">{item.name} × {item.quantity}</span><span className="font-semibold text-slate-800">{formatINR(item.total_paise)}</span></div><p className="mt-1 text-[11px] text-slate-500">{item.consumers.map((c) => `${c.display_name}: ${formatINR(c.share_paise)}`).join(' · ')}</p></div>)}</div><div className="mt-3 flex flex-wrap gap-2">{expense.shares.map((share) => <span key={share.participant_id} className="rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] text-emerald-800">{share.display_name}: {formatINR(share.owed_paise)}</span>)}</div></article>)}</div>}</section>
            {detail.settlements.length > 0 && <section className="rounded-2xl border border-slate-200 bg-white p-5"><h3 className="font-semibold text-slate-900">Settlement history</h3><div className="mt-3 space-y-2">{detail.settlements.map((settlement) => <div key={settlement.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2 text-sm"><span>{settlement.payer_name} paid {settlement.receiver_name}</span><div className="flex items-center gap-3"><span className="font-semibold text-emerald-700">{formatINR(settlement.amount_paise)} · {settlement.settlement_date}</span><button type="button" onClick={() => undoSettlement(settlement.id)} className="text-xs font-semibold text-red-700 underline">Undo</button></div></div>)}</div><p className="mt-3 text-xs text-slate-500">To edit or delete an expense after settling, undo the recorded settlements first.</p></section>}
          </>}
        </main>
      </div>

      {expenseOpen && detail && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-3"><form onSubmit={saveExpense} className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white p-5 shadow-xl"><div className="flex items-center justify-between"><h2 className="text-lg font-bold text-slate-900">{editingExpenseId ? 'Edit trip expense' : 'Add trip expense'}</h2><button type="button" onClick={() => setExpenseOpen(false)} className="rounded-lg p-2 text-slate-500"><X className="h-5 w-5"/></button></div><div className="mt-4 grid gap-3 sm:grid-cols-2"><label className="text-xs font-semibold text-slate-600">Bill title<input required minLength={2} value={expenseTitle} onChange={(e) => setExpenseTitle(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 p-2.5 text-sm" placeholder="e.g. Dinner at restaurant"/></label><label className="text-xs font-semibold text-slate-600">Expense date<input required type="date" value={expenseDate} onChange={(e) => setExpenseDate(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 p-2.5 text-sm"/></label><label className="text-xs font-semibold text-slate-600 sm:col-span-2">Description (optional)<input value={expenseDescription} onChange={(e) => setExpenseDescription(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 p-2.5 text-sm"/></label><label className="text-xs font-semibold text-slate-600 sm:col-span-2">Who paid this bill?<select required value={payerId} onChange={(e) => setPayerId(Number(e.target.value))} className="mt-1 w-full rounded-lg border border-slate-300 p-2.5 text-sm">{detail.participants.map((p) => <option key={p.id} value={p.id}>{p.display_name}</option>)}</select></label></div><div className="mt-5 flex items-center justify-between"><h3 className="font-semibold text-slate-900">Items and actual consumers</h3><button type="button" onClick={() => setItems((old) => [...old, emptyItem(detail.participants.map((p) => p.id))])} className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold"><Plus className="h-3.5 w-3.5"/> Add item</button></div><div className="mt-3 space-y-3">{items.map((item, index) => <div key={index} className="rounded-xl border border-slate-200 p-3"><div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_130px_100px_40px]"><label className="text-[11px] font-semibold text-slate-500">Item name<input required value={item.name} onChange={(e) => setItems((old) => old.map((v, i) => i === index ? { ...v, name: e.target.value } : v))} className="mt-1 w-full rounded-lg border border-slate-300 p-2 text-sm" placeholder="Tea, coffee, snacks…"/></label><label className="text-[11px] font-semibold text-slate-500">Unit price (₹)<input required type="number" min="0.01" step="0.01" value={item.unitPrice} onChange={(e) => setItems((old) => old.map((v, i) => i === index ? { ...v, unitPrice: e.target.value } : v))} className="mt-1 w-full rounded-lg border border-slate-300 p-2 text-sm"/></label><label className="text-[11px] font-semibold text-slate-500">Quantity<input required type="number" min="1" step="1" value={item.quantity} onChange={(e) => setItems((old) => old.map((v, i) => i === index ? { ...v, quantity: e.target.value } : v))} className="mt-1 w-full rounded-lg border border-slate-300 p-2 text-sm"/></label><button type="button" disabled={items.length === 1} onClick={() => setItems((old) => old.filter((_, i) => i !== index))} className="mt-5 rounded-lg p-2 text-slate-400 hover:text-red-600 disabled:opacity-30" title="Remove item"><Trash2 className="h-4 w-4"/></button></div><div className="mt-3"><p className="mb-2 text-[11px] font-semibold text-slate-500">Who consumed this item?</p><div className="flex flex-wrap gap-2">{detail.participants.map((participant) => <label key={participant.id} className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-xs ${item.participantIds.includes(participant.id) ? 'border-emerald-300 bg-emerald-50 text-emerald-800' : 'border-slate-200 text-slate-600'}`}><input type="checkbox" checked={item.participantIds.includes(participant.id)} onChange={(e) => setItems((old) => old.map((v, i) => i === index ? { ...v, participantIds: e.target.checked ? [...v.participantIds, participant.id] : v.participantIds.filter((id) => id !== participant.id) } : v))}/>{participant.display_name}</label>)}</div></div></div>)}</div><div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4"><div><p className="text-xs text-slate-500">Calculated bill total</p><p className="text-xl font-bold text-slate-900">{formatINR(totalBillPaise)}</p></div><div className="flex gap-2"><button type="button" onClick={() => setExpenseOpen(false)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm">Cancel</button><button disabled={savingExpense} className="rounded-lg bg-[#065F46] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{savingExpense ? 'Saving…' : 'Save expense'}</button></div></div></form></div>}
      {exportOpen && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4"><div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl"><h2 className="font-bold text-slate-900">Export Quick Split CSV</h2><p className="mt-1 text-sm text-slate-600">Choose the order for expenses and settlements.</p><div className="mt-4 grid grid-cols-2 gap-2"><button type="button" onClick={() => exportCsv('newest')} className="rounded-lg bg-[#065F46] px-3 py-2.5 text-sm font-semibold text-white">Newest first</button><button type="button" onClick={() => exportCsv('oldest')} className="rounded-lg border border-slate-300 px-3 py-2.5 text-sm font-semibold text-slate-700">Oldest first</button></div><button type="button" onClick={() => setExportOpen(false)} className="mt-3 w-full rounded-lg px-3 py-2 text-sm text-slate-500">Cancel</button></div></div>}
    </div>
  );

  async function loadDetailFor(id: number) {
    try { const next = await apiRequest<LedgerDetail>(`/api/trip-ledger/${id}`); setDetail(next); setParticipantDrafts(Object.fromEntries(next.participants.map((p) => [p.id, p.display_name]))); }
    catch (error) { onToast(error instanceof Error ? error.message : 'Unable to load Quick Split.', 'error'); }
  }
};
