import React, { useEffect, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Copy,
  Link2,
  Plus,
  QrCode,
  Receipt,
  Settings,
  Shield,
  Trash2,
  UserPlus,
} from 'lucide-react';
import { apiRequest } from '../../services/api.ts';
import { formatINR } from '../../utils/currency.ts';
import { UserAvatar } from '../common/BrandMark.tsx';
import type {
  ActivityRecord,
  AppRoute,
  AuthUser,
  ExpenseRecord,
  MemberNetBalance,
  SettlementRecord,
  SimplifiedTransfer,
} from '../../types/index.ts';

interface GroupWorkspaceViewProps {
  groupId: number;
  currentUser: AuthUser;
  onBack: () => void;
  onNavigate: (route: AppRoute, params?: { groupId?: number; expenseId?: number }) => void;
  onToast: (msg: string, tone?: 'success' | 'error') => void;
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

interface InvitationItem {
  id: number;
  invitee_email: string | null;
  token: string;
  status: string;
  max_uses: number;
  use_count: number;
  expires_at: string;
}

export const GroupWorkspaceView: React.FC<GroupWorkspaceViewProps> = ({
  groupId,
  currentUser,
  onBack,
  onNavigate,
  onToast,
  onOpenPayQr,
}) => {
  const [tab, setTab] = useState<'overview' | 'expenses' | 'members' | 'balances' | 'activity' | 'settings'>('overview');
  const [loading, setLoading] = useState(true);
  const [group, setGroup] = useState<{
    id: number;
    name: string;
    description: string;
    category: string;
    coverColor: string;
    isArchived: boolean;
    myRole: string;
    createdAt: string;
    totalExpenditurePaise: number;
    confirmedSettledPaise: number;
  } | null>(null);
  const [members, setMembers] = useState<MemberNetBalance[]>([]);
  const [transfers, setTransfers] = useState<SimplifiedTransfer[]>([]);
  const [expenses, setExpenses] = useState<ExpenseRecord[]>([]);
  const [invitations, setInvitations] = useState<InvitationItem[]>([]);
  const [inviteQr, setInviteQr] = useState<string | null>(null);
  const [inviteUrl, setInviteUrl] = useState<string>('');
  const [activities, setActivities] = useState<ActivityRecord[]>([]);
  const [settlements, setSettlements] = useState<SettlementRecord[]>([]);

  const [inviteEmail, setInviteEmail] = useState('');
  const [editName, setEditName] = useState('');
  const [editDesc, setEditDesc] = useState('');

  const loadWorkspace = () => {
    setLoading(true);
    apiRequest<{
      group: NonNullable<typeof group>;
      members: MemberNetBalance[];
      transfers: SimplifiedTransfer[];
      expenses: ExpenseRecord[];
      invitations: InvitationItem[];
      inviteQrDataUrl: string | null;
      activities: ActivityRecord[];
      settlements: SettlementRecord[];
    }>(`/api/groups/${groupId}`)
      .then((res) => {
        setGroup(res.group);
        setEditName(res.group.name);
        setEditDesc(res.group.description);
        setMembers(res.members);
        setTransfers(res.transfers);
        setExpenses(res.expenses);
        setInvitations(res.invitations);
        setInviteQr(res.inviteQrDataUrl);
        const activeInv = res.invitations.find((i) => i.status === 'pending' && !i.invitee_email);
        if (activeInv) {
          setInviteUrl(`${window.location.origin}/?invite=${activeInv.token}`);
        }
        setActivities(res.activities);
        setSettlements(res.settlements);
      })
      .catch((err) => onToast(err instanceof Error ? err.message : 'Unable to load group', 'error'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadWorkspace();
  }, [groupId]);

  const handleGenerateQrInvite = async () => {
    try {
      const res = await apiRequest<{ token: string; inviteUrl: string; qrDataUrl: string }>(
        `/api/groups/${groupId}/invitations`,
        { method: 'POST', body: JSON.stringify({ expiresInDays: 14 }) }
      );
      setInviteQr(res.qrDataUrl);
      setInviteUrl(res.inviteUrl);
      onToast('New shareable invite link and QR code generated.', 'success');
      loadWorkspace();
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Failed to create invite', 'error');
    }
  };

  const handleAddMemberByEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail.trim()) return;
    try {
      const res = await apiRequest<{ status: string; memberName?: string }>(`/api/groups/${groupId}/members`, {
        method: 'POST',
        body: JSON.stringify({ email: inviteEmail.trim() }),
      });
      setInviteEmail('');
      onToast(
        res.status === 'added'
          ? `${res.memberName} added to the group.`
          : 'Invitation token created for that email.',
        'success'
      );
      loadWorkspace();
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Could not add member', 'error');
    }
  };

  const handleRemoveMember = async (memberId: number, name: string) => {
    try {
      await apiRequest(`/api/groups/${groupId}/members/${memberId}`, { method: 'DELETE' });
      onToast(`${name} removed from group.`, 'success');
      loadWorkspace();
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Cannot remove member', 'error');
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiRequest(`/api/groups/${groupId}`, {
        method: 'PATCH',
        body: JSON.stringify({ name: editName, description: editDesc }),
      });
      onToast('Group settings updated.', 'success');
      loadWorkspace();
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Update failed', 'error');
    }
  };

  const handleArchiveToggle = async () => {
    if (!group) return;
    try {
      await apiRequest(`/api/groups/${groupId}`, {
        method: 'PATCH',
        body: JSON.stringify({ isArchived: !group.isArchived }),
      });
      onToast(group.isArchived ? 'Group restored.' : 'Group archived.', 'success');
      loadWorkspace();
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Action failed', 'error');
    }
  };

  const handleDeleteGroup = async () => {
    try {
      await apiRequest(`/api/groups/${groupId}`, { method: 'DELETE' });
      onToast('Group deleted.', 'success');
      onBack();
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Cannot delete group', 'error');
    }
  };

  if (loading || !group) {
    return <div className="h-64 bg-white border border-slate-200 rounded-xl animate-pulse" />;
  }

  const myBalance = members.find((m) => m.userId === currentUser.id)?.netPaise ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <button
            type="button"
            onClick={onBack}
            className="mt-1 p-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 cursor-pointer"
            aria-label="Back to groups"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="font-display text-2xl font-bold text-slate-900">{group.name}</h1>
              {group.isArchived && <span className="text-xs text-amber-700 font-medium">Archived</span>}
            </div>
            <p className="text-sm text-slate-600 mt-0.5">
              {group.category} · {members.length} members · {group.description || 'Shared expense workspace'}
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => onNavigate('/add-expense', { groupId })}
          className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-[#065F46] hover:bg-[#047857] rounded-lg cursor-pointer self-start"
        >
          <Plus className="w-4 h-4" />
          <span>Add Expense to Group</span>
        </button>
      </div>

      {/* Workspace Navigation Tabs */}
      <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-xl overflow-x-auto no-scrollbar">
        {[
          { id: 'overview', label: 'Overview' },
          { id: 'expenses', label: `Expenses (${expenses.length})` },
          { id: 'members', label: `Members & Invites (${members.length})` },
          { id: 'balances', label: 'Balances & Settle' },
          { id: 'activity', label: 'Activity' },
          ...(group.myRole === 'admin' ? [{ id: 'settings', label: 'Settings' }] : []),
        ].map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id as typeof tab)}
            className={`px-3.5 py-2 text-xs font-semibold rounded-lg whitespace-nowrap transition-colors cursor-pointer ${
              tab === t.id ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Overview Tab */}
      {tab === 'overview' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <p className="text-xs text-slate-500">Total Group Expenditure</p>
              <p className="font-mono-num text-2xl font-bold text-slate-900 mt-1">
                {formatINR(group.totalExpenditurePaise)}
              </p>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <p className="text-xs text-slate-500">Confirmed Settlements</p>
              <p className="font-mono-num text-2xl font-bold text-slate-900 mt-1">
                {formatINR(group.confirmedSettledPaise)}
              </p>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <p className="text-xs text-slate-500">Your Net Group Balance</p>
              <p
                className={`font-mono-num text-2xl font-bold mt-1 ${
                  myBalance > 0 ? 'text-[#065F46]' : myBalance < 0 ? 'text-[#B91C1C]' : 'text-slate-900'
                }`}
              >
                {myBalance > 0 ? `+${formatINR(myBalance)}` : formatINR(myBalance)}
              </p>
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-6">
            <h2 className="font-display text-base font-bold text-slate-900 mb-4">
              Member Contributions &amp; Net Position
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                    <th className="pb-2.5 font-medium">Member</th>
                    <th className="pb-2.5 font-medium text-right">Paid Upfront</th>
                    <th className="pb-2.5 font-medium text-right">Fair Share</th>
                    <th className="pb-2.5 font-medium text-right">Settled Net</th>
                    <th className="pb-2.5 font-medium text-right">Current Balance</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {members.map((m) => (
                    <tr key={m.userId} className="h-11">
                      <td className="py-2">
                        <div className="flex items-center gap-2.5">
                          <UserAvatar name={m.fullName} avatarUrl={m.avatarUrl} size="sm" />
                          <span className="font-medium text-slate-900">
                            {m.fullName} {m.userId === currentUser.id ? '(You)' : ''}
                          </span>
                        </div>
                      </td>
                      <td className="py-2 text-right font-mono-num text-slate-700">{formatINR(m.paidPaise)}</td>
                      <td className="py-2 text-right font-mono-num text-slate-700">{formatINR(m.owedPaise)}</td>
                      <td className="py-2 text-right font-mono-num text-slate-500">
                        {formatINR(m.settlementsPaidPaise - m.settlementsReceivedPaise)}
                      </td>
                      <td
                        className={`py-2 text-right font-mono-num font-semibold ${
                          m.netPaise > 0 ? 'text-[#065F46]' : m.netPaise < 0 ? 'text-[#B91C1C]' : 'text-slate-500'
                        }`}
                      >
                        {m.netPaise > 0 ? `+${formatINR(m.netPaise)}` : formatINR(m.netPaise)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Expenses Tab */}
      {tab === 'expenses' && (
        <div className="bg-white border border-slate-200 rounded-xl p-6">
          {expenses.length === 0 ? (
            <div className="text-center py-10 space-y-3">
              <Receipt className="w-8 h-8 text-slate-400 mx-auto" />
              <p className="text-sm text-slate-600">No expenses logged in this group yet.</p>
              <button
                type="button"
                onClick={() => onNavigate('/add-expense', { groupId })}
                className="px-4 py-2 text-sm font-semibold text-white bg-[#065F46] rounded-lg cursor-pointer"
              >
                Log First Expense
              </button>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {expenses.map((exp) => (
                <div
                  key={exp.id}
                  onClick={() => onNavigate('/expenses', { expenseId: exp.id })}
                  className="py-3.5 flex items-center justify-between gap-4 hover:bg-slate-50 -mx-2 px-2 rounded-lg cursor-pointer"
                >
                  <div>
                    <p className="font-semibold text-sm text-slate-900">{exp.title}</p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {exp.category} · {exp.split_method} split · Paid by {exp.payer_name} · {exp.expense_date}
                    </p>
                  </div>
                  <span className="font-mono-num text-sm font-bold text-slate-900">
                    {formatINR(exp.total_paise)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Members & Invites Tab */}
      {tab === 'members' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-6 space-y-5">
            <h2 className="font-display text-base font-bold text-slate-900">Group Members</h2>

            <form onSubmit={handleAddMemberByEmail} className="flex gap-2">
              <input
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="Add or invite friend by email..."
                className="flex-1 px-3.5 py-2 text-sm border border-slate-300 rounded-lg"
                required
              />
              <button
                type="submit"
                className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-white bg-[#065F46] hover:bg-[#047857] rounded-lg cursor-pointer whitespace-nowrap"
              >
                <UserPlus className="w-4 h-4" />
                <span>Invite</span>
              </button>
            </form>

            <div className="divide-y divide-slate-100">
              {members.map((m) => (
                <div key={m.userId} className="py-3 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <UserAvatar name={m.fullName} avatarUrl={m.avatarUrl} />
                    <div>
                      <p className="text-sm font-semibold text-slate-900">
                        {m.fullName} {m.userId === currentUser.id ? '(You)' : ''}
                      </p>
                      <p className="text-xs text-slate-500">
                        {m.email} · {m.role === 'admin' ? 'Admin' : 'Member'}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {group.myRole === 'admin' && m.userId !== currentUser.id && (
                      <>
                        <button
                          type="button"
                          onClick={async () => {
                            await apiRequest(`/api/groups/${groupId}/members/${m.userId}/role`, {
                              method: 'PATCH',
                              body: JSON.stringify({ role: m.role === 'admin' ? 'member' : 'admin' }),
                            });
                            loadWorkspace();
                          }}
                          className="text-xs px-2.5 py-1 border border-slate-200 rounded hover:bg-slate-50 text-slate-700 cursor-pointer"
                        >
                          <Shield className="w-3 h-3 inline mr-1" />
                          {m.role === 'admin' ? 'Make Member' : 'Make Admin'}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleRemoveMember(m.userId, m.fullName)}
                          className="text-xs px-2 py-1 text-red-700 hover:bg-red-50 rounded cursor-pointer"
                          title="Remove member (requires ₹0 balance)"
                        >
                          Remove
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-base font-bold text-slate-900">QR &amp; Shareable Invite</h2>
              <button
                type="button"
                onClick={handleGenerateQrInvite}
                className="text-xs font-semibold text-[#065F46] hover:underline cursor-pointer"
              >
                Generate Fresh Link
              </button>
            </div>
            <p className="text-xs text-slate-600 leading-relaxed">
              Scanning this QR resolves to a secure invitation link. Friends must sign in and confirm before joining.
            </p>

            {inviteQr ? (
              <div className="p-4 border border-slate-200 rounded-xl bg-[#F8FAFC] flex flex-col items-center gap-3">
                <img src={inviteQr} alt="Group invitation QR code" className="w-44 h-44 rounded-lg border border-slate-200 bg-white p-2" />
                {inviteUrl && (
                  <div className="w-full flex items-center gap-2">
                    <input
                      type="text"
                      readOnly
                      value={inviteUrl}
                      className="flex-1 px-2.5 py-1.5 text-xs font-mono-num bg-white border border-slate-300 rounded"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard.writeText(inviteUrl);
                        onToast('Invite link copied to clipboard.', 'success');
                      }}
                      className="px-3 py-1.5 text-xs font-semibold bg-slate-900 text-white rounded inline-flex items-center gap-1 cursor-pointer"
                    >
                      <Copy className="w-3.5 h-3.5" />
                      <span>Copy</span>
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <button
                type="button"
                onClick={handleGenerateQrInvite}
                className="w-full py-6 border border-dashed border-slate-300 rounded-xl text-sm font-medium text-slate-700 hover:bg-slate-50 flex flex-col items-center gap-2 cursor-pointer"
              >
                <QrCode className="w-6 h-6 text-[#065F46]" />
                <span>Create Group Invite QR Code</span>
              </button>
            )}

            {invitations.length > 0 && (
              <div className="pt-3 border-t border-slate-200 space-y-2">
                <p className="text-xs font-semibold text-slate-700">Active &amp; Past Invitations</p>
                {invitations.slice(0, 4).map((inv) => (
                  <div key={inv.id} className="flex items-center justify-between text-xs py-1">
                    <span className="text-slate-600 truncate">
                      <Link2 className="w-3 h-3 inline mr-1" />
                      {inv.invitee_email || 'Shareable QR Link'} · {inv.status} ({inv.use_count}/{inv.max_uses})
                    </span>
                    {inv.status === 'pending' && group.myRole === 'admin' && (
                      <button
                        type="button"
                        onClick={async () => {
                          await apiRequest(`/api/groups/${groupId}/invitations/${inv.id}/revoke`, {
                            method: 'POST',
                          });
                          loadWorkspace();
                        }}
                        className="text-red-700 hover:underline cursor-pointer"
                      >
                        Revoke
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Balances & Settle Tab */}
      {tab === 'balances' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-6 bg-white border border-slate-200 rounded-xl p-6 space-y-4">
            <h2 className="font-display text-base font-bold text-slate-900">
              Simplified Settlement Plan (Min Transfers)
            </h2>
            {transfers.length === 0 ? (
              <p className="text-sm text-slate-500 py-6">Everyone in this group is squared up.</p>
            ) : (
              <div className="space-y-3">
                {transfers.map((t, i) => (
                  <div key={i} className="border border-slate-200 rounded-lg p-4 flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">
                        {t.fromName} <ArrowRight className="w-3.5 h-3.5 inline text-slate-400" /> {t.toName}
                      </p>
                      <p className="text-xs text-slate-500 mt-0.5">Optimal debt-graph transfer</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="font-mono-num font-bold text-slate-900">{formatINR(t.amountPaise)}</span>
                      <button
                        type="button"
                        onClick={() =>
                          onOpenPayQr({
                            groupId,
                            groupName: group.name,
                            payerUserId: t.fromUserId,
                            payerName: t.fromName,
                            receiverUserId: t.toUserId,
                            receiverName: t.toName,
                            amountPaise: t.amountPaise,
                          })
                        }
                        className="px-3 py-1.5 text-xs font-semibold text-white bg-[#065F46] hover:bg-[#047857] rounded-md cursor-pointer"
                      >
                        Settle / UPI QR
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="lg:col-span-6 bg-white border border-slate-200 rounded-xl p-6 space-y-4">
            <h2 className="font-display text-base font-bold text-slate-900">Group Settlement Ledger</h2>
            {settlements.length === 0 ? (
              <p className="text-sm text-slate-500 py-6">No settlements recorded in this group yet.</p>
            ) : (
              <div className="divide-y divide-slate-100">
                {settlements.map((s) => (
                  <div key={s.id} className="py-3 flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-slate-900">
                        {s.payer_name} paid {s.receiver_name}
                      </p>
                      <p className="text-xs text-slate-500">
                        {s.payment_method} {s.reference_code ? `· Ref ${s.reference_code}` : ''} ·{' '}
                        <span className={s.status === 'confirmed' ? 'text-[#065F46] font-medium' : 'text-amber-700 font-medium'}>
                          {s.status === 'confirmed' ? 'Confirmed' : 'Awaiting Confirmation'}
                        </span>
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono-num text-sm font-semibold text-slate-900">
                        {formatINR(s.amount_paise)}
                      </span>
                      {s.status !== 'confirmed' && (s.receiver_user_id === currentUser.id || group.myRole === 'admin') && (
                        <button
                          type="button"
                          onClick={async () => {
                            await apiRequest(`/api/balances/settlements/${s.id}/confirm`, { method: 'POST' });
                            onToast('Settlement confirmed.', 'success');
                            loadWorkspace();
                          }}
                          className="px-2.5 py-1 text-xs font-semibold bg-[#065F46] text-white rounded cursor-pointer inline-flex items-center gap-1"
                        >
                          <Check className="w-3 h-3" /> Confirm
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Activity Tab */}
      {tab === 'activity' && (
        <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-3">
          {activities.map((a) => (
            <div key={a.id} className="py-2.5 border-b border-slate-100 last:border-0">
              <p className="text-sm text-slate-800">{a.summary}</p>
              <p className="text-xs text-slate-500 mt-0.5">
                {new Date(a.created_at + 'Z').toLocaleString('en-IN')}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* Settings Tab */}
      {tab === 'settings' && group.myRole === 'admin' && (
        <div className="bg-white border border-slate-200 rounded-xl p-6 max-w-xl space-y-6">
          <form onSubmit={handleSaveSettings} className="space-y-4">
            <h2 className="font-display text-base font-bold text-slate-900 flex items-center gap-2">
              <Settings className="w-4 h-4" /> Group Settings
            </h2>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Group Name</label>
              <input
                type="text"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="w-full px-3.5 py-2 text-sm border border-slate-300 rounded-lg"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Description</label>
              <textarea
                rows={2}
                value={editDesc}
                onChange={(e) => setEditDesc(e.target.value)}
                className="w-full px-3.5 py-2 text-sm border border-slate-300 rounded-lg"
              />
            </div>
            <button
              type="submit"
              className="px-4 py-2 text-sm font-semibold text-white bg-[#065F46] hover:bg-[#047857] rounded-lg cursor-pointer"
            >
              Save Changes
            </button>
          </form>

          <div className="pt-5 border-t border-slate-200 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={handleArchiveToggle}
              className="px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer"
            >
              {group.isArchived ? 'Restore Group' : 'Archive Group'}
            </button>
            <button
              type="button"
              onClick={handleDeleteGroup}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-red-700 bg-red-50 hover:bg-red-100 rounded-lg cursor-pointer"
            >
              <Trash2 className="w-4 h-4" /> Delete Group (Only if settled)
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
