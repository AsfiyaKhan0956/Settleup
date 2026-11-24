
import type { CloudflareEnv } from "./db.ts";
import { dbAll, dbFirst, dbRun } from "./db.ts";
import { hashToken, readSessionToken } from "./security.ts";

interface Env extends CloudflareEnv {
  SESSION_SECRET: string;
}

const EXPENSE_CATEGORIES = [
  "Food and groceries", "Transportation", "Shopping", "Education",
  "Electricity and utilities", "Rent and accommodation", "Healthcare",
  "Entertainment", "Travel", "Personal care", "Other expenses"
];

const INCOME_CATEGORIES = [
  "Salary & stipend", "Allowance", "Freelance & side income",
  "Gift & refund", "Other income"
];

const json = (data: unknown, status = 200) =>
  Response.json(data, { status });

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

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function monday(date: string): Date {
  const d = new Date(`${date}T00:00:00Z`);
  const day = d.getUTCDay();
  d.setUTCDate(d.getUTCDate() + (day === 0 ? -6 : 1 - day));
  return d;
}

function dateRange(params: {
  period?: string; date?: string; startDate?: string; endDate?: string;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const anchor = params.date && validDate(params.date) ? params.date : today;
  const period = params.period ?? "monthly";

  if (period === "daily") {
    return { period: "daily", start: anchor, end: anchor, anchorDate: anchor };
  }

  if (period === "weekly") {
    const start = monday(anchor);
    const end = new Date(start);
    end.setUTCDate(start.getUTCDate() + 6);
    return { period: "weekly", start: ymd(start), end: ymd(end), anchorDate: anchor };
  }

  if (period === "custom" && params.startDate && params.endDate &&
      validDate(params.startDate) && validDate(params.endDate)) {
    return {
      period: "custom",
      start: params.startDate <= params.endDate ? params.startDate : params.endDate,
      end: params.startDate <= params.endDate ? params.endDate : params.startDate,
      anchorDate: params.endDate
    };
  }

  const [year, month] = anchor.split("-").map(Number);
  return {
    period: "monthly",
    start: ymd(new Date(Date.UTC(year, month - 1, 1))),
    end: ymd(new Date(Date.UTC(year, month, 0))),
    anchorDate: anchor
  };
}

function csvCell(value: unknown): string {
  const s = String(value ?? "");
  return `"${s.replace(/"/g, '""')}"`;
}

export async function handlePersonal(
  request: Request,
  env: Env
): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "");

  if (!path.startsWith("/api/personal")) return null;

  try {
    const userId = await getUserId(request, env);
    if (!userId) return json({ error: "Authentication required. Please sign in." }, 401);

    // PERSONAL SUMMARY
    if (path === "/api/personal/summary" && request.method === "GET") {
      const range = dateRange({
        period: url.searchParams.get("period") ?? undefined,
        date: url.searchParams.get("date") ?? undefined,
        startDate: url.searchParams.get("startDate") ?? undefined,
        endDate: url.searchParams.get("endDate") ?? undefined
      });

      const categoryFilter = url.searchParams.get("category")?.trim() ?? "";

      const allInRange = await dbAll<{
        id: number; title: string; amount_paise: number; type: "income" | "expense";
        category: string; transaction_date: string; notes: string;
        payment_method: string; linked_group_expense_id: number | null; created_at: string;
      }>(
        env.DB,
        `SELECT id, title, amount_paise, type, category, transaction_date,
                notes, payment_method, linked_group_expense_id, created_at
         FROM personal_transactions
         WHERE user_id = ? AND transaction_date >= ? AND transaction_date <= ?
         ORDER BY transaction_date DESC, id DESC`,
        [userId, range.start, range.end]
      );

      let totalIncomePaise = 0;
      let totalExpensePaise = 0;
      const categoryMap = new Map<string, { category: string; totalPaise: number; count: number }>();

      for (const tx of allInRange) {
        if (tx.type === "income") totalIncomePaise += tx.amount_paise;
        else {
          totalExpensePaise += tx.amount_paise;
          const current = categoryMap.get(tx.category) ??
            { category: tx.category, totalPaise: 0, count: 0 };
          current.totalPaise += tx.amount_paise;
          current.count++;
          categoryMap.set(tx.category, current);
        }
      }

      const categoryBreakdown = Array.from(categoryMap.values())
        .sort((a, b) => b.totalPaise - a.totalPaise);
      const remainingBalancePaise = totalIncomePaise - totalExpensePaise;
      const hasRecordedIncome = totalIncomePaise > 0;

      const weekStart = monday(range.anchorDate);
      const weekEnd = new Date(weekStart);
      weekEnd.setUTCDate(weekStart.getUTCDate() + 6);

      const weekRows = await dbAll<{ transaction_date: string; total_paise: number }>(
        env.DB,
        `SELECT transaction_date, SUM(amount_paise) AS total_paise
         FROM personal_transactions
         WHERE user_id = ? AND type = 'expense'
           AND transaction_date >= ? AND transaction_date <= ?
         GROUP BY transaction_date`,
        [userId, ymd(weekStart), ymd(weekEnd)]
      );

      const weekMap = new Map(weekRows.map(r => [r.transaction_date, r.total_paise]));
      const weeklySpending = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
        .map((dayLabel, i) => {
          const d = new Date(weekStart);
          d.setUTCDate(weekStart.getUTCDate() + i);
          const date = ymd(d);
          return { dayLabel, date, totalPaise: weekMap.get(date) ?? 0 };
        });

      const [year, month] = range.anchorDate.split("-").map(Number);
      const sixStart = ymd(new Date(Date.UTC(year, month - 6, 1)));
      const sixEnd = ymd(new Date(Date.UTC(year, month, 0)));

      const monthlySpending = await dbAll(
        env.DB,
        `SELECT strftime('%Y-%m', transaction_date) AS month,
                SUM(CASE WHEN type = 'income' THEN amount_paise ELSE 0 END) AS income_paise,
                SUM(CASE WHEN type = 'expense' THEN amount_paise ELSE 0 END) AS expense_paise
         FROM personal_transactions
         WHERE user_id = ? AND transaction_date >= ? AND transaction_date <= ?
         GROUP BY strftime('%Y-%m', transaction_date)
         ORDER BY month ASC`,
        [userId, sixStart, sixEnd]
      );

      const monthStart = `${year}-${String(month).padStart(2, "0")}-01`;
      const monthEnd = ymd(new Date(Date.UTC(year, month, 0)));
      const weekStartStr = ymd(weekStart);
      const weekEndStr = ymd(weekEnd);

      const budgets = await dbAll<{
        id: number; scope: "overall" | "category"; category: string;
        period: "weekly" | "monthly"; limit_paise: number;
      }>(
        env.DB,
        "SELECT id, scope, category, period, limit_paise FROM personal_budgets WHERE user_id = ? ORDER BY scope, period",
        [userId]
      );

      const budgetStatuses = await Promise.all(budgets.map(async b => {
        const start = b.period === "weekly" ? weekStartStr : monthStart;
        const end = b.period === "weekly" ? weekEndStr : monthEnd;
        const spent = await dbFirst<{ spent: number }>(
          env.DB,
          `SELECT COALESCE(SUM(amount_paise), 0) AS spent
           FROM personal_transactions
           WHERE user_id = ? AND type = 'expense'
             AND transaction_date >= ? AND transaction_date <= ?
             ${b.scope === "category" ? "AND category = ?" : ""}`,
          b.scope === "category"
            ? [userId, start, end, b.category]
            : [userId, start, end]
        );
        const spentPaise = spent?.spent ?? 0;
        const percentUsed = Number((spentPaise / b.limit_paise * 100).toFixed(1));
        return {
          ...b,
          spentPaise,
          remainingPaise: b.limit_paise - spentPaise,
          percentUsed,
          alertState: percentUsed >= 100 ? "exceeded" : percentUsed >= 80 ? "approaching" : "ok"
        };
      }));

      const savingsGoals = await dbAll(
        env.DB,
        "SELECT * FROM personal_savings_goals WHERE user_id = ? ORDER BY created_at DESC",
        [userId]
      );

      const customCategories = await dbAll<{
        id: number; name: string; type: "income" | "expense"; color: string;
      }>(
        env.DB,
        "SELECT id, name, type, color FROM personal_categories WHERE user_id = ? ORDER BY name",
        [userId]
      );

      const transactions = categoryFilter
        ? allInRange.filter(tx => tx.category === categoryFilter)
        : allInRange;

      return json({
        range,
        summary: {
          totalIncomePaise,
          totalExpensePaise,
          remainingBalancePaise,
          savingsPaise: hasRecordedIncome ? Math.max(0, remainingBalancePaise) : 0,
          savingsPercent: hasRecordedIncome
            ? Number((remainingBalancePaise / totalIncomePaise * 100).toFixed(1))
            : null,
          hasRecordedIncome,
          highestSpendingCategory: categoryBreakdown[0] ?? null,
          transactionCount: allInRange.length
        },
        categoryBreakdown,
        weeklySpending,
        monthlySpending,
        budgetStatuses,
        savingsGoals,
        categories: {
          expense: Array.from(new Set([
            ...EXPENSE_CATEGORIES,
            ...customCategories.filter(c => c.type === "expense").map(c => c.name)
          ])),
          income: Array.from(new Set([
            ...INCOME_CATEGORIES,
            ...customCategories.filter(c => c.type === "income").map(c => c.name)
          ])),
          custom: customCategories
        },
        transactions
      });
    }

    // CREATE TRANSACTION
    if (path === "/api/personal/transactions" && request.method === "POST") {
      const body = await request.json() as {
        title?: string; amountPaise?: number; type?: string; category?: string;
        transactionDate?: string; notes?: string; paymentMethod?: string;
        linkedGroupExpenseId?: number | null;
      };

      const title = (body.title ?? "").trim();
      const amount = Math.round(Number(body.amountPaise ?? 0));
      const category = (body.category ?? "").trim();
      const date = (body.transactionDate ?? "").trim();

      if (title.length < 2 || title.length > 120)
        return json({ error: "Transaction title must be between 2 and 120 characters." }, 400);
      if (!Number.isFinite(amount) || amount <= 0)
        return json({ error: "Amount must be greater than ₹0." }, 400);
      if (body.type !== "income" && body.type !== "expense")
        return json({ error: "Transaction type must be income or expense." }, 400);
      if (!category) return json({ error: "Please select a category." }, 400);
      if (!validDate(date)) return json({ error: "Please provide a valid date (YYYY-MM-DD)." }, 400);

      const result = await env.DB.prepare(
        `INSERT INTO personal_transactions
         (user_id, title, amount_paise, type, category, transaction_date, notes, payment_method, linked_group_expense_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        userId, title, amount, body.type, category, date,
        (body.notes ?? "").trim(), (body.paymentMethod ?? "").trim(),
        body.linkedGroupExpenseId ?? null
      ).run();

      return json({ transactionId: Number(result.meta.last_row_id) }, 201);
    }

    // UPDATE / DELETE TRANSACTION
    const txMatch = path.match(/^\/api\/personal\/transactions\/(\d+)$/);
    if (txMatch) {
      const id = Number(txMatch[1]);
      const existing = await dbFirst(
        env.DB,
        "SELECT id FROM personal_transactions WHERE id = ? AND user_id = ?",
        [id, userId]
      );
      if (!existing) return json({ error: "Personal transaction not found." }, 404);

      if (request.method === "DELETE") {
        await dbRun(env.DB,
          "DELETE FROM personal_transactions WHERE id = ? AND user_id = ?",
          [id, userId]);
        return json({ ok: true });
      }

      if (request.method === "PUT") {
        const body = await request.json() as {
          title?: string; amountPaise?: number; type?: string; category?: string;
          transactionDate?: string; notes?: string; paymentMethod?: string;
        };
        const title = (body.title ?? "").trim();
        const amount = Math.round(Number(body.amountPaise ?? 0));
        const category = (body.category ?? "").trim();
        const date = (body.transactionDate ?? "").trim();

        if (title.length < 2 || amount <= 0 ||
            (body.type !== "income" && body.type !== "expense") ||
            !category || !validDate(date)) {
          return json({ error: "Invalid transaction fields provided." }, 400);
        }

        await dbRun(
          env.DB,
          `UPDATE personal_transactions
           SET title = ?, amount_paise = ?, type = ?, category = ?,
               transaction_date = ?, notes = ?, payment_method = ?,
               updated_at = datetime('now')
           WHERE id = ? AND user_id = ?`,
          [title, amount, body.type, category, date,
           (body.notes ?? "").trim(), (body.paymentMethod ?? "").trim(), id, userId]
        );
        return json({ ok: true });
      }
    }

    // CREATE / DELETE CUSTOM CATEGORY
    if (path === "/api/personal/categories" && request.method === "POST") {
      const body = await request.json() as { name?: string; type?: string; color?: string };
      const name = (body.name ?? "").trim();
      if (name.length < 2 || name.length > 48)
        return json({ error: "Category name must be between 2 and 48 characters." }, 400);

      const type = body.type === "income" ? "income" : "expense";
      const color = /^#[0-9A-Fa-f]{6}$/.test(body.color ?? "") ? body.color! : "#065F46";

      try {
        const result = await env.DB.prepare(
          "INSERT INTO personal_categories (user_id, name, type, color) VALUES (?, ?, ?, ?)"
        ).bind(userId, name, type, color).run();
        return json({ id: Number(result.meta.last_row_id), name, type, color }, 201);
      } catch {
        return json({ error: "A custom category with that name already exists." }, 409);
      }
    }

    const categoryMatch = path.match(/^\/api\/personal\/categories\/(\d+)$/);
    if (categoryMatch && request.method === "DELETE") {
      const result = await dbRun(
        env.DB,
        "DELETE FROM personal_categories WHERE id = ? AND user_id = ?",
        [Number(categoryMatch[1]), userId]
      );
      if (!result.meta.changes) return json({ error: "Custom category not found." }, 404);
      return json({ ok: true });
    }

    // CREATE / DELETE BUDGET
    if (path === "/api/personal/budgets" && request.method === "POST") {
      const body = await request.json() as {
        scope?: string; category?: string; period?: string; limitPaise?: number;
      };
      const scope = body.scope === "category" ? "category" : "overall";
      const category = scope === "category" ? (body.category ?? "").trim() : "";
      const period = body.period === "weekly" ? "weekly" : "monthly";
      const limit = Math.round(Number(body.limitPaise ?? 0));

      if (scope === "category" && !category)
        return json({ error: "Select a category for a category budget." }, 400);
      if (!Number.isFinite(limit) || limit <= 0)
        return json({ error: "Budget limit must be greater than ₹0." }, 400);

      await dbRun(
        env.DB,
        `INSERT INTO personal_budgets (user_id, scope, category, period, limit_paise)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(user_id, scope, category, period)
         DO UPDATE SET limit_paise = excluded.limit_paise, updated_at = datetime('now')`,
        [userId, scope, category, period, limit]
      );
      return json({ ok: true }, 201);
    }

    const budgetMatch = path.match(/^\/api\/personal\/budgets\/(\d+)$/);
    if (budgetMatch && request.method === "DELETE") {
      const result = await dbRun(
        env.DB,
        "DELETE FROM personal_budgets WHERE id = ? AND user_id = ?",
        [Number(budgetMatch[1]), userId]
      );
      if (!result.meta.changes) return json({ error: "Budget not found." }, 404);
      return json({ ok: true });
    }

    // CREATE / UPDATE / DELETE SAVINGS GOALS
    if (path === "/api/personal/goals" && request.method === "POST") {
      const body = await request.json() as {
        title?: string; targetPaise?: number; currentSavedPaise?: number;
        targetDate?: string; notes?: string;
      };
      const title = (body.title ?? "").trim();
      const target = Math.round(Number(body.targetPaise ?? 0));
      const saved = Math.max(0, Math.round(Number(body.currentSavedPaise ?? 0)));

      if (title.length < 2) return json({ error: "Goal title must be at least 2 characters." }, 400);
      if (!Number.isFinite(target) || target <= 0)
        return json({ error: "Target amount must be greater than ₹0." }, 400);

      const result = await env.DB.prepare(
        `INSERT INTO personal_savings_goals
         (user_id, title, target_paise, current_saved_paise, target_date, notes)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).bind(userId, title, target, saved, body.targetDate?.trim() || null,
        (body.notes ?? "").trim()).run();

      return json({ goalId: Number(result.meta.last_row_id) }, 201);
    }

    const goalMatch = path.match(/^\/api\/personal\/goals\/(\d+)$/);
    if (goalMatch) {
      const id = Number(goalMatch[1]);
      const existing = await dbFirst<{
        title: string; target_paise: number; current_saved_paise: number;
      }>(
        env.DB,
        "SELECT title, target_paise, current_saved_paise FROM personal_savings_goals WHERE id = ? AND user_id = ?",
        [id, userId]
      );

      if (!existing) return json({ error: "Savings goal not found." }, 404);

      if (request.method === "DELETE") {
        await dbRun(env.DB,
          "DELETE FROM personal_savings_goals WHERE id = ? AND user_id = ?",
          [id, userId]);
        return json({ ok: true });
      }

      if (request.method === "PATCH") {
        const body = await request.json() as {
          currentSavedPaise?: number; targetPaise?: number; title?: string;
        };
        await dbRun(
          env.DB,
          `UPDATE personal_savings_goals
           SET title = ?, target_paise = ?, current_saved_paise = ?,
               updated_at = datetime('now')
           WHERE id = ? AND user_id = ?`,
          [
            body.title !== undefined && body.title.trim() ? body.title.trim() : existing.title,
            body.targetPaise !== undefined && body.targetPaise > 0
              ? Math.round(body.targetPaise) : existing.target_paise,
            body.currentSavedPaise !== undefined && body.currentSavedPaise >= 0
              ? Math.round(body.currentSavedPaise) : existing.current_saved_paise,
            id, userId
          ]
        );
        return json({ ok: true });
      }
    }

    // CSV EXPORT
    if (path === "/api/personal/export.csv" && request.method === "GET") {
      const order = url.searchParams.get("order") === "oldest" ? "ASC" : "DESC";
      const rows = await dbAll<{
        id: number; transaction_date: string; type: string; category: string;
        title: string; payment_method: string; amount_paise: number; notes: string;
      }>(
        env.DB,
        `SELECT id, transaction_date, type, category, title, payment_method, amount_paise, notes
         FROM personal_transactions WHERE user_id = ?
         ORDER BY transaction_date ${order}, id ${order}`,
        [userId]
      );

      const lines = [
        ["ID", "Date", "Type", "Category", "Title", "Payment Method", "Amount (INR)", "Notes"],
        ...rows.map(r => [
          r.id, r.transaction_date, r.type, r.category, r.title,
          r.payment_method, (r.amount_paise / 100).toFixed(2), r.notes
        ])
      ];

      const csv = lines.map(row => row.map(csvCell).join(",")).join("\r\n");
      return new Response("\uFEFF" + csv, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": 'attachment; filename="settleup-personal-tracker.csv"'
        }
      });
    }

    return json({ error: "Route not found." }, 404);
  } catch (error) {
    return json({
      error: "Unable to process personal finance request.",
      details: error instanceof Error ? error.message : "Unknown error"
    }, 500);
  }
}
