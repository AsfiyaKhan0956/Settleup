import React, { useEffect, useState } from 'react';
import { ArrowRight, HelpCircle, Scale } from 'lucide-react';
import { apiRequest } from '../../services/api.ts';
import { formatINR } from '../../utils/currency.ts';
import type { AuthUser, MemberNetBalance, SimplifiedTransfer } from '../../types/index.ts';

interface BalancesViewProps {
  currentUser: AuthUser;
  onOpenPayQr: (transfer: {
    groupId: number;
    groupName: string;
    payerUserId: number;
    payerName: string;
    receiverUserId: number;
    receiverName: string;
    amountPaise: number;
  }) => void;
}

interface GroupBalanceSummary {
  groupId: number;
  groupName: string;
  category: string;
  myPaidPaise: number;
  myOwedPaise: number;
  myNetPaise: number;
  members: MemberNetBalance[];
  transfers: SimplifiedTransfer[];
}

export const BalancesView: React.FC<BalancesViewProps> = ({ currentUser, onOpenPayQr }) => {
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState({
    totalIOwePaise: 0,
    totalOwedToMePaise: 0,
    netBalancePaise: 0,
  });
  const [groups, setGroups] = useState<GroupBalanceSummary[]>([]);
  const [transfers, setTransfers] = useState<Array<SimplifiedTransfer & { groupId: number; groupName: string }>>([]);

  useEffect(() => {
    setLoading(true);
    apiRequest<{
      summary: typeof summary;
      groupSummaries: GroupBalanceSummary[];
      suggestedTransfers: Array<SimplifiedTransfer & { groupId: number; groupName: string }>;
    }>('/api/balances/overview')
      .then((res) => {
        setSummary(res.summary);
        setGroups(res.groupSummaries);
        setTransfers(res.suggestedTransfers);
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <div className="h-64 bg-white border border-slate-200 rounded-xl animate-pulse" />;
  }

  const iOweList = transfers.filter((t) => t.fromUserId === currentUser.id);
  const owedToMeList = transfers.filter((t) => t.toUserId === currentUser.id);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-slate-900">Balances — Who Owes Whom</h1>
        <p className="text-sm text-slate-600 mt-0.5">
          Transparent net positions and simplified minimum-transfer paths across every group.
        </p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <p className="text-xs text-slate-500">People I Owe</p>
          <p className="font-mono-num text-2xl font-bold text-[#B91C1C] mt-1">
            {formatINR(summary.totalIOwePaise)}
          </p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <p className="text-xs text-slate-500">People Who Owe Me</p>
          <p className="font-mono-num text-2xl font-bold text-[#065F46] mt-1">
            {formatINR(summary.totalOwedToMePaise)}
          </p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <p className="text-xs text-slate-500">Overall Net Balance</p>
          <p
            className={`font-mono-num text-2xl font-bold mt-1 ${
              summary.netBalancePaise >= 0 ? 'text-[#065F46]' : 'text-[#B91C1C]'
            }`}
          >
            {summary.netBalancePaise > 0
              ? `+${formatINR(summary.netBalancePaise)}`
              : formatINR(summary.netBalancePaise)}
          </p>
        </div>
      </div>

      {/* People I Owe vs People Who Owe Me */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
          <h2 className="font-display text-base font-bold text-slate-900">People I Owe</h2>
          {iOweList.length === 0 ? (
            <p className="text-sm text-slate-500 py-6">You do not owe anyone right now.</p>
          ) : (
            <div className="space-y-3">
              {iOweList.map((t, idx) => (
                <div key={idx} className="border border-slate-200 rounded-lg p-4 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">
                      You owe {t.toName}
                    </p>
                    <p className="text-xs text-slate-500">{t.groupName}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-mono-num text-base font-bold text-[#B91C1C]">
                      {formatINR(t.amountPaise)}
                    </span>
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
                      className="px-3 py-1.5 text-xs font-semibold text-white bg-[#065F46] hover:bg-[#047857] rounded-md cursor-pointer"
                    >
                      Pay via UPI QR
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
          <h2 className="font-display text-base font-bold text-slate-900">People Who Owe Me</h2>
          {owedToMeList.length === 0 ? (
            <p className="text-sm text-slate-500 py-6">No pending receivables right now.</p>
          ) : (
            <div className="space-y-3">
              {owedToMeList.map((t, idx) => (
                <div key={idx} className="border border-slate-200 rounded-lg p-4 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">{t.fromName} owes you</p>
                    <p className="text-xs text-slate-500">{t.groupName}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-mono-num text-base font-bold text-[#065F46]">
                      +{formatINR(t.amountPaise)}
                    </span>
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
                      className="px-3 py-1.5 text-xs font-medium text-slate-700 border border-slate-300 hover:bg-slate-50 rounded-md cursor-pointer"
                    >
                      Record Received
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Detailed Calculation Explanation per Group */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
        <div className="flex items-center gap-2">
          <HelpCircle className="w-4 h-4 text-[#065F46]" />
          <h2 className="font-display text-base font-bold text-slate-900">
            How Your Group Balances Are Calculated
          </h2>
        </div>
        <p className="text-xs text-slate-600 leading-relaxed">
          Formula: <code className="font-mono-num bg-slate-100 px-1.5 py-0.5 rounded">Net = Paid Upfront − Total Splits Owed + Confirmed Settlements Paid − Confirmed Settlements Received</code>
        </p>

        <div className="space-y-4">
          {groups.map((g) => (
            <div key={g.groupId} className="border border-slate-200 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-display font-bold text-sm text-slate-900">{g.groupName}</h3>
                <span className="font-mono-num text-xs text-slate-600">
                  Paid {formatINR(g.myPaidPaise)} − Owed {formatINR(g.myOwedPaise)}
                </span>
              </div>
              {g.transfers.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {g.transfers.map((t, i) => (
                    <span
                      key={i}
                      className="text-xs bg-slate-50 border border-slate-200 rounded-md px-2.5 py-1.5 font-medium text-slate-800"
                    >
                      {t.fromName} <ArrowRight className="w-3 h-3 inline text-slate-400" /> {t.toName}:{' '}
                      <strong className="font-mono-num">{formatINR(t.amountPaise)}</strong>
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-[#065F46] flex items-center gap-1">
                  <Scale className="w-3.5 h-3.5" /> All members settled to ₹0.00
                </p>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
