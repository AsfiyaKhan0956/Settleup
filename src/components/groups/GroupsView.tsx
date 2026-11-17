import React, { useEffect, useState } from 'react';
import { Check, FolderPlus, Loader2, Mail, Plus, QrCode, Search, X } from 'lucide-react';
import { apiRequest } from '../../services/api.ts';
import { formatINR } from '../../utils/currency.ts';
import { UserAvatar } from '../common/BrandMark.tsx';
import type { AppRoute, GroupSummary, PendingUserInvitation } from '../../types/index.ts';

interface GroupsViewProps {
  onSelectGroup: (groupId: number) => void;
  onNavigate: (route: AppRoute) => void;
  onOpenQrScanner?: () => void;
  onToast?: (msg: string, tone?: 'success' | 'error') => void;
}

const CATEGORIES = ['All', 'Friends', 'Travel', 'Home & Roommates', 'Family', 'Work & Events', 'Other'];
const COVER_COLORS = ['#065F46', '#0F172A', '#047857', '#1E293B', '#B45309', '#0D9488'];

export const GroupsView: React.FC<GroupsViewProps> = ({
  onSelectGroup,
  onOpenQrScanner,
  onToast,
}) => {
  const [groups, setGroups] = useState<GroupSummary[]>([]);
  const [pendingInvitations, setPendingInvitations] = useState<PendingUserInvitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('All');
  const [showArchived, setShowArchived] = useState(false);

  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newCategory, setNewCategory] = useState('Friends');
  const [newColor, setNewColor] = useState('#065F46');
  const [inviteEmailsRaw, setInviteEmailsRaw] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  const fetchGroups = () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (search.trim()) params.set('search', search.trim());
    if (category !== 'All') params.set('category', category);
    if (showArchived) params.set('archived', 'true');

    Promise.all([
      apiRequest<{ groups: GroupSummary[] }>(`/api/groups?${params.toString()}`),
      apiRequest<{ invitations: PendingUserInvitation[] }>('/api/groups/my-pending-invitations'),
    ])
      .then(([grpRes, invRes]) => {
        setGroups(grpRes.groups);
        setPendingInvitations(invRes.invitations);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchGroups();
  }, [category, showArchived]);

  const handleAcceptPending = async (inv: PendingUserInvitation) => {
    try {
      const res = await apiRequest<{ groupId: number }>(`/api/groups/invite/${inv.token}/accept`, {
        method: 'POST',
      });
      onToast?.(`Joined "${inv.group_name}"!`, 'success');
      onSelectGroup(res.groupId);
    } catch (err) {
      onToast?.(err instanceof Error ? err.message : 'Unable to accept invitation.', 'error');
    }
  };

  const handleDeclinePending = async (inv: PendingUserInvitation) => {
    try {
      await apiRequest(`/api/groups/invite/${inv.token}/decline`, { method: 'POST' });
      onToast?.(`Declined invitation to "${inv.group_name}".`, 'success');
      fetchGroups();
    } catch (err) {
      onToast?.(err instanceof Error ? err.message : 'Unable to decline invitation.', 'error');
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (newName.trim().length < 2) {
      setError('Group name must be at least 2 characters.');
      return;
    }
    setCreating(true);
    try {
      const memberEmails = inviteEmailsRaw
        .split(/[,\n]/)
        .map((s) => s.trim())
        .filter(Boolean);

      const res = await apiRequest<{
        groupId: number;
        invitedCount?: number;
        emailsSentCount?: number;
        smtpConfigured?: boolean;
      }>('/api/groups', {
        method: 'POST',
        body: JSON.stringify({
          name: newName.trim(),
          description: newDesc.trim(),
          category: newCategory,
          coverColor: newColor,
          memberEmails,
        }),
      });
      setCreateOpen(false);
      setNewName('');
      setNewDesc('');
      setInviteEmailsRaw('');
      if (res.invitedCount && res.invitedCount > 0) {
        if (res.emailsSentCount === res.invitedCount) {
          onToast?.(`Group created and ${res.emailsSentCount} invitation email(s) sent.`, 'success');
        } else if (!res.smtpConfigured) {
          onToast?.(
            `Group created with ${res.invitedCount} pending invite(s). Share their links in Members & Invites (SMTP email not configured).`,
            'success'
          );
        }
      }
      onSelectGroup(res.groupId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create group.');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900">My Groups</h1>
          <p className="text-sm text-slate-600 mt-0.5">
            Dedicated shared spaces for roommates, outings, and trips.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5 self-start">
          {onOpenQrScanner && (
            <button
              type="button"
              onClick={onOpenQrScanner}
              className="inline-flex items-center gap-2 px-3.5 py-2.5 text-sm font-semibold text-slate-800 bg-white border border-slate-300 hover:border-slate-400 rounded-lg cursor-pointer"
            >
              <QrCode className="w-4 h-4 text-[#065F46]" />
              <span>Scan Invite QR</span>
            </button>
          )}
          <button
            type="button"
            id="tour-create-group"
            onClick={() => setCreateOpen(true)}
            className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-[#065F46] hover:bg-[#047857] rounded-lg cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>New Group</span>
          </button>
        </div>
      </div>

      {/* Pending Group Invitations for Current User */}
      {pendingInvitations.length > 0 && (
        <div className="bg-emerald-50/70 border border-emerald-200 rounded-xl p-5 space-y-3">
          <div className="flex items-center gap-2">
            <Mail className="w-4 h-4 text-[#065F46]" />
            <h2 className="font-display text-sm font-bold text-slate-900">
              Pending Group Invitations ({pendingInvitations.length})
            </h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {pendingInvitations.map((inv) => (
              <div
                key={inv.id}
                className="bg-white border border-slate-200 rounded-lg p-4 flex items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <p className="text-sm font-bold text-slate-900 truncate">{inv.group_name}</p>
                  <p className="text-xs text-slate-600 mt-0.5">
                    Invited by {inv.inviter_name} · {inv.group_category}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => handleDeclinePending(inv)}
                    className="px-2.5 py-1.5 text-xs font-medium text-slate-600 border border-slate-300 hover:bg-slate-50 rounded-md cursor-pointer"
                  >
                    Decline
                  </button>
                  <button
                    type="button"
                    onClick={() => handleAcceptPending(inv)}
                    className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-white bg-[#065F46] hover:bg-[#047857] rounded-md cursor-pointer"
                  >
                    <Check className="w-3.5 h-3.5" /> Accept
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Search & Filter Toolbar */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-white border border-slate-200 rounded-xl p-4">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            fetchGroups();
          }}
          className="relative flex-1 max-w-md"
        >
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search groups by name or description..."
            className="w-full pl-9 pr-20 py-2 text-sm border border-slate-300 rounded-lg focus:border-[#065F46] focus:outline-none"
          />
          <button
            type="submit"
            className="absolute right-1.5 top-1/2 -translate-y-1/2 px-2.5 py-1 text-xs font-medium bg-slate-100 hover:bg-slate-200 text-slate-700 rounded cursor-pointer"
          >
            Search
          </button>
        </form>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg overflow-x-auto no-scrollbar">
            {CATEGORIES.map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setCategory(cat)}
                className={`px-2.5 py-1 text-xs font-medium rounded-md whitespace-nowrap transition-colors cursor-pointer ${
                  category === cat
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>

          <label className="inline-flex items-center gap-1.5 text-xs text-slate-600 ml-2 cursor-pointer">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
              className="rounded border-slate-300 text-[#065F46]"
            />
            <span>Show archived</span>
          </label>
        </div>
      </div>

      {/* Group Cards Grid */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-52 bg-white border border-slate-200 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : groups.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-12 text-center space-y-3">
          <FolderPlus className="w-8 h-8 text-slate-400 mx-auto" />
          <p className="font-display font-semibold text-slate-900">No groups found</p>
          <p className="text-sm text-slate-600">Create a group or adjust your search filters.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {groups.map((g) => (
            <div
              key={g.id}
              onClick={() => onSelectGroup(g.id)}
              className="bg-white border border-slate-200 hover:border-slate-300 rounded-xl p-5 flex flex-col justify-between transition-colors cursor-pointer"
            >
              <div>
                <div className="flex items-start justify-between gap-3">
                  <div
                    className="w-11 h-11 rounded-xl text-white font-display font-bold text-sm flex items-center justify-center shrink-0"
                    style={{ backgroundColor: g.coverColor }}
                  >
                    {g.name.slice(0, 2).toUpperCase()}
                  </div>
                  <span className="text-xs text-slate-500">
                    {g.category} {g.isArchived ? '· Archived' : ''}
                  </span>
                </div>

                <h2 className="font-display text-lg font-bold text-slate-900 mt-3.5">{g.name}</h2>
                <p className="text-xs text-slate-600 mt-1 line-clamp-2 min-h-[2rem]">
                  {g.description || 'Shared expense workspace'}
                </p>

                <div className="flex items-center gap-1.5 mt-4">
                  <div className="flex -space-x-2">
                    {g.members.slice(0, 5).map((m) => (
                      <UserAvatar key={m.userId} name={m.fullName} avatarUrl={m.avatarUrl} size="sm" />
                    ))}
                  </div>
                  <span className="text-xs text-slate-500 ml-1">
                    {g.memberCount} {g.memberCount === 1 ? 'member' : 'members'}
                  </span>
                </div>
              </div>

              <div className="mt-5 pt-4 border-t border-slate-100 flex items-center justify-between text-xs">
                <div>
                  <span className="text-slate-500 block">Total spent</span>
                  <span className="font-mono-num font-semibold text-slate-900">
                    {formatINR(g.totalExpenditurePaise)}
                  </span>
                </div>
                <div className="text-right">
                  <span className="text-slate-500 block">Your balance</span>
                  <span
                    className={`font-mono-num font-semibold ${
                      g.myNetBalancePaise > 0
                        ? 'text-[#065F46]'
                        : g.myNetBalancePaise < 0
                        ? 'text-[#B91C1C]'
                        : 'text-slate-600'
                    }`}
                  >
                    {g.myNetBalancePaise > 0
                      ? `+${formatINR(g.myNetBalancePaise)}`
                      : formatINR(g.myNetBalancePaise)}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create Group Modal */}
      {createOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-2xl max-w-lg w-full p-6 space-y-5">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-xl font-bold text-slate-900">Create New Group</h2>
              <button
                type="button"
                onClick={() => setCreateOpen(false)}
                aria-label="Close modal"
                className="text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {error && (
              <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-800">{error}</div>
            )}

            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Group Name</label>
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="e.g., Coorg Road Trip or Hostel Room 204"
                  required
                  className="w-full px-3.5 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Description</label>
                <input
                  type="text"
                  value={newDesc}
                  onChange={(e) => setNewDesc(e.target.value)}
                  placeholder="What expenses will this group track?"
                  className="w-full px-3.5 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Category</label>
                  <select
                    value={newCategory}
                    onChange={(e) => setNewCategory(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                  >
                    {CATEGORIES.filter((c) => c !== 'All').map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Accent Color</label>
                  <div className="flex items-center gap-2 pt-1.5">
                    {COVER_COLORS.map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setNewColor(c)}
                        aria-label={`Select color ${c}`}
                        className={`w-7 h-7 rounded-full cursor-pointer transition-transform ${
                          newColor === c ? 'ring-2 ring-offset-2 ring-slate-900 scale-110' : ''
                        }`}
                        style={{ backgroundColor: c }}
                      />
                    ))}
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Invite Members by Email (Optional)
                </label>
                <textarea
                  rows={2}
                  value={inviteEmailsRaw}
                  onChange={(e) => setInviteEmailsRaw(e.target.value)}
                  placeholder="Enter email addresses separated by commas"
                  className="w-full px-3.5 py-2 text-sm border border-slate-300 rounded-lg"
                />
                <p className="text-[11px] text-slate-500 mt-1">
                  Invited friends receive a link to accept or decline. You can also invite via Phone, Link, or QR Code after creation.
                </p>
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setCreateOpen(false)}
                  className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creating}
                  className="px-5 py-2 text-sm font-semibold text-white bg-[#065F46] hover:bg-[#047857] rounded-lg inline-flex items-center gap-2 cursor-pointer"
                >
                  {creating && <Loader2 className="w-4 h-4 animate-spin" />}
                  <span>Create Group</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
