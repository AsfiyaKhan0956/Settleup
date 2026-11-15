import { Router } from 'express';
import { db } from '../db.ts';
import { requireAuth, type AuthedRequest } from '../middleware.ts';

export const analyticsRouter = Router();

analyticsRouter.get('/summary', requireAuth, (req: AuthedRequest, res) => {
  const userId = req.user!.id;
  const groupId = req.query.groupId ? Number(req.query.groupId) : null;
  const days = req.query.days ? Number(req.query.days) : 180;

  const dateFilter = `date('now', '-${Math.max(7, Math.min(365, days))} days')`;
  const groupCondition = groupId ? 'AND e.group_id = ?' : '';
  const params: Array<number> = groupId ? [userId, groupId] : [userId];

  const monthlyTrend = db
    .prepare(`
      SELECT strftime('%Y-%m', e.expense_date) AS month,
             SUM(e.total_paise) AS group_total_paise,
             SUM(COALESCE(es.owed_paise, 0)) AS my_share_paise,
             COUNT(e.id) AS expense_count
      FROM expenses e
      JOIN group_members gm ON gm.group_id = e.group_id AND gm.user_id = ?
      LEFT JOIN expense_splits es ON es.expense_id = e.id AND es.user_id = gm.user_id
      WHERE date(e.expense_date) >= ${dateFilter} ${groupCondition}
      GROUP BY strftime('%Y-%m', e.expense_date)
      ORDER BY month ASC
    `)
    .all(...params);

  const weeklyTrend = db
    .prepare(`
      SELECT strftime('%Y-W%W', e.expense_date) AS week,
             SUM(e.total_paise) AS total_paise,
             SUM(COALESCE(es.owed_paise, 0)) AS my_share_paise
      FROM expenses e
      JOIN group_members gm ON gm.group_id = e.group_id AND gm.user_id = ?
      LEFT JOIN expense_splits es ON es.expense_id = e.id AND es.user_id = gm.user_id
      WHERE date(e.expense_date) >= date('now', '-56 days') ${groupCondition}
      GROUP BY strftime('%Y-W%W', e.expense_date)
      ORDER BY week ASC
    `)
    .all(...params);

  const byCategory = db
    .prepare(`
      SELECT e.category,
             SUM(e.total_paise) AS total_paise,
             SUM(COALESCE(es.owed_paise, 0)) AS my_share_paise,
             COUNT(e.id) AS count
      FROM expenses e
      JOIN group_members gm ON gm.group_id = e.group_id AND gm.user_id = ?
      LEFT JOIN expense_splits es ON es.expense_id = e.id AND es.user_id = gm.user_id
      WHERE date(e.expense_date) >= ${dateFilter} ${groupCondition}
      GROUP BY e.category
      ORDER BY total_paise DESC
    `)
    .all(...params);

  const byGroup = db
    .prepare(`
      SELECT g.id AS group_id, g.name AS group_name, g.cover_color,
             COALESCE(SUM(e.total_paise), 0) AS total_paise,
             COUNT(e.id) AS expense_count
      FROM groups g
      JOIN group_members gm ON gm.group_id = g.id AND gm.user_id = ?
      LEFT JOIN expenses e ON e.group_id = g.id AND date(e.expense_date) >= ${dateFilter}
      WHERE g.is_archived = 0 ${groupId ? 'AND g.id = ?' : ''}
      GROUP BY g.id
      ORDER BY total_paise DESC
    `)
    .all(...params);

  const memberContributions = db
    .prepare(`
      SELECT u.id AS user_id, u.full_name,
             COALESCE(SUM(e.total_paise), 0) AS paid_paise
      FROM expenses e
      JOIN group_members gm ON gm.group_id = e.group_id AND gm.user_id = ?
      JOIN users u ON u.id = e.paid_by_user_id
      WHERE date(e.expense_date) >= ${dateFilter} ${groupCondition}
      GROUP BY u.id
      ORDER BY paid_paise DESC
    `)
    .all(...params);

  const settlementStats = db
    .prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN s.status = 'confirmed' THEN s.amount_paise ELSE 0 END), 0) AS settled_paise,
        COALESCE(SUM(CASE WHEN s.status IN ('pending', 'recorded') THEN s.amount_paise ELSE 0 END), 0) AS pending_paise
      FROM settlements s
      JOIN group_members gm ON gm.group_id = s.group_id AND gm.user_id = ?
      ${groupId ? 'WHERE s.group_id = ?' : ''}
    `)
    .get(...params) as { settled_paise: number; pending_paise: number };

  res.json({
    monthlyTrend,
    weeklyTrend,
    byCategory,
    byGroup,
    memberContributions,
    settlementStats,
  });
});

analyticsRouter.get('/export.csv', requireAuth, (req: AuthedRequest, res) => {
  const userId = req.user!.id;
  const groupId = req.query.groupId ? Number(req.query.groupId) : null;

  const rows = db
    .prepare(`
      SELECT e.id, e.expense_date, g.name AS group_name, e.title, e.category,
             e.split_method, payer.full_name AS paid_by, e.total_paise,
             COALESCE(es.owed_paise, 0) AS my_share_paise
      FROM expenses e
      JOIN groups g ON g.id = e.group_id
      JOIN group_members gm ON gm.group_id = g.id AND gm.user_id = ?
      JOIN users payer ON payer.id = e.paid_by_user_id
      LEFT JOIN expense_splits es ON es.expense_id = e.id AND es.user_id = ?
      ${groupId ? 'WHERE e.group_id = ?' : ''}
      ORDER BY e.expense_date DESC, e.id DESC
    `)
    .all(...(groupId ? [userId, userId, groupId] : [userId, userId])) as Array<{
    id: number;
    expense_date: string;
    group_name: string;
    title: string;
    category: string;
    split_method: string;
    paid_by: string;
    total_paise: number;
    my_share_paise: number;
  }>;

  const escapeCsv = (val: string | number) => `"${String(val).replace(/"/g, '""')}"`;
  const header = ['Expense ID', 'Date', 'Group', 'Title', 'Category', 'Split Method', 'Paid By', 'Total (INR)', 'My Share (INR)'];
  const lines = [
    header.map(escapeCsv).join(','),
    ...rows.map((r) =>
      [
        r.id,
        r.expense_date,
        r.group_name,
        r.title,
        r.category,
        r.split_method,
        r.paid_by,
        (r.total_paise / 100).toFixed(2),
        (r.my_share_paise / 100).toFixed(2),
      ]
        .map(escapeCsv)
        .join(',')
    ),
  ];

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="settleup-expenses-report.csv"');
  res.send(lines.join('\n'));
});
