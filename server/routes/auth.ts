import { Router } from 'express';
import { db } from '../db.ts';
import {
  clearSessionCookie,
  createRateLimiter,
  generateOpaqueToken,
  hashPassword,
  hashToken,
  isValidEmail,
  normalizePhone,
  passwordStrengthErrors,
  readSessionToken,
  setSessionCookie,
  verifyPassword,
} from '../security.ts';
import { loadUserById, requireAuth, type AuthedRequest } from '../middleware.ts';

export const authRouter = Router();
const authLimiter = createRateLimiter(60_000, 30);

function createSessionForUser(userId: number, rememberMe: boolean): string {
  const rawToken = generateOpaqueToken(32);
  const tokenHash = hashToken(rawToken);
  const days = rememberMe ? 30 : 1;
  db.prepare(`
    INSERT INTO sessions (token_hash, user_id, remember_me, expires_at)
    VALUES (?, ?, ?, datetime('now', '+' || ? || ' days'))
  `).run(tokenHash, userId, rememberMe ? 1 : 0, days);
  return rawToken;
}

authRouter.post('/register', authLimiter, (req, res) => {
  const { fullName, email, phone, password, avatarUrl, upiId } = req.body as {
    fullName?: string;
    email?: string;
    phone?: string;
    password?: string;
    avatarUrl?: string;
    upiId?: string;
  };

  const cleanName = (fullName ?? '').trim();
  const cleanEmail = (email ?? '').trim().toLowerCase();
  const rawPhone = (phone ?? '').trim();
  const cleanPhone = rawPhone ? normalizePhone(rawPhone) : null;
  const pass = password ?? '';

  if (cleanName.length < 2 || cleanName.length > 80) {
    res.status(400).json({ error: 'Full name must be between 2 and 80 characters.' });
    return;
  }
  if (!isValidEmail(cleanEmail)) {
    res.status(400).json({ error: 'Please enter a valid email address.' });
    return;
  }
  if (rawPhone && !cleanPhone) {
    res.status(400).json({ error: 'Please enter a valid mobile number with country code if required.' });
    return;
  }
  const strengthErrs = passwordStrengthErrors(pass);
  if (strengthErrs.length > 0) {
    res.status(400).json({ error: `Password requirements not met: ${strengthErrs.join(', ')}.` });
    return;
  }

  if (avatarUrl && !avatarUrl.startsWith('data:image/') && !avatarUrl.startsWith('/')) {
    res.status(400).json({ error: 'Invalid avatar image format.' });
    return;
  }
  if (avatarUrl && avatarUrl.length > 1_400_000) {
    res.status(400).json({ error: 'Profile image is too large (max ~1 MB).' });
    return;
  }

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(cleanEmail);
  if (existing) {
    res.status(409).json({ error: 'An account with this email already exists.' });
    return;
  }
  if (cleanPhone) {
    const existingPhone = db.prepare('SELECT id FROM users WHERE phone = ?').get(cleanPhone);
    if (existingPhone) {
      res.status(409).json({ error: 'An account with this mobile number already exists.' });
      return;
    }
  }

  const passwordHash = hashPassword(pass);

  const newUserId = db.transaction(() => {
    const result = db
      .prepare(`
        INSERT INTO users (full_name, email, phone, password_hash, avatar_url, upi_id, is_demo)
        VALUES (?, ?, ?, ?, ?, ?, 0)
      `)
      .run(cleanName, cleanEmail, cleanPhone, passwordHash, avatarUrl ?? null, upiId?.trim() || null);

    const uid = Number(result.lastInsertRowid);
    db.prepare('INSERT INTO user_preferences (user_id, onboarding_completed) VALUES (?, 0)').run(uid);
    db.prepare(`
      INSERT INTO notifications (user_id, type, title, message, link_path)
      VALUES (?, 'welcome', 'Welcome to SettleUp', 'Manage shared group bills and track your personal income, expenses, and budgets.', '/groups')
    `).run(uid);
    return uid;
  })();

  const rawToken = createSessionForUser(newUserId, false);
  setSessionCookie(req, res, rawToken, false);

  res.status(201).json({ user: loadUserById(newUserId), sessionToken: rawToken });
});

authRouter.post('/login', authLimiter, (req, res) => {
  const { email, password, rememberMe } = req.body as {
    email?: string;
    password?: string;
    rememberMe?: boolean;
  };

  const cleanEmail = (email ?? '').trim().toLowerCase();
  const pass = password ?? '';

  if (!isValidEmail(cleanEmail) || !pass) {
    res.status(400).json({ error: 'Please provide both email and password.' });
    return;
  }

  const row = db
    .prepare('SELECT id, password_hash FROM users WHERE email = ?')
    .get(cleanEmail) as { id: number; password_hash: string } | undefined;

  if (!row || !verifyPassword(pass, row.password_hash)) {
    res.status(401).json({ error: 'Invalid email or password.' });
    return;
  }

  const rawToken = createSessionForUser(row.id, Boolean(rememberMe));
  setSessionCookie(req, res, rawToken, Boolean(rememberMe));

  res.json({ user: loadUserById(row.id), sessionToken: rawToken });
});

authRouter.post('/demo', authLimiter, (req, res) => {
  const demoUser = db
    .prepare('SELECT id FROM users WHERE email = ?')
    .get('aarav@settleup.app') as { id: number } | undefined;

  if (!demoUser) {
    res.status(404).json({ error: 'Demo workspace unavailable.' });
    return;
  }

  const rawToken = createSessionForUser(demoUser.id, false);
  setSessionCookie(req, res, rawToken, false);
  res.json({ user: loadUserById(demoUser.id), sessionToken: rawToken });
});

authRouter.post('/logout', (req, res) => {
  const rawToken = readSessionToken(req);
  if (rawToken) {
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(rawToken));
  }
  clearSessionCookie(req, res);
  res.json({ ok: true });
});

authRouter.get('/me', requireAuth, (req: AuthedRequest, res) => {
  res.json({ user: req.user });
});

authRouter.post('/forgot-password', authLimiter, (req, res) => {
  const { email } = req.body as { email?: string };
  const cleanEmail = (email ?? '').trim().toLowerCase();
  if (!isValidEmail(cleanEmail)) {
    res.status(400).json({ error: 'Please enter a valid email address.' });
    return;
  }

  const user = db.prepare('SELECT id FROM users WHERE email = ?').get(cleanEmail) as
    | { id: number }
    | undefined;

  // Always return neutral confirmation; in development preview without SMTP, return devResetToken safely
  if (!user) {
    res.json({
      message: 'If an account matches that email, a password reset token has been generated.',
    });
    return;
  }

  const rawResetToken = generateOpaqueToken(24);
  const tokenHash = hashToken(rawResetToken);

  db.prepare(`
    INSERT INTO password_resets (user_id, token_hash, expires_at)
    VALUES (?, ?, datetime('now', '+30 minutes'))
  `).run(user.id, tokenHash);

  res.json({
    message:
      'Password reset token generated (valid for 30 minutes). SMTP email delivery is simulated in local preview mode.',
    devResetToken: rawResetToken,
  });
});

authRouter.post('/reset-password', authLimiter, (req, res) => {
  const { token, newPassword } = req.body as { token?: string; newPassword?: string };
  const rawToken = (token ?? '').trim();
  const pass = newPassword ?? '';

  if (!rawToken) {
    res.status(400).json({ error: 'Reset token is required.' });
    return;
  }

  const strengthErrs = passwordStrengthErrors(pass);
  if (strengthErrs.length > 0) {
    res.status(400).json({ error: `Password requirements not met: ${strengthErrs.join(', ')}.` });
    return;
  }

  const tokenHash = hashToken(rawToken);
  const resetRow = db
    .prepare(`
      SELECT id, user_id
      FROM password_resets
      WHERE token_hash = ? AND used = 0 AND datetime(expires_at) > datetime('now')
    `)
    .get(tokenHash) as { id: number; user_id: number } | undefined;

  if (!resetRow) {
    res.status(400).json({ error: 'Reset token is invalid or has expired.' });
    return;
  }

  const newHash = hashPassword(pass);
  db.transaction(() => {
    db.prepare("UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?").run(
      newHash,
      resetRow.user_id
    );
    db.prepare('UPDATE password_resets SET used = 1 WHERE id = ?').run(resetRow.id);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(resetRow.user_id);
  })();

  res.json({ message: 'Password updated successfully. Please sign in with your new password.' });
});

authRouter.post('/change-password', requireAuth, (req: AuthedRequest, res) => {
  const { currentPassword, newPassword } = req.body as {
    currentPassword?: string;
    newPassword?: string;
  };
  const userId = req.user!.id;

  const row = db
    .prepare('SELECT password_hash FROM users WHERE id = ?')
    .get(userId) as { password_hash: string };

  if (!currentPassword || !verifyPassword(currentPassword, row.password_hash)) {
    res.status(400).json({ error: 'Current password is incorrect.' });
    return;
  }

  const errs = passwordStrengthErrors(newPassword ?? '');
  if (errs.length > 0) {
    res.status(400).json({ error: `New password requirements not met: ${errs.join(', ')}.` });
    return;
  }

  db.prepare("UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?").run(
    hashPassword(newPassword!),
    userId
  );

  res.json({ message: 'Password updated successfully.' });
});

authRouter.delete('/account', requireAuth, (req: AuthedRequest, res) => {
  const userId = req.user!.id;
  if (req.user!.isDemo) {
    res.status(400).json({ error: 'The shared demo account cannot be deleted.' });
    return;
  }

  // Prevent deletion if user has unsettled non-zero balances or owns groups with other members
  const groups = db
    .prepare('SELECT group_id FROM group_members WHERE user_id = ?')
    .all(userId) as Array<{ group_id: number }>;

  const hasExpenses = db
    .prepare('SELECT 1 FROM expenses WHERE paid_by_user_id = ? OR created_by_user_id = ? LIMIT 1')
    .get(userId, userId);

  if (hasExpenses || groups.length > 0) {
    res.status(400).json({
      error:
        'Please leave or archive your groups and settle outstanding expenses before deleting your account to preserve group audit trails.',
    });
    return;
  }

  db.prepare('DELETE FROM users WHERE id = ?').run(userId);
  clearSessionCookie(req, res);
  res.json({ ok: true });
});
