import { Router } from 'express';
import { db } from '../db.ts';
import { loadUserById, requireAuth, type AuthedRequest } from '../middleware.ts';

export const profileRouter = Router();

profileRouter.patch('/', requireAuth, (req: AuthedRequest, res) => {
  const userId = req.user!.id;
  const { fullName, upiId, avatarUrl, preferences } = req.body as {
    fullName?: string;
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

  if (avatarUrl && !avatarUrl.startsWith('data:image/') && !avatarUrl.startsWith('/')) {
    res.status(400).json({ error: 'Invalid profile picture format.' });
    return;
  }
  if (avatarUrl && avatarUrl.length > 1_400_000) {
    res.status(400).json({ error: 'Profile picture exceeds maximum allowed size.' });
    return;
  }

  db.transaction(() => {
    if (fullName !== undefined || upiId !== undefined || avatarUrl !== undefined) {
      const current = db
        .prepare('SELECT full_name, upi_id, avatar_url FROM users WHERE id = ?')
        .get(userId) as { full_name: string; upi_id: string | null; avatar_url: string | null };

      db.prepare(`
        UPDATE users
        SET full_name = ?, upi_id = ?, avatar_url = ?, updated_at = datetime('now')
        WHERE id = ?
      `).run(
        fullName !== undefined ? fullName.trim() : current.full_name,
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
