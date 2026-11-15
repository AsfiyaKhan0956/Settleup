import React, { useEffect, useState } from 'react';
import { Bell, CheckCheck } from 'lucide-react';
import { apiRequest } from '../../services/api.ts';
import type { ActivityRecord, AppRoute, NotificationRecord } from '../../types/index.ts';

export const NotificationsView: React.FC<{
  onNavigate: (route: AppRoute) => void;
  onUpdated: () => void;
}> = ({ onNavigate, onUpdated }) => {
  const [notifications, setNotifications] = useState<NotificationRecord[]>([]);
  const [activities, setActivities] = useState<ActivityRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    apiRequest<{ notifications: NotificationRecord[]; activities: ActivityRecord[] }>('/api/notifications')
      .then((res) => {
        setNotifications(res.notifications);
        setActivities(res.activities);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const markAllRead = async () => {
    await apiRequest('/api/notifications/mark-read', { method: 'POST', body: JSON.stringify({}) });
    onUpdated();
    load();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900">Activity &amp; Notifications</h1>
          <p className="text-sm text-slate-600 mt-0.5">
            Real-time updates for new bills, group invites, and settlement confirmations.
          </p>
        </div>
        <button
          type="button"
          onClick={markAllRead}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg cursor-pointer"
        >
          <CheckCheck className="w-4 h-4" /> Mark All Read
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-6 bg-white border border-slate-200 rounded-xl p-6 space-y-4">
          <h2 className="font-display text-base font-bold text-slate-900">Your Notifications</h2>
          {loading ? (
            <p className="text-sm text-slate-500">Loading...</p>
          ) : notifications.length === 0 ? (
            <div className="py-8 text-center text-sm text-slate-500">
              <Bell className="w-7 h-7 text-slate-300 mx-auto mb-2" />
              No notifications yet.
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {notifications.map((n) => (
                <div
                  key={n.id}
                  onClick={async () => {
                    if (!n.is_read) {
                      await apiRequest('/api/notifications/mark-read', {
                        method: 'POST',
                        body: JSON.stringify({ id: n.id }),
                      });
                      onUpdated();
                    }
                    const target = (n.link_path?.startsWith('/') ? n.link_path.split('?')[0] : '/dashboard') as AppRoute;
                    onNavigate(target);
                  }}
                  className={`py-3.5 px-2 -mx-2 rounded-lg cursor-pointer transition-colors hover:bg-slate-50 ${
                    n.is_read === 0 ? 'bg-emerald-50/40' : ''
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-slate-900">{n.title}</p>
                    <span className="text-[11px] text-slate-400">
                      {n.is_read === 0 ? 'Unread' : 'Read'}
                    </span>
                  </div>
                  <p className="text-xs text-slate-600 mt-1">{n.message}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="lg:col-span-6 bg-white border border-slate-200 rounded-xl p-6 space-y-4">
          <h2 className="font-display text-base font-bold text-slate-900">Group Audit Timeline</h2>
          <div className="divide-y divide-slate-100">
            {activities.map((a) => (
              <div key={a.id} className="py-3">
                <p className="text-sm text-slate-800">{a.summary}</p>
                <p className="text-xs text-slate-500 mt-0.5">
                  {a.group_name ? `${a.group_name} · ` : ''}
                  {new Date(a.created_at + 'Z').toLocaleString('en-IN')}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
