
import type { CloudflareEnv } from "./db.ts";
import { dbAll, dbFirst, dbRun } from "./db.ts";
import { hashToken, readSessionToken } from "./security.ts";
import {
  calculateSplits,
  formatINR,
  type ExpenseItemInput,
  type SplitMethod,
  type SplitParticipantInput,
} from "../server/math.ts";

interface Env extends CloudflareEnv {
  SESSION_SECRET: string;
}

interface AuthUser {
  id: number;
  fullName: string;
}

interface ExpensePayload {
  groupId: number;
  paidByUserId: number;
  title: string;
  description?: string;
  notes?: string;
  category: string;
  splitMethod: SplitMethod;
  totalPaise?: number;
  taxPaise?: number;
  tipPaise?: number;
  discountPaise?: number;
  expenseDate?: string;
  receiptDataUrl?: string | null;
  participants: SplitParticipantInput[];
  items?: ExpenseItemInput[];
}

const json = (data: unknown, status = 200) =>
  Response.json(data, { status });

async function getUser(request: Request, env: Env): Promise<AuthUser | null> {
  const token = readSessionToken(request);
  if (!token) return null;

  const tokenHash = await hashToken(token, env.SESSION_SECRET);

  const session = await dbFirst<{ user_id: number }>(
    env.DB,
    `SELECT user_id FROM sessions
     WHERE token_hash = ? AND datetime(expires_at) > datetime('now')`,
    [tokenHash]
  );

  if (!session) return null;

  const user = await dbFirst<{ id: number; full_name: string }>(
    env.DB,
    "SELECT id, full_name FROM users WHERE id = ?",
    [session.user_id]
  );

  return user ? { id: user.id, fullName: user.full_name } : null;
}

async function getMembership(
  env: Env,
  groupId: number,
  userId: number
): Promise<{ role: string } | null> {
  return await dbFirst(
    env.DB,
    "SELECT role FROM group_members WHERE group_id = ? AND user_id = ?",
    [groupId, userId]
  );
}

async function validateGroupUsers(
  env: Env,
  groupId: number,
  userIds: number[]
): Promise<boolean> {
  if (!userIds.length || userIds.some(id => !Number.isInteger(id) || id <= 0)) {
    return false;
  }

  const placeholders = userIds.map(() => "?").join(",");
  const rows = await dbAll<{ user_id: number }>(
    env.DB,
    `SELECT user_id FROM group_members
     WHERE group_id = ? AND user_id IN (${placeholders})`,
    [groupId, ...userIds]
  );

  const valid = new Set(rows.map(row => row.user_id));
  return userIds.every(id => valid.has(id));
}

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value;
}

async function readBody(request: Request): Promise<ExpensePayload | null> {
  try {
    return await request.json() as ExpensePayload;
  } catch {
    return null;
  }
}

async function listExpenses(
  request: Request,
  env: Env,
  userId: number
): Promise<Response> {
  const url = new URL(request.url);
  const groupId = Number(url.searchParams.get("groupId")) || null;
  const category = (url.searchParams.get("category") ?? "").trim();
  const search = (url.searchParams.get("search") ?? "").trim().toLowerCase();
  const sort = (url.searchParams.get("sort") ?? "newest").trim();

  const rows = await dbAll<any>(
    env.DB,
    `SELECT e.*, g.name AS group_name,
            payer.full_name AS payer_name,
            creator.full_name AS creator_name
     FROM expenses e
     JOIN groups g ON g.id = e.group_id
     JOIN group_members gm ON gm.group_id = g.id AND gm.user_id = ?
     JOIN users payer ON payer.id = e.paid_by_user_id
     JOIN users creator ON creator.id = e.created_by_user_id
     ORDER BY e.expense_date DESC, e.id DESC`,
    [userId]
  );

  const expenses = [];

  for (const row of rows) {
    if (groupId && row.group_id !== groupId) continue;
    if (category && category !== "All" && row.category !== category) continue;

    const matches = !search ||
      [row.title, row.description, row.group_name, row.payer_name]
        .some(value => String(value ?? "").toLowerCase().includes(search));

    if (!matches) continue;

    const splits = await dbAll<any>(
      env.DB,
      `SELECT es.user_id, u.full_name, es.owed_paise
       FROM expense_splits es
       JOIN users u ON u.id = es.user_id
       WHERE es.expense_id = ?`,
      [row.id]
    );

    const mySplit = splits.find(split => split.user_id === userId);

    expenses.push({
      ...row,
      participantCount: splits.length,
      myOwedPaise: mySplit?.owed_paise ?? 0,
      splits
    });
  }

  if (sort === "oldest") expenses.reverse();
  if (sort === "highest") expenses.sort((a, b) => b.total_paise - a.total_paise);
  if (sort === "lowest") expenses.sort((a, b) => a.total_paise - b.total_paise);

  return json({ expenses });
}

async function getExpense(
  env: Env,
  expenseId: number,
  userId: number
): Promise<Response> {
  const expense = await dbFirst<any>(
    env.DB,
    `SELECT e.*, g.name AS group_name,
            payer.full_name AS payer_name,
            creator.full_name AS creator_name
     FROM expenses e
     JOIN groups g ON g.id = e.group_id
     JOIN users payer ON payer.id = e.paid_by_user_id
     JOIN users creator ON creator.id = e.created_by_user_id
     WHERE e.id = ?`,
    [expenseId]
  );

  if (!expense) return json({ error: "Expense not found." }, 404);

  const membership = await getMembership(env, expense.group_id, userId);
  if (!membership) {
    return json({
      error: "Access denied. You do not belong to this expense group."
    }, 403);
  }

  const splits = await dbAll<any>(
    env.DB,
    `SELECT es.user_id, u.full_name, u.avatar_url,
            es.owed_paise, es.item_subtotal_paise,
            es.shared_charges_paise, es.share_meta
     FROM expense_splits es
     JOIN users u ON u.id = es.user_id
     WHERE es.expense_id = ?
     ORDER BY es.owed_paise DESC`,
    [expenseId]
  );

  const itemsRaw = await dbAll<any>(
    env.DB,
    "SELECT * FROM expense_items WHERE expense_id = ? ORDER BY id ASC",
    [expenseId]
  );

  const items = [];

  for (const item of itemsRaw) {
    const consumers = await dbAll<any>(
      env.DB,
      `SELECT ic.user_id, u.full_name
       FROM item_consumers ic
       JOIN users u ON u.id = ic.user_id
       WHERE ic.item_id = ?`,
      [item.id]
    );
    items.push({ ...item, consumers });
  }

  return json({
    expense,
    splits,
    items,
    canEdit: true,
    canDelete: membership.role === "admin" ||
      expense.created_by_user_id === userId
  });
}

async function writeExpense(
  request: Request,
  env: Env,
  user: AuthUser,
  expenseId?: number
): Promise<Response> {
  const body = await readBody(request);
  if (!body) return json({ error: "Invalid request body." }, 400);

  let existing: any = null;

  if (expenseId) {
    existing = await dbFirst<any>(
      env.DB,
      "SELECT * FROM expenses WHERE id = ?",
      [expenseId]
    );

    if (!existing) return json({ error: "Expense not found." }, 404);

    const membership = await getMembership(env, existing.group_id, user.id);
    if (!membership) {
      return json({
        error: "Only registered members of this group can edit its expenses."
      }, 403);
    }
  }

  const groupId = expenseId ? existing.group_id : Number(body.groupId);
  const membership = await getMembership(env, groupId, user.id);

  if (!membership) {
    return json({ error: "You are not a member of the selected group." }, 403);
  }

  const title = (body.title ?? "").trim();
  const expenseDate = body.expenseDate ||
    new Date().toISOString().slice(0, 10);

  if (title.length < 2 || title.length > 120) {
    return json({
      error: "Expense title must be between 2 and 120 characters."
    }, 400);
  }

  if (!validDate(expenseDate)) {
    return json({ error: "Please enter a valid expense date." }, 400);
  }

  const paidByUserId = Number(body.paidByUserId);
  const participantIds = Array.from(new Set([
    paidByUserId,
    ...(body.participants ?? []).map(p => Number(p.userId)),
    ...(body.items ?? []).flatMap(item =>
      (item.consumerUserIds ?? []).map(Number)
    )
  ]));

  if (!await validateGroupUsers(env, groupId, participantIds)) {
    return json({
      error: "Payer and all split participants must belong to this group."
    }, 400);
  }

  if (body.receiptDataUrl && body.receiptDataUrl.length > 2_000_000) {
    return json({
      error: "Receipt attachment is too large (max ~1.5 MB)."
    }, 400);
  }

  let computed: any;

  try {
    computed = calculateSplits({
      splitMethod: body.splitMethod,
      totalPaise: body.totalPaise,
      participants: body.participants,
      items: body.items,
      taxPaise: body.taxPaise,
      tipPaise: body.tipPaise,
      discountPaise: body.discountPaise
    });
  } catch (error) {
    return json({
      error: error instanceof Error
        ? error.message
        : "Invalid split calculation."
    }, 400);
  }

  let id = expenseId;

  if (expenseId) {
    await dbRun(
      env.DB,
      `UPDATE expenses
       SET paid_by_user_id = ?, title = ?, description = ?, notes = ?,
           category = ?, split_method = ?, subtotal_paise = ?,
           tax_paise = ?, tip_paise = ?, discount_paise = ?,
           total_paise = ?, expense_date = ?,
           receipt_data_url = COALESCE(?, receipt_data_url),
           updated_at = datetime('now')
       WHERE id = ?`,
      [
        paidByUserId, title, (body.description ?? "").trim(),
        (body.notes ?? "").trim(), body.category || "Food",
        body.splitMethod, computed.subtotalPaise, computed.taxPaise,
        computed.tipPaise, computed.discountPaise, computed.totalPaise,
        expenseDate, body.receiptDataUrl ?? null, expenseId
      ]
    );

    await dbRun(
      env.DB,
      `DELETE FROM item_consumers
       WHERE item_id IN (SELECT id FROM expense_items WHERE expense_id = ?)`,
      [expenseId]
    );
    await dbRun(env.DB, "DELETE FROM expense_items WHERE expense_id = ?", [expenseId]);
    await dbRun(env.DB, "DELETE FROM expense_splits WHERE expense_id = ?", [expenseId]);
  } else {
    const result = await env.DB.prepare(
      `INSERT INTO expenses (
        group_id, paid_by_user_id, created_by_user_id,
        title, description, notes, category, split_method,
        subtotal_paise, tax_paise, tip_paise, discount_paise,
        total_paise, expense_date, receipt_data_url
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      groupId, paidByUserId, user.id, title,
      (body.description ?? "").trim(), (body.notes ?? "").trim(),
      body.category || "Food", body.splitMethod,
      computed.subtotalPaise, computed.taxPaise, computed.tipPaise,
      computed.discountPaise, computed.totalPaise, expenseDate,
      body.receiptDataUrl ?? null
    ).run();

    id = Number(result.meta.last_row_id);
  }

  if (!id) return json({ error: "Could not save expense." }, 500);

  if (body.splitMethod === "itemized" && body.items) {
    for (const item of body.items) {
      const unitPrice = Math.round(item.unitPricePaise);
      const quantity = Math.round(item.quantity);
      const itemResult = await env.DB.prepare(
        `INSERT INTO expense_items
         (expense_id, name, unit_price_paise, quantity, total_paise)
         VALUES (?, ?, ?, ?, ?)`
      ).bind(
        id, item.name.trim(), unitPrice, quantity, unitPrice * quantity
      ).run();

      const itemId = Number(itemResult.meta.last_row_id);

      for (const consumerId of Array.from(new Set(item.consumerUserIds))) {
        await dbRun(
          env.DB,
          `INSERT INTO item_consumers (item_id, user_id, share_weight)
           VALUES (?, ?, 1)`,
          [itemId, consumerId]
        );
      }
    }
  }

  const statements = computed.splits.map((split: any) =>
    env.DB.prepare(
      `INSERT INTO expense_splits
       (expense_id, user_id, owed_paise, item_subtotal_paise,
        shared_charges_paise, share_meta)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(
      id, split.userId, split.owedPaise,
      split.itemSubtotalPaise, split.sharedChargesPaise,
      split.shareMeta
    )
  );

  statements.push(
    env.DB.prepare(
      "UPDATE groups SET updated_at = datetime('now') WHERE id = ?"
    ).bind(groupId)
  );

  statements.push(
    env.DB.prepare(
      `INSERT INTO activity_logs
       (group_id, user_id, action, entity_type, entity_id, summary)
       VALUES (?, ?, ?, 'expense', ?, ?)`
    ).bind(
      groupId, user.id,
      expenseId ? "expense_updated" : "expense_created",
      id,
      `${user.fullName} ${expenseId ? "updated" : "added"} "${title}" (${formatINR(computed.totalPaise)})`
    )
  );

  for (const split of computed.splits) {
    if (!expenseId && split.userId !== user.id && split.owedPaise > 0) {
      statements.push(
        env.DB.prepare(
          `INSERT INTO notifications
           (user_id, group_id, type, title, message, link_path)
           VALUES (?, ?, 'expense_added', ?, ?, '/expenses')`
        ).bind(
          split.userId,
          groupId,
          `New expense: ${title}`,
          `${user.fullName} logged "${title}". Your share is ${formatINR(split.owedPaise)}.`
        )
      );
    }
  }

  if (statements.length) await env.DB.batch(statements);

  return expenseId
    ? json({ ok: true, computed })
    : json({ expenseId: id, computed }, 201);
}

async function deleteExpense(
  env: Env,
  expenseId: number,
  user: AuthUser
): Promise<Response> {
  const existing = await dbFirst<any>(
    env.DB,
    "SELECT group_id, created_by_user_id, title FROM expenses WHERE id = ?",
    [expenseId]
  );

  if (!existing) return json({ error: "Expense not found." }, 404);

  const membership = await getMembership(env, existing.group_id, user.id);

  if (!membership ||
      (membership.role !== "admin" && existing.created_by_user_id !== user.id)) {
    return json({
      error: "Only the expense creator or a group admin can delete this expense."
    }, 403);
  }

  await dbRun(
    env.DB,
    `DELETE FROM item_consumers
     WHERE item_id IN (SELECT id FROM expense_items WHERE expense_id = ?)`,
    [expenseId]
  );
  await dbRun(env.DB, "DELETE FROM expense_items WHERE expense_id = ?", [expenseId]);
  await dbRun(env.DB, "DELETE FROM expense_splits WHERE expense_id = ?", [expenseId]);
  await dbRun(env.DB, "DELETE FROM expenses WHERE id = ?", [expenseId]);

  await dbRun(
    env.DB,
    `INSERT INTO activity_logs
     (group_id, user_id, action, entity_type, entity_id, summary)
     VALUES (?, ?, 'expense_deleted', 'expense', ?, ?)`,
    [
      existing.group_id,
      user.id,
      expenseId,
      `${user.fullName} deleted expense "${existing.title}"`
    ]
  );

  return json({ ok: true });
}

export async function handleExpenses(
  request: Request,
  env: Env
): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";

  if (path !== "/api/expenses" && !path.startsWith("/api/expenses/")) {
    return null;
  }

  const user = await getUser(request, env);

  if (!user) {
    return json({
      error: "Authentication required. Please sign in."
    }, 401);
  }

  try {
    if (path === "/api/expenses" && request.method === "GET") {
      return await listExpenses(request, env, user.id);
    }

    if (path === "/api/expenses" && request.method === "POST") {
      return await writeExpense(request, env, user);
    }

    const match = path.match(/^\/api\/expenses\/(\d+)$/);
    if (!match) return json({ error: "Expense not found." }, 404);

    const expenseId = Number(match[1]);

    if (request.method === "GET") {
      return await getExpense(env, expenseId, user.id);
    }

    if (request.method === "PUT") {
      return await writeExpense(request, env, user, expenseId);
    }

    if (request.method === "DELETE") {
      return await deleteExpense(env, expenseId, user);
    }

    return json({ error: "Method not allowed." }, 405);
  } catch (error) {
    return json({
      error: "An error occurred while processing the expense.",
      details: error instanceof Error ? error.message : "Unknown error"
    }, 500);
  }
}
