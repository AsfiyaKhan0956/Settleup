
import type { CloudflareEnv } from "./db.ts";
import { dbAll, dbFirst, dbRun } from "./db.ts";
import { hashToken, readSessionToken } from "./security.ts";

interface Env extends CloudflareEnv {
  SESSION_SECRET: string;
}

async function getUserId(
  request: Request,
  env: Env
): Promise<number | null> {
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

  const user = await dbFirst<{ id: number }>(
    env.DB,
    "SELECT id FROM users WHERE id = ?",
    [session.user_id]
  );

  return user?.id ?? null;
}

const json = (data: unknown, status = 200) =>
  Response.json(data, { status });

async function getNotifications(env: Env, userId: number) {
  const notifications = await dbAll(
    env.DB,
    `SELECT * FROM notifications
     WHERE user_id = ?
     ORDER BY created_at DESC, id DESC
     LIMIT 40`,
    [userId]
  );

  const activities = await dbAll(
    env.DB,
    `SELECT a.*, g.name AS group_name,
            u.full_name AS actor_name
     FROM activity_logs a
     LEFT JOIN groups g ON g.id = a.group_id
     JOIN users u ON u.id = a.user_id
     WHERE a.group_id IN (
       SELECT group_id FROM group_members WHERE user_id = ?
     )
     OR a.user_id = ?
     ORDER BY a.created_at DESC, a.id DESC
     LIMIT 30`,
    [userId, userId]
  );

  return json({ notifications, activities });
}

async function markRead(request: Request, env: Env, userId: number) {
  let body: { id?: number };

  try {
    body = await request.json() as { id?: number };
  } catch {
    body = {};
  }

  if (body.id !== undefined) {
    const id = Number(body.id);

    if (!Number.isSafeInteger(id) || id <= 0) {
      return json({ error: "Invalid notification ID." }, 400);
    }

    await dbRun(
      env.DB,
      "UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?",
      [id, userId]
    );
  } else {
    await dbRun(
      env.DB,
      "UPDATE notifications SET is_read = 1 WHERE user_id = ?",
      [userId]
    );
  }

  return json({ ok: true });
}

export async function handleNotifications(
  request: Request,
  env: Env
): Promise<Response | null> {
  const path = new URL(request.url).pathname.replace(/\/+$/, "");

  if (
    path !== "/api/notifications" &&
    path !== "/api/notifications/mark-read"
  ) {
    return null;
  }

  try {
    const userId = await getUserId(request, env);

    if (!userId) {
      return json({
        error: "Authentication required. Please sign in."
      }, 401);
    }

    if (
      path === "/api/notifications" &&
      request.method === "GET"
    ) {
      return await getNotifications(env, userId);
    }

    if (
      path === "/api/notifications/mark-read" &&
      request.method === "POST"
    ) {
      return await markRead(request, env, userId);
    }

    return json({ error: "Method not allowed." }, 405);
  } catch (error) {
    return json({
      error: "Unable to process notifications.",
      details: error instanceof Error ? error.message : "Unknown error"
    }, 500);
  }
}
