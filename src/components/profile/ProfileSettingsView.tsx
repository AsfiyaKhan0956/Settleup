import React, { useState } from 'react';
import { Compass, Loader2, LogOut, Trash2, Upload } from 'lucide-react';
import { apiRequest } from '../../services/api.ts';
import { UserAvatar } from '../common/BrandMark.tsx';
import type { AuthUser } from '../../types/index.ts';

interface ProfileSettingsViewProps {
  user: AuthUser;
  onUserUpdated: (user: AuthUser) => void;
  onLogout: () => void;
  onReplayTour: () => void;
  onToast: (msg: string, tone?: 'success' | 'error') => void;
}

export const ProfileSettingsView: React.FC<ProfileSettingsViewProps> = ({
  user,
  onUserUpdated,
  onLogout,
  onReplayTour,
  onToast,
}) => {
  const [fullName, setFullName] = useState(user.fullName);
  const [phone, setPhone] = useState(user.phone || '');
  const [upiId, setUpiId] = useState(user.upiId || '');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(user.avatarUrl);
  const [emailNotifications, setEmailNotifications] = useState(user.preferences.emailNotifications);
  const [settlementAlerts, setSettlementAlerts] = useState(user.preferences.settlementAlerts);
  const [savingProfile, setSavingProfile] = useState(false);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [savingPass, setSavingPass] = useState(false);

  const handleAvatarUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 900_000) {
      onToast('Profile picture must be under 900 KB.', 'error');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') setAvatarUrl(reader.result);
    };
    reader.readAsDataURL(file);
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingProfile(true);
    try {
      const res = await apiRequest<{ user: AuthUser }>('/api/profile', {
        method: 'PATCH',
        body: JSON.stringify({
          fullName: fullName.trim(),
          phone: phone.trim() || null,
          upiId: upiId.trim() || null,
          avatarUrl,
          preferences: {
            currency: 'INR',
            emailNotifications,
            settlementAlerts,
          },
        }),
      });
      onUserUpdated(res.user);
      onToast('Profile and preferences saved.', 'success');
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Unable to save profile', 'error');
    } finally {
      setSavingProfile(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingPass(true);
    try {
      await apiRequest('/api/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      setCurrentPassword('');
      setNewPassword('');
      onToast('Password updated successfully.', 'success');
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Unable to change password', 'error');
    } finally {
      setSavingPass(false);
    }
  };

  const handleDeleteAccount = async () => {
    try {
      await apiRequest('/api/auth/account', { method: 'DELETE' });
      onToast('Account deleted.', 'success');
      onLogout();
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Cannot delete account', 'error');
    }
  };

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="font-display text-2xl font-bold text-slate-900">Profile &amp; Settings</h1>
        <p className="text-sm text-slate-600 mt-0.5">
          Manage your identity, UPI VPA for receiving settlements, password, and preferences.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <form onSubmit={handleSaveProfile} className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-6 space-y-5">
          <h2 className="font-display text-base font-bold text-slate-900">Account Profile</h2>

          <div className="flex items-center gap-4">
            <UserAvatar name={fullName || user.fullName} avatarUrl={avatarUrl} size="lg" />
            <div className="space-y-1.5">
              <label className="inline-flex items-center gap-2 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer">
                <Upload className="w-3.5 h-3.5" />
                <span>Update Photo</span>
                <input type="file" accept="image/*" onChange={handleAvatarUpload} className="sr-only" />
              </label>
              {avatarUrl && (
                <button
                  type="button"
                  onClick={() => setAvatarUrl(null)}
                  className="block text-xs text-slate-500 hover:text-red-700 cursor-pointer"
                >
                  Remove photo
                </button>
              )}
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Full Name</label>
              <input
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Enter your full name"
                required
                className="w-full px-3.5 py-2 text-sm border border-slate-300 rounded-lg"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Email Address</label>
              <input
                type="email"
                value={user.email}
                disabled
                className="w-full px-3.5 py-2 text-sm border border-slate-200 bg-slate-50 text-slate-500 rounded-lg"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Mobile Number (Optional — used for group invitations matched to your phone)
              </label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="Enter your mobile number"
                className="w-full px-3.5 py-2 text-sm border border-slate-300 rounded-lg"
              />
              <p className="text-[11px] text-slate-500 mt-1">Include your country code if required.</p>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                UPI ID (Optional — used when generating payment QRs for others to pay you)
              </label>
              <input
                type="text"
                value={upiId}
                onChange={(e) => setUpiId(e.target.value)}
                placeholder="Enter your UPI ID"
                className="w-full px-3.5 py-2 text-sm font-mono-num border border-slate-300 rounded-lg"
              />
              <p className="text-[11px] text-slate-500 mt-1">Example: yourname@upi</p>
            </div>
          </div>

          <div className="pt-3 border-t border-slate-200 space-y-2.5">
            <p className="text-xs font-semibold text-slate-700">Notification &amp; Display Preferences</p>
            <label className="flex items-center gap-2.5 text-sm text-slate-700 cursor-pointer">
              <input
                type="checkbox"
                checked={emailNotifications}
                onChange={(e) => setEmailNotifications(e.target.checked)}
                className="rounded border-slate-300 text-[#065F46]"
              />
              <span>Notify me when new expenses are logged in my groups</span>
            </label>
            <label className="flex items-center gap-2.5 text-sm text-slate-700 cursor-pointer">
              <input
                type="checkbox"
                checked={settlementAlerts}
                onChange={(e) => setSettlementAlerts(e.target.checked)}
                className="rounded border-slate-300 text-[#065F46]"
              />
              <span>Alert me when someone submits a settlement awaiting confirmation</span>
            </label>
            <p className="text-xs text-slate-500">Default Ledger Currency: INR (₹) · Theme: Crisp Daylight</p>
          </div>

          <button
            type="submit"
            disabled={savingProfile}
            className="px-5 py-2.5 text-sm font-semibold text-white bg-[#065F46] hover:bg-[#047857] rounded-lg inline-flex items-center gap-2 cursor-pointer"
          >
            {savingProfile && <Loader2 className="w-4 h-4 animate-spin" />}
            <span>Save Profile</span>
          </button>
        </form>

        <div className="lg:col-span-5 space-y-6">
          <form onSubmit={handleChangePassword} className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
            <h2 className="font-display text-base font-bold text-slate-900">Change Password</h2>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Current Password</label>
              <input
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                required
                className="w-full px-3.5 py-2 text-sm border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">New Password</label>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Create a new password"
                required
                className="w-full px-3.5 py-2 text-sm border border-slate-300 rounded-lg"
              />
            </div>
            <button
              type="submit"
              disabled={savingPass}
              className="w-full py-2 text-sm font-semibold text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer"
            >
              {savingPass ? 'Updating...' : 'Update Password'}
            </button>
          </form>

          <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-3">
            <h2 className="font-display text-base font-bold text-slate-900">Guided Onboarding &amp; Session</h2>
            <button
              type="button"
              onClick={onReplayTour}
              className="w-full py-2 px-4 text-sm font-medium text-[#065F46] bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-lg inline-flex items-center justify-center gap-2 cursor-pointer"
            >
              <Compass className="w-4 h-4" /> Replay Interactive Tour
            </button>
            <button
              type="button"
              onClick={onLogout}
              className="w-full py-2 px-4 text-sm font-medium text-slate-700 border border-slate-300 hover:bg-slate-50 rounded-lg inline-flex items-center justify-center gap-2 cursor-pointer"
            >
              <LogOut className="w-4 h-4" /> Sign Out
            </button>
            {!user.isDemo && (
              <button
                type="button"
                onClick={handleDeleteAccount}
                className="w-full py-2 px-4 text-xs font-semibold text-red-700 hover:bg-red-50 rounded-lg inline-flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" /> Delete Account (Requires settled groups)
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
