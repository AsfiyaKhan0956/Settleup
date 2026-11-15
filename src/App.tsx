import React, { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, AlertCircle, X } from 'lucide-react';
import { apiRequest, setStoredSessionToken } from './services/api.ts';
import type { AppRoute, AuthUser, NotificationRecord } from './types/index.ts';
import { LandingPage } from './components/landing/LandingPage.tsx';
import { LoginPage } from './components/auth/LoginPage.tsx';
import { RegisterPage } from './components/auth/RegisterPage.tsx';
import { ForgotPasswordPage } from './components/auth/ForgotPasswordPage.tsx';
import { ErrorStatusPage, HelpCentrePage, LegalPage } from './components/public/PublicPages.tsx';
import { AppShell } from './components/layout/AppShell.tsx';
import { DashboardView } from './components/dashboard/DashboardView.tsx';
import { GroupsView } from './components/groups/GroupsView.tsx';
import { GroupWorkspaceView } from './components/groups/GroupWorkspaceView.tsx';
import { AddExpenseView } from './components/expenses/AddExpenseView.tsx';
import { ExpensesHistoryView } from './components/expenses/ExpensesHistoryView.tsx';
import { BalancesView } from './components/balances/BalancesView.tsx';
import { SettlementsView, UpiQrPaymentModal, type ActivePayTarget } from './components/settlements/SettlementsView.tsx';
import { AnalyticsView } from './components/analytics/AnalyticsView.tsx';
import { NotificationsView } from './components/notifications/NotificationsView.tsx';
import { ProfileSettingsView } from './components/profile/ProfileSettingsView.tsx';
import { OnboardingTour } from './components/onboarding/OnboardingTour.tsx';
import { AiHelpAssistant } from './components/assistant/AiHelpAssistant.tsx';

const PUBLIC_ROUTES: AppRoute[] = ['/', '/login', '/register', '/forgot-password', '/help', '/privacy', '/terms', '/403', '/404', '/expired'];

interface InvitePreview {
  token: string;
  valid: boolean;
  groupId: number;
  groupName: string;
  groupDescription: string;
  inviterName: string;
}

export default function App() {
  const [route, setRoute] = useState<AppRoute>(() => {
    const path = window.location.pathname as AppRoute;
    const known: AppRoute[] = [
      '/',
      '/login',
      '/register',
      '/forgot-password',
      '/help',
      '/privacy',
      '/terms',
      '/403',
      '/404',
      '/expired',
      '/dashboard',
      '/groups',
      '/add-expense',
      '/expenses',
      '/balances',
      '/settlements',
      '/analytics',
      '/notifications',
      '/profile',
    ];
    return known.includes(path) ? path : '/404';
  });

  const [user, setUser] = useState<AuthUser | null>(null);
  const [authChecked, setAuthChecked] = useState(false);

  const [selectedGroupId, setSelectedGroupId] = useState<number | null>(null);
  const [selectedExpenseId, setSelectedExpenseId] = useState<number | null>(null);
  const [editExpenseId, setEditExpenseId] = useState<number | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [showTour, setShowTour] = useState(false);
  const [payTarget, setPayTarget] = useState<ActivePayTarget | null>(null);
  const [refreshSignal, setRefreshSignal] = useState(0);
  const [invitePreview, setInvitePreview] = useState<InvitePreview | null>(null);
  const [toast, setToast] = useState<{ msg: string; tone: 'success' | 'error' } | null>(null);

  const showToast = useCallback((msg: string, tone: 'success' | 'error' = 'success') => {
    setToast({ msg, tone });
    window.setTimeout(() => {
      setToast((prev) => (prev?.msg === msg ? null : prev));
    }, 4200);
  }, []);

  const navigate = useCallback(
    (nextRoute: AppRoute, params?: { groupId?: number; expenseId?: number; editExpenseId?: number }) => {
      setSelectedGroupId(params?.groupId ?? null);
      setSelectedExpenseId(params?.expenseId ?? null);
      setEditExpenseId(params?.editExpenseId ?? null);
      setRoute(nextRoute);
      window.history.pushState({}, '', nextRoute);
      window.scrollTo({ top: 0, behavior: 'auto' });
    },
    []
  );

  const refreshUnread = useCallback(() => {
    apiRequest<{ notifications: NotificationRecord[] }>('/api/notifications')
      .then((res) => {
        setUnreadCount(res.notifications.filter((n) => n.is_read === 0).length);
      })
      .catch(() => {});
  }, []);

  // Check active session & invite token on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const inviteToken = params.get('invite');
    if (inviteToken) {
      apiRequest<Omit<InvitePreview, 'token'>>(`/api/groups/invite/${inviteToken}`)
        .then((res) => {
          setInvitePreview({ token: inviteToken, ...res });
        })
        .catch(() => showToast('Invitation link is invalid or expired.', 'error'));
    }

    apiRequest<{ user: AuthUser }>('/api/auth/me')
      .then((res) => {
        setUser(res.user);
        refreshUnread();
        if (!res.user.preferences.onboardingCompleted && !res.user.isDemo) {
          setShowTour(true);
        }
      })
      .catch(() => {
        setUser(null);
      })
      .finally(() => setAuthChecked(true));

    const onPopState = () => {
      setRoute((window.location.pathname as AppRoute) || '/');
    };
    const onExpired = () => {
      setUser(null);
      navigate('/expired');
    };
    window.addEventListener('popstate', onPopState);
    window.addEventListener('settleup:session-expired', onExpired);
    return () => {
      window.removeEventListener('popstate', onPopState);
      window.removeEventListener('settleup:session-expired', onExpired);
    };
  }, [navigate, refreshUnread, showToast]);

  const handleAuthSuccess = (authedUser: AuthUser, sessionToken?: string, rememberMe = true) => {
    if (sessionToken) {
      setStoredSessionToken(sessionToken, rememberMe);
    }
    setUser(authedUser);
    refreshUnread();
    if (!authedUser.preferences.onboardingCompleted && !authedUser.isDemo) {
      setShowTour(true);
    }
    navigate('/dashboard');
  };

  const handleDemoLogin = async () => {
    try {
      const res = await apiRequest<{ user: AuthUser; sessionToken?: string }>('/api/auth/demo', { method: 'POST' });
      if (res.sessionToken) {
        setStoredSessionToken(res.sessionToken, false);
      }
      setUser(res.user);
      refreshUnread();
      navigate('/dashboard');
      showToast('Signed in to SettleUp Live Demo Workspace (Aarav Sharma).', 'success');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to open live demo workspace.';
      showToast(msg, 'error');
      throw err;
    }
  };

  const handleLogout = async () => {
    await apiRequest('/api/auth/logout', { method: 'POST' }).catch(() => {});
    setStoredSessionToken(null);
    setUser(null);
    setUnreadCount(0);
    navigate('/');
  };

  const handleFinishTour = () => {
    setShowTour(false);
    if (user && !user.preferences.onboardingCompleted) {
      apiRequest<{ user: AuthUser }>('/api/profile', {
        method: 'PATCH',
        body: JSON.stringify({ preferences: { onboardingCompleted: true } }),
      })
        .then((res) => setUser(res.user))
        .catch(() => {});
    }
  };

  const handleAcceptInvite = async () => {
    if (!invitePreview) return;
    if (!user) {
      showToast('Please sign in or register first to join the group.', 'error');
      navigate('/login');
      return;
    }
    try {
      const res = await apiRequest<{ groupId: number }>(`/api/groups/invite/${invitePreview.token}/accept`, {
        method: 'POST',
      });
      setInvitePreview(null);
      window.history.replaceState({}, '', '/groups');
      navigate('/groups', { groupId: res.groupId });
      showToast(`Joined "${invitePreview.groupName}"!`, 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Unable to join group', 'error');
    }
  };

  if (!authChecked) {
    return (
      <div className="min-h-screen bg-[#F8FAFC] flex items-center justify-center">
        <div className="text-sm font-medium text-slate-500">Loading SettleUp...</div>
      </div>
    );
  }

  // Protected route guard
  const isPublic = PUBLIC_ROUTES.includes(route);
  if (!isPublic && !user) {
    return (
      <>
        <LoginPage onNavigate={navigate} onSuccess={handleAuthSuccess} onDemoLogin={handleDemoLogin} />
      </>
    );
  }

  return (
    <>
      {/* Pending Group Invitation Modal */}
      {invitePreview && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-2xl max-w-md w-full p-6 space-y-4">
            <h2 className="font-display text-xl font-bold text-slate-900">Group Invitation</h2>
            {invitePreview.valid ? (
              <>
                <p className="text-sm text-slate-600">
                  <strong>{invitePreview.inviterName}</strong> invited you to join{' '}
                  <strong>{invitePreview.groupName}</strong>.
                </p>
                {invitePreview.groupDescription && (
                  <p className="text-xs text-slate-500 bg-slate-50 p-3 rounded-lg border border-slate-200">
                    {invitePreview.groupDescription}
                  </p>
                )}
                <div className="flex justify-end gap-2.5 pt-2">
                  <button
                    type="button"
                    onClick={() => setInvitePreview(null)}
                    className="px-4 py-2 text-sm text-slate-600 border border-slate-300 rounded-lg cursor-pointer"
                  >
                    Dismiss
                  </button>
                  <button
                    type="button"
                    onClick={handleAcceptInvite}
                    className="px-4 py-2 text-sm font-semibold text-white bg-[#065F46] hover:bg-[#047857] rounded-lg cursor-pointer"
                  >
                    {user ? 'Accept & Join Group' : 'Sign In to Join'}
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="text-sm text-red-700">This invitation has expired or been revoked.</p>
                <button
                  type="button"
                  onClick={() => setInvitePreview(null)}
                  className="px-4 py-2 text-sm font-semibold text-slate-800 bg-slate-100 rounded-lg cursor-pointer"
                >
                  Close
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* Toast Notification */}
      {toast && (
        <div
          role="status"
          className={`fixed top-5 right-5 z-50 max-w-sm px-4 py-3 rounded-xl shadow-lg border flex items-center gap-2.5 text-sm font-medium ${
            toast.tone === 'error'
              ? 'bg-red-50 border-red-200 text-red-900'
              : 'bg-slate-900 border-slate-800 text-white'
          }`}
        >
          {toast.tone === 'error' ? (
            <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
          ) : (
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          )}
          <span>{toast.msg}</span>
          <button
            type="button"
            onClick={() => setToast(null)}
            aria-label="Dismiss message"
            className="ml-2 opacity-70 hover:opacity-100 cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Public Routes */}
      {route === '/' && (
        <LandingPage
          onNavigate={navigate}
          onDemoLogin={handleDemoLogin}
          isAuthenticated={Boolean(user)}
        />
      )}
      {route === '/login' && (
        <LoginPage onNavigate={navigate} onSuccess={handleAuthSuccess} onDemoLogin={handleDemoLogin} />
      )}
      {route === '/register' && (
        <RegisterPage onNavigate={navigate} onSuccess={handleAuthSuccess} onDemoLogin={handleDemoLogin} />
      )}
      {route === '/forgot-password' && <ForgotPasswordPage onNavigate={navigate} />}
      {route === '/help' && <HelpCentrePage onNavigate={navigate} />}
      {route === '/privacy' && <LegalPage mode="privacy" onNavigate={navigate} />}
      {route === '/terms' && <LegalPage mode="terms" onNavigate={navigate} />}
      {route === '/403' && <ErrorStatusPage code="403" onNavigate={navigate} />}
      {route === '/404' && <ErrorStatusPage code="404" onNavigate={navigate} />}
      {route === '/expired' && <ErrorStatusPage code="expired" onNavigate={navigate} />}

      {/* Authenticated App Routes */}
      {!isPublic && user && (
        <AppShell
          user={user}
          currentRoute={route}
          unreadCount={unreadCount}
          onNavigate={(r) => navigate(r)}
          onReplayTour={() => setShowTour(true)}
        >
          {route === '/dashboard' && (
            <DashboardView
              user={user}
              onNavigate={navigate}
              onReplayOnboarding={() => setShowTour(true)}
              onOpenPayQr={(target) => setPayTarget(target)}
              onToast={showToast}
              refreshSignal={refreshSignal}
            />
          )}

          {route === '/groups' && !selectedGroupId && (
            <GroupsView
              onSelectGroup={(id) => navigate('/groups', { groupId: id })}
              onNavigate={navigate}
            />
          )}

          {route === '/groups' && selectedGroupId && (
            <GroupWorkspaceView
              groupId={selectedGroupId}
              currentUser={user}
              onBack={() => navigate('/groups')}
              onNavigate={navigate}
              onToast={showToast}
              onOpenPayQr={(target) => setPayTarget(target)}
            />
          )}

          {route === '/add-expense' && (
            <AddExpenseView
              currentUser={user}
              initialGroupId={selectedGroupId}
              editExpenseId={editExpenseId}
              onSaved={(gid) => {
                refreshUnread();
                navigate('/groups', { groupId: gid });
              }}
              onCancel={() => navigate('/dashboard')}
              onToast={showToast}
            />
          )}

          {route === '/expenses' && (
            <ExpensesHistoryView
              initialExpenseId={selectedExpenseId}
              onNavigate={navigate}
              onToast={showToast}
            />
          )}

          {route === '/balances' && (
            <BalancesView currentUser={user} onOpenPayQr={(target) => setPayTarget(target)} />
          )}

          {route === '/settlements' && (
            <SettlementsView
              currentUser={user}
              onOpenPayQr={(target) => setPayTarget(target)}
              onToast={showToast}
              refreshSignal={refreshSignal}
            />
          )}

          {route === '/analytics' && <AnalyticsView />}

          {route === '/notifications' && (
            <NotificationsView onNavigate={navigate} onUpdated={refreshUnread} />
          )}

          {route === '/profile' && (
            <ProfileSettingsView
              user={user}
              onUserUpdated={setUser}
              onLogout={handleLogout}
              onReplayTour={() => setShowTour(true)}
              onToast={showToast}
            />
          )}

          {payTarget && (
            <UpiQrPaymentModal
              target={payTarget}
              currentUser={user}
              onClose={() => setPayTarget(null)}
              onRecorded={() => {
                setRefreshSignal((s) => s + 1);
                refreshUnread();
              }}
              onToast={showToast}
            />
          )}

          {showTour && <OnboardingTour onClose={handleFinishTour} onNavigate={navigate} />}
          <AiHelpAssistant onNavigate={navigate} />
        </AppShell>
      )}
    </>
  );
}
