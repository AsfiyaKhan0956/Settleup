import { Router } from 'express';
import { db } from '../db.ts';
import { loadUserById, requireAuth, type AuthedRequest } from '../middleware.ts';
import { normalizePhone } from '../security.ts';

export const profileRouter = Router();

profileRouter.patch('/', requireAuth, (req: AuthedRequest, res) => {
  const userId = req.user!.id;
  const { fullName, phone, upiId, avatarUrl, preferences } = req.body as {
    fullName?: string;
    phone?: string | null;
    upiId?: string | null;
    avatarUrl?: string | null;
    preferences?: {
      currency?: string;
      emailNotifications?: boolean;
      settlementAlerts?: boolean;
      onboardingCompleted?: boolean;
    };
  };

  if (fullName !== undefined && fullName.trim().length < 2) {
    res.status(400).json({ error: 'Full name must be at least 2 characters.' });
    return;
  }

  let normalizedPhone: string | null | undefined = undefined;
  if (phone !== undefined) {
    const raw = (phone ?? '').trim();
    if (!raw) {
      normalizedPhone = null;
    } else {
      const norm = normalizePhone(raw);
      if (!norm) {
        res.status(400).json({ error: 'Enter a valid mobile number (include country code if required).' });
        return;
      }
      const conflict = db
        .prepare('SELECT id FROM users WHERE phone = ? AND id <> ?')
        .get(norm, userId);
      if (conflict) {
        res.status(409).json({ error: 'This mobile number is already linked to another account.' });
        return;
      }
      normalizedPhone = norm;
    }
  }

  if (avatarUrl && !avatarUrl.startsWith('data:image/') && !avatarUrl.startsWith('/')) {
    res.status(400).json({ error: 'Invalid profile picture format.' });
    return;
  }
  if (avatarUrl && avatarUrl.length > 1_400_000) {
    res.status(400).json({ error: 'Profile picture exceeds maximum allowed size.' });
    return;
  }

  db.transaction(() => {
    if (fullName !== undefined || normalizedPhone !== undefined || upiId !== undefined || avatarUrl !== undefined) {
      const current = db
        .prepare('SELECT full_name, phone, upi_id, avatar_url FROM users WHERE id = ?')
        .get(userId) as { full_name: string; phone: string | null; upi_id: string | null; avatar_url: string | null };

      db.prepare(`
        UPDATE users
        SET full_name = ?, phone = ?, upi_id = ?, avatar_url = ?, updated_at = datetime('now')
        WHERE id = ?
      `).run(
        fullName !== undefined ? fullName.trim() : current.full_name,
        normalizedPhone !== undefined ? normalizedPhone : current.phone,
        upiId !== undefined ? upiId?.trim() || null : current.upi_id,
        avatarUrl !== undefined ? avatarUrl : current.avatar_url,
        userId
      );
    }

    if (preferences) {
      const curPref = db
        .prepare('SELECT * FROM user_preferences WHERE user_id = ?')
        .get(userId) as
        | {
            currency: string;
            email_notifications: number;
            settlement_alerts: number;
            onboarding_completed: number;
          }
        | undefined;

      db.prepare(`
        INSERT INTO user_preferences (user_id, currency, email_notifications, settlement_alerts, onboarding_completed)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET
          currency = excluded.currency,
          email_notifications = excluded.email_notifications,
          settlement_alerts = excluded.settlement_alerts,
          onboarding_completed = excluded.onboarding_completed,
          updated_at = datetime('now')
      `).run(
        userId,
        preferences.currency ?? curPref?.currency ?? 'INR',
        preferences.emailNotifications !== undefined
          ? preferences.emailNotifications
            ? 1
            : 0
          : curPref?.email_notifications ?? 1,
        preferences.settlementAlerts !== undefined
          ? preferences.settlementAlerts
            ? 1
            : 0
          : curPref?.settlement_alerts ?? 1,
        preferences.onboardingCompleted !== undefined
          ? preferences.onboardingCompleted
            ? 1
            : 0
          : curPref?.onboarding_completed ?? 0
      );
    }
  })();

  res.json({ user: loadUserById(userId) });
});
