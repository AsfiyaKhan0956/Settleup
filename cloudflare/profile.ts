
import type { CloudflareEnv } from "./db.ts";
import { dbFirst, dbRun } from "./db.ts";
import { hashToken, readSessionToken, normalizePhone } from "./security.ts";

interface Env extends CloudflareEnv {
  SESSION_SECRET: string;
}

async function getUserId(request: Request, env: Env): Promise<number | null> {
  const token = readSessionToken(request);
  if (!token) return null;

  const tokenHash = await hashToken(token, env.SESSION_SECRET);
  const session = await dbFirst<{ user_id: number }>(
    env.DB,
    `SELECT user_id FROM sessions
     WHERE token_hash = ? AND datetime(expires_at) > datetime('now')`,
    [tokenHash]
  );

  return session?.user_id ?? null;
}

async function loadUser(env: Env, userId: number) {
  return dbFirst(
    env.DB,
    `SELECT
      u.id,
      u.full_name AS fullName,
      u.email,
      u.phone,
      u.avatar_url AS avatarUrl,
      u.upi_id AS upiId,
      u.is_demo AS isDemo,
      COALESCE(p.currency, 'INR') AS currency,
      COALESCE(p.theme, 'daylight') AS theme,
      COALESCE(p.email_notifications, 1) AS emailNotifications,
      COALESCE(p.settlement_alerts, 1) AS settlementAlerts,
      COALESCE(p.onboarding_completed, 0) AS onboardingCompleted
     FROM users u
     LEFT JOIN user_preferences p ON p.user_id = u.id
     WHERE u.id = ?`,
    [userId]
  );
}

const json = (data: unknown, status = 200) =>
  Response.json(data, { status });

export async function handleProfile(
  request: Request,
  env: Env
): Promise<Response | null> {
  const path = new URL(request.url).pathname.replace(/\/+$/, "");

  if (path !== "/api/profile") return null;

  if (request.method !== "PATCH") {
    return json({ error: "Method not allowed." }, 405);
  }

  try {
    const userId = await getUserId(request, env);

    if (!userId) {
      return json({ error: "Authentication required. Please sign in." }, 401);
    }

    const body = await request.json() as {
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

    const { fullName, phone, upiId, avatarUrl, preferences } = body;

    if (fullName !== undefined &&
        (typeof fullName !== "string" || fullName.trim().length < 2 ||
         fullName.trim().length > 80)) {
      return json({ error: "Full name must be between 2 and 80 characters." }, 400);
    }

    let normalizedPhone: string | null | undefined;

    if (phone !== undefined) {
      const raw = (phone ?? "").trim();

      if (!raw) {
        normalizedPhone = null;
      } else {
        normalizedPhone = normalizePhone(raw);

        if (!normalizedPhone) {
          return json({
            error: "Enter a valid mobile number (include country code if required)."
          }, 400);
        }

        const conflict = await dbFirst(
          env.DB,
          "SELECT id FROM users WHERE phone = ? AND id <> ?",
          [normalizedPhone, userId]
        );

        if (conflict) {
          return json({
            error: "This mobile number is already linked to another account."
          }, 409);
        }
      }
    }

    if (avatarUrl && !avatarUrl.startsWith("data:image/") &&
        !avatarUrl.startsWith("/")) {
      return json({ error: "Invalid profile picture format." }, 400);
    }

    if (avatarUrl && avatarUrl.length > 1_400_000) {
      return json({
        error: "Profile picture exceeds maximum allowed size."
      }, 400);
    }

    if (upiId !== undefined && upiId !== null &&
        typeof upiId !== "string") {
      return json({ error: "Invalid UPI ID." }, 400);
    }

    if (
      fullName !== undefined ||
      normalizedPhone !== undefined ||
      upiId !== undefined ||
      avatarUrl !== undefined
    ) {
      const current = await dbFirst<{
        full_name: string;
        phone: string | null;
        upi_id: string | null;
        avatar_url: string | null;
      }>(
        env.DB,
        `SELECT full_name, phone, upi_id, avatar_url
         FROM users WHERE id = ?`,
        [userId]
      );

      if (!current) return json({ error: "Account not found." }, 404);

      await dbRun(
        env.DB,
        `UPDATE users
         SET full_name = ?, phone = ?, upi_id = ?,
             avatar_url = ?, updated_at = datetime('now')
         WHERE id = ?`,
        [
          fullName !== undefined ? fullName.trim() : current.full_name,
          normalizedPhone !== undefined ? normalizedPhone : current.phone,
          upiId !== undefined ? upiId?.trim() || null : current.upi_id,
          avatarUrl !== undefined ? avatarUrl : current.avatar_url,
          userId
        ]
      );
    }

    if (preferences) {
      const current = await dbFirst<{
        currency: string;
        email_notifications: number;
        settlement_alerts: number;
        onboarding_completed: number;
      }>(
        env.DB,
        "SELECT * FROM user_preferences WHERE user_id = ?",
        [userId]
      );

      const currency = preferences.currency ?? current?.currency ?? "INR";

      if (typeof currency !== "string" || currency.length > 10) {
        return json({ error: "Invalid currency." }, 400);
      }

      await dbRun(
        env.DB,
        `INSERT INTO user_preferences
          (user_id, currency, email_notifications,
           settlement_alerts, onboarding_completed)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET
           currency = excluded.currency,
           email_notifications = excluded.email_notifications,
           settlement_alerts = excluded.settlement_alerts,
           onboarding_completed = excluded.onboarding_completed,
           updated_at = datetime('now')`,
        [
          userId,
          currency,
          preferences.emailNotifications !== undefined
            ? (preferences.emailNotifications ? 1 : 0)
            : current?.email_notifications ?? 1,
          preferences.settlementAlerts !== undefined
            ? (preferences.settlementAlerts ? 1 : 0)
            : current?.settlement_alerts ?? 1,
          preferences.onboardingCompleted !== undefined
            ? (preferences.onboardingCompleted ? 1 : 0)
            : current?.onboarding_completed ?? 0
        ]
      );
    }

    return json({ user: await loadUser(env, userId) });
  } catch (error) {
    return json({
      error: "Unable to update profile.",
      details: error instanceof Error ? error.message : "Unknown error"
    }, 500);
  }
}
