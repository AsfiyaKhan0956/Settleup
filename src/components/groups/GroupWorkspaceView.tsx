import React, { useEffect, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Camera,
  Check,
  Copy,
  Download,
  Link2,
  Loader2,
  Mail,
  MessageCircle,
  Phone,
  Plus,
  QrCode,
  Receipt,
  RefreshCw,
  Settings,
  Shield,
  Trash2,
  UserPlus,
} from 'lucide-react';
import { apiRequest } from '../../services/api.ts';
import QRCode from 'qrcode';
import { formatINR } from '../../utils/currency.ts';
import { UserAvatar } from '../common/BrandMark.tsx';
import type {
  ActivityRecord,
  AppRoute,
  AuthUser,
  ExpenseRecord,
  GroupInvitationItem,
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
  onOpenQrScanner?: () => void;
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

export const GroupWorkspaceView: React.FC<GroupWorkspaceViewProps> = ({
  groupId,
  currentUser,
  onBack,
  onNavigate,
  onToast,
  onOpenQrScanner,
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
  const [invitations, setInvitations] = useState<GroupInvitationItem[]>([]);
  const [inviteQr, setInviteQr] = useState<string | null>(null);
  const [qrSourceUrl, setQrSourceUrl] = useState('');
  const [inviteUrl, setInviteUrl] = useState<string>('');
  const [smtpConfigured, setSmtpConfigured] = useState<boolean>(false);
  const [smsConfigured, setSmsConfigured] = useState<boolean>(false);
  const [activities, setActivities] = useState<ActivityRecord[]>([]);
  const [settlements, setSettlements] = useState<SettlementRecord[]>([]);

  const [inviteChannel, setInviteChannel] = useState<'email' | 'whatsapp' | 'sms' | 'qr'>('email');
  const [inviteEmail, setInviteEmail] = useState('');
  const [emailRequest, setEmailRequest] = useState<{ key: string; id: string } | null>(null);
  const [phoneCountryCode, setPhoneCountryCode] = useState('+91');
  const [invitePhone, setInvitePhone] = useState('');
  const [phoneDeliveryMode, setPhoneDeliveryMode] = useState<'whatsapp' | 'sms'>('whatsapp');
  const [inviteBusy, setInviteBusy] = useState(false);
  const [autoLinkAttemptedForGroup, setAutoLinkAttemptedForGroup] = useState<number | null>(null);
  const [lastInviteFeedback, setLastInviteFeedback] = useState<{
    channel: string;
    deliveryMode?: string;
    inviteUrl: string;
    whatsappShareUrl: string;
    smsShareUrl?: string;
    emailShareUrl?: string;
    deliveryStatus: string;
    deliveryError?: string | null;
    hasExistingAccount?: boolean;
  } | null>(null);

  const [editName, setEditName] = useState('');
  const [editDesc, setEditDesc] = useState('');

  const loadWorkspace = () => {
    setLoading(true);
    apiRequest<{
      group: NonNullable<typeof group>;
      members: MemberNetBalance[];
      transfers: SimplifiedTransfer[];
      expenses: ExpenseRecord[];
      invitations: GroupInvitationItem[];
      inviteQrDataUrl: string | null;
      activeInviteUrl: string | null;
      smtpConfigured: boolean;
      smsConfigured?: boolean;
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
        setSmtpConfigured(Boolean(res.smtpConfigured));
        setSmsConfigured(Boolean(res.smsConfigured));
        if (res.activeInviteUrl) {
          setInviteUrl(res.activeInviteUrl);
        } else {
          const activeInv = res.invitations.find((i) => i.status === 'pending' && !i.invitee_email && !i.invitee_phone);
          setInviteUrl(activeInv?.inviteUrl ?? '');
        }
        setActivities(res.activities);
        setSettlements(res.settlements);
      })
      .catch((err) => onToast(err instanceof Error ? err.message : 'Unable to load group', 'error'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    setInviteUrl('');
    setInviteQr(null);
    setQrSourceUrl('');
    loadWorkspace();
  }, [groupId]);

  useEffect(() => {
    if (tab !== 'members' || inviteChannel !== 'qr' || !inviteUrl || qrSourceUrl === inviteUrl) return;
    setInviteQr(null);
    let cancelled = false;
    QRCode.toDataURL(inviteUrl, { width: 280, margin: 2, errorCorrectionLevel: 'M' })
      .then((dataUrl) => { if (!cancelled) { setInviteQr(dataUrl); setQrSourceUrl(inviteUrl); } })
      .catch(() => onToast('Could not generate the QR code on this device.', 'error'));
    return () => { cancelled = true; };
  }, [tab, inviteChannel, inviteUrl, qrSourceUrl]);

  const handleGenerateShareInvite = async (channel: 'qr' | 'link', reuseExisting = false) => {
    setInviteBusy(true);
    if (!reuseExisting) setLastInviteFeedback(null);
    try {
      const res = await apiRequest<{
        inviteUrl: string;
        whatsappShareUrl: string;
        deliveryStatus: string;
      }>(`/api/groups/${groupId}/invitations`, {
        method: 'POST',
        body: JSON.stringify({ channel, reuseExisting, expiresInDays: 14 }),
      });
      setInviteUrl(res.inviteUrl);
      setInviteQr(null);
      setQrSourceUrl('');
      if (channel === 'qr') {
        const qrDataUrl = await QRCode.toDataURL(res.inviteUrl, { width: 280, margin: 2, errorCorrectionLevel: 'M' });
        setInviteQr(qrDataUrl);
        setQrSourceUrl(res.inviteUrl);
      }
      if (!reuseExisting) {
        setLastInviteFeedback({
          channel,
          inviteUrl: res.inviteUrl,
          whatsappShareUrl: res.whatsappShareUrl,
          deliveryStatus: res.deliveryStatus,
        });
        onToast(
          channel === 'qr' ? 'Fresh QR invite code generated.' : 'Fresh shareable invite link generated.',
          'success'
        );
      }
      loadWorkspace();
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Failed to create invite', 'error');
    } finally {
      setInviteBusy(false);
    }
  };

  useEffect(() => {
    if (tab === 'members' && !loading && group?.id === groupId && !inviteUrl && !inviteBusy && autoLinkAttemptedForGroup !== groupId) {
      setAutoLinkAttemptedForGroup(groupId);
      handleGenerateShareInvite('link', true);
    }
  }, [tab, group?.id, groupId, loading, inviteUrl, inviteBusy, autoLinkAttemptedForGroup]);

  const handleEmailInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    const recipients = inviteEmail.split(/[\s,;]+/).map((email) => email.trim()).filter(Boolean);
    if (!recipients.length) return;
    if (recipients.length > 5) { onToast('Send invitations to no more than 5 addresses at a time.', 'error'); return; }
    const requestKey = recipients.map((email) => email.toLowerCase()).join(',');
    const requestId = emailRequest?.key === requestKey ? emailRequest.id : crypto.randomUUID().replaceAll('-', '');
    if (emailRequest?.key !== requestKey) setEmailRequest({ key: requestKey, id: requestId });
    setInviteBusy(true);
    setLastInviteFeedback(null);
    try {
      const res = await apiRequest<{
        ok: boolean;
        sentCount: number;
        failedIndexes: number[];
        results: Array<{ index: number; ok: boolean; error?: string }>;
      }>(`/api/groups/${groupId}/invitations/email`, {
        method: 'POST',
        body: JSON.stringify({ recipients, requestId }),
      });
      loadWorkspace();
      if (res.ok) {
        setInviteEmail('');
        setEmailRequest(null);
        onToast(`Invitation email sent to ${res.sentCount} recipient${res.sentCount === 1 ? '' : 's'}.`, 'success');
      } else {
        const failed = (res.failedIndexes ?? []).map((index) => recipients[index]).filter(Boolean);
        onToast(`Email sent to ${res.sentCount}; failed for ${failed.join(', ') || 'one or more recipients'}. Check the addresses and delivery status before retrying.`, 'error');
      }
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Could not create email invitation', 'error');
    } finally {
      setInviteBusy(false);
    }
  };

  const handlePhoneInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    const raw = invitePhone.trim();
    if (!raw) return;
    const combinedPhone = raw.startsWith('+') ? raw : `${phoneCountryCode} ${raw}`;
    setInviteBusy(true);
    setLastInviteFeedback(null);
    try {
      const res = await apiRequest<{
        inviteUrl: string;
        whatsappShareUrl: string;
        smsShareUrl: string;
        hasExistingAccount: boolean;
        smsSent: boolean;
        deliveryMode: string;
        deliveryStatus: string;
        deliveryError?: string | null;
      }>(`/api/groups/${groupId}/invitations`, {
        method: 'POST',
        body: JSON.stringify({
          channel: 'phone',
          inviteePhone: combinedPhone,
          deliveryMode: phoneDeliveryMode,
          expiresInDays: 14,
        }),
      });
      setInvitePhone('');
      const smsDelivered = phoneDeliveryMode === 'sms' && Boolean(res.smsSent);
      setLastInviteFeedback({
        channel: 'phone',
        deliveryMode: res.deliveryMode,
        inviteUrl: res.inviteUrl,
        whatsappShareUrl: res.whatsappShareUrl,
        smsShareUrl: res.smsShareUrl,
        deliveryStatus: smsDelivered ? 'sent' : 'manual_share',
        deliveryError: smsDelivered ? res.deliveryError : null,
        hasExistingAccount: res.hasExistingAccount,
      });
      loadWorkspace();
      if (smsDelivered) {
        onToast('SMS invitation sent successfully.', 'success');
      } else {
        onToast(phoneDeliveryMode === 'sms' ? 'Opening your SMS app with the invitation ready.' : 'Opening WhatsApp with the invitation ready.', 'success');
        const appUrl = phoneDeliveryMode === 'sms' ? res.smsShareUrl : res.whatsappShareUrl;
        if (appUrl) window.location.href = appUrl;
      }
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Could not create phone invitation', 'error');
    } finally {
      setInviteBusy(false);
    }
  };

  const handleResendInvite = async (inviteId: number) => {
    try {
      const invitation = invitations.find((item) => item.id === inviteId);
      if (invitation?.channel === 'email' && invitation.invitee_email) {
        const delivery = await apiRequest<{ ok: boolean; sentCount: number }>(`/api/groups/${groupId}/invitations/email`, {
          method: 'POST',
          body: JSON.stringify({ recipients: [invitation.invitee_email], requestId: crypto.randomUUID().replaceAll('-', '') }),
        });
        onToast(delivery.ok ? 'Invitation email sent successfully.' : 'Email delivery failed or could not be confirmed. Check delivery status before retrying.', delivery.ok ? 'success' : 'error');
        loadWorkspace();
        return;
      }
      const res = await apiRequest<{
        ok?: boolean;
        sentCount?: number;
        failedIndexes?: number[];
        emailDelivered?: boolean;
        smsDelivered?: boolean;
        deliveryError: string | null;
        emailShareUrl?: string;
        whatsappShareUrl?: string;
        smsShareUrl?: string;
        inviteUrl?: string;
      }>(`/api/groups/${groupId}/invitations/${inviteId}/resend`, { method: 'POST' });
      if (invitation?.channel === 'email') {
        if (res.ok) onToast(`Invitation email sent to ${res.sentCount ?? 1} recipient${res.sentCount === 1 ? '' : 's'}.`, 'success');
        else if (res.ok === false) onToast('Email delivery failed or could not be confirmed. Check delivery status before retrying.', 'error');
        else if (res.emailDelivered) onToast('Invitation email sent successfully.', 'success');
        else {
          const message = `Hello,\n\n${currentUser.fullName} has invited you to join the "${group?.name ?? 'group'}" group on SettleUp.\n\nOpen this secure invitation link to view the group and accept:\n${res.inviteUrl}\n\nRegards,\n${currentUser.fullName}`;
          const emailUrl = res.emailShareUrl || `mailto:${invitation.invitee_email ?? ''}?subject=${encodeURIComponent(`Invitation to join ${group?.name ?? 'SettleUp'} on SettleUp`)}&body=${encodeURIComponent(message)}`;
          onToast('Opening your email app with the invitation ready.', 'success');
          window.location.href = emailUrl;
        }
      } else if (invitation?.channel === 'phone' && res.smsDelivered) {
        onToast('SMS invitation sent successfully.', 'success');
      } else {
        onToast('Opening WhatsApp with the invitation ready.', 'success');
        if (res.whatsappShareUrl) window.location.href = res.whatsappShareUrl;
      }
      loadWorkspace();
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Resend failed', 'error');
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

        <div className="flex flex-wrap items-center gap-2.5 self-start">
          <button
            type="button"
            onClick={() => setTab('members')}
            className="inline-flex items-center gap-2 px-3.5 py-2.5 text-sm font-semibold text-[#065F46] bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-lg cursor-pointer"
          >
            <UserPlus className="w-4 h-4" />
            <span>Add Members</span>
          </button>
          <button
            type="button"
            onClick={() => onNavigate('/add-expense', { groupId })}
            className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-[#065F46] hover:bg-[#047857] rounded-lg cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Add Expense to Group</span>
          </button>
        </div>
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

          {members.length <= 1 && (
            <div className="bg-emerald-50/70 border border-emerald-200 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-slate-900">Ready to invite your friends?</p>
                <p className="text-xs text-slate-600 mt-0.5">
                  Add members in seconds via Email, Phone Number (WhatsApp / SMS), Invite Link, or QR Code.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setTab('members')}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#065F46] hover:bg-[#047857] rounded-lg cursor-pointer self-start sm:self-auto"
              >
                <UserPlus className="w-3.5 h-3.5" />
                <span>Add Members</span>
              </button>
            </div>
          )}

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
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          <div className="lg:col-span-6 bg-white border border-slate-200 rounded-xl p-6 space-y-5">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-base font-bold text-slate-900">Group Members ({members.length})</h2>
              {onOpenQrScanner && (
                <button
                  type="button"
                  onClick={onOpenQrScanner}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-[#065F46] bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-lg cursor-pointer"
                >
                  <Camera className="w-3.5 h-3.5" />
                  <span>Scan Another Invite QR</span>
                </button>
              )}
            </div>

            <div className="divide-y divide-slate-100">
              {members.map((m) => (
                <div key={m.userId} className="py-3 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <UserAvatar name={m.fullName} avatarUrl={m.avatarUrl} />
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-900 truncate">
                        {m.fullName} {m.userId === currentUser.id ? '(You)' : ''}
                      </p>
                      <p className="text-xs text-slate-500 truncate">
                        {m.isGuest || m.role === 'guest' ? 'Guest · Read only' : `${m.email} · ${m.role === 'admin' ? 'Admin' : 'Member'}`}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {group.myRole === 'admin' && m.userId !== currentUser.id && m.role !== 'guest' && !m.isGuest && (
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

          <div className="lg:col-span-6 bg-white border border-slate-200 rounded-xl p-6 space-y-5">
            <div>
              <h2 className="font-display text-base font-bold text-slate-900">Add Members</h2>
              <p className="text-xs text-slate-600 mt-0.5">
                Pick any method below. Recipients review and accept the invite before joining the group.
              </p>
            </div>

            {/* Four invitation methods: Email, WhatsApp, SMS, and QR Code */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 p-1 bg-slate-100 rounded-xl text-xs font-semibold">
              {[
                { id: 'email', label: 'Email', icon: Mail },
                { id: 'whatsapp', label: 'WhatsApp', icon: MessageCircle },
                { id: 'sms', label: 'SMS', icon: Phone },
                { id: 'qr', label: 'QR Code', icon: QrCode },
              ].map((opt) => {
                const Icon = opt.icon;
                const active = inviteChannel === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => { setInviteChannel(opt.id as typeof inviteChannel); if (opt.id === 'whatsapp' || opt.id === 'sms') setPhoneDeliveryMode(opt.id); }}
                    className={`py-2 px-2 rounded-lg inline-flex items-center justify-center gap-1.5 cursor-pointer transition-colors ${
                      active ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    <span>{opt.label}</span>
                  </button>
                );
              })}
            </div>

            {/* Method 1: Email Invitation */}
            {inviteChannel === 'email' && (
              <div className="space-y-3">
                <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs text-slate-600">
                  Send a secure invitation through the configured SettleUp email service. Messages are sent individually; Gmail sending limits apply.
                </p>
                <form onSubmit={handleEmailInvite} className="space-y-2.5">
                  <label htmlFor="invite-email-input" className="block text-xs font-medium text-slate-700">
                    Recipient Email Addresses (up to 5)
                  </label>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <textarea
                      id="invite-email-input"
                      rows={3}
                      value={inviteEmail}
                      onChange={(e) => setInviteEmail(e.target.value)}
                      placeholder="Enter one or more addresses, separated by commas or spaces"
                      className="flex-1 px-3.5 py-2 text-sm border border-slate-300 rounded-lg focus:border-[#065F46] focus:outline-none"
                      required
                    />
                    <button
                      type="submit"
                      disabled={inviteBusy}
                      className="inline-flex items-center justify-center gap-1.5 px-4 py-2 text-sm font-semibold text-white bg-[#065F46] hover:bg-[#047857] rounded-lg cursor-pointer whitespace-nowrap disabled:opacity-60"
                    >
                      {inviteBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
                      <span>Send Invitation</span>
                    </button>
                  </div>
                </form>
              </div>
            )}

            {/* WhatsApp or SMS invitation */}
            {(inviteChannel === 'whatsapp' || inviteChannel === 'sms') && (
              <div className="space-y-3">
                <form onSubmit={handlePhoneInvite} className="space-y-3">
                  <div>
                    <label htmlFor="invite-phone-input" className="block text-xs font-medium text-slate-700 mb-1">
                      {inviteChannel === 'whatsapp' ? 'WhatsApp Number (with Country Code)' : 'Mobile Number (with Country Code)'}
                    </label>
                    <div className="flex gap-2">
                      <select
                        aria-label="Country code"
                        value={phoneCountryCode}
                        onChange={(e) => setPhoneCountryCode(e.target.value)}
                        className="px-2.5 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                      >
                        <option value="+91">+91 (IN)</option>
                        <option value="+1">+1 (US/CA)</option>
                        <option value="+44">+44 (UK)</option>
                        <option value="+971">+971 (UAE)</option>
                        <option value="+65">+65 (SG)</option>
                        <option value="+61">+61 (AU)</option>
                      </select>
                      <input
                        id="invite-phone-input"
                        type="tel"
                        value={invitePhone}
                        onChange={(e) => setInvitePhone(e.target.value)}
                        placeholder="Enter mobile number"
                        className="flex-1 px-3.5 py-2 text-sm border border-slate-300 rounded-lg focus:border-[#065F46] focus:outline-none"
                        required
                      />
                    </div>
                    <p className="text-[11px] text-slate-500 mt-1">
                      Include country code or pick one on the left.
                    </p>
                  </div>



                  <button
                    type="submit"
                    disabled={inviteBusy}
                    className="w-full py-2.5 px-4 text-sm font-semibold text-white bg-[#065F46] hover:bg-[#047857] rounded-lg inline-flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60"
                  >
                    {inviteBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
                    <span>{phoneDeliveryMode === 'whatsapp' ? 'Continue to WhatsApp' : 'Open SMS App'}</span>
                  </button>
                </form>
              </div>
            )}

            {/* Method 4: QR Code */}
            {inviteChannel === 'qr' && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-700">Scannable Group Invite QR</span>
                  <button
                    type="button"
                    disabled={inviteBusy}
                    onClick={() => handleGenerateShareInvite('qr', false)}
                    className="text-xs font-semibold text-[#065F46] hover:underline cursor-pointer"
                  >
                    Generate Fresh QR
                  </button>
                </div>

                {inviteQr ? (
                  <div className="p-4 border border-slate-200 rounded-xl bg-[#F8FAFC] flex flex-col items-center gap-3">
                    <img
                      src={inviteQr}
                      alt="Group invitation QR code"
                      className="w-44 h-44 rounded-lg border border-slate-200 bg-white p-2"
                    />
                    <p className="text-[11px] text-slate-500 text-center max-w-xs">
                      Scanning with your phone camera, WhatsApp QR scanner, or SettleUp&apos;s built-in scanner opens this group invitation directly.
                    </p>
                    <div className="flex flex-wrap items-center justify-center gap-2 w-full">
                      <a
                        href={inviteQr}
                        download={`${group.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-invite-qr.png`}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50"
                      >
                        <Download className="w-3.5 h-3.5" /> Save QR PNG
                      </a>
                      {inviteUrl && (
                        <button
                          type="button"
                          onClick={() => {
                            navigator.clipboard.writeText(inviteUrl);
                            onToast('Invite link copied to clipboard.', 'success');
                          }}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-slate-900 text-white rounded-lg cursor-pointer"
                        >
                          <Copy className="w-3.5 h-3.5" /> Copy Link
                        </button>
                      )}
                      {onOpenQrScanner && (
                        <button
                          type="button"
                          onClick={onOpenQrScanner}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-[#065F46] bg-emerald-50 border border-emerald-200 rounded-lg cursor-pointer"
                        >
                          <Camera className="w-3.5 h-3.5" /> Open Scanner
                        </button>
                      )}
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    disabled={inviteBusy}
                    onClick={() => handleGenerateShareInvite('qr', false)}
                    className="w-full py-6 border border-dashed border-slate-300 rounded-xl text-sm font-medium text-slate-700 hover:bg-slate-50 flex flex-col items-center gap-2 cursor-pointer"
                  >
                    <QrCode className="w-6 h-6 text-[#065F46]" />
                    <span>Create Group Invite QR Code</span>
                  </button>
                )}
              </div>
            )}

            {/* Shareable Group Invitation - always available below the four invitation methods */}
            <div className="space-y-3 border-t border-slate-200 pt-5">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">Shareable Group Invitation</h3>
                <p className="mt-1 text-xs text-slate-500">Create a secure invitation link that you can copy and send wherever you like.</p>
              </div>
              {inviteUrl ? (
                <div className="flex flex-col gap-2 sm:flex-row">
                  <input type="text" readOnly value={inviteUrl} aria-label="Shareable group invitation link" className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-xs font-mono-num" />
                  <button type="button" onClick={() => { navigator.clipboard.writeText(inviteUrl); onToast('Invitation link copied to clipboard.', 'success'); }} className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white"><Copy className="h-3.5 w-3.5"/> Copy Link</button>
                  <button type="button" disabled={inviteBusy} onClick={() => handleGenerateShareInvite('link', false)} className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 disabled:opacity-50">Generate New Link</button>
                </div>
              ) : (
                <button type="button" disabled={inviteBusy} onClick={() => handleGenerateShareInvite('link', false)} className="w-full rounded-xl border border-dashed border-slate-300 py-4 text-sm font-semibold text-[#065F46] disabled:opacity-50">{inviteBusy ? 'Creating secure link…' : 'Generate Invitation Link'}</button>
              )}
            </div>

            {/* Honest Feedback Card after creating invite */}
            {lastInviteFeedback && (
              <div className="p-3.5 rounded-xl bg-[#F8FAFC] border border-slate-200 space-y-2.5 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-slate-900">
                    Invitation Ready ({lastInviteFeedback.channel.toUpperCase()})
                  </span>
                  <span
                    className={`font-semibold ${
                      lastInviteFeedback.deliveryStatus === 'sent'
                        ? 'text-[#065F46]'
                        : lastInviteFeedback.deliveryStatus === 'failed' || lastInviteFeedback.deliveryStatus === 'not_configured'
                        ? 'text-amber-700'
                        : 'text-slate-600'
                    }`}
                  >
                    {lastInviteFeedback.deliveryStatus === 'sent'
                      ? 'Delivered'
                      : lastInviteFeedback.deliveryStatus === 'manual_share' || lastInviteFeedback.deliveryStatus === 'not_configured'
                      ? (lastInviteFeedback.channel === 'email' || lastInviteFeedback.channel === 'phone' ? 'Ready to send from your app' : 'Invitation ready')
                      : lastInviteFeedback.deliveryStatus === 'failed'
                      ? 'Delivery Failed — Share Manually'
                      : 'Ready to Share'}
                  </span>
                </div>
                {lastInviteFeedback.deliveryError && (
                  <p className="text-amber-800 leading-relaxed">{lastInviteFeedback.deliveryError}</p>
                )}
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(lastInviteFeedback.inviteUrl);
                      onToast('Invite link copied.', 'success');
                    }}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-slate-900 text-white rounded font-semibold cursor-pointer"
                  >
                    <Copy className="w-3 h-3" /> Copy Link
                  </button>
                  {lastInviteFeedback.emailShareUrl && lastInviteFeedback.deliveryStatus !== 'sent' && (
                    <a href={lastInviteFeedback.emailShareUrl} className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded border border-slate-300 bg-white font-semibold text-slate-800">
                      <Mail className="h-3 w-3" /> Open Email App
                    </a>
                  )}
                  {!(lastInviteFeedback.channel === 'phone' && lastInviteFeedback.deliveryMode === 'sms' && lastInviteFeedback.deliveryStatus === 'sent') && <a
                    href={lastInviteFeedback.whatsappShareUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-[#065F46] text-white rounded font-semibold"
                  >
                    <MessageCircle className="w-3 h-3" /> Send via WhatsApp
                  </a>}
                  {lastInviteFeedback.smsShareUrl && lastInviteFeedback.deliveryStatus !== 'sent' && (
                    <a
                      href={lastInviteFeedback.smsShareUrl}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-white border border-slate-300 text-slate-800 rounded font-semibold hover:bg-slate-50"
                    >
                      <Phone className="w-3 h-3 text-[#065F46]" /> Open SMS App
                    </a>
                  )}

                </div>
              </div>
            )}

            {/* Invitation History with Status Badges, Copy, Resend & Revoke */}
            {invitations.length > 0 && (
              <div className="pt-3 border-t border-slate-200 space-y-2.5">
                <p className="text-xs font-semibold text-slate-700">Invitations ({invitations.length})</p>
                <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                  {invitations.slice(0, 15).map((inv) => {
                    const statusBadge =
                      inv.status === 'accepted'
                        ? 'bg-emerald-50 text-[#065F46] border-emerald-200'
                        : inv.status === 'pending'
                        ? 'bg-amber-50 text-amber-800 border-amber-200'
                        : 'bg-slate-100 text-slate-600 border-slate-200';
                    return (
                      <div
                        key={inv.id}
                        className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs py-2.5 px-3 rounded-lg bg-slate-50 border border-slate-200/70"
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="font-medium text-slate-800 truncate">
                              <Link2 className="w-3 h-3 inline mr-1 text-slate-400" />
                              {inv.invitee_email || inv.invitee_phone || `${inv.channel.toUpperCase()} Invite Link`}
                            </p>
                            <span className={`px-2 py-0.5 text-[10px] font-semibold rounded-full border capitalize shrink-0 ${statusBadge}`}>
                              {inv.status}
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-500 mt-0.5">
                            Method: <span className="capitalize">{inv.channel}</span> · Uses {inv.use_count}/{inv.max_uses}
                            {(inv.channel === 'email' || inv.channel === 'phone' || inv.channel === 'whatsapp') && ` · Delivery: ${inv.delivery_status}`}
                          </p>
                        </div>
                        <div className="flex items-center gap-2.5 shrink-0">
                          {inv.status === 'pending' && inv.inviteUrl && (
                            <button
                              type="button"
                              onClick={() => {
                                navigator.clipboard.writeText(inv.inviteUrl!);
                                onToast('Invitation link copied.', 'success');
                              }}
                              className="text-slate-700 hover:underline cursor-pointer"
                            >
                              Copy Link
                            </button>
                          )}
                          {inv.status === 'pending' && (inv.invitee_email || inv.invitee_phone) && (
                            <button
                              type="button"
                              onClick={() => handleResendInvite(inv.id)}
                              className="inline-flex items-center gap-0.5 text-[#065F46] hover:underline cursor-pointer"
                            >
                              <RefreshCw className="w-3 h-3" /> Resend
                            </button>
                          )}
                          {inv.status === 'pending' && group.myRole === 'admin' && (
                            <button
                              type="button"
                              onClick={async () => {
                                await apiRequest(`/api/groups/${groupId}/invitations/${inv.id}/revoke`, {
                                  method: 'POST',
                                });
                                onToast('Invitation revoked.', 'success');
                                loadWorkspace();
                              }}
                              className="text-red-700 hover:underline cursor-pointer"
                            >
                              Revoke
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
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
