import { Router } from 'express';
import { db } from '../db.ts';
import { todayYmd } from '../date.ts';
import { getMembership, requireAuth, type AuthedRequest } from '../middleware.ts';
import {
  calculateSplits,
  formatINR,
  type ExpenseItemInput,
  type SplitMethod,
  type SplitParticipantInput,
} from '../math.ts';

export const expensesRouter = Router();

expensesRouter.get('/', requireAuth, (req: AuthedRequest, res) => {
  const userId = req.user!.id;
  const groupIdParam = req.query.groupId ? Number(req.query.groupId) : null;
  const category = ((req.query.category as string) ?? '').trim();
  const search = ((req.query.search as string) ?? '').trim().toLowerCase();
  const sort = ((req.query.sort as string) ?? 'newest').trim();

  const rows = db
    .prepare(`
      SELECT e.*, g.name AS group_name, payer.full_name AS payer_name, creator.full_name AS creator_name
      FROM expenses e
      JOIN groups g ON g.id = e.group_id
      JOIN group_members gm ON gm.group_id = g.id AND gm.user_id = ?
      JOIN users payer ON payer.id = e.paid_by_user_id
      JOIN users creator ON creator.id = e.created_by_user_id
      ORDER BY e.expense_date DESC, e.id DESC
    `)
    .all(userId) as Array<{
    id: number;
    group_id: number;
    group_name: string;
    paid_by_user_id: number;
    payer_name: string;
    created_by_user_id: number;
    creator_name: string;
    title: string;
    description: string;
    category: string;
    split_method: string;
    total_paise: number;
    expense_date: string;
    created_at: string;
  }>;

  const splitStmt = db.prepare(`
    SELECT es.user_id, u.full_name, es.owed_paise
    FROM expense_splits es
    JOIN users u ON u.id = es.user_id
    WHERE es.expense_id = ?
  `);

  let filtered = rows
    .filter((r) => (groupIdParam ? r.group_id === groupIdParam : true))
    .filter((r) => (!category || category === 'All' ? true : r.category === category))
    .filter((r) =>
      !search
        ? true
        : r.title.toLowerCase().includes(search) ||
          r.description.toLowerCase().includes(search) ||
          r.group_name.toLowerCase().includes(search) ||
          r.payer_name.toLowerCase().includes(search)
    )
    .map((r) => {
      const splits = splitStmt.all(r.id) as Array<{ user_id: number; full_name: string; owed_paise: number }>;
      const mySplit = splits.find((s) => s.user_id === userId);
      return {
        ...r,
        participantCount: splits.length,
        myOwedPaise: mySplit?.owed_paise ?? 0,
        splits,
      };
    });

  if (sort === 'oldest') {
    filtered = [...filtered].reverse();
  } else if (sort === 'highest') {
    filtered = [...filtered].sort((a, b) => b.total_paise - a.total_paise);
  } else if (sort === 'lowest') {
    filtered = [...filtered].sort((a, b) => a.total_paise - b.total_paise);
  }

  res.json({ expenses: filtered });
});

expensesRouter.get('/:id', requireAuth, (req: AuthedRequest, res) => {
  const expenseId = Number(req.params.id);
  const userId = req.user!.id;

  const expense = db
    .prepare(`
      SELECT e.*, g.name AS group_name, payer.full_name AS payer_name, creator.full_name AS creator_name
      FROM expenses e
      JOIN groups g ON g.id = e.group_id
      JOIN users payer ON payer.id = e.paid_by_user_id
      JOIN users creator ON creator.id = e.created_by_user_id
      WHERE e.id = ?
    `)
    .get(expenseId) as
    | {
        id: number;
        group_id: number;
        group_name: string;
        paid_by_user_id: number;
        payer_name: string;
        created_by_user_id: number;
        creator_name: string;
        title: string;
        description: string;
        notes: string;
        category: string;
        split_method: SplitMethod;
        subtotal_paise: number;
        tax_paise: number;
        tip_paise: number;
        discount_paise: number;
        total_paise: number;
        currency: string;
        expense_date: string;
        receipt_data_url: string | null;
        created_at: string;
        updated_at: string;
      }
    | undefined;

  if (!expense) {
    res.status(404).json({ error: 'Expense not found.' });
    return;
  }

  const membership = getMembership(expense.group_id, userId);
  if (!membership) {
    res.status(403).json({ error: 'Access denied. You do not belong to this expense group.' });
    return;
  }

  const splits = db
    .prepare(`
      SELECT es.user_id, u.full_name, u.avatar_url, es.owed_paise, es.item_subtotal_paise, es.shared_charges_paise, es.share_meta
      FROM expense_splits es
      JOIN users u ON u.id = es.user_id
      WHERE es.expense_id = ?
      ORDER BY es.owed_paise DESC
    `)
    .all(expenseId);

  const itemsRaw = db
    .prepare('SELECT * FROM expense_items WHERE expense_id = ? ORDER BY id ASC')
    .all(expenseId) as Array<{
    id: number;
    name: string;
    unit_price_paise: number;
    quantity: number;
    total_paise: number;
  }>;

  const consumerStmt = db.prepare(`
    SELECT ic.user_id, u.full_name
    FROM item_consumers ic
    JOIN users u ON u.id = ic.user_id
    WHERE ic.item_id = ?
  `);

  const items = itemsRaw.map((item) => ({
    ...item,
    consumers: consumerStmt.all(item.id) as Array<{ user_id: number; full_name: string }>,
  }));

  res.json({
    expense,
    splits,
    items,
    canEdit: true,
    canDelete: membership.role === 'admin' || expense.created_by_user_id === userId,
  });
});

interface ExpenseWritePayload {
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
  expenseDate: string;
  receiptDataUrl?: string | null;
  participants: SplitParticipantInput[];
  items?: ExpenseItemInput[];
}


function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function validateGroupUsers(groupId: number, userIds: number[]): boolean {
  const placeholders = userIds.map(() => '?').join(',');
  if (!placeholders) return false;
  const rows = db
    .prepare(`SELECT user_id FROM group_members WHERE group_id = ? AND user_id IN (${placeholders})`)
    .all(groupId, ...userIds) as Array<{ user_id: number }>;
  const validSet = new Set(rows.map((r) => r.user_id));
  return userIds.every((id) => validSet.has(id));
}

expensesRouter.post('/', requireAuth, (req: AuthedRequest, res) => {
  const userId = req.user!.id;
  const body = req.body as ExpenseWritePayload;

  const groupId = Number(body.groupId);
  const membership = getMembership(groupId, userId);
  if (!membership) {
    res.status(403).json({ error: 'You are not a member of the selected group.' });
    return;
  }

  const title = (body.title ?? '').trim();
  const expenseDate = body.expenseDate || todayYmd();
  if (!isValidIsoDate(expenseDate)) {
    res.status(400).json({ error: 'Please enter a valid expense date.' });
    return;
  }
  if (title.length < 2 || title.length > 120) {
    res.status(400).json({ error: 'Expense title must be between 2 and 120 characters.' });
    return;
  }

  const paidByUserId = Number(body.paidByUserId);
  const participantIds = Array.from(
    new Set([
      paidByUserId,
      ...(body.participants ?? []).map((p) => Number(p.userId)),
      ...(body.items ?? []).flatMap((i) => i.consumerUserIds.map(Number)),
    ])
  );

  if (!validateGroupUsers(groupId, participantIds)) {
    res.status(400).json({ error: 'Payer and all split participants must belong to this group.' });
    return;
  }

  if (body.receiptDataUrl && body.receiptDataUrl.length > 2_000_000) {
    res.status(400).json({ error: 'Receipt attachment is too large (max ~1.5 MB).' });
    return;
  }

  let computed;
  try {
    computed = calculateSplits({
      splitMethod: body.splitMethod,
      totalPaise: body.totalPaise,
      participants: body.participants,
      items: body.items,
      taxPaise: body.taxPaise,
      tipPaise: body.tipPaise,
      discountPaise: body.discountPaise,
    });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Invalid split calculation.' });
    return;
  }

  const expenseId = db.transaction(() => {
    const expId = Number(
      db
        .prepare(`
          INSERT INTO expenses (
            group_id, paid_by_user_id, created_by_user_id, title, description, notes,
            category, split_method, subtotal_paise, tax_paise, tip_paise, discount_paise,
            total_paise, expense_date, receipt_data_url
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          groupId,
          paidByUserId,
          userId,
          title,
          (body.description ?? '').trim(),
          (body.notes ?? '').trim(),
          body.category || 'Food',
          body.splitMethod,
          computed.subtotalPaise,
          computed.taxPaise,
          computed.tipPaise,
          computed.discountPaise,
          computed.totalPaise,
          expenseDate,
          body.receiptDataUrl ?? null
        ).lastInsertRowid
    );

    if (body.splitMethod === 'itemized' && body.items) {
      const insertItem = db.prepare(`
        INSERT INTO expense_items (expense_id, name, unit_price_paise, quantity, total_paise)
        VALUES (?, ?, ?, ?, ?)
      `);
      const insertConsumer = db.prepare(`
        INSERT INTO item_consumers (item_id, user_id, share_weight) VALUES (?, ?, 1)
      `);

      for (const item of body.items) {
        const itemTotal = Math.round(item.unitPricePaise) * Math.round(item.quantity);
        const itemId = Number(
          insertItem.run(expId, item.name.trim(), Math.round(item.unitPricePaise), Math.round(item.quantity), itemTotal)
            .lastInsertRowid
        );
        for (const cid of Array.from(new Set(item.consumerUserIds))) {
          insertConsumer.run(itemId, cid);
        }
      }
    }

    const insertSplit = db.prepare(`
      INSERT INTO expense_splits (expense_id, user_id, owed_paise, item_subtotal_paise, shared_charges_paise, share_meta)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    for (const s of computed.splits) {
      insertSplit.run(expId, s.userId, s.owedPaise, s.itemSubtotalPaise, s.sharedChargesPaise, s.shareMeta);
    }

    db.prepare("UPDATE groups SET updated_at = datetime('now') WHERE id = ?").run(groupId);
    db.prepare(`
      INSERT INTO activity_logs (group_id, user_id, action, entity_type, entity_id, summary)
      VALUES (?, ?, 'expense_created', 'expense', ?, ?)
    `).run(groupId, userId, expId, `${req.user!.fullName} added "${title}" (${formatINR(computed.totalPaise)})`);

    // Notify involved participants other than the creator
    const notifStmt = db.prepare(`
      INSERT INTO notifications (user_id, group_id, type, title, message, link_path)
      VALUES (?, ?, 'expense_added', ?, ?, '/expenses')
    `);
    for (const s of computed.splits) {
      if (s.userId !== userId && s.owedPaise > 0) {
        notifStmt.run(
          s.userId,
          groupId,
          `New expense: ${title}`,
          `${req.user!.fullName} logged "${title}". Your share is ${formatINR(s.owedPaise)}.`
        );
      }
    }

    return expId;
  })();

  res.status(201).json({ expenseId, computed });
});

expensesRouter.put('/:id', requireAuth, (req: AuthedRequest, res) => {
  const expenseId = Number(req.params.id);
  const userId = req.user!.id;
  const body = req.body as ExpenseWritePayload;

  const existing = db.prepare('SELECT * FROM expenses WHERE id = ?').get(expenseId) as
    | { group_id: number; created_by_user_id: number; title: string }
    | undefined;

  if (!existing) {
    res.status(404).json({ error: 'Expense not found.' });
    return;
  }

  const membership = getMembership(existing.group_id, userId);
  if (!membership) {
    res.status(403).json({ error: 'Only registered members of this group can edit its expenses.' });
    return;
  }

  const updatedPayerId = Number(body.paidByUserId);
  const updatedParticipantIds = Array.from(new Set([
    updatedPayerId,
    ...(body.participants ?? []).map((participant) => Number(participant.userId)),
    ...(body.items ?? []).flatMap((item) => (item.consumerUserIds ?? []).map(Number)),
  ]));
  if (!validateGroupUsers(existing.group_id, updatedParticipantIds)) {
    res.status(400).json({ error: 'Payer and all split participants must belong to this group.' });
    return;
  }
  if (body.receiptDataUrl && body.receiptDataUrl.length > 2_000_000) {
    res.status(400).json({ error: 'Receipt attachment is too large (max ~1.5 MB).' });
    return;
  }

  const title = (body.title ?? '').trim();
  const expenseDate = body.expenseDate || todayYmd();
  if (!isValidIsoDate(expenseDate)) {
    res.status(400).json({ error: 'Please enter a valid expense date.' });
    return;
  }
  if (title.length < 2 || title.length > 120) {
    res.status(400).json({ error: 'Expense title must be between 2 and 120 characters.' });
    return;
  }

  let computed;
  try {
    computed = calculateSplits({
      splitMethod: body.splitMethod,
      totalPaise: body.totalPaise,
      participants: body.participants,
      items: body.items,
      taxPaise: body.taxPaise,
      tipPaise: body.tipPaise,
      discountPaise: body.discountPaise,
    });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Invalid split calculation.' });
    return;
  }

  db.transaction(() => {
    db.prepare(`
      UPDATE expenses
      SET paid_by_user_id = ?, title = ?, description = ?, notes = ?, category = ?,
          split_method = ?, subtotal_paise = ?, tax_paise = ?, tip_paise = ?, discount_paise = ?,
          total_paise = ?, expense_date = ?, receipt_data_url = COALESCE(?, receipt_data_url), updated_at = datetime('now')
      WHERE id = ?
    `).run(
      Number(body.paidByUserId),
      title,
      (body.description ?? '').trim(),
      (body.notes ?? '').trim(),
      body.category || 'Food',
      body.splitMethod,
      computed.subtotalPaise,
      computed.taxPaise,
      computed.tipPaise,
      computed.discountPaise,
      computed.totalPaise,
      expenseDate,
      body.receiptDataUrl ?? null,
      expenseId
    );

    db.prepare('DELETE FROM expense_items WHERE expense_id = ?').run(expenseId);
    db.prepare('DELETE FROM expense_splits WHERE expense_id = ?').run(expenseId);

    if (body.splitMethod === 'itemized' && body.items) {
      const insertItem = db.prepare(`
        INSERT INTO expense_items (expense_id, name, unit_price_paise, quantity, total_paise)
        VALUES (?, ?, ?, ?, ?)
      `);
      const insertConsumer = db.prepare(`
        INSERT INTO item_consumers (item_id, user_id, share_weight) VALUES (?, ?, 1)
      `);
      for (const item of body.items) {
        const itemTotal = Math.round(item.unitPricePaise) * Math.round(item.quantity);
        const itemId = Number(
          insertItem.run(expenseId, item.name.trim(), Math.round(item.unitPricePaise), Math.round(item.quantity), itemTotal)
            .lastInsertRowid
        );
        for (const cid of Array.from(new Set(item.consumerUserIds))) {
          insertConsumer.run(itemId, cid);
        }
      }
    }

    const insertSplit = db.prepare(`
      INSERT INTO expense_splits (expense_id, user_id, owed_paise, item_subtotal_paise, shared_charges_paise, share_meta)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    for (const s of computed.splits) {
      insertSplit.run(expenseId, s.userId, s.owedPaise, s.itemSubtotalPaise, s.sharedChargesPaise, s.shareMeta);
    }

    db.prepare(`
      INSERT INTO activity_logs (group_id, user_id, action, entity_type, entity_id, summary)
      VALUES (?, ?, 'expense_updated', 'expense', ?, ?)
    `).run(existing.group_id, userId, expenseId, `${req.user!.fullName} updated "${title}" (${formatINR(computed.totalPaise)})`);
  })();

  res.json({ ok: true, computed });
});

expensesRouter.delete('/:id', requireAuth, (req: AuthedRequest, res) => {
  const expenseId = Number(req.params.id);
  const userId = req.user!.id;

  const existing = db.prepare('SELECT group_id, created_by_user_id, title FROM expenses WHERE id = ?').get(expenseId) as
    | { group_id: number; created_by_user_id: number; title: string }
    | undefined;

  if (!existing) {
    res.status(404).json({ error: 'Expense not found.' });
    return;
  }

  const membership = getMembership(existing.group_id, userId);
  if (!membership || (membership.role !== 'admin' && existing.created_by_user_id !== userId)) {
    res.status(403).json({ error: 'Only the expense creator or a group admin can delete this expense.' });
    return;
  }

  db.transaction(() => {
    db.prepare('DELETE FROM expenses WHERE id = ?').run(expenseId);
    db.prepare(`
      INSERT INTO activity_logs (group_id, user_id, action, entity_type, entity_id, summary)
      VALUES (?, ?, 'expense_deleted', 'expense', ?, ?)
    `).run(existing.group_id, userId, expenseId, `${req.user!.fullName} deleted expense "${existing.title}"`);
  })();

  res.json({ ok: true });
});
