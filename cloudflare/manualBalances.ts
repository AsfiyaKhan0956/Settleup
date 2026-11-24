
import type { CloudflareEnv } from "./db.ts";
import { dbAll, dbFirst, dbRun } from "./db.ts";
import { hashToken, readSessionToken } from "./security.ts";

interface Env extends CloudflareEnv {
  SESSION_SECRET: string;
}

interface User {
  id: number;
}

const json = (data: unknown, status = 200) =>
  Response.json(data, { status });

async function getUser(request: Request, env: Env): Promise<User | null> {
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

  const user = await dbFirst<User>(
    env.DB,
    "SELECT id FROM users WHERE id = ?",
    [session.user_id]
  );

  return user ?? null;
}

async function getOwnedBalance(
  env: Env,
  balanceId: number,
  userId: number
) {
  return dbFirst<any>(
    env.DB,
    "SELECT * FROM manual_balances WHERE id = ? AND user_id = ?",
    [balanceId, userId]
  );
}

async function addEvent(
  env: Env,
  userId: number,
  balanceId: number | null,
  tripLedgerId: number | null,
  action: string,
  amountPaise: number,
  note: string
) {
  await dbRun(
    env.DB,
    `INSERT INTO manual_balance_events
     (user_id, manual_balance_id, trip_ledger_id, action, amount_paise, note)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [userId, balanceId, tripLedgerId, action, amountPaise, note]
  );
}

async function listBalances(env: Env, userId: number, url: URL) {
  const tripId = Number(url.searchParams.get("tripLedgerId") || 0);
  const status = url.searchParams.get("status");

  let sql = `
    SELECT mb.*,
           ep.display_name AS external_name,
           ep.phone AS external_phone,
           u.full_name AS linked_user_name
    FROM manual_balances mb
    LEFT JOIN external_participants ep
      ON ep.id = mb.external_participant_id
    LEFT JOIN users u
      ON u.id = mb.linked_user_id
    WHERE mb.user_id = ?
  `;

  const params: unknown[] = [userId];

  if (tripId > 0) {
    sql += " AND mb.trip_ledger_id = ?";
    params.push(tripId);
  }

  if (status && ["pending", "partially_settled", "settled"].includes(status)) {
    sql += " AND mb.status = ?";
    params.push(status);
  }

  sql += " ORDER BY mb.entry_date DESC, mb.id DESC";

  const balances = await dbAll<any>(env.DB, sql, params);

  const totals = await dbFirst<any>(
    env.DB,
    `SELECT
       SUM(CASE WHEN direction = 'to_pay'
         THEN amount_paise - settled_paise ELSE 0 END) AS total_to_pay,
       SUM(CASE WHEN direction = 'to_receive'
         THEN amount_paise - settled_paise ELSE 0 END) AS total_to_receive,
       COUNT(*) AS total_count
     FROM manual_balances
     WHERE user_id = ?`,
    [userId]
  );

  return json({
    balances,
    summary: {
      totalToPayPaise: totals?.total_to_pay ?? 0,
      totalToReceivePaise: totals?.total_to_receive ?? 0,
      totalCount: totals?.total_count ?? 0
    }
  });
}

async function createBalance(
  request: Request,
  env: Env,
  userId: number
) {
  const body = await request.json() as any;

  const personName = String(body.personName ?? "").trim();
  const direction = body.direction;
  const amountPaise = Number(body.amountPaise);
  const tripLedgerId = body.tripLedgerId
    ? Number(body.tripLedgerId)
    : null;

  if (personName.length < 2 || personName.length > 100) {
    return json({ error: "Enter a valid person's name." }, 400);
  }

  if (!["to_pay", "to_receive"].includes(direction)) {
    return json({ error: "Invalid balance direction." }, 400);
  }

  if (!Number.isSafeInteger(amountPaise) || amountPaise <= 0) {
    return json({ error: "Amount must be a positive amount in paise." }, 400);
  }

  if (tripLedgerId !== null) {
    const ledger = await dbFirst<any>(
      env.DB,
      "SELECT id FROM trip_ledgers WHERE id = ? AND user_id = ?",
      [tripLedgerId, userId]
    );

    if (!ledger) {
      return json({ error: "Trip ledger not found." }, 404);
    }
  }

  const participantType =
    body.participantType === "registered" ? "registered" : "external";

  const linkedUserId = body.linkedUserId
    ? Number(body.linkedUserId)
    : null;

  if (linkedUserId !== null) {
    const linkedUser = await dbFirst<any>(
      env.DB,
      "SELECT id, full_name FROM users WHERE id = ?",
      [linkedUserId]
    );

    if (!linkedUser) {
      return json({ error: "Linked user not found." }, 404);
    }
  }

  const result = await env.DB.prepare(
    `INSERT INTO manual_balances (
       user_id, trip_ledger_id, external_participant_id,
       linked_user_id, person_name, contact_ref,
       participant_type, direction, amount_paise,
       settled_paise, status, trip_name, description, entry_date
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'pending', ?, ?, ?)`
  ).bind(
    userId,
    tripLedgerId,
    body.externalParticipantId ? Number(body.externalParticipantId) : null,
    linkedUserId,
    personName,
    String(body.contactRef ?? "").trim(),
    participantType,
    direction,
    amountPaise,
    String(body.tripName ?? "").trim(),
    String(body.description ?? "").trim(),
    body.entryDate || new Date().toISOString().slice(0, 10)
  ).run();

  const balanceId = Number(result.meta.last_row_id);

  await addEvent(
    env,
    userId,
    balanceId,
    tripLedgerId,
    "created",
    amountPaise,
    "Manual balance created"
  );

  return json({ ok: true, balanceId }, 201);
}

async function settleBalance(
  request: Request,
  env: Env,
  balanceId: number,
  userId: number
) {
  const balance = await getOwnedBalance(env, balanceId, userId);

  if (!balance) {
    return json({ error: "Manual balance not found." }, 404);
  }

  if (balance.status === "settled") {
    return json({ error: "This balance is already settled." }, 400);
  }

  const body = await request.json() as any;
  const amountPaise = Number(body.amountPaise);
  const remaining = balance.amount_paise - balance.settled_paise;

  if (!Number.isSafeInteger(amountPaise) ||
      amountPaise <= 0 ||
      amountPaise > remaining) {
    return json({
      error: "Enter a valid settlement amount not exceeding the remaining balance."
    }, 400);
  }

  const newSettled = balance.settled_paise + amountPaise;
  const newStatus =
    newSettled >= balance.amount_paise
      ? "settled"
      : "partially_settled";

  const note = String(body.note ?? "").trim() || "Settlement recorded";

  await env.DB.batch([
    env.DB.prepare(
      `UPDATE manual_balances
       SET settled_paise = ?, status = ?, updated_at = datetime('now')
       WHERE id = ? AND user_id = ?`
    ).bind(newSettled, newStatus, balanceId, userId),

    env.DB.prepare(
      `INSERT INTO manual_balance_events
       (user_id, manual_balance_id, trip_ledger_id,
        action, amount_paise, note)
       VALUES (?, ?, ?, 'settlement', ?, ?)`
    ).bind(
      userId,
      balanceId,
      balance.trip_ledger_id,
      amountPaise,
      note
    )
  ]);

  return json({
    ok: true,
    settledPaise: newSettled,
    remainingPaise: balance.amount_paise - newSettled,
    status: newStatus
  });
}

async function updateBalance(
  request: Request,
  env: Env,
  balanceId: number,
  userId: number
) {
  const balance = await getOwnedBalance(env, balanceId, userId);

  if (!balance) {
    return json({ error: "Manual balance not found." }, 404);
  }

  const body = await request.json() as any;

  const personName = body.personName !== undefined
    ? String(body.personName).trim()
    : balance.person_name;

  const direction = body.direction ?? balance.direction;
  const amountPaise = body.amountPaise !== undefined
    ? Number(body.amountPaise)
    : balance.amount_paise;

  if (personName.length < 2 || personName.length > 100) {
    return json({ error: "Enter a valid person's name." }, 400);
  }

  if (!["to_pay", "to_receive"].includes(direction)) {
    return json({ error: "Invalid balance direction." }, 400);
  }

  if (!Number.isSafeInteger(amountPaise) ||
      amountPaise <= 0 ||
      amountPaise < balance.settled_paise) {
    return json({
      error: "Amount must be positive and cannot be less than the amount already settled."
    }, 400);
  }

  const status = amountPaise === balance.settled_paise
    ? "settled"
    : balance.settled_paise > 0
      ? "partially_settled"
      : "pending";

  await dbRun(
    env.DB,
    `UPDATE manual_balances
     SET person_name = ?, contact_ref = ?, direction = ?,
         amount_paise = ?, trip_name = ?, description = ?,
         entry_date = ?, status = ?, updated_at = datetime('now')
     WHERE id = ? AND user_id = ?`,
    [
      personName,
      body.contactRef !== undefined ? String(body.contactRef).trim() : balance.contact_ref,
      direction,
      amountPaise,
      body.tripName !== undefined ? String(body.tripName).trim() : balance.trip_name,
      body.description !== undefined ? String(body.description).trim() : balance.description,
      body.entryDate ?? balance.entry_date,
      status,
      balanceId,
      userId
    ]
  );

  await addEvent(
    env,
    userId,
    balanceId,
    balance.trip_ledger_id,
    "updated",
    amountPaise,
    "Manual balance updated"
  );

  return json({ ok: true });
}

async function deleteBalance(
  env: Env,
  balanceId: number,
  userId: number
) {
  const balance = await getOwnedBalance(env, balanceId, userId);

  if (!balance) {
    return json({ error: "Manual balance not found." }, 404);
  }

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO manual_balance_events
       (user_id, manual_balance_id, trip_ledger_id,
        action, amount_paise, note)
       VALUES (?, NULL, ?, 'deleted', ?, ?)`
    ).bind(
      userId,
      balance.trip_ledger_id,
      balance.amount_paise,
      `Deleted balance for ${balance.person_name}`
    ),

    env.DB.prepare(
      "DELETE FROM manual_balances WHERE id = ? AND user_id = ?"
    ).bind(balanceId, userId)
  ]);

  return json({ ok: true });
}

async function getEvents(
  env: Env,
  balanceId: number,
  userId: number
) {
  const balance = await getOwnedBalance(env, balanceId, userId);

  if (!balance) {
    return json({ error: "Manual balance not found." }, 404);
  }

  const events = await dbAll<any>(
    env.DB,
    `SELECT * FROM manual_balance_events
     WHERE manual_balance_id = ? AND user_id = ?
     ORDER BY created_at DESC, id DESC`,
    [balanceId, userId]
  );

  return json({ events });
}

export async function handleManualBalances(
  request: Request,
  env: Env
): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";

  if (
    path !== "/api/manual-balances" &&
    !path.startsWith("/api/manual-balances/")
  ) {
    return null;
  }

  const user = await getUser(request, env);

  if (!user) {
    return json({
      error: "Authentication required. Please sign in."
    }, 401);
  }

  try {
    if (path === "/api/manual-balances") {
      if (request.method === "GET") {
        return await listBalances(env, user.id, url);
      }

      if (request.method === "POST") {
        return await createBalance(request, env, user.id);
      }
    }

    const match = path.match(
      /^\/api\/manual-balances\/(\d+)(?:\/(settle|events))?$/
    );

    if (match) {
      const balanceId = Number(match[1]);
      const action = match[2];

      if (action === "settle" && request.method === "POST") {
        return await settleBalance(request, env, balanceId, user.id);
      }

      if (action === "events" && request.method === "GET") {
        return await getEvents(env, balanceId, user.id);
      }

      if (!action && request.method === "PATCH") {
        return await updateBalance(request, env, balanceId, user.id);
      }

      if (!action && request.method === "DELETE") {
        return await deleteBalance(env, balanceId, user.id);
      }
    }

    return json({ error: "Manual balance route not found." }, 404);
  } catch (error) {
    return json({
      error: "An error occurred while processing manual balances.",
      details: error instanceof Error ? error.message : "Unknown error"
    }, 500);
  }
}
