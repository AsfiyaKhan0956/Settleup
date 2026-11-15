import React, { useEffect, useState } from 'react';
import { ArrowRight, Check, Copy, Loader2, QrCode, X } from 'lucide-react';
import { apiRequest } from '../../services/api.ts';
import { formatINR, rupeesToPaise } from '../../utils/currency.ts';
import type { AuthUser, GroupSummary, MemberNetBalance, SettlementRecord, SimplifiedTransfer } from '../../types/index.ts';

export interface ActivePayTarget {
  groupId: number;
  groupName: string;
  payerUserId: number;
  payerName: string;
  receiverUserId: number;
  receiverName: string;
  amountPaise: number;
}

export const UpiQrPaymentModal: React.FC<{
  target: ActivePayTarget;
  currentUser: AuthUser;
  onClose: () => void;
  onRecorded: () => void;
  onToast: (msg: string, tone?: 'success' | 'error') => void;
}> = ({ target, currentUser, onClose, onRecorded, onToast }) => {
  const [qrData, setQrData] = useState<{
    upiUri: string;
    upiVpa: string;
    hasConfiguredUpi: boolean;
    paymentReference: string;
    qrDataUrl: string;
    amountRupees: string;
  } | null>(null);
  const [amountStr, setAmountStr] = useState((target.amountPaise / 100).toFixed(2));
  const [paymentMethod, setPaymentMethod] = useState('UPI');
  const [referenceCode, setReferenceCode] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const loadQr = (paise: number) => {
    if (paise <= 0) return;
    apiRequest<NonNullable<typeof qrData>>('/api/balances/upi-qr', {
      method: 'POST',
      body: JSON.stringify({
        groupId: target.groupId,
        receiverUserId: target.receiverUserId,
        amountPaise: paise,
        note: `SettleUp ${target.groupName}`,
      }),
    }).then((res) => {
      setQrData(res);
    });
  };

  useEffect(() => {
    loadQr(target.amountPaise);
  }, [target]);

  const handleRecord = async (e: React.FormEvent) => {
    e.preventDefault();
    const paise = rupeesToPaise(amountStr);
    if (paise <= 0) {
      onToast('Amount must be greater than ₹0.', 'error');
      return;
    }
    setSubmitting(true);
    try {
      const res = await apiRequest<{ status: string }>('/api/balances/settlements', {
        method: 'POST',
        body: JSON.stringify({
          groupId: target.groupId,
          payerUserId: target.payerUserId,
          receiverUserId: target.receiverUserId,
          amountPaise: paise,
          paymentMethod,
          referenceCode: referenceCode.trim() || qrData?.paymentReference || '',
          upiUri: qrData?.upiUri || '',
          notes: notes.trim(),
        }),
      });
      onToast(
        res.status === 'confirmed'
          ? 'Settlement confirmed and balances updated.'
          : 'Payment recorded. Waiting for recipient to confirm receipt.',
        'success'
      );
      onRecorded();
      onClose();
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Unable to record settlement.', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const isReceiver = currentUser.id === target.receiverUserId;

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
      <div className="bg-white border border-slate-200 rounded-2xl max-w-lg w-full max-h-[92vh] overflow-y-auto p-6 space-y-5">
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 pb-4">
          <div>
            <p className="text-xs font-medium text-[#065F46]">{target.groupName}</p>
            <h2 className="font-display text-lg font-bold text-slate-900">
              {target.payerName} <ArrowRight className="w-4 h-4 inline text-slate-400" /> {target.receiverName}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="text-slate-400 hover:text-slate-700 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* UPI QR Display */}
        {qrData && (
          <div className="border border-slate-200 rounded-xl bg-[#F8FAFC] p-4 flex flex-col sm:flex-row items-center gap-4">
            <img
              src={qrData.qrDataUrl}
              alt="UPI payment QR code"
              className="w-36 h-36 rounded-lg border border-slate-200 bg-white p-1.5 shrink-0"
            />
            <div className="space-y-2 text-xs text-slate-600 flex-1 min-w-0">
              <p className="font-semibold text-slate-900 text-sm">Scan in GPay, PhonePe, or Paytm</p>
              <p>
                Recipient UPI: <span className="font-mono-num font-semibold text-slate-900">{qrData.upiVpa}</span>
                {!qrData.hasConfiguredUpi && ' (placeholder — update in Profile)'}
              </p>
              <p>
                Suggested Ref: <span className="font-mono-num text-slate-800">{qrData.paymentReference}</span>
              </p>
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(qrData.upiVpa);
                  onToast('UPI ID copied.', 'success');
                }}
                className="inline-flex items-center gap-1 px-2.5 py-1 bg-white border border-slate-300 rounded text-slate-700 font-medium cursor-pointer"
              >
                <Copy className="w-3 h-3" /> Copy UPI ID
              </button>
            </div>
          </div>
        )}

        <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-900">
          Note: Scanning a UPI QR does not automatically verify bank settlement. Submit your UTR/reference below—balances clear once {target.receiverName} confirms receipt.
        </div>

        <form onSubmit={handleRecord} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Amount (₹ INR)</label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                value={amountStr}
                onChange={(e) => {
                  setAmountStr(e.target.value);
                  const p = rupeesToPaise(e.target.value);
                  if (p > 0) loadQr(p);
                }}
                className="w-full px-3 py-2 text-sm font-mono-num font-semibold border border-slate-300 rounded-lg"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Method</label>
              <select
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
              >
                <option value="UPI">UPI (GPay / PhonePe)</option>
                <option value="Bank Transfer">NEFT / IMPS</option>
                <option value="Cash">Cash</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              UTR / Transaction Reference (Optional for cash)
            </label>
            <input
              type="text"
              value={referenceCode}
              onChange={(e) => setReferenceCode(e.target.value)}
              placeholder="e.g., UTR432009182736"
              className="w-full px-3 py-2 text-sm font-mono-num border border-slate-300 rounded-lg"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Note</label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional settlement note"
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
            />
          </div>

          <div className="flex justify-end gap-2.5 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-slate-700 border border-slate-300 rounded-lg cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-5 py-2 text-sm font-semibold text-white bg-[#065F46] hover:bg-[#047857] rounded-lg inline-flex items-center gap-2 cursor-pointer"
            >
              {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
              <span>{isReceiver ? 'Confirm Payment Received' : 'Record Payment'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export const SettlementsView: React.FC<{
  currentUser: AuthUser;
  onOpenPayQr: (target: ActivePayTarget) => void;
  onToast: (msg: string, tone?: 'success' | 'error') => void;
  refreshSignal: number;
}> = ({ currentUser, onOpenPayQr, onToast, refreshSignal }) => {
  const [suggested, setSuggested] = useState<Array<SimplifiedTransfer & { groupId: number; groupName: string }>>([]);
  const [settlements, setSettlements] = useState<SettlementRecord[]>([]);
  const [groups, setGroups] = useState<GroupSummary[]>([]);
  const [groupMembers, setGroupMembers] = useState<MemberNetBalance[]>([]);
  const [loading, setLoading] = useState(true);

  // Manual entry form
  const [manualGroupId, setManualGroupId] = useState<number | ''>('');
  const [manualPayerId, setManualPayerId] = useState<number | ''>('');
  const [manualReceiverId, setManualReceiverId] = useState<number | ''>('');
  const [manualAmountStr, setManualAmountStr] = useState('');

  const loadData = () => {
    setLoading(true);
    Promise.all([
      apiRequest<{
        suggestedTransfers: Array<SimplifiedTransfer & { groupId: number; groupName: string }>;
        settlements: SettlementRecord[];
      }>('/api/balances/overview'),
      apiRequest<{ groups: GroupSummary[] }>('/api/groups'),
    ])
      .then(([bal, grp]) => {
        setSuggested(bal.suggestedTransfers);
        setSettlements(bal.settlements);
        setGroups(grp.groups);
        if (!manualGroupId && grp.groups.length > 0) {
          setManualGroupId(grp.groups[0].id);
        }
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadData();
  }, [refreshSignal]);

  useEffect(() => {
    if (!manualGroupId) return;
    apiRequest<{ members: MemberNetBalance[] }>(`/api/groups/${manualGroupId}`).then((res) => {
      setGroupMembers(res.members);
      if (res.members.length >= 2) {
        setManualPayerId(currentUser.id);
        const other = res.members.find((m) => m.userId !== currentUser.id);
        setManualReceiverId(other?.userId ?? res.members[0].userId);
      }
    });
  }, [manualGroupId]);

  const handleConfirm = async (id: number) => {
    try {
      await apiRequest(`/api/balances/settlements/${id}/confirm`, { method: 'POST' });
      onToast('Settlement confirmed! Group balances updated.', 'success');
      loadData();
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Unable to confirm', 'error');
    }
  };

  const handleLaunchManualQr = (e: React.FormEvent) => {
    e.preventDefault();
    const paise = rupeesToPaise(manualAmountStr);
    if (!manualGroupId || !manualPayerId || !manualReceiverId || paise <= 0) {
      onToast('Select group, payer, receiver, and an amount > ₹0.', 'error');
      return;
    }
    if (manualPayerId === manualReceiverId) {
      onToast('Payer and receiver must be different people.', 'error');
      return;
    }
    const g = groups.find((x) => x.id === Number(manualGroupId));
    const payer = groupMembers.find((m) => m.userId === Number(manualPayerId));
    const receiver = groupMembers.find((m) => m.userId === Number(manualReceiverId));
    onOpenPayQr({
      groupId: Number(manualGroupId),
      groupName: g?.name || 'Group',
      payerUserId: Number(manualPayerId),
      payerName: payer?.fullName || 'Payer',
      receiverUserId: Number(manualReceiverId),
      receiverName: receiver?.fullName || 'Receiver',
      amountPaise: paise,
    });
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-slate-900">Settlements &amp; UPI QR</h1>
        <p className="text-sm text-slate-600 mt-0.5">
          Generate UPI payment QRs, record transaction references, and confirm receipts honestly.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Suggested Transfers */}
        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-6 space-y-4">
          <h2 className="font-display text-base font-bold text-slate-900">Suggested Transfers</h2>
          {loading ? (
            <p className="text-sm text-slate-500">Loading...</p>
          ) : suggested.length === 0 ? (
            <p className="text-sm text-slate-500 py-4">No outstanding transfers required.</p>
          ) : (
            <div className="space-y-3">
              {suggested.map((t, i) => (
                <div key={i} className="border border-slate-200 rounded-lg p-4 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs text-slate-500">{t.groupName}</p>
                    <p className="text-sm font-semibold text-slate-900 mt-0.5">
                      {t.fromName} <ArrowRight className="w-3.5 h-3.5 inline text-slate-400" /> {t.toName}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-mono-num font-bold text-slate-900">{formatINR(t.amountPaise)}</span>
                    <button
                      type="button"
                      onClick={() =>
                        onOpenPayQr({
                          groupId: t.groupId,
                          groupName: t.groupName,
                          payerUserId: t.fromUserId,
                          payerName: t.fromName,
                          receiverUserId: t.toUserId,
                          receiverName: t.toName,
                          amountPaise: t.amountPaise,
                        })
                      }
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-[#065F46] hover:bg-[#047857] rounded-md cursor-pointer"
                    >
                      <QrCode className="w-3.5 h-3.5" /> Pay / Settle
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Custom Settlement Form */}
        <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-6 space-y-4">
          <h2 className="font-display text-base font-bold text-slate-900">Record Custom Settlement</h2>
          <form onSubmit={handleLaunchManualQr} className="space-y-3.5">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Group</label>
              <select
                value={manualGroupId}
                onChange={(e) => setManualGroupId(Number(e.target.value))}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
              >
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Payer</label>
                <select
                  value={manualPayerId}
                  onChange={(e) => setManualPayerId(Number(e.target.value))}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                >
                  {groupMembers.map((m) => (
                    <option key={m.userId} value={m.userId}>
                      {m.fullName}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Receiver</label>
                <select
                  value={manualReceiverId}
                  onChange={(e) => setManualReceiverId(Number(e.target.value))}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                >
                  {groupMembers.map((m) => (
                    <option key={m.userId} value={m.userId}>
                      {m.fullName}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Amount (₹ INR)</label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                value={manualAmountStr}
                onChange={(e) => setManualAmountStr(e.target.value)}
                placeholder="55.00"
                required
                className="w-full px-3 py-2 text-sm font-mono-num border border-slate-300 rounded-lg"
              />
            </div>
            <button
              type="submit"
              className="w-full py-2.5 text-sm font-semibold text-white bg-[#065F46] hover:bg-[#047857] rounded-lg cursor-pointer"
            >
              Generate UPI QR &amp; Record
            </button>
          </form>
        </div>
      </div>

      {/* Settlement History */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200">
          <h2 className="font-display text-base font-bold text-slate-900">Settlement History</h2>
        </div>
        {settlements.length === 0 ? (
          <p className="p-8 text-center text-sm text-slate-500">No settlements recorded yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-left text-xs font-semibold text-slate-600">
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Group</th>
                  <th className="px-4 py-3">Transfer</th>
                  <th className="px-4 py-3">Method &amp; Ref</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Amount</th>
                  <th className="px-4 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {settlements.map((s) => (
                  <tr key={s.id} className="h-12">
                    <td className="px-4 py-2.5 font-mono-num text-xs text-slate-500">
                      {s.created_at.slice(0, 10)}
                    </td>
                    <td className="px-4 py-2.5 text-slate-700">{s.group_name}</td>
                    <td className="px-4 py-2.5 font-medium text-slate-900">
                      {s.payer_name} → {s.receiver_name}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-slate-600 font-mono-num">
                      {s.payment_method} {s.reference_code ? `· ${s.reference_code}` : ''}
                    </td>
                    <td className="px-4 py-2.5 text-xs font-semibold">
                      {s.status === 'confirmed' ? (
                        <span className="text-[#065F46]">Confirmed</span>
                      ) : (
                        <span className="text-amber-700">Awaiting Confirmation</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono-num font-semibold text-slate-900">
                      {formatINR(s.amount_paise)}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {s.status !== 'confirmed' && s.receiver_user_id === currentUser.id ? (
                        <button
                          type="button"
                          onClick={() => handleConfirm(s.id)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold bg-[#065F46] text-white rounded cursor-pointer"
                        >
                          <Check className="w-3 h-3" /> Confirm Receipt
                        </button>
                      ) : (
                        <span className="text-xs text-slate-400">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
