
import type { CloudflareEnv } from "./db.ts";
import { dbAll, dbFirst, dbRun } from "./db.ts";
import { hashToken, readSessionToken } from "./security.ts";

interface Env extends CloudflareEnv {
  SESSION_SECRET: string;
}

interface Participant {
  id: number;
  name: string;
  paidPaise: number;
  consumedPaise: number;
  settlementPaidPaise: number;
  settlementReceivedPaise: number;
  netPaise: number;
}

interface ItemInput {
  name: string;
  unitPricePaise: number;
  quantity: number;
  participantIds: number[];
}

interface ExpenseInput {
  title?: string;
  description?: string;
  expenseDate?: string;
  paidByParticipantId?: number;
  items?: ItemInput[];
}

const json = (data: unknown, status = 200) => Response.json(data, { status });

function todayYmd(): string {
  return new Date().toISOString().slice(0, 10);
}

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

function csvCell(value: unknown): string {
  let s = value == null ? "" : String(value);
  if (typeof value === "string" && /^[\s]*[=+@\-\t\r]/.test(s)) s = "'" + s;
  return `"${s.replace(/"/g, '""')}"`;
}

function csvDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : value;
}

function csvDocument(rows: unknown[][]): string {
  return "\uFEFF" + rows.map(row => row.map(csvCell).join(",")).join("\r\n");
}

async function getUserId(request: Request, env: Env): Promise<number | null> {
  const token = readSessionToken(request);
  if (!token) return null;
  const tokenHash = await hashToken(token, env.SESSION_SECRET);
  const session = await dbFirst<{ user_id: number }>(
    env.DB,
    "SELECT user_id FROM sessions WHERE token_hash = ? AND datetime(expires_at) > datetime('now')",
    [tokenHash]
  );
  return session?.user_id ?? null;
}

async function ownedLedger(ledgerId: number, userId: number, env: Env) {
  return dbFirst<{
    id: number; user_id: number; title: string; description: string;
    event_date: string; created_at: string;
  }>(
    env.DB,
    "SELECT * FROM trip_ledgers WHERE id = ? AND user_id = ?",
    [ledgerId, userId]
  );
}

function allocateItemCost(totalPaise: number, participantIds: number[]) {
  const ids = [...new Set(participantIds)].sort((a, b) => a - b);
  if (!Number.isSafeInteger(totalPaise) || totalPaise < 0 || !ids.length) {
    throw new Error("Invalid item allocation.");
  }
  const base = Math.floor(totalPaise / ids.length);
  let remainder = totalPaise - base * ids.length;
  return ids.map(participantId => ({
    participantId,
    sharePaise: base + (remainder-- > 0 ? 1 : 0)
  }));
}

function simplifyBalances(participants: Array<{ id: number; name: string; netPaise: number }>) {
  const total = participants.reduce((sum, p) => sum + p.netPaise, 0);
  if (total !== 0) throw new Error("Trip Ledger participant balances do not reconcile to zero.");

  const debtors = participants.filter(p => p.netPaise < 0)
    .map(p => ({ ...p, remaining: -p.netPaise })).sort((a, b) => a.id - b.id);
  const creditors = participants.filter(p => p.netPaise > 0)
    .map(p => ({ ...p, remaining: p.netPaise })).sort((a, b) => a.id - b.id);

  const transfers: Array<{
    fromParticipantId: number; fromName: string;
    toParticipantId: number; toName: string; amountPaise: number;
  }> = [];

  let di = 0;
  let ci = 0;
  while (di < debtors.length && ci < creditors.length) {
    const debtor = debtors[di];
    const creditor = creditors[ci];
    const amountPaise = Math.min(debtor.remaining, creditor.remaining);
    if (amountPaise > 0) {
      transfers.push({
        fromParticipantId: debtor.id,
        fromName: debtor.name,
        toParticipantId: creditor.id,
        toName: creditor.name,
        amountPaise
      });
    }
    debtor.remaining -= amountPaise;
    creditor.remaining -= amountPaise;
    if (debtor.remaining === 0) di++;
    if (creditor.remaining === 0) ci++;
  }
  return transfers;
}

async function calculateSummary(ledgerId: number, env: Env) {
  const participants = await dbAll<{ id: number; display_name: string }>(
    env.DB,
    "SELECT id, display_name FROM trip_ledger_participants WHERE ledger_id = ? ORDER BY id",
    [ledgerId]
  );

  const map = new Map<number, Participant>(
    participants.map(p => [p.id, {
      id: p.id,
      name: p.display_name,
      paidPaise: 0,
      consumedPaise: 0,
      settlementPaidPaise: 0,
      settlementReceivedPaise: 0,
      netPaise: 0
    }])
  );

  const expenses = await dbAll<{
    paid_by_participant_id: number; total_paise: number;
  }>(
    env.DB,
    "SELECT paid_by_participant_id, total_paise FROM trip_ledger_expenses WHERE ledger_id = ?",
    [ledgerId]
  );

  let totalExpenditurePaise = 0;
  for (const e of expenses) {
    totalExpenditurePaise += e.total_paise;
    const p = map.get(e.paid_by_participant_id);
    if (p) p.paidPaise += e.total_paise;
  }

  const shares = await dbAll<{ participant_id: number; owed_paise: number }>(
    env.DB,
    `SELECT s.participant_id, s.owed_paise
     FROM trip_ledger_shares s
     JOIN trip_ledger_expenses e ON e.id = s.expense_id
     WHERE e.ledger_id = ?`,
    [ledgerId]
  );

  for (const share of shares) {
    const p = map.get(share.participant_id);
    if (p) p.consumedPaise += share.owed_paise;
  }

  const settlements = await dbAll<{
    payer_participant_id: number; receiver_participant_id: number; amount_paise: number;
  }>(
    env.DB,
    "SELECT payer_participant_id, receiver_participant_id, amount_paise FROM trip_ledger_settlements WHERE ledger_id = ?",
    [ledgerId]
  );

  for (const s of settlements) {
    const payer = map.get(s.payer_participant_id);
    const receiver = map.get(s.receiver_participant_id);
    if (payer) payer.settlementPaidPaise += s.amount_paise;
    if (receiver) receiver.settlementReceivedPaise += s.amount_paise;
  }

  const rows = [...map.values()];
  for (const p of rows) {
    p.netPaise = p.paidPaise - p.consumedPaise +
      p.settlementPaidPaise - p.settlementReceivedPaise;
  }

  const transfers = simplifyBalances(rows.map(p => ({
    id: p.id, name: p.name, netPaise: p.netPaise
  })));

  return { participants: rows, totalExpenditurePaise, transfers, settlements };
}

async function saveExpense(
  ledgerId: number,
  expenseId: number | null,
  body: ExpenseInput,
  env: Env
) {
  const title = (body.title ?? "").trim();
  const description = (body.description ?? "").trim();
  const expenseDate = body.expenseDate || todayYmd();
  const payerId = Number(body.paidByParticipantId);
  const items = body.items;

  if (title.length < 2 || title.length > 120)
    throw new Error("Expense title must be between 2 and 120 characters.");
  if (description.length > 500)
    throw new Error("Description must be 500 characters or fewer.");
  if (!validDate(expenseDate))
    throw new Error("Please enter a valid expense date.");
  if (!Number.isSafeInteger(payerId) || payerId <= 0)
    throw new Error("Choose who paid this bill.");
  if (!Array.isArray(items) || items.length < 1 || items.length > 100)
    throw new Error("Add at least one item (maximum 100 items per bill).");

  const participants = await dbAll<{ id: number }>(
    env.DB,
    "SELECT id FROM trip_ledger_participants WHERE ledger_id = ?",
    [ledgerId]
  );
  const validIds = new Set(participants.map(p => p.id));

  if (!validIds.has(payerId))
    throw new Error("The person who paid must belong to this trip.");

  const normalized = items.map(item => {
    const name = String(item.name ?? "").trim();
    const unitPricePaise = Number(item.unitPricePaise);
    const quantity = Number(item.quantity);
    const participantIds = Array.isArray(item.participantIds)
      ? [...new Set(item.participantIds.map(Number))]
      : [];

    if (!name || name.length > 100)
      throw new Error("Each item needs a name (maximum 100 characters).");
    if (!Number.isSafeInteger(unitPricePaise) || unitPricePaise <= 0)
      throw new Error(`Enter a valid price for ${name}.`);
    if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 1000)
      throw new Error(`Quantity for ${name} must be from 1 to 1,000.`);
    if (!participantIds.length || participantIds.some(id => !validIds.has(id)))
      throw new Error(`Choose at least one valid consumer for ${name}.`);

    const totalPaise = unitPricePaise * quantity;
    if (!Number.isSafeInteger(totalPaise))
      throw new Error(`The total for ${name} is too large.`);

    return { name, unitPricePaise, quantity, totalPaise, participantIds };
  });

  const totalPaise = normalized.reduce((sum, item) => sum + item.totalPaise, 0);
  if (!Number.isSafeInteger(totalPaise) || totalPaise <= 0)
    throw new Error("Bill total must be greater than zero.");

  const recordedSettlement = await dbFirst(
    env.DB,
    "SELECT 1 AS found FROM trip_ledger_settlements WHERE ledger_id = ? LIMIT 1",
    [ledgerId]
  );
  if (expenseId !== null && recordedSettlement)
    throw new Error("Undo the recorded settlements before editing trip expenses, so paid amounts remain accurate.");

  let id = expenseId;

  if (id === null) {
    const result = await env.DB.prepare(
      `INSERT INTO trip_ledger_expenses
       (ledger_id, title, description, expense_date, paid_by_participant_id, total_paise)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(ledgerId, title, description, expenseDate, payerId, totalPaise).run();
    id = Number(result.meta.last_row_id);
  } else {
    await dbRun(
      env.DB,
      `UPDATE trip_ledger_expenses
       SET title = ?, description = ?, expense_date = ?,
           paid_by_participant_id = ?, total_paise = ?, updated_at = datetime('now')
       WHERE id = ? AND ledger_id = ?`,
      [title, description, expenseDate, payerId, totalPaise, id, ledgerId]
    );
    await dbRun(env.DB, "DELETE FROM trip_ledger_items WHERE expense_id = ?", [id]);
    await dbRun(env.DB, "DELETE FROM trip_ledger_shares WHERE expense_id = ?", [id]);
  }

  const shareTotals = new Map<number, number>();
  const statements: D1PreparedStatement[] = [];

  for (const item of normalized) {
    const itemResult = await env.DB.prepare(
      `INSERT INTO trip_ledger_items
       (expense_id, name, unit_price_paise, quantity, total_paise)
       VALUES (?, ?, ?, ?, ?)`
    ).bind(id, item.name, item.unitPricePaise, item.quantity, item.totalPaise).run();

    const itemId = Number(itemResult.meta.last_row_id);

    for (const allocation of allocateItemCost(item.totalPaise, item.participantIds)) {
      statements.push(
        env.DB.prepare(
          "INSERT INTO trip_ledger_item_consumers (item_id, participant_id, share_paise) VALUES (?, ?, ?)"
        ).bind(itemId, allocation.participantId, allocation.sharePaise)
      );
      shareTotals.set(
        allocation.participantId,
        (shareTotals.get(allocation.participantId) ?? 0) + allocation.sharePaise
      );
    }
  }

  for (const [participantId, owedPaise] of shareTotals) {
    statements.push(
      env.DB.prepare(
        "INSERT INTO trip_ledger_shares (expense_id, participant_id, owed_paise) VALUES (?, ?, ?)"
      ).bind(id, participantId, owedPaise)
    );
  }

  statements.push(
    env.DB.prepare("UPDATE trip_ledgers SET updated_at = datetime('now') WHERE id = ?")
      .bind(ledgerId)
  );

  if (statements.length) await env.DB.batch(statements);

  return { expenseId: id, totalPaise };
}

export async function handleTripLedger(
  request: Request,
  env: Env
): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "");

  if (!path.startsWith("/api/trip-ledger")) return null;

  try {
    const userId = await getUserId(request, env);
    if (!userId) return json({ error: "Authentication required. Please sign in." }, 401);

    // LIST LEDGERS
    if (path === "/api/trip-ledger" && request.method === "GET") {
      const ledgers = await dbAll<{
        id: number; title: string; description: string;
        event_date: string; created_at: string;
      }>(
        env.DB,
        `SELECT id, title, description, event_date, created_at
         FROM trip_ledgers
         WHERE user_id = ?
           AND EXISTS (
             SELECT 1 FROM trip_ledger_participants p
             WHERE p.ledger_id = trip_ledgers.id
           )
         ORDER BY event_date DESC, id DESC`,
        [userId]
      );

      const results = await Promise.all(ledgers.map(async ledger => ({
        ...ledger,
        ...await calculateSummary(ledger.id, env)
      })));

      return json({ ledgers: results });
    }

    // CREATE LEDGER
    if (path === "/api/trip-ledger" && request.method === "POST") {
      const body = await request.json() as {
        title?: string; description?: string; eventDate?: string;
      };
      const title = (body.title ?? "").trim();
      const description = (body.description ?? "").trim();
      const eventDate = body.eventDate ?? todayYmd();

      if (title.length < 2 || title.length > 100)
        return json({ error: "Trip name must be between 2 and 100 characters." }, 400);
      if (description.length > 500)
        return json({ error: "Description must be 500 characters or fewer." }, 400);
      if (!validDate(eventDate))
        return json({ error: "Please enter a valid trip date." }, 400);

      const result = await env.DB.prepare(
        "INSERT INTO trip_ledgers (user_id, title, description, event_date) VALUES (?, ?, ?, ?)"
      ).bind(userId, title, description, eventDate).run();

      const ledgerId = Number(result.meta.last_row_id);
      await env.DB.batch([
        env.DB.prepare(
          "INSERT INTO trip_ledger_participants (ledger_id, display_name) VALUES (?, ?)"
        ).bind(ledgerId, "Person A"),
        env.DB.prepare(
          "INSERT INTO trip_ledger_participants (ledger_id, display_name) VALUES (?, ?)"
        ).bind(ledgerId, "Person B")
      ]);

      return json({ ledgerId }, 201);
    }

    // CSV EXPORT
    const exportMatch = path.match(/^\/api\/trip-ledger\/(\d+)\/export\.csv$/);
    if (exportMatch && request.method === "GET") {
      const ledgerId = Number(exportMatch[1]);
      const ledger = await ownedLedger(ledgerId, userId, env);
      if (!ledger) return json({ error: "Trip Ledger not found." }, 404);

      const order = url.searchParams.get("order") === "oldest" ? "ASC" : "DESC";
      const expenses = await dbAll<{
        id: number; title: string; expense_date: string;
        total_paise: number; payer_name: string;
      }>(
        env.DB,
        `SELECT e.id, e.title, e.expense_date, e.total_paise,
                p.display_name AS payer_name
         FROM trip_ledger_expenses e
         JOIN trip_ledger_participants p ON p.id = e.paid_by_participant_id
         WHERE e.ledger_id = ?`,
        [ledgerId]
      );

      const settlements = await dbAll<{
        id: number; settlement_date: string; payer_name: string;
        receiver_name: string; amount_paise: number;
      }>(
        env.DB,
        `SELECT s.id, s.settlement_date, a.display_name AS payer_name,
                b.display_name AS receiver_name, s.amount_paise
         FROM trip_ledger_settlements s
         JOIN trip_ledger_participants a ON a.id = s.payer_participant_id
         JOIN trip_ledger_participants b ON b.id = s.receiver_participant_id
         WHERE s.ledger_id = ?`,
        [ledgerId]
      );

      const transactions = [
        ...expenses.map(e => ({
          date: e.expense_date, id: e.id, kind: "expense" as const, data: e
        })),
        ...settlements.map(s => ({
          date: s.settlement_date, id: s.id, kind: "settlement" as const, data: s
        }))
      ].sort((a, b) => {
        const result = a.date.localeCompare(b.date) ||
          a.kind.localeCompare(b.kind) || a.id - b.id;
        return order === "ASC" ? result : -result;
      });

      const rows: unknown[][] = [[
        "Transaction ID", "Date", "Type", "Category", "Title",
        "Paid By", "Paid To", "Amount"
      ]];

      for (const t of transactions) {
        if (t.kind === "expense") {
          const e = t.data;
          rows.push([
            `EXP-${e.id}`, csvDate(e.expense_date), "Expense", "",
            e.title, e.payer_name, "", (e.total_paise / 100).toFixed(2)
          ]);
        } else {
          const s = t.data;
          rows.push([
            `SET-${s.id}`, csvDate(s.settlement_date), "Settlement", "",
            "Settlement", s.payer_name, s.receiver_name,
            (s.amount_paise / 100).toFixed(2)
          ]);
        }
      }

      return new Response(csvDocument(rows), {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="trip-ledger-${ledgerId}.csv"`
        }
      });
    }

    // PARTICIPANT UPDATE
    const participantMatch = path.match(/^\/api\/trip-ledger\/participants\/(\d+)$/);
    if (participantMatch && request.method === "PATCH") {
      const participantId = Number(participantMatch[1]);
      const participant = await dbFirst<{ ledger_id: number }>(
        env.DB,
        `SELECT p.ledger_id FROM trip_ledger_participants p
         JOIN trip_ledgers l ON l.id = p.ledger_id
         WHERE p.id = ? AND l.user_id = ?`,
        [participantId, userId]
      );
      if (!participant) return json({ error: "Participant not found." }, 404);

      const body = await request.json() as { displayName?: string };
      const displayName = (body.displayName ?? "").trim();
      if (displayName.length < 2 || displayName.length > 80)
        return json({ error: "Participant name must be between 2 and 80 characters." }, 400);

      await dbRun(env.DB,
        "UPDATE trip_ledger_participants SET display_name = ? WHERE id = ?",
        [displayName, participantId]);
      await dbRun(env.DB,
        "UPDATE trip_ledgers SET updated_at = datetime('now') WHERE id = ?",
        [participant.ledger_id]);
      return json({ ok: true });
    }

    // EXPENSE UPDATE / DELETE
    const expenseMatch = path.match(/^\/api\/trip-ledger\/expenses\/(\d+)$/);
    if (expenseMatch) {
      const expenseId = Number(expenseMatch[1]);
      const expense = await dbFirst<{ ledger_id: number }>(
        env.DB,
        "SELECT ledger_id FROM trip_ledger_expenses WHERE id = ?",
        [expenseId]
      );
      if (!expense || !await ownedLedger(expense.ledger_id, userId, env))
        return json({ error: "Trip expense not found." }, 404);

      if (request.method === "DELETE") {
        const hasSettlement = await dbFirst(
          env.DB,
          "SELECT 1 AS found FROM trip_ledger_settlements WHERE ledger_id = ? LIMIT 1",
          [expense.ledger_id]
        );
        if (hasSettlement) {
          return json({ error: "Undo the recorded settlements before deleting trip expenses, so paid amounts remain accurate." }, 409);
        }
        await dbRun(env.DB,
          "DELETE FROM trip_ledger_expenses WHERE id = ?",
          [expenseId]);
        await dbRun(env.DB,
          "UPDATE trip_ledgers SET updated_at = datetime('now') WHERE id = ?",
          [expense.ledger_id]);
        return json({ ok: true });
      }

      if (request.method === "PUT") {
        try {
          const body = await request.json() as ExpenseInput;
          return json(await saveExpense(expense.ledger_id, expenseId, body, env));
        } catch (error) {
          return json({ error: error instanceof Error ? error.message : "Unable to update trip expense." }, 400);
        }
      }
    }

    // DELETE SETTLEMENT
    const settlementMatch = path.match(/^\/api\/trip-ledger\/settlements\/(\d+)$/);
    if (settlementMatch && request.method === "DELETE") {
      const settlementId = Number(settlementMatch[1]);
      const settlement = await dbFirst<{ ledger_id: number }>(
        env.DB,
        `SELECT s.ledger_id FROM trip_ledger_settlements s
         JOIN trip_ledgers l ON l.id = s.ledger_id
         WHERE s.id = ? AND l.user_id = ?`,
        [settlementId, userId]
      );
      if (!settlement) return json({ error: "Settlement record not found." }, 404);

      await dbRun(env.DB,
        "DELETE FROM trip_ledger_settlements WHERE id = ?",
        [settlementId]);
      await dbRun(env.DB,
        "UPDATE trip_ledgers SET updated_at = datetime('now') WHERE id = ?",
        [settlement.ledger_id]);
      return json({ ok: true, ledgerId: settlement.ledger_id });
    }

    // LEDGER-SCOPED ROUTES
    const ledgerMatch = path.match(/^\/api\/trip-ledger\/(\d+)(?:\/(.*))?$/);
    if (ledgerMatch) {
      const ledgerId = Number(ledgerMatch[1]);
      const subpath = ledgerMatch[2] ?? "";
      const ledger = await ownedLedger(ledgerId, userId, env);
      if (!ledger) return json({ error: "Trip Ledger not found." }, 404);

      // GET LEDGER DETAILS
      if (!subpath && request.method === "GET") {
        const participants = await dbAll(
          env.DB,
          "SELECT * FROM trip_ledger_participants WHERE ledger_id = ? ORDER BY id",
          [ledgerId]
        );
        const expenses = await dbAll<{
          id: number; title: string; description: string; expense_date: string;
          total_paise: number; paid_by_participant_id: number; payer_name: string;
        }>(
          env.DB,
          `SELECT e.*, p.display_name AS payer_name
           FROM trip_ledger_expenses e
           JOIN trip_ledger_participants p ON p.id = e.paid_by_participant_id
           WHERE e.ledger_id = ? ORDER BY e.expense_date DESC, e.id DESC`,
          [ledgerId]
        );

        const detailedExpenses = await Promise.all(expenses.map(async expense => {
          const items = await dbAll<{
            id: number; name: string; unit_price_paise: number;
            quantity: number; total_paise: number;
          }>(
            env.DB,
            "SELECT * FROM trip_ledger_items WHERE expense_id = ? ORDER BY id",
            [expense.id]
          );

          const detailedItems = await Promise.all(items.map(async item => ({
            ...item,
            consumers: await dbAll(
              env.DB,
              `SELECT c.participant_id, p.display_name, c.share_paise
               FROM trip_ledger_item_consumers c
               JOIN trip_ledger_participants p ON p.id = c.participant_id
               WHERE c.item_id = ? ORDER BY p.id`,
              [item.id]
            )
          })));

          const shares = await dbAll(
            env.DB,
            `SELECT s.participant_id, p.display_name, s.owed_paise
             FROM trip_ledger_shares s
             JOIN trip_ledger_participants p ON p.id = s.participant_id
             WHERE s.expense_id = ? ORDER BY p.id`,
            [expense.id]
          );

          return { ...expense, items: detailedItems, shares };
        }));

        const settlements = await dbAll(
          env.DB,
          `SELECT s.*, a.display_name AS payer_name, b.display_name AS receiver_name
           FROM trip_ledger_settlements s
           JOIN trip_ledger_participants a ON a.id = s.payer_participant_id
           JOIN trip_ledger_participants b ON b.id = s.receiver_participant_id
           WHERE s.ledger_id = ? ORDER BY s.settlement_date DESC, s.id DESC`,
          [ledgerId]
        );

        return json({
          ledger, participants, expenses: detailedExpenses,
          settlements, summary: await calculateSummary(ledgerId, env)
        });
      }

      // UPDATE LEDGER
      if (!subpath && request.method === "PATCH") {
        const body = await request.json() as {
          title?: string; description?: string; eventDate?: string;
        };
        const title = (body.title ?? "").trim();
        const description = (body.description ?? "").trim();
        const eventDate = body.eventDate ?? "";

        if (title.length < 2 || title.length > 100 ||
            description.length > 500 || !validDate(eventDate)) {
          return json({ error: "Enter a valid trip name, description, and date." }, 400);
        }

        await dbRun(
          env.DB,
          `UPDATE trip_ledgers SET title = ?, description = ?,
           event_date = ?, updated_at = datetime('now') WHERE id = ?`,
          [title, description, eventDate, ledgerId]
        );
        return json({ ok: true });
      }

      // ADD PARTICIPANT
      if (subpath === "participants" && request.method === "POST") {
        const body = await request.json() as { displayName?: string };
        const name = (body.displayName ?? "").trim();
        if (name.length < 2 || name.length > 80)
          return json({ error: "Participant name must be between 2 and 80 characters." }, 400);

        const result = await env.DB.prepare(
          "INSERT INTO trip_ledger_participants (ledger_id, display_name) VALUES (?, ?)"
        ).bind(ledgerId, name).run();

        await dbRun(env.DB,
          "UPDATE trip_ledgers SET updated_at = datetime('now') WHERE id = ?",
          [ledgerId]);
        return json({ participantId: Number(result.meta.last_row_id), displayName: name }, 201);
      }

      // ADD EXPENSE
      if (subpath === "expenses" && request.method === "POST") {
        try {
          const body = await request.json() as ExpenseInput;
          return json(await saveExpense(ledgerId, null, body, env), 201);
        } catch (error) {
          return json({ error: error instanceof Error ? error.message : "Unable to save trip expense." }, 400);
        }
      }

      // RECORD SETTLEMENT
      if (subpath === "settlements" && request.method === "POST") {
        const body = await request.json() as {
          payerParticipantId?: number; receiverParticipantId?: number;
          amountPaise?: number; settlementDate?: string; note?: string;
        };
        const payerId = Number(body.payerParticipantId);
        const receiverId = Number(body.receiverParticipantId);
        const amountPaise = Number(body.amountPaise);
        const settlementDate = body.settlementDate ?? todayYmd();
        const note = (body.note ?? "").trim();

        const participants = await dbAll<{ id: number }>(
          env.DB,
          "SELECT id FROM trip_ledger_participants WHERE ledger_id = ?",
          [ledgerId]
        );
        const ids = new Set(participants.map(p => p.id));

        if (payerId === receiverId || !ids.has(payerId) || !ids.has(receiverId))
          return json({ error: "Choose two different participants from this trip." }, 400);
        if (!Number.isSafeInteger(amountPaise) || amountPaise <= 0 ||
            !validDate(settlementDate) || note.length > 250) {
          return json({ error: "Enter a valid settlement amount, date, and note." }, 400);
        }

        try {
          const summary = await calculateSummary(ledgerId, env);
          const transfer = summary.transfers.find(t =>
            t.fromParticipantId === payerId && t.toParticipantId === receiverId
          );

          if (!transfer || amountPaise > transfer.amountPaise) {
            return json({
              error: "Settlement cannot exceed the currently suggested amount between these participants."
            }, 400);
          }

          const result = await env.DB.prepare(
            `INSERT INTO trip_ledger_settlements
             (ledger_id, payer_participant_id, receiver_participant_id,
              amount_paise, settlement_date, note)
             VALUES (?, ?, ?, ?, ?, ?)`
          ).bind(ledgerId, payerId, receiverId, amountPaise, settlementDate, note).run();

          await dbRun(env.DB,
            "UPDATE trip_ledgers SET updated_at = datetime('now') WHERE id = ?",
            [ledgerId]);

          return json({ settlementId: Number(result.meta.last_row_id) }, 201);
        } catch (error) {
          return json({ error: error instanceof Error ? error.message : "Unable to record settlement." }, 400);
        }
      }
    }

    return json({ error: "Route not found." }, 404);
  } catch (error) {
    return json({
      error: "Unable to process Trip Ledger request.",
      details: error instanceof Error ? error.message : "Unknown error"
    }, 500);
  }
}
