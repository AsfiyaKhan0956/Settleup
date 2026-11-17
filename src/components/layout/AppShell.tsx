import React, { useState } from 'react';
import {
  BarChart3,
  Bell,
  Compass,
  FolderKanban,
  LayoutDashboard,
  Menu,
  PiggyBank,
  Plus,
  QrCode,
  Receipt,
  Scale,
  Settings,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import { BrandMark, UserAvatar } from '../common/BrandMark.tsx';
import type { AppRoute, AuthUser } from '../../types/index.ts';

interface AppShellProps {
  user: AuthUser;
  currentRoute: AppRoute;
  unreadCount: number;
  onNavigate: (route: AppRoute) => void;
  onReplayTour: () => void;
  onOpenQrScanner?: () => void;
  children: React.ReactNode;
}

const NAV_SECTIONS: Array<{
  title: string;
  items: Array<{ route: AppRoute; label: string; icon: React.ComponentType<{ className?: string }> }>;
}> = [
  {
    title: 'Personal Finance',
    items: [
      { route: '/personal', label: 'Personal Tracker', icon: PiggyBank },
    ],
  },
  {
    title: 'Groups & Shared Bills',
    items: [
      { route: '/dashboard', label: 'Overview', icon: LayoutDashboard },
      { route: '/groups', label: 'My Groups', icon: FolderKanban },
      { route: '/add-expense', label: 'Add Group Expense', icon: Plus },
      { route: '/expenses', label: 'Expense History', icon: Receipt },
      { route: '/balances', label: 'Group Balances', icon: Scale },
      { route: '/manual-balances', label: 'Large Trips / Manual', icon: Users },
      { route: '/settlements', label: 'Settlements & QR', icon: Wallet },
      { route: '/analytics', label: 'Group Analytics', icon: BarChart3 },
    ],
  },
  {
    title: 'Account',
    items: [
      { route: '/notifications', label: 'Notifications', icon: Bell },
      { route: '/profile', label: 'Profile & Settings', icon: Settings },
    ],
  },
];

const ALL_NAV_ITEMS = NAV_SECTIONS.flatMap((s) => s.items);

export const AppShell: React.FC<AppShellProps> = ({
  user,
  currentRoute,
  unreadCount,
  onNavigate,
  onReplayTour,
  onOpenQrScanner,
  children,
}) => {
  const [mobileOpen, setMobileOpen] = useState(false);
  const activeLabel = ALL_NAV_ITEMS.find((n) => n.route === currentRoute)?.label || 'Workspace';

  const SidebarContent = () => (
    <div className="flex flex-col h-full justify-between p-4 bg-white border-r border-slate-200 overflow-y-auto">
      <div className="space-y-5">
        <button
          type="button"
          onClick={() => onNavigate('/')}
          className="flex items-center gap-2.5 px-2 py-1 cursor-pointer"
        >
          <BrandMark size={28} />
          <span className="font-display text-lg font-bold tracking-tight text-slate-900">SettleUp</span>
        </button>

        <nav className="space-y-4" aria-label="Workspace navigation">
          {NAV_SECTIONS.map((section) => (
            <div key={section.title} className="space-y-1">
              <p className="px-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                {section.title}
              </p>
              {section.items.map((item) => {
                const Icon = item.icon;
                const active = currentRoute === item.route;
                return (
                  <button
                    key={item.route}
                    type="button"
                    onClick={() => {
                      onNavigate(item.route);
                      setMobileOpen(false);
                    }}
                    className={`w-full flex items-center justify-between px-3 py-2 text-sm font-medium rounded-lg transition-colors cursor-pointer ${
                      active
                        ? 'bg-[#065F46] text-white'
                        : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                    }`}
                  >
                    <span className="flex items-center gap-2.5">
                      <Icon className="w-4 h-4 shrink-0" />
                      <span className="whitespace-nowrap">{item.label}</span>
                    </span>
                    {item.route === '/notifications' && unreadCount > 0 && (
                      <span
                        className={`font-mono-num text-[11px] font-semibold px-1.5 py-0.5 rounded ${
                          active ? 'bg-white/20 text-white' : 'bg-emerald-50 text-[#065F46]'
                        }`}
                      >
                        {unreadCount}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>
      </div>

      <div className="pt-4 mt-4 border-t border-slate-200 space-y-2.5">
        {onOpenQrScanner && (
          <button
            type="button"
            onClick={() => {
              setMobileOpen(false);
              onOpenQrScanner();
            }}
            className="w-full flex items-center gap-2 px-3 py-2 text-xs font-semibold text-[#065F46] bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-lg cursor-pointer"
          >
            <QrCode className="w-3.5 h-3.5" />
            <span>Scan Invite QR</span>
          </button>
        )}

        <button
          type="button"
          onClick={() => {
            setMobileOpen(false);
            onReplayTour();
          }}
          className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-lg cursor-pointer"
        >
          <Compass className="w-3.5 h-3.5 text-[#065F46]" />
          <span>Guided Tour</span>
        </button>

        <div
          onClick={() => {
            onNavigate('/profile');
            setMobileOpen(false);
          }}
          className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg hover:bg-slate-50 cursor-pointer"
        >
          <UserAvatar name={user.fullName} avatarUrl={user.avatarUrl} size="sm" />
          <div className="min-w-0">
            <p className="text-xs font-semibold text-slate-900 truncate">{user.fullName}</p>
            <p className="text-[11px] text-slate-500 truncate">{user.email}</p>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-[#0F172A] flex">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:block w-[260px] shrink-0 sticky top-0 h-screen">
        <SidebarContent />
      </aside>

      {/* Mobile Drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div className="w-[260px] h-full relative z-10">
            <SidebarContent />
          </div>
          <div className="flex-1 bg-slate-900/40" onClick={() => setMobileOpen(false)} />
        </div>
      )}

      {/* Main Content Column */}
      <div className="flex-1 min-w-0 flex flex-col">
        <header className="sticky top-0 z-20 bg-[#F8FAFC]/90 backdrop-blur-md border-b border-slate-200 h-16 px-4 sm:px-6 flex items-center justify-between gap-4 no-print">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileOpen(!mobileOpen)}
              aria-label="Toggle navigation menu"
              className="lg:hidden p-2 rounded-lg border border-slate-200 bg-white text-slate-700 cursor-pointer"
            >
              {mobileOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
            </button>
            <div className="text-sm text-slate-500 truncate">
              <span>SettleUp</span>
              <span className="mx-2" aria-hidden="true">/</span>
              <span className="font-semibold text-slate-900">{activeLabel}</span>
            </div>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            {onOpenQrScanner && (
              <button
                type="button"
                onClick={onOpenQrScanner}
                title="Join group via invite QR or link"
                className="hidden sm:inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg cursor-pointer"
              >
                <QrCode className="w-3.5 h-3.5 text-[#065F46]" />
                <span>Join Group QR</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => onNavigate('/notifications')}
              aria-label="Notifications"
              className="relative p-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 cursor-pointer"
            >
              <Bell className="w-4 h-4" />
              {unreadCount > 0 && (
                <span className="absolute -top-1 -right-1 px-1 min-w-[16px] h-4 rounded-full bg-[#065F46] text-white text-[10px] font-mono-num flex items-center justify-center">
                  {unreadCount}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => onNavigate('/add-expense')}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-[#065F46] hover:bg-[#047857] rounded-lg cursor-pointer whitespace-nowrap"
            >
              <Plus className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Add Expense</span>
              <span className="sm:hidden">Add</span>
            </button>
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-6xl w-full mx-auto">{children}</main>
      </div>
    </div>
  );
};
