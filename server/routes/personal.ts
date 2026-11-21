import { Router } from 'express';
import { db } from '../db.ts';
import { requireAuth, type AuthedRequest } from '../middleware.ts';
import { todayYmd } from '../date.ts';
import { csvDocument, formatCsvDate } from '../csv.ts';

export const personalRouter = Router();

export const DEFAULT_EXPENSE_CATEGORIES = [
  'Food and groceries',
  'Transportation',
  'Shopping',
  'Education',
  'Electricity and utilities',
  'Rent and accommodation',
  'Healthcare',
  'Entertainment',
  'Travel',
  'Personal care',
  'Other expenses',
];

export const DEFAULT_INCOME_CATEGORIES = [
  'Salary & stipend',
  'Allowance',
  'Freelance & side income',
  'Gift & refund',
  'Other income',
];

function isIsoDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const parsed = new Date(`${s}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === s;
}

function formatYmd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function getMondayOfWeek(dateStr: string): Date {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const day = d.getUTCDay(); // 0=Sun..6=Sat
  const diffToMon = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diffToMon);
  return d;
}

function resolveDateRange(params: {
  period?: string;
  date?: string;
  startDate?: string;
  endDate?: string;
}): { period: 'daily' | 'weekly' | 'monthly' | 'custom'; start: string; end: string; anchorDate: string } {
  const today = todayYmd();
  const rawPeriod = params.period ?? 'monthly';
  const anchor = params.date && isIsoDate(params.date) ? params.date : today;

  if (rawPeriod === 'daily') {
    return { period: 'daily', start: anchor, end: anchor, anchorDate: anchor };
  }

  if (rawPeriod === 'weekly') {
    const mon = getMondayOfWeek(anchor);
    const sun = new Date(mon);
    sun.setUTCDate(mon.getUTCDate() + 6);
    return { period: 'weekly', start: formatYmd(mon), end: formatYmd(sun), anchorDate: anchor };
  }

  if (rawPeriod === 'custom' && params.startDate && params.endDate && isIsoDate(params.startDate) && isIsoDate(params.endDate)) {
    const start = params.startDate <= params.endDate ? params.startDate : params.endDate;
    const end = params.startDate <= params.endDate ? params.endDate : params.startDate;
    return { period: 'custom', start, end, anchorDate: end };
  }

  // Default: monthly
  const [y, m] = anchor.split('-').map(Number);
  const firstDay = new Date(Date.UTC(y, m - 1, 1));
  const lastDay = new Date(Date.UTC(y, m, 0));
  return { period: 'monthly', start: formatYmd(firstDay), end: formatYmd(lastDay), anchorDate: anchor };
}

personalRouter.get('/summary', requireAuth, (req: AuthedRequest, res) => {
  const userId = req.user!.id;
  const period = (req.query.period as string) || 'monthly';
  const date = (req.query.date as string) || undefined;
  const startDate = (req.query.startDate as string) || undefined;
  const endDate = (req.query.endDate as string) || undefined;
  const categoryFilter = ((req.query.category as string) || '').trim();

  const range = resolveDateRange({ period, date, startDate, endDate });

  const allInRange = db
    .prepare(`
      SELECT id, title, amount_paise, type, category, transaction_date, notes, payment_method, linked_group_expense_id, created_at
      FROM personal_transactions
      WHERE user_id = ? AND transaction_date >= ? AND transaction_date <= ?
      ORDER BY transaction_date DESC, id DESC
    `)
    .all(userId, range.start, range.end) as Array<{
    id: number;
    title: string;
    amount_paise: number;
    type: 'income' | 'expense';
    category: string;
    transaction_date: string;
    notes: string;
    payment_method: string;
    linked_group_expense_id: number | null;
    created_at: string;
  }>;

  let totalIncomePaise = 0;
  let totalExpensePaise = 0;
  const categoryMap = new Map<string, { category: string; totalPaise: number; count: number }>();

  for (const tx of allInRange) {
    if (tx.type === 'income') {
      totalIncomePaise += tx.amount_paise;
    } else {
      totalExpensePaise += tx.amount_paise;
      const cur = categoryMap.get(tx.category) ?? { category: tx.category, totalPaise: 0, count: 0 };
      cur.totalPaise += tx.amount_paise;
      cur.count += 1;
      categoryMap.set(tx.category, cur);
    }
  }

  const categoryBreakdown = Array.from(categoryMap.values()).sort((a, b) => b.totalPaise - a.totalPaise);
  const highestSpendingCategory = categoryBreakdown[0] ?? null;
  const remainingBalancePaise = totalIncomePaise - totalExpensePaise;
  const hasRecordedIncome = totalIncomePaise > 0;
  const savingsPaise = hasRecordedIncome ? Math.max(0, remainingBalancePaise) : 0;
  const savingsPercent = hasRecordedIncome
    ? Number(((remainingBalancePaise / totalIncomePaise) * 100).toFixed(1))
    : null;

  // Weekly Spending Chart (7 days of week containing anchorDate)
  const mon = getMondayOfWeek(range.anchorDate);
  const sun = new Date(mon);
  sun.setUTCDate(mon.getUTCDate() + 6);
  const weekRows = db
    .prepare(`
      SELECT transaction_date, SUM(amount_paise) AS total_paise
      FROM personal_transactions
      WHERE user_id = ? AND type = 'expense' AND transaction_date >= ? AND transaction_date <= ?
      GROUP BY transaction_date
    `)
    .all(userId, formatYmd(mon), formatYmd(sun)) as Array<{ transaction_date: string; total_paise: number }>;

  const weekMap = new Map(weekRows.map((r) => [r.transaction_date, r.total_paise]));
  const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const weeklySpending = dayNames.map((label, idx) => {
    const d = new Date(mon);
    d.setUTCDate(mon.getUTCDate() + idx);
    const ymd = formatYmd(d);
    return {
      dayLabel: label,
      date: ymd,
      totalPaise: weekMap.get(ymd) ?? 0,
    };
  });

  // Monthly Spending Chart (last 6 months up to anchorDate's month)
  const anchorParts = range.anchorDate.split('-').map(Number);
  const sixMonthsStart = new Date(Date.UTC(anchorParts[0], anchorParts[1] - 6, 1));
  const sixMonthsEnd = new Date(Date.UTC(anchorParts[0], anchorParts[1], 0));
  const monthRows = db
    .prepare(`
      SELECT strftime('%Y-%m', transaction_date) AS month,
             SUM(CASE WHEN type = 'income' THEN amount_paise ELSE 0 END) AS income_paise,
             SUM(CASE WHEN type = 'expense' THEN amount_paise ELSE 0 END) AS expense_paise
      FROM personal_transactions
      WHERE user_id = ? AND transaction_date >= ? AND transaction_date <= ?
      GROUP BY strftime('%Y-%m', transaction_date)
      ORDER BY month ASC
    `)
    .all(userId, formatYmd(sixMonthsStart), formatYmd(sixMonthsEnd)) as Array<{
    month: string;
    income_paise: number;
    expense_paise: number;
  }>;

  // Budgets evaluation (against current calendar week / month of anchorDate)
  const monthStart = `${anchorParts[0]}-${String(anchorParts[1]).padStart(2, '0')}-01`;
  const monthEnd = formatYmd(new Date(Date.UTC(anchorParts[0], anchorParts[1], 0)));
  const weekStart = formatYmd(mon);
  const weekEnd = formatYmd(sun);

  const budgets = db
    .prepare('SELECT id, scope, category, period, limit_paise FROM personal_budgets WHERE user_id = ? ORDER BY scope ASC, period ASC')
    .all(userId) as Array<{
    id: number;
    scope: 'overall' | 'category';
    category: string;
    period: 'weekly' | 'monthly';
    limit_paise: number;
  }>;

  const budgetStatuses = budgets.map((b) => {
    const bStart = b.period === 'weekly' ? weekStart : monthStart;
    const bEnd = b.period === 'weekly' ? weekEnd : monthEnd;
    const spentRow =
      b.scope === 'overall'
        ? (db
            .prepare(`
              SELECT COALESCE(SUM(amount_paise), 0) AS spent
              FROM personal_transactions
              WHERE user_id = ? AND type = 'expense' AND transaction_date >= ? AND transaction_date <= ?
            `)
            .get(userId, bStart, bEnd) as { spent: number })
        : (db
            .prepare(`
              SELECT COALESCE(SUM(amount_paise), 0) AS spent
              FROM personal_transactions
              WHERE user_id = ? AND type = 'expense' AND category = ? AND transaction_date >= ? AND transaction_date <= ?
            `)
            .get(userId, b.category, bStart, bEnd) as { spent: number });

    const spentPaise = spentRow.spent;
    const remainingPaise = b.limit_paise - spentPaise;
    const percentUsed = Number(((spentPaise / b.limit_paise) * 100).toFixed(1));
    const alertState = percentUsed >= 100 ? 'exceeded' : percentUsed >= 80 ? 'approaching' : 'ok';
    return {
      ...b,
      spentPaise,
      remainingPaise,
      percentUsed,
      alertState,
    };
  });

  const savingsGoals = db
    .prepare('SELECT * FROM personal_savings_goals WHERE user_id = ? ORDER BY created_at DESC')
    .all(userId);

  const customCategories = db
    .prepare('SELECT id, name, type, color FROM personal_categories WHERE user_id = ? ORDER BY name ASC')
    .all(userId) as Array<{ id: number; name: string; type: 'income' | 'expense'; color: string }>;

  const transactions = categoryFilter
    ? allInRange.filter((tx) => tx.category === categoryFilter)
    : allInRange;

  res.json({
    range,
    summary: {
      totalIncomePaise,
      totalExpensePaise,
      remainingBalancePaise,
      savingsPaise,
      savingsPercent,
      hasRecordedIncome,
      highestSpendingCategory,
      transactionCount: allInRange.length,
    },
    categoryBreakdown,
    weeklySpending,
    monthlySpending: monthRows,
    budgetStatuses,
    savingsGoals,
    categories: {
      expense: Array.from(
        new Set([...DEFAULT_EXPENSE_CATEGORIES, ...customCategories.filter((c) => c.type === 'expense').map((c) => c.name)])
      ),
      income: Array.from(
        new Set([...DEFAULT_INCOME_CATEGORIES, ...customCategories.filter((c) => c.type === 'income').map((c) => c.name)])
      ),
      custom: customCategories,
    },
    transactions,
  });
});

personalRouter.post('/transactions', requireAuth, (req: AuthedRequest, res) => {
  const userId = req.user!.id;
  const { title, amountPaise, type, category, transactionDate, notes, paymentMethod, linkedGroupExpenseId } =
    req.body as {
      title?: string;
      amountPaise?: number;
      type?: 'income' | 'expense';
      category?: string;
      transactionDate?: string;
      notes?: string;
      paymentMethod?: string;
      linkedGroupExpenseId?: number | null;
    };

  const cleanTitle = (title ?? '').trim();
  const cleanAmt = Math.round(Number(amountPaise ?? 0));
  const cleanCategory = (category ?? '').trim();
  const cleanDate = (transactionDate ?? '').trim();

  if (cleanTitle.length < 2 || cleanTitle.length > 120) {
    res.status(400).json({ error: 'Transaction title must be between 2 and 120 characters.' });
    return;
  }
  if (!Number.isFinite(cleanAmt) || cleanAmt <= 0) {
    res.status(400).json({ error: 'Amount must be greater than ₹0.' });
    return;
  }
  if (type !== 'income' && type !== 'expense') {
    res.status(400).json({ error: 'Transaction type must be income or expense.' });
    return;
  }
  if (!cleanCategory) {
    res.status(400).json({ error: 'Please select a category.' });
    return;
  }
  if (!isIsoDate(cleanDate)) {
    res.status(400).json({ error: 'Please provide a valid date (YYYY-MM-DD).' });
    return;
  }

  const id = Number(
    db
      .prepare(`
        INSERT INTO personal_transactions (
          user_id, title, amount_paise, type, category, transaction_date, notes, payment_method, linked_group_expense_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        userId,
        cleanTitle,
        cleanAmt,
        type,
        cleanCategory,
        cleanDate,
        (notes ?? '').trim(),
        (paymentMethod ?? '').trim(),
        linkedGroupExpenseId ?? null
      ).lastInsertRowid
  );

  res.status(201).json({ transactionId: id });
});

personalRouter.put('/transactions/:id', requireAuth, (req: AuthedRequest, res) => {
  const userId = req.user!.id;
  const txId = Number(req.params.id);

  const existing = db
    .prepare('SELECT id FROM personal_transactions WHERE id = ? AND user_id = ?')
    .get(txId, userId);
  if (!existing) {
    res.status(404).json({ error: 'Personal transaction not found.' });
    return;
  }

  const { title, amountPaise, type, category, transactionDate, notes, paymentMethod } = req.body as {
    title?: string;
    amountPaise?: number;
    type?: 'income' | 'expense';
    category?: string;
    transactionDate?: string;
    notes?: string;
    paymentMethod?: string;
  };

  const cleanTitle = (title ?? '').trim();
  const cleanAmt = Math.round(Number(amountPaise ?? 0));
  const cleanCategory = (category ?? '').trim();
  const cleanDate = (transactionDate ?? '').trim();

  if (cleanTitle.length < 2 || cleanAmt <= 0 || (type !== 'income' && type !== 'expense') || !cleanCategory || !isIsoDate(cleanDate)) {
    res.status(400).json({ error: 'Invalid transaction fields provided.' });
    return;
  }

  db.prepare(`
    UPDATE personal_transactions
    SET title = ?, amount_paise = ?, type = ?, category = ?, transaction_date = ?, notes = ?, payment_method = ?, updated_at = datetime('now')
    WHERE id = ? AND user_id = ?
  `).run(cleanTitle, cleanAmt, type, cleanCategory, cleanDate, (notes ?? '').trim(), (paymentMethod ?? '').trim(), txId, userId);

  res.json({ ok: true });
});

personalRouter.delete('/transactions/:id', requireAuth, (req: AuthedRequest, res) => {
  const userId = req.user!.id;
  const txId = Number(req.params.id);
  const info = db.prepare('DELETE FROM personal_transactions WHERE id = ? AND user_id = ?').run(txId, userId);
  if (info.changes === 0) {
    res.status(404).json({ error: 'Personal transaction not found.' });
    return;
  }
  res.json({ ok: true });
});

personalRouter.post('/categories', requireAuth, (req: AuthedRequest, res) => {
  const userId = req.user!.id;
  const { name, type, color } = req.body as { name?: string; type?: 'income' | 'expense'; color?: string };
  const cleanName = (name ?? '').trim();
  if (cleanName.length < 2 || cleanName.length > 48) {
    res.status(400).json({ error: 'Category name must be between 2 and 48 characters.' });
    return;
  }
  const cleanType = type === 'income' ? 'income' : 'expense';
  const cleanColor = /^#[0-9A-Fa-f]{6}$/.test(color ?? '') ? color! : '#065F46';

  try {
    const id = Number(
      db
        .prepare('INSERT INTO personal_categories (user_id, name, type, color) VALUES (?, ?, ?, ?)')
        .run(userId, cleanName, cleanType, cleanColor).lastInsertRowid
    );
    res.status(201).json({ id, name: cleanName, type: cleanType, color: cleanColor });
  } catch {
    res.status(409).json({ error: 'A custom category with that name already exists.' });
  }
});

personalRouter.delete('/categories/:id', requireAuth, (req: AuthedRequest, res) => {
  const info = db
    .prepare('DELETE FROM personal_categories WHERE id = ? AND user_id = ?')
    .run(Number(req.params.id), req.user!.id);
  if (info.changes === 0) {
    res.status(404).json({ error: 'Custom category not found.' });
    return;
  }
  res.json({ ok: true });
});

personalRouter.post('/budgets', requireAuth, (req: AuthedRequest, res) => {
  const userId = req.user!.id;
  const { scope, category, period, limitPaise } = req.body as {
    scope?: 'overall' | 'category';
    category?: string;
    period?: 'weekly' | 'monthly';
    limitPaise?: number;
  };

  const cleanScope = scope === 'category' ? 'category' : 'overall';
  const cleanCategory = cleanScope === 'category' ? (category ?? '').trim() : '';
  const cleanPeriod = period === 'weekly' ? 'weekly' : 'monthly';
  const cleanLimit = Math.round(Number(limitPaise ?? 0));

  if (cleanScope === 'category' && !cleanCategory) {
    res.status(400).json({ error: 'Select a category for a category budget.' });
    return;
  }
  if (!Number.isFinite(cleanLimit) || cleanLimit <= 0) {
    res.status(400).json({ error: 'Budget limit must be greater than ₹0.' });
    return;
  }

  db.prepare(`
    INSERT INTO personal_budgets (user_id, scope, category, period, limit_paise)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(user_id, scope, category, period) DO UPDATE SET
      limit_paise = excluded.limit_paise,
      updated_at = datetime('now')
  `).run(userId, cleanScope, cleanCategory, cleanPeriod, cleanLimit);

  res.status(201).json({ ok: true });
});

personalRouter.delete('/budgets/:id', requireAuth, (req: AuthedRequest, res) => {
  const info = db
    .prepare('DELETE FROM personal_budgets WHERE id = ? AND user_id = ?')
    .run(Number(req.params.id), req.user!.id);
  if (info.changes === 0) {
    res.status(404).json({ error: 'Budget not found.' });
    return;
  }
  res.json({ ok: true });
});

personalRouter.post('/goals', requireAuth, (req: AuthedRequest, res) => {
  const userId = req.user!.id;
  const { title, targetPaise, currentSavedPaise, targetDate, notes } = req.body as {
    title?: string;
    targetPaise?: number;
    currentSavedPaise?: number;
    targetDate?: string;
    notes?: string;
  };

  const cleanTitle = (title ?? '').trim();
  const cleanTarget = Math.round(Number(targetPaise ?? 0));
  const cleanSaved = Math.max(0, Math.round(Number(currentSavedPaise ?? 0)));

  if (cleanTitle.length < 2) {
    res.status(400).json({ error: 'Goal title must be at least 2 characters.' });
    return;
  }
  if (!Number.isFinite(cleanTarget) || cleanTarget <= 0) {
    res.status(400).json({ error: 'Target amount must be greater than ₹0.' });
    return;
  }

  const id = Number(
    db
      .prepare(`
        INSERT INTO personal_savings_goals (user_id, title, target_paise, current_saved_paise, target_date, notes)
        VALUES (?, ?, ?, ?, ?, ?)
      `)
      .run(userId, cleanTitle, cleanTarget, cleanSaved, targetDate?.trim() || null, (notes ?? '').trim()).lastInsertRowid
  );

  res.status(201).json({ goalId: id });
});

personalRouter.patch('/goals/:id', requireAuth, (req: AuthedRequest, res) => {
  const userId = req.user!.id;
  const goalId = Number(req.params.id);
  const { currentSavedPaise, targetPaise, title } = req.body as {
    currentSavedPaise?: number;
    targetPaise?: number;
    title?: string;
  };

  const existing = db
    .prepare('SELECT * FROM personal_savings_goals WHERE id = ? AND user_id = ?')
    .get(goalId, userId) as { title: string; target_paise: number; current_saved_paise: number } | undefined;

  if (!existing) {
    res.status(404).json({ error: 'Savings goal not found.' });
    return;
  }

  db.prepare(`
    UPDATE personal_savings_goals
    SET title = ?, target_paise = ?, current_saved_paise = ?, updated_at = datetime('now')
    WHERE id = ? AND user_id = ?
  `).run(
    title !== undefined && title.trim() ? title.trim() : existing.title,
    targetPaise !== undefined && targetPaise > 0 ? Math.round(targetPaise) : existing.target_paise,
    currentSavedPaise !== undefined && currentSavedPaise >= 0 ? Math.round(currentSavedPaise) : existing.current_saved_paise,
    goalId,
    userId
  );

  res.json({ ok: true });
});

personalRouter.delete('/goals/:id', requireAuth, (req: AuthedRequest, res) => {
  const info = db
    .prepare('DELETE FROM personal_savings_goals WHERE id = ? AND user_id = ?')
    .run(Number(req.params.id), req.user!.id);
  if (info.changes === 0) {
    res.status(404).json({ error: 'Savings goal not found.' });
    return;
  }
  res.json({ ok: true });
});

personalRouter.get('/export.csv', requireAuth, (req: AuthedRequest, res) => {
  const userId = req.user!.id;
  const order = req.query.order === 'oldest' ? 'ASC' : 'DESC';
  const rows = db
    .prepare(`
      SELECT id, transaction_date, type, category, title, payment_method, amount_paise, notes
      FROM personal_transactions
      WHERE user_id = ?
      ORDER BY transaction_date ${order}, id ${order}
    `)
    .all(userId) as Array<{
    id: number;
    transaction_date: string;
    type: string;
    category: string;
    title: string;
    payment_method: string;
    amount_paise: number;
    notes: string;
  }>;

  const header = ['ID', 'Date', 'Type', 'Category', 'Title', 'Payment Method', 'Amount (INR)', 'Notes'];
  const lines = [
    header,
    ...rows.map((r) => [r.id, formatCsvDate(r.transaction_date), r.type, r.category, r.title, r.payment_method, (r.amount_paise / 100).toFixed(2), r.notes]),
  ];

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="settleup-personal-tracker.csv"');
  res.send(csvDocument(lines));
});
