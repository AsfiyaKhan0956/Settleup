
import type { CloudflareEnv } from "./db.ts";
import { dbAll, dbFirst } from "./db.ts";
import { readSessionToken, hashToken } from "./security.ts";

function todayYmd(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());

  const get = (type: string) =>
    parts.find(part => part.type === type)?.value ?? "";

  return `${get("year")}-${get("month")}-${get("day")}`;
}

function shiftYmd(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function formatCsvDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : value;
}

function csvCell(value: string | number | null | undefined): string {
  let text = value == null ? "" : String(value);
  if (typeof value === "string" && /^[\s]*[=+@\-\t\r]/.test(text)) {
    text = `'${text}`;
  }
  return `"${text.replace(/"/g, '""')}"`;
}

function csvDocument(rows: Array<Array<string | number | null | undefined>>): string {
  return "\uFEFF" + rows.map(row => row.map(csvCell).join(",")).join("\r\n");
}

async function getUserId(request: Request, env: CloudflareEnv): Promise<number | null> {
  const token = readSessionToken(request);
  if (!token) return null;

  const secret = (env as CloudflareEnv & { SESSION_SECRET?: string }).SESSION_SECRET;
  if (!secret) return null;

  const tokenHash = await hashToken(token, secret);

  const session = await dbFirst<{ user_id: number }>(
    env.DB,
    `SELECT user_id FROM sessions
     WHERE token_hash = ? AND datetime(expires_at) > datetime('now')`,
    [tokenHash]
  );

  return session?.user_id ?? null;
}

function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

export async function handleAnalytics(
  request: Request,
  env: CloudflareEnv
): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;

  if (!path.startsWith("/api/analytics")) return null;

  const userId = await getUserId(request, env);
  if (!userId) {
    return jsonError("Authentication required. Please sign in.", 401);
  }

  const groupParam = url.searchParams.get("groupId");
  const groupId = groupParam ? Number(groupParam) : null;

  if (groupParam && (!Number.isInteger(groupId) || Number(groupId) <= 0)) {
    return jsonError("Invalid group ID.", 400);
  }

  if (path === "/api/analytics/summary" && request.method === "GET") {
    const requestedDays = Number(url.searchParams.get("days") ?? 180);
    const safeDays = Math.max(
      7,
      Math.min(365, Number.isFinite(requestedDays) ? Math.trunc(requestedDays) : 180)
    );

    const startDate = shiftYmd(todayYmd(), -safeDays);
    const weeklyStartDate = shiftYmd(todayYmd(), -56);
    const groupCondition = groupId ? "AND e.group_id = ?" : "";
    const params: unknown[] = groupId ? [userId, groupId] : [userId];

    const monthlyTrend = await dbAll(
      env.DB,
      `SELECT strftime('%Y-%m', e.expense_date) AS month,
              SUM(e.total_paise) AS group_total_paise,
              SUM(COALESCE(es.owed_paise, 0)) AS my_share_paise,
              COUNT(e.id) AS expense_count
       FROM expenses e
       JOIN group_members gm ON gm.group_id = e.group_id AND gm.user_id = ?
       LEFT JOIN expense_splits es ON es.expense_id = e.id AND es.user_id = gm.user_id
       WHERE date(e.expense_date) >= date(?) ${groupCondition}
       GROUP BY strftime('%Y-%m', e.expense_date)
       ORDER BY month ASC`,
      [userId, startDate, ...(groupId ? [groupId] : [])]
    );

    const weeklyTrend = await dbAll(
      env.DB,
      `SELECT strftime('%Y-W%W', e.expense_date) AS week,
              SUM(e.total_paise) AS total_paise,
              SUM(COALESCE(es.owed_paise, 0)) AS my_share_paise
       FROM expenses e
       JOIN group_members gm ON gm.group_id = e.group_id AND gm.user_id = ?
       LEFT JOIN expense_splits es ON es.expense_id = e.id AND es.user_id = gm.user_id
       WHERE date(e.expense_date) >= date(?) ${groupCondition}
       GROUP BY strftime('%Y-W%W', e.expense_date)
       ORDER BY week ASC`,
      [userId, weeklyStartDate, ...(groupId ? [groupId] : [])]
    );

    const byCategory = await dbAll(
      env.DB,
      `SELECT e.category,
              SUM(e.total_paise) AS total_paise,
              SUM(COALESCE(es.owed_paise, 0)) AS my_share_paise,
              COUNT(e.id) AS count
       FROM expenses e
       JOIN group_members gm ON gm.group_id = e.group_id AND gm.user_id = ?
       LEFT JOIN expense_splits es ON es.expense_id = e.id AND es.user_id = gm.user_id
       WHERE date(e.expense_date) >= date(?) ${groupCondition}
       GROUP BY e.category
       ORDER BY total_paise DESC`,
      [userId, startDate, ...(groupId ? [groupId] : [])]
    );

    const byGroup = await dbAll(
      env.DB,
      `SELECT g.id AS group_id, g.name AS group_name, g.cover_color,
              COALESCE(SUM(e.total_paise), 0) AS total_paise,
              COUNT(e.id) AS expense_count
       FROM groups g
       JOIN group_members gm ON gm.group_id = g.id AND gm.user_id = ?
       LEFT JOIN expenses e
         ON e.group_id = g.id AND date(e.expense_date) >= date(?)
       WHERE g.is_archived = 0 ${groupId ? "AND g.id = ?" : ""}
       GROUP BY g.id
       ORDER BY total_paise DESC`,
      [userId, startDate, ...(groupId ? [groupId] : [])]
    );

    const memberContributions = await dbAll(
      env.DB,
      `SELECT u.id AS user_id, u.full_name,
              COALESCE(SUM(e.total_paise), 0) AS paid_paise
       FROM expenses e
       JOIN group_members gm ON gm.group_id = e.group_id AND gm.user_id = ?
       JOIN users u ON u.id = e.paid_by_user_id
       WHERE date(e.expense_date) >= date(?) ${groupCondition}
       GROUP BY u.id
       ORDER BY paid_paise DESC`,
      [userId, startDate, ...(groupId ? [groupId] : [])]
    );

    const settlementStats = await dbFirst<{
      settled_paise: number;
      pending_paise: number;
    }>(
      env.DB,
      `SELECT
         COALESCE(SUM(CASE WHEN s.status = 'confirmed'
           THEN s.amount_paise ELSE 0 END), 0) AS settled_paise,
         COALESCE(SUM(CASE WHEN s.status IN ('pending', 'recorded')
           THEN s.amount_paise ELSE 0 END), 0) AS pending_paise
       FROM settlements s
       JOIN group_members gm ON gm.group_id = s.group_id AND gm.user_id = ?
       ${groupId ? "WHERE s.group_id = ?" : ""}`,
      params
    );

    return Response.json({
      monthlyTrend,
      weeklyTrend,
      byCategory,
      byGroup,
      memberContributions,
      settlementStats: settlementStats ?? {
        settled_paise: 0,
        pending_paise: 0
      }
    });
  }

  if (path === "/api/analytics/export.csv" && request.method === "GET") {
    const order = url.searchParams.get("order") === "oldest" ? "ASC" : "DESC";

    const rows = await dbAll<{
      id: number;
      expense_date: string;
      group_name: string;
      title: string;
      category: string;
      split_method: string;
      paid_by: string;
      total_paise: number;
      my_share_paise: number;
    }>(
      env.DB,
      `SELECT e.id, e.expense_date, g.name AS group_name,
              e.title, e.category, e.split_method,
              payer.full_name AS paid_by, e.total_paise,
              COALESCE(es.owed_paise, 0) AS my_share_paise
       FROM expenses e
       JOIN groups g ON g.id = e.group_id
       JOIN group_members gm ON gm.group_id = g.id AND gm.user_id = ?
       JOIN users payer ON payer.id = e.paid_by_user_id
       LEFT JOIN expense_splits es
         ON es.expense_id = e.id AND es.user_id = ?
       ${groupId ? "WHERE e.group_id = ?" : ""}
       ORDER BY e.expense_date ${order}, e.id ${order}`,
      groupId ? [userId, userId, groupId] : [userId, userId]
    );

    const header = [
      "Expense ID", "Date", "Group", "Title", "Category",
      "Split Method", "Paid By", "Total (INR)", "My Share (INR)"
    ];

    const lines = [
      header,
      ...rows.map(row => [
        row.id,
        formatCsvDate(row.expense_date),
        row.group_name,
        row.title,
        row.category,
        row.split_method,
        row.paid_by,
        (row.total_paise / 100).toFixed(2),
        (row.my_share_paise / 100).toFixed(2)
      ])
    ];

    return new Response(csvDocument(lines), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="settleup-expenses-report.csv"'
      }
    });
  }

  return jsonError("Route not found", 404);
}
