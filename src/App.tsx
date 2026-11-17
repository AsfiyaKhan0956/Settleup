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
import { QrInviteScannerModal } from './components/groups/QrInviteScannerModal.tsx';
import { AddExpenseView } from './components/expenses/AddExpenseView.tsx';
import { ExpensesHistoryView } from './components/expenses/ExpensesHistoryView.tsx';
import { BalancesView } from './components/balances/BalancesView.tsx';
import { ManualTripBalancesView } from './components/balances/ManualTripBalancesView.tsx';
import { SettlementsView, UpiQrPaymentModal, type ActivePayTarget } from './components/settlements/SettlementsView.tsx';
import { AnalyticsView } from './components/analytics/AnalyticsView.tsx';
import { PersonalTrackerView } from './components/personal/PersonalTrackerView.tsx';
import { NotificationsView } from './components/notifications/NotificationsView.tsx';
import { ProfileSettingsView } from './components/profile/ProfileSettingsView.tsx';
import { OnboardingTour } from './components/onboarding/OnboardingTour.tsx';
import { AiHelpAssistant } from './components/assistant/AiHelpAssistant.tsx';

const PUBLIC_ROUTES: AppRoute[] = ['/', '/login', '/register', '/forgot-password', '/help', '/privacy', '/terms', '/403', '/404', '/expired'];
const PENDING_INVITE_KEY = 'settleup_pending_invite';

interface InvitePreview {
  token: string;
  valid: boolean;
  status?: string;
  reason?: string;
  requiresEmailMatch?: boolean;
  groupId?: number;
  groupName?: string;
  groupCategory?: string;
  inviterName?: string;
}

function extractInitialInviteToken(): string | null {
  const params = new URLSearchParams(window.location.search);
  const queryToken = params.get('invite')?.trim();
  if (queryToken) return queryToken;
  const pathMatch = window.location.pathname.match(/^\/invite\/([a-zA-Z0-9_-]{8,128})\/?$/);
  return pathMatch ? pathMatch[1] : null;
}

function savePendingInviteToken(token: string | null) {
  try {
    if (token) window.sessionStorage.setItem(PENDING_INVITE_KEY, token);
    else window.sessionStorage.removeItem(PENDING_INVITE_KEY);
  } catch {
    // Ignore storage errors
  }
}

function readPendingInviteToken(): string | null {
  try {
    return window.sessionStorage.getItem(PENDING_INVITE_KEY);
  } catch {
    return null;
  }
}

export default function App() {
  const [route, setRoute] = useState<AppRoute>(() => {
    const path = window.location.pathname as AppRoute;
    if (/^\/invite\/[a-zA-Z0-9_-]{8,128}\/?$/.test(window.location.pathname)) {
      return '/';
    }
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
      '/personal',
      '/dashboard',
      '/groups',
      '/add-expense',
      '/expenses',
      '/balances',
      '/manual-balances',
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
  const [qrScannerOpen, setQrScannerOpen] = useState(false);
  const [refreshSignal, setRefreshSignal] = useState(0);
  const [invitePreview, setInvitePreview] = useState<InvitePreview | null>(null);
  const [toast, setToast] = useState<{ msg: string; tone: 'success' | 'error' } | null>(null);

  const showToast = useCallback((msg: string, tone: 'success' | 'error' = 'success') => {
    setToast({ msg, tone });
    window.setTimeout(() => {
      setToast((prev) => (prev?.msg === msg ? null : prev));
    }, 4500);
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

  const loadInvitePreview = useCallback((token: string) => {
    apiRequest<Omit<InvitePreview, 'token'>>(`/api/groups/invite/${encodeURIComponent(token)}`)
      .then((res) => {
        setInvitePreview({ token, ...res });
        if (res.valid) {
          savePendingInviteToken(token);
        } else {
          savePendingInviteToken(null);
        }
      })
      .catch((err) => {
        savePendingInviteToken(null);
        setInvitePreview({
          token,
          valid: false,
          status: 'invalid',
          reason: err instanceof Error ? err.message : 'This invitation link is invalid, expired, or has been revoked.',
        });
      });
  }, []);

  // Check active session & invite token on mount
  useEffect(() => {
    const inviteToken = extractInitialInviteToken() || readPendingInviteToken();
    if (inviteToken) {
      loadInvitePreview(inviteToken);
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
  }, [loadInvitePreview, navigate, refreshUnread]);

  const handleAuthSuccess = (authedUser: AuthUser, sessionToken?: string, rememberMe = true) => {
    if (sessionToken) {
      setStoredSessionToken(sessionToken, rememberMe);
    }
    setUser(authedUser);
    refreshUnread();
    if (!authedUser.preferences.onboardingCompleted && !authedUser.isDemo) {
      setShowTour(true);
    }
    const pendingToken = readPendingInviteToken();
    if (pendingToken) {
      loadInvitePreview(pendingToken);
      navigate('/groups');
    } else {
      navigate('/dashboard');
    }
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
      savePendingInviteToken(invitePreview.token);
      setInvitePreview(null);
      showToast('Sign in or create an account to accept your group invitation.', 'success');
      navigate('/login');
      return;
    }
    try {
      const res = await apiRequest<{ groupId: number; groupName: string; alreadyMember?: boolean }>(
        `/api/groups/invite/${encodeURIComponent(invitePreview.token)}/accept`,
        { method: 'POST' }
      );
      savePendingInviteToken(null);
      const joinedGroupName = res.groupName || invitePreview.groupName || 'group';
      setInvitePreview(null);
      window.history.replaceState({}, '', '/groups');
      navigate('/groups', { groupId: res.groupId });
      showToast(
        res.alreadyMember
          ? `You are already a member of "${joinedGroupName}".`
          : `Joined "${joinedGroupName}"!`,
        'success'
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Unable to join group', 'error');
    }
  };

  const handleDeclineInvite = async () => {
    if (!invitePreview) return;
    try {
      await apiRequest(`/api/groups/invite/${encodeURIComponent(invitePreview.token)}/decline`, {
        method: 'POST',
      });
    } catch {
      // Best-effort decline
    }
    savePendingInviteToken(null);
    setInvitePreview(null);
    if (window.location.search.includes('invite=') || window.location.pathname.startsWith('/invite/')) {
      window.history.replaceState({}, '', user ? '/groups' : '/');
    }
    showToast('Invitation declined.', 'success');
  };

  const handleSwitchAccountForInvite = async () => {
    if (!invitePreview) return;
    const token = invitePreview.token;
    await apiRequest('/api/auth/logout', { method: 'POST' }).catch(() => {});
    setStoredSessionToken(null);
    setUser(null);
    setUnreadCount(0);
    savePendingInviteToken(token);
    setInvitePreview(null);
    navigate('/login');
    showToast('Signed out. Sign in or register with the invited email to accept.', 'success');
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
        <div
          className="fixed inset-0 z-50 bg-slate-900/55 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Group Invitation"
        >
          <div className="bg-white border border-slate-200 rounded-2xl max-w-md w-full p-6 space-y-4 shadow-xl">
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-display text-xl font-bold text-slate-900">Group Invitation</h2>
              {!invitePreview.valid && invitePreview.status && (
                <span className="px-2.5 py-0.5 text-xs font-semibold rounded-full bg-red-50 text-red-700 border border-red-200 capitalize">
                  {invitePreview.status === 'accepted' ? 'Already Used' : invitePreview.status}
                </span>
              )}
            </div>

            {invitePreview.valid ? (
              <>
                <p className="text-sm text-slate-700 leading-relaxed">
                  <strong>{invitePreview.inviterName}</strong> invited you to join{' '}
                  <strong>{invitePreview.groupName}</strong>. Would you like to join?
                </p>

                {invitePreview.groupCategory && (
                  <p className="text-xs text-slate-500">
                    Category: <span className="font-medium text-slate-700">{invitePreview.groupCategory}</span>
                  </p>
                )}

                {!user && (
                  <p className="text-xs text-slate-600 bg-slate-50 p-3 rounded-lg border border-slate-200">
                    Sign in or create a free SettleUp account first — you&apos;ll return right here to join{' '}
                    <strong>{invitePreview.groupName}</strong>.
                  </p>
                )}

                {invitePreview.requiresEmailMatch && (
                  <div className="text-xs text-slate-700 bg-emerald-50/70 p-3 rounded-lg border border-emerald-200 space-y-1.5">
                    <p>
                      This invitation is linked to the invited email address.
                      {user ? ` You are currently signed in as ${user.email}.` : ' Sign in or register using that email address to accept.'}
                    </p>
                    {user && (
                      <button
                        type="button"
                        onClick={handleSwitchAccountForInvite}
                        className="font-semibold text-[#065F46] hover:underline cursor-pointer"
                      >
                        Switch account / Sign in with another email
                      </button>
                    )}
                  </div>
                )}

                <div className="flex flex-wrap justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={handleDeclineInvite}
                    className="px-3.5 py-2 text-sm text-slate-700 border border-slate-300 hover:bg-slate-50 rounded-lg cursor-pointer"
                  >
                    Decline
                  </button>
                  {!user && (
                    <button
                      type="button"
                      onClick={() => {
                        savePendingInviteToken(invitePreview.token);
                        setInvitePreview(null);
                        navigate('/register');
                      }}
                      className="px-3.5 py-2 text-sm font-semibold text-[#065F46] bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 rounded-lg cursor-pointer"
                    >
                      Register
                    </button>
                  )}
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
                <p className="text-sm text-red-700 leading-relaxed">
                  {invitePreview.reason || 'This invitation link is invalid, expired, or has been revoked.'}
                </p>
                <div className="flex justify-end pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      savePendingInviteToken(null);
                      setInvitePreview(null);
                      if (window.location.search.includes('invite=') || window.location.pathname.startsWith('/invite/')) {
                        window.history.replaceState({}, '', user ? '/groups' : '/');
                      }
                    }}
                    className="px-4 py-2 text-sm font-semibold text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer"
                  >
                    Close
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* QR Invite Scanner Modal */}
      {qrScannerOpen && (
        <QrInviteScannerModal
          onClose={() => setQrScannerOpen(false)}
          onTokenDetected={(token) => {
            setQrScannerOpen(false);
            loadInvitePreview(token);
          }}
        />
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
          onOpenQrScanner={() => setQrScannerOpen(true)}
        >
          {route === '/personal' && <PersonalTrackerView onToast={showToast} />}

          {route === '/dashboard' && (
            <DashboardView
              user={user}
              onNavigate={navigate}
              onReplayOnboarding={() => setShowTour(true)}
            />
          )}

          {route === '/groups' && !selectedGroupId && (
            <GroupsView
              onSelectGroup={(id) => navigate('/groups', { groupId: id })}
              onNavigate={navigate}
              onOpenQrScanner={() => setQrScannerOpen(true)}
              onToast={showToast}
            />
          )}

          {route === '/groups' && selectedGroupId && (
            <GroupWorkspaceView
              groupId={selectedGroupId}
              currentUser={user}
              onBack={() => navigate('/groups')}
              onNavigate={navigate}
              onToast={showToast}
              onOpenQrScanner={() => setQrScannerOpen(true)}
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

          {route === '/manual-balances' && <ManualTripBalancesView onToast={showToast} />}

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
