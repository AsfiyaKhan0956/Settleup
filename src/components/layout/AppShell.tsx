import React, { useState } from 'react';
import {
  BarChart3,
  Bell,
  Compass,
  FolderKanban,
  LayoutDashboard,
  Menu,
  Plus,
  Receipt,
  Scale,
  Settings,
  Wallet,
  X,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { BrandMark, UserAvatar } from '../common/BrandMark.tsx';
import type { AppRoute, AuthUser } from '../../types/index.ts';

interface AppShellProps {
  user: AuthUser;
  currentRoute: AppRoute;
  unreadCount: number;
  onNavigate: (route: AppRoute) => void;
  onReplayTour: () => void;
  children: React.ReactNode;
}

const NAV_ITEMS: Array<{ route: AppRoute; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { route: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { route: '/groups', label: 'My Groups', icon: FolderKanban },
  { route: '/add-expense', label: 'Add Expense', icon: Plus },
  { route: '/expenses', label: 'Expense History', icon: Receipt },
  { route: '/balances', label: 'Balances', icon: Scale },
  { route: '/settlements', label: 'Settlements', icon: Wallet },
  { route: '/analytics', label: 'Analytics & Reports', icon: BarChart3 },
  { route: '/notifications', label: 'Notifications', icon: Bell },
  { route: '/profile', label: 'Profile & Settings', icon: Settings },
];

export const AppShell: React.FC<AppShellProps> = ({
  user,
  currentRoute,
  unreadCount,
  onNavigate,
  onReplayTour,
  children,
}) => {
  const [mobileOpen, setMobileOpen] = useState(false);
  const activeLabel = NAV_ITEMS.find((n) => n.route === currentRoute)?.label || 'Workspace';

  const SidebarContent = () => (
    <div className="flex flex-col h-full justify-between p-4 bg-white border-r border-slate-200">
      <div className="space-y-6">
        <button
          type="button"
          onClick={() => onNavigate('/')}
          className="flex items-center gap-2.5 px-2 py-1 cursor-pointer"
        >
          <BrandMark size={28} />
          <span className="font-display text-lg font-bold tracking-tight text-slate-900">SettleUp</span>
        </button>

        <nav className="space-y-1" aria-label="Workspace navigation">
          {NAV_ITEMS.map((item) => {
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
                className={`w-full flex items-center justify-between px-3 py-2.5 text-sm font-medium rounded-lg transition-colors cursor-pointer ${
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
        </nav>
      </div>

      <div className="pt-4 border-t border-slate-200 space-y-3">
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

          <div className="flex items-center gap-3 shrink-0">
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

        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-6xl w-full mx-auto">
          <AnimatePresence mode="wait">
            <motion.div
              key={currentRoute}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.22, ease: 'easeOut' }}
            >
              {children}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
    </div>
  );
};
