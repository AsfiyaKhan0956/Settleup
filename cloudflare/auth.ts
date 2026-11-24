
import {
  dbFirst,
  dbRun,
  type CloudflareEnv
} from "./db.ts";

import {
  clearSessionCookie,
  generateOpaqueToken,
  hashPassword,
  hashToken,
  isValidEmail,
  normalizePhone,
  passwordStrengthErrors,
  readSessionToken,
  setSessionCookie,
  verifyPassword
} from "./security.ts";

interface UserRow {
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

async function loadUser(db: D1Database, userId: number) {
  const row = await dbFirst<UserRow>(
    db,
    `SELECT u.id, u.full_name, u.email, u.phone,
            u.avatar_url, u.upi_id, u.is_demo,
            p.currency, p.theme, p.email_notifications,
            p.settlement_alerts, p.onboarding_completed
     FROM users u
     LEFT JOIN user_preferences p ON p.user_id = u.id
     WHERE u.id = ?`,
    [userId]
  );

  if (!row) return null;

  return {
    id: row.id,
    fullName: row.full_name,
    email: row.email,
    phone: row.phone,
    avatarUrl: row.avatar_url,
    upiId: row.upi_id,
    isDemo: row.is_demo === 1,
    preferences: {
      currency: row.currency ?? "INR",
      theme: row.theme ?? "daylight",
      emailNotifications: (row.email_notifications ?? 1) === 1,
      settlementAlerts: (row.settlement_alerts ?? 1) === 1,
      onboardingCompleted: (row.onboarding_completed ?? 0) === 1
    }
  };
}

async function createSession(
  env: CloudflareEnv & { SESSION_SECRET: string },
  userId: number,
  rememberMe: boolean
) {
  const token = generateOpaqueToken(32);
  const tokenHash = await hashToken(token, env.SESSION_SECRET);
  const days = rememberMe ? 30 : 1;

  await dbRun(
    env.DB,
    `INSERT INTO sessions (token_hash, user_id, remember_me, expires_at)
     VALUES (?, ?, ?, datetime('now', '+' || ? || ' days'))`,
    [tokenHash, userId, rememberMe ? 1 : 0, days]
  );

  return token;
}

async function currentUser(
  request: Request,
  env: CloudflareEnv & { SESSION_SECRET: string }
) {
  const token = readSessionToken(request);
  if (!token) return null;

  const tokenHash = await hashToken(token, env.SESSION_SECRET);

  const session = await dbFirst<{ user_id: number }>(
    env.DB,
    `SELECT user_id FROM sessions
     WHERE token_hash = ?
       AND datetime(expires_at) > datetime('now')`,
    [tokenHash]
  );

  if (!session) return null;
  return await loadUser(env.DB, session.user_id);
}

function json(data: unknown, status = 200, headers?: HeadersInit) {
  return Response.json(data, { status, headers });
}

async function readBody(request: Request) {
  try {
    return await request.json() as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function handleAuth(
  request: Request,
  env: CloudflareEnv & { SESSION_SECRET: string }
): Promise<Response> {
  const path = new URL(request.url).pathname.replace(/\/+$/, "");
  const method = request.method.toUpperCase();

  if (method === "POST" && path === "/api/auth/register") {
    const body = await readBody(request);
    if (!body) return json({ error: "Invalid request body." }, 400);

    const fullName = String(body.fullName ?? "").trim();
    const email = String(body.email ?? "").trim().toLowerCase();
    const rawPhone = String(body.phone ?? "").trim();
    const phone = rawPhone ? normalizePhone(rawPhone) : null;
    const password = String(body.password ?? "");
    const avatarUrl = body.avatarUrl ? String(body.avatarUrl) : null;
    const upiId = String(body.upiId ?? "").trim() || null;

    if (fullName.length < 2 || fullName.length > 80) {
      return json({ error: "Full name must be between 2 and 80 characters." }, 400);
    }

    if (!isValidEmail(email)) {
      return json({ error: "Please enter a valid email address." }, 400);
    }

    if (rawPhone && !phone) {
      return json({ error: "Please enter a valid mobile number with country code if required." }, 400);
    }

    const errors = passwordStrengthErrors(password);
    if (errors.length) {
      return json({ error: `Password requirements not met: ${errors.join(", ")}.` }, 400);
    }

    if (avatarUrl && !avatarUrl.startsWith("data:image/") && !avatarUrl.startsWith("/")) {
      return json({ error: "Invalid avatar image format." }, 400);
    }

    if (avatarUrl && avatarUrl.length > 1_400_000) {
      return json({ error: "Profile image is too large (max ~1 MB)." }, 400);
    }

    const existing = await dbFirst(
      env.DB,
      "SELECT id FROM users WHERE email = ?",
      [email]
    );

    if (existing) {
      return json({ error: "An account with this email already exists." }, 409);
    }

    if (phone) {
      const existingPhone = await dbFirst(
        env.DB,
        "SELECT id FROM users WHERE phone = ?",
        [phone]
      );

      if (existingPhone) {
        return json({ error: "An account with this mobile number already exists." }, 409);
      }
    }

    try {
      const passwordHash = await hashPassword(password);

      const inserted = await dbFirst<{ id: number }>(
        env.DB,
        `INSERT INTO users
          (full_name, email, phone, password_hash, avatar_url, upi_id, is_demo)
         VALUES (?, ?, ?, ?, ?, ?, 0)
         RETURNING id`,
        [fullName, email, phone, passwordHash, avatarUrl, upiId]
      );

      if (!inserted) {
        return json({ error: "Could not create account." }, 500);
      }

      await env.DB.batch([
        env.DB.prepare(
          "INSERT INTO user_preferences (user_id, onboarding_completed) VALUES (?, 0)"
        ).bind(inserted.id),
        env.DB.prepare(
          `INSERT INTO notifications
           (user_id, type, title, message, link_path)
           VALUES (?, 'welcome', 'Welcome to SettleUp',
           'Manage shared group bills and track your personal income, expenses, and budgets.',
           '/groups')`
        ).bind(inserted.id)
      ]);

      const token = await createSession(env, inserted.id, false);
      const user = await loadUser(env.DB, inserted.id);

      return json(
        { user },
        201,
        { "Set-Cookie": setSessionCookie(request, token, false) }
      );
    } catch {
      return json({ error: "Could not create account. Please try again." }, 409);
    }
  }

  if (method === "POST" && path === "/api/auth/login") {
    const body = await readBody(request);
    if (!body) return json({ error: "Invalid request body." }, 400);

    const email = String(body.email ?? "").trim().toLowerCase();
    const password = String(body.password ?? "");
    const rememberMe = Boolean(body.rememberMe);

    if (!isValidEmail(email) || !password) {
      return json({ error: "Please provide both email and password." }, 400);
    }

    const row = await dbFirst<{ id: number; password_hash: string }>(
      env.DB,
      "SELECT id, password_hash FROM users WHERE email = ?",
      [email]
    );

  if (!row || !(await verifyPassword(password, row.password_hash))) {
  return json({ error: "Invalid email or password." }, 401);
}

// Automatically upgrade an old bcrypt hash to scrypt.
if (/^\$2[aby]\$/.test(row.password_hash)) {
  const upgradedHash = await hashPassword(password);

  await dbRun(
    env.DB,
    "UPDATE users SET password_hash = ? WHERE id = ?",
    [upgradedHash, row.id]
  );
}

    const token = await createSession(env, row.id, rememberMe);
    const user = await loadUser(env.DB, row.id);

    return json(
      { user },
      200,
      { "Set-Cookie": setSessionCookie(request, token, rememberMe) }
    );
  }

  if (method === "POST" && path === "/api/auth/demo") {
    const demoUser = await dbFirst<{ id: number }>(
      env.DB,
      "SELECT id FROM users WHERE email = ?",
      ["aarav@settleup.app"]
    );

    if (!demoUser) {
      return json({ error: "Demo workspace unavailable." }, 404);
    }

    const token = await createSession(env, demoUser.id, false);
    const user = await loadUser(env.DB, demoUser.id);

    return json(
      { user },
      200,
      { "Set-Cookie": setSessionCookie(request, token, false) }
    );
  }

  if (method === "POST" && path === "/api/auth/logout") {
    const token = readSessionToken(request);

    if (token) {
      const tokenHash = await hashToken(token, env.SESSION_SECRET);
      await dbRun(env.DB, "DELETE FROM sessions WHERE token_hash = ?", [tokenHash]);
    }

    return json(
      { ok: true },
      200,
      { "Set-Cookie": clearSessionCookie(request) }
    );
  }

  if (method === "GET" && path === "/api/auth/me") {
    const user = await currentUser(request, env);

    if (!user) {
      return json(
        { error: "Authentication required. Please sign in." },
        401
      );
    }

    return json({ user });
  }

  return json({ error: "Authentication route not found." }, 404);
}
