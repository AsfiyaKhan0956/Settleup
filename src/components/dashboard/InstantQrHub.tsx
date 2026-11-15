import React, { useEffect, useMemo, useState } from 'react';
import { Check, Copy, Loader2, QrCode, Share2, Sparkles, UserPlus } from 'lucide-react';
import { motion } from 'motion/react';
import { apiRequest } from '../../services/api.ts';
import { formatINR } from '../../utils/currency.ts';
import type { AuthUser, GroupSummary, SimplifiedTransfer } from '../../types/index.ts';

interface InstantQrHubProps {
  groups: GroupSummary[];
  transfers: SimplifiedTransfer[];
  currentUser: AuthUser;
  onOpenPayQr: (target: {
    groupId: number;
    groupName: string;
    payerUserId: number;
    payerName: string;
    receiverUserId: number;
    receiverName: string;
    amountPaise: number;
  }) => void;
  onToast?: (msg: string, tone?: 'success' | 'error') => void;
}

export const InstantQrHub: React.FC<InstantQrHubProps> = ({
  groups,
  transfers,
  currentUser,
  onOpenPayQr,
  onToast,
}) => {
  const [tab, setTab] = useState<'upi' | 'invite'>('upi');

  // Prioritize transfers where currentUser owes money
  const orderedTransfers = useMemo(() => {
    const mine = transfers.filter((t) => t.fromUserId === currentUser.id);
    const others = transfers.filter((t) => t.fromUserId !== currentUser.id);
    return [...mine, ...others];
  }, [transfers, currentUser.id]);

  const [selectedTransferIdx, setSelectedTransferIdx] = useState(0);
  const [upiQr, setUpiQr] = useState<{
    qrDataUrl: string;
    upiVpa: string;
    receiverName: string;
    amountPaise: number;
  } | null>(null);
  const [upiLoading, setUpiLoading] = useState(false);

  const [selectedInviteGroupId, setSelectedInviteGroupId] = useState<number>(groups[0]?.id ?? 0);
  const [inviteQrUrl, setInviteQrUrl] = useState<string | null>(null);
  const [inviteLink, setInviteLink] = useState<string>('');
  const [inviteLoading, setInviteLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const activeTransfer = orderedTransfers[selectedTransferIdx] ?? orderedTransfers[0] ?? null;

  useEffect(() => {
    if (groups.length > 0 && !groups.some((g) => g.id === selectedInviteGroupId)) {
      setSelectedInviteGroupId(groups[0].id);
    }
  }, [groups, selectedInviteGroupId]);

  // Fetch live UPI QR for activeTransfer when tab === 'upi'
  useEffect(() => {
    if (tab !== 'upi' || !activeTransfer || !activeTransfer.groupId) {
      setUpiQr(null);
      return;
    }
    let active = true;
    setUpiLoading(true);
    apiRequest<{
      qrDataUrl: string;
      upiVpa: string;
      receiverName: string;
      amountPaise: number;
    }>('/api/balances/upi-qr', {
      method: 'POST',
      body: JSON.stringify({
        groupId: activeTransfer.groupId,
        receiverUserId: activeTransfer.toUserId,
        amountPaise: activeTransfer.amountPaise,
        note: `SettleUp ${activeTransfer.groupName || 'Group'}`,
      }),
    })
      .then((res) => {
        if (active) setUpiQr(res);
      })
      .catch(() => {
        if (active) setUpiQr(null);
      })
      .finally(() => {
        if (active) setUpiLoading(false);
      });

    return () => {
      active = false;
    };
  }, [tab, activeTransfer]);

  // Fetch Group Invite QR when tab === 'invite'
  useEffect(() => {
    if (tab !== 'invite' || !selectedInviteGroupId) return;
    let active = true;
    setInviteLoading(true);
    apiRequest<{
      inviteQrDataUrl: string | null;
      invitations: Array<{ token: string; status: string; invitee_email: string | null; expires_at: string }>;
    }>(`/api/groups/${selectedInviteGroupId}`)
      .then((res) => {
        if (!active) return;
        setInviteQrUrl(res.inviteQrDataUrl);
        const openInv = res.invitations.find(
          (i) => i.status === 'pending' && !i.invitee_email && new Date(i.expires_at).getTime() > Date.now()
        );
        setInviteLink(openInv ? `${window.location.origin}/?invite=${openInv.token}` : '');
      })
      .catch(() => {
        if (active) {
          setInviteQrUrl(null);
          setInviteLink('');
        }
      })
      .finally(() => {
        if (active) setInviteLoading(false);
      });

    return () => {
      active = false;
    };
  }, [tab, selectedInviteGroupId]);

  const handleGenerateInvite = async () => {
    if (!selectedInviteGroupId) return;
    setInviteLoading(true);
    try {
      const res = await apiRequest<{ token: string; inviteUrl: string; qrDataUrl: string }>(
        `/api/groups/${selectedInviteGroupId}/invitations`,
        {
          method: 'POST',
          body: JSON.stringify({ expiresInDays: 14 }),
        }
      );
      setInviteQrUrl(res.qrDataUrl);
      setInviteLink(`${window.location.origin}/?invite=${res.token}`);
      onToast?.('New group invite QR generated!', 'success');
    } catch (err) {
      onToast?.(err instanceof Error ? err.message : 'Could not create invite QR.', 'error');
    } finally {
      setInviteLoading(false);
    }
  };

  const handleCopyInvite = async () => {
    if (!inviteLink) return;
    try {
      await navigator.clipboard.writeText(inviteLink);
      setCopied(true);
      onToast?.('Invite link copied to clipboard.', 'success');
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      onToast?.('Copy link manually from the field below.', 'error');
    }
  };

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-6 flex flex-col justify-between space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-base font-bold text-slate-900 flex items-center gap-2">
            <QrCode className="w-4 h-4 text-[#065F46]" />
            <span>Instant QR Hub</span>
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            One-tap UPI debt settlement or scannable group invite QR
          </p>
        </div>

        <div className="inline-flex p-1 rounded-lg bg-slate-100 border border-slate-200 self-start">
          <button
            type="button"
            onClick={() => setTab('upi')}
            className={`px-3 py-1 text-xs font-semibold rounded-md transition-all cursor-pointer ${
              tab === 'upi' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            UPI Payment QR
          </button>
          <button
            type="button"
            onClick={() => setTab('invite')}
            className={`px-3 py-1 text-xs font-semibold rounded-md transition-all cursor-pointer ${
              tab === 'invite' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Group Invite QR
          </button>
        </div>
      </div>

      {tab === 'upi' ? (
        orderedTransfers.length === 0 ? (
          <div className="py-8 text-center border border-dashed border-slate-200 rounded-xl space-y-2">
            <Sparkles className="w-6 h-6 text-[#065F46] mx-auto" />
            <p className="text-sm font-semibold text-slate-900">No pending UPI settlements</p>
            <p className="text-xs text-slate-500 max-w-xs mx-auto">
              All group transfers are settled right now. Switch to Group Invite QR to add friends.
            </p>
          </div>
        ) : (
          <motion.div
            key="upi-tab"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-4"
          >
            {orderedTransfers.length > 1 && (
              <select
                value={selectedTransferIdx}
                onChange={(e) => setSelectedTransferIdx(Number(e.target.value))}
                aria-label="Select transfer for UPI QR"
                className="w-full px-3 py-2 text-xs font-medium border border-slate-300 rounded-lg bg-[#F8FAFC]"
              >
                {orderedTransfers.map((t, i) => (
                  <option key={i} value={i}>
                    {t.groupName}: {t.fromUserId === currentUser.id ? 'You' : t.fromName} →{' '}
                    {t.toUserId === currentUser.id ? 'You' : t.toName} ({formatINR(t.amountPaise)})
                  </option>
                ))}
              </select>
            )}

            <div className="flex flex-col sm:flex-row items-center gap-5 p-4 rounded-xl bg-[#F8FAFC] border border-slate-200">
              <div className="w-36 h-36 rounded-xl bg-white border border-slate-200 flex items-center justify-center shrink-0 overflow-hidden p-2">
                {upiLoading ? (
                  <Loader2 className="w-6 h-6 animate-spin text-[#065F46]" />
                ) : upiQr ? (
                  <img
                    src={upiQr.qrDataUrl}
                    alt={`UPI Payment QR for ${upiQr.receiverName}`}
                    className="w-full h-full object-contain"
                  />
                ) : (
                  <QrCode className="w-8 h-8 text-slate-300" />
                )}
              </div>

              {activeTransfer && (
                <div className="flex-1 min-w-0 space-y-2 text-center sm:text-left">
                  <p className="text-xs font-semibold text-[#065F46]">{activeTransfer.groupName}</p>
                  <p className="text-sm font-bold text-slate-900">
                    {activeTransfer.fromUserId === currentUser.id ? 'You pay' : `${activeTransfer.fromName} pays`}{' '}
                    {activeTransfer.toUserId === currentUser.id ? 'You' : activeTransfer.toName}
                  </p>
                  <p className="font-mono-num text-xl font-bold text-slate-900">
                    {formatINR(activeTransfer.amountPaise)}
                  </p>
                  {upiQr && (
                    <p className="text-[11px] font-mono-num text-slate-500 truncate">
                      UPI VPA: {upiQr.upiVpa}
                    </p>
                  )}
                  {activeTransfer.groupId && (
                    <button
                      type="button"
                      onClick={() =>
                        onOpenPayQr({
                          groupId: activeTransfer.groupId!,
                          groupName: activeTransfer.groupName || 'Group',
                          payerUserId: activeTransfer.fromUserId,
                          payerName: activeTransfer.fromName,
                          receiverUserId: activeTransfer.toUserId,
                          receiverName: activeTransfer.toName,
                          amountPaise: activeTransfer.amountPaise,
                        })
                      }
                      className="mt-1 inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-[#065F46] hover:bg-[#047857] rounded-lg cursor-pointer"
                    >
                      <QrCode className="w-3.5 h-3.5" />
                      <span>Pay &amp; Submit UTR</span>
                    </button>
                  )}
                </div>
              )}
            </div>
          </motion.div>
        )
      ) : (
        <motion.div
          key="invite-tab"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-4"
        >
          <select
            value={selectedInviteGroupId}
            onChange={(e) => setSelectedInviteGroupId(Number(e.target.value))}
            aria-label="Select group for invite QR"
            className="w-full px-3 py-2 text-xs font-medium border border-slate-300 rounded-lg bg-[#F8FAFC]"
          >
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name} ({g.memberCount} members)
              </option>
            ))}
          </select>

          <div className="flex flex-col sm:flex-row items-center gap-5 p-4 rounded-xl bg-[#F8FAFC] border border-slate-200">
            <div className="w-36 h-36 rounded-xl bg-white border border-slate-200 flex items-center justify-center shrink-0 overflow-hidden p-2">
              {inviteLoading ? (
                <Loader2 className="w-6 h-6 animate-spin text-[#065F46]" />
              ) : inviteQrUrl ? (
                <img
                  src={inviteQrUrl}
                  alt="Group Invite QR Code"
                  className="w-full h-full object-contain"
                />
              ) : (
                <UserPlus className="w-8 h-8 text-slate-300" />
              )}
            </div>

            <div className="flex-1 min-w-0 space-y-2.5 text-center sm:text-left">
              <p className="text-sm font-bold text-slate-900">Shareable Group Invite QR</p>
              <p className="text-xs text-slate-600">
                Friends can scan this QR code or open the secure invite link to join your group ledger instantly.
              </p>

              <div className="flex flex-wrap justify-center sm:justify-start gap-2 pt-1">
                {inviteLink ? (
                  <button
                    type="button"
                    onClick={handleCopyInvite}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-[#065F46] hover:bg-[#047857] rounded-lg cursor-pointer"
                  >
                    {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copied ? 'Copied!' : 'Copy Invite Link'}</span>
                  </button>
                ) : null}

                <button
                  type="button"
                  onClick={handleGenerateInvite}
                  disabled={inviteLoading}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg cursor-pointer"
                >
                  <Share2 className="w-3.5 h-3.5" />
                  <span>{inviteQrUrl ? 'Rotate QR' : 'Generate Invite QR'}</span>
                </button>
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </div>
  );
};
