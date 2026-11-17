import type { NextFunction, Request, Response } from 'express';
import { db } from './db.ts';
import { readSessionToken, hashToken } from './security.ts';
import { simplifyDebts, type MemberNetBalance, type SimplifiedTransfer } from './math.ts';

export interface AuthUser {
  id: number;
  fullName: string;
  email: string;
  phone: string | null;
  avatarUrl: string | null;
  upiId: string | null;
  isDemo: boolean;
  preferences: {
    currency: string;
    theme: string;
    emailNotifications: boolean;
    settlementAlerts: boolean;
    onboardingCompleted: boolean;
  };
}

export interface AuthedRequest extends Request {
  user?: AuthUser;
}

export function loadUserById(userId: number): AuthUser | null {
  const row = db
    .prepare(`
      SELECT u.id, u.full_name, u.email, u.phone, u.avatar_url, u.upi_id, u.is_demo,
             p.currency, p.theme, p.email_notifications, p.settlement_alerts, p.onboarding_completed
      FROM users u
      LEFT JOIN user_preferences p ON p.user_id = u.id
      WHERE u.id = ?
    `)
    .get(userId) as
    | {
        id: number;
        full_name: string;
        email: string;
        phone: string | null;
        avatar_url: string | null;
        upi_id: string | null;
        is_demo: number;
        currency: string | null;
        theme: string | null;
        email_notifications: number | null;
        settlement_alerts: number | null;
        onboarding_completed: number | null;
      }
    | undefined;

  if (!row) return null;

  return {
    id: row.id,
    fullName: row.full_name,
    email: row.email,
    phone: row.phone ?? null,
    avatarUrl: row.avatar_url,
    upiId: row.upi_id,
    isDemo: row.is_demo === 1,
    preferences: {
      currency: row.currency ?? 'INR',
      theme: row.theme ?? 'daylight',
      emailNotifications: (row.email_notifications ?? 1) === 1,
      settlementAlerts: (row.settlement_alerts ?? 1) === 1,
      onboardingCompleted: (row.onboarding_completed ?? 0) === 1,
    },
  };
}

export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction): void {
  const rawToken = readSessionToken(req);
  if (!rawToken) {
    res.status(401).json({ error: 'Authentication required. Please sign in.' });
    return;
  }

  const tokenHash = hashToken(rawToken);
  const session = db
    .prepare(`
      SELECT user_id, expires_at
      FROM sessions
      WHERE token_hash = ? AND datetime(expires_at) > datetime('now')
    `)
    .get(tokenHash) as { user_id: number; expires_at: string } | undefined;

  if (!session) {
    res.status(401).json({ error: 'Session expired. Please sign in again.', code: 'SESSION_EXPIRED' });
    return;
  }

  const user = loadUserById(session.user_id);
  if (!user) {
    res.status(401).json({ error: 'Account not found.' });
    return;
  }

  req.user = user;
  next();
}

export function getMembership(groupId: number, userId: number): { role: string } | undefined {
  return db
    .prepare('SELECT role FROM group_members WHERE group_id = ? AND user_id = ?')
    .get(groupId, userId) as { role: string } | undefined;
}

export function computeGroupBalances(groupId: number): {
  members: MemberNetBalance[];
  transfers: SimplifiedTransfer[];
  totalExpenditurePaise: number;
  confirmedSettledPaise: number;
} {
  const membersRaw = db
    .prepare(`
      SELECT u.id, u.full_name, u.email, u.upi_id, u.avatar_url, gm.role
      FROM group_members gm
      JOIN users u ON u.id = gm.user_id
      WHERE gm.group_id = ?
      ORDER BY gm.joined_at ASC
    `)
    .all(groupId) as Array<{
    id: number;
    full_name: string;
    email: string;
    upi_id: string | null;
    avatar_url: string | null;
    role: string;
  }>;

  const balanceMap = new Map<number, MemberNetBalance>();
  for (const m of membersRaw) {
    balanceMap.set(m.id, {
      userId: m.id,
      fullName: m.full_name,
      email: m.email,
      upiId: m.upi_id,
      avatarUrl: m.avatar_url,
      paidPaise: 0,
      owedPaise: 0,
      settlementsPaidPaise: 0,
      settlementsReceivedPaise: 0,
      pendingIncomingPaise: 0,
      pendingOutgoingPaise: 0,
      netPaise: 0,
    });
  }

  const expenses = db
    .prepare('SELECT id, paid_by_user_id, total_paise FROM expenses WHERE group_id = ?')
    .all(groupId) as Array<{ id: number; paid_by_user_id: number; total_paise: number }>;

  let totalExpenditurePaise = 0;
  for (const exp of expenses) {
    totalExpenditurePaise += exp.total_paise;
    const payer = balanceMap.get(exp.paid_by_user_id);
    if (payer) {
      payer.paidPaise += exp.total_paise;
    }
  }

  const splits = db
    .prepare(`
      SELECT es.user_id, es.owed_paise
      FROM expense_splits es
      JOIN expenses e ON e.id = es.expense_id
      WHERE e.group_id = ?
    `)
    .all(groupId) as Array<{ user_id: number; owed_paise: number }>;

  for (const s of splits) {
    const member = balanceMap.get(s.user_id);
    if (member) {
      member.owedPaise += s.owed_paise;
    }
  }

  const settlements = db
    .prepare(`
      SELECT payer_user_id, receiver_user_id, amount_paise, status
      FROM settlements
      WHERE group_id = ?
    `)
    .all(groupId) as Array<{
    payer_user_id: number;
    receiver_user_id: number;
    amount_paise: number;
    status: string;
  }>;

  let confirmedSettledPaise = 0;
  for (const st of settlements) {
    const payer = balanceMap.get(st.payer_user_id);
    const receiver = balanceMap.get(st.receiver_user_id);
    if (st.status === 'confirmed') {
      confirmedSettledPaise += st.amount_paise;
      if (payer) payer.settlementsPaidPaise += st.amount_paise;
      if (receiver) receiver.settlementsReceivedPaise += st.amount_paise;
    } else if (st.status === 'recorded' || st.status === 'pending') {
      if (payer) payer.pendingOutgoingPaise += st.amount_paise;
      if (receiver) receiver.pendingIncomingPaise += st.amount_paise;
    }
  }

  const members = Array.from(balanceMap.values()).map((m) => ({
    ...m,
    netPaise: m.paidPaise - m.owedPaise + m.settlementsPaidPaise - m.settlementsReceivedPaise,
  }));

  const transfers = simplifyDebts(members);

  return {
    members,
    transfers,
    totalExpenditurePaise,
    confirmedSettledPaise,
  };
}
