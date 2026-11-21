import { Router } from 'express';
import { db } from '../db.ts';
import { requireAuth, type AuthedRequest } from '../middleware.ts';
import { csvDocument, formatCsvDate } from '../csv.ts';
import { todayYmd } from '../date.ts';
import { allocateItemCost, calculateParticipantNetBalance, simplifyLedgerBalances } from '../tripLedgerMath.ts';

export const tripLedgerRouter = Router();

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

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function ownedLedger(ledgerId: number, userId: number) {
  return db.prepare('SELECT * FROM trip_ledgers WHERE id = ? AND user_id = ?').get(ledgerId, userId) as
    | { id: number; user_id: number; title: string; description: string; event_date: string }
    | undefined;
}

function calculateLedgerSummary(ledgerId: number) {
  const participants = db.prepare('SELECT id, display_name FROM trip_ledger_participants WHERE ledger_id = ? ORDER BY id').all(ledgerId) as Array<{ id: number; display_name: string }>;
  const map = new Map(participants.map((p) => [p.id, { id: p.id, name: p.display_name, paidPaise: 0, consumedPaise: 0, settlementPaidPaise: 0, settlementReceivedPaise: 0, netPaise: 0 }]));
  const expenses = db.prepare('SELECT id, paid_by_participant_id, total_paise FROM trip_ledger_expenses WHERE ledger_id = ?').all(ledgerId) as Array<{ id: number; paid_by_participant_id: number; total_paise: number }>;
  let totalExpenditurePaise = 0;
  for (const expense of expenses) {
    totalExpenditurePaise += expense.total_paise;
    const payer = map.get(expense.paid_by_participant_id);
    if (payer) payer.paidPaise += expense.total_paise;
  }
  const shares = db.prepare(`SELECT s.participant_id, s.owed_paise FROM trip_ledger_shares s JOIN trip_ledger_expenses e ON e.id = s.expense_id WHERE e.ledger_id = ?`).all(ledgerId) as Array<{ participant_id: number; owed_paise: number }>;
  for (const share of shares) {
    const participant = map.get(share.participant_id);
    if (participant) participant.consumedPaise += share.owed_paise;
  }
  const settlements = db.prepare('SELECT payer_participant_id, receiver_participant_id, amount_paise FROM trip_ledger_settlements WHERE ledger_id = ?').all(ledgerId) as Array<{ payer_participant_id: number; receiver_participant_id: number; amount_paise: number }>;
  for (const settlement of settlements) {
    const payer = map.get(settlement.payer_participant_id);
    const receiver = map.get(settlement.receiver_participant_id);
    if (payer) payer.settlementPaidPaise += settlement.amount_paise;
    if (receiver) receiver.settlementReceivedPaise += settlement.amount_paise;
  }
  const rows = [...map.values()];
  for (const p of rows) p.netPaise = calculateParticipantNetBalance(p);
  const transfers = simplifyLedgerBalances(rows.map((p) => ({ id: p.id, name: p.name, netPaise: p.netPaise })));
  return { participants: rows, totalExpenditurePaise, transfers, settlements };
}

function saveExpense(ledgerId: number, expenseId: number | null, body: ExpenseInput) {
  const title = (body.title ?? '').trim();
  const description = (body.description ?? '').trim();
  const expenseDate = body.expenseDate || todayYmd();
  const payerId = Number(body.paidByParticipantId);
  const items = body.items;
  if (title.length < 2 || title.length > 120) throw new Error('Expense title must be between 2 and 120 characters.');
  if (description.length > 500) throw new Error('Description must be 500 characters or fewer.');
  if (!validDate(expenseDate)) throw new Error('Please enter a valid expense date.');
  if (!Number.isSafeInteger(payerId) || payerId <= 0) throw new Error('Choose who paid this bill.');
  if (!Array.isArray(items) || items.length < 1 || items.length > 100) throw new Error('Add at least one item (maximum 100 items per bill).');
  const validParticipants = new Set((db.prepare('SELECT id FROM trip_ledger_participants WHERE ledger_id = ?').all(ledgerId) as Array<{ id: number }>).map((p) => p.id));
  if (!validParticipants.has(payerId)) throw new Error('The person who paid must belong to this trip.');
  const normalized = items.map((item) => {
    const name = String(item.name ?? '').trim();
    const unitPricePaise = Number(item.unitPricePaise);
    const quantity = Number(item.quantity);
    const participantIds = Array.isArray(item.participantIds) ? [...new Set(item.participantIds.map(Number))] : [];
    if (!name || name.length > 100) throw new Error('Each item needs a name (maximum 100 characters).');
    if (!Number.isSafeInteger(unitPricePaise) || unitPricePaise <= 0) throw new Error(`Enter a valid price for ${name}.`);
    if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 1000) throw new Error(`Quantity for ${name} must be a whole number from 1 to 1,000.`);
    if (participantIds.length === 0 || participantIds.some((id) => !validParticipants.has(id))) throw new Error(`Choose at least one valid consumer for ${name}.`);
    const totalPaise = unitPricePaise * quantity;
    if (!Number.isSafeInteger(totalPaise)) throw new Error(`The total for ${name} is too large.`);
    return { name, unitPricePaise, quantity, totalPaise, participantIds };
  });
  const totalPaise = normalized.reduce((sum, item) => sum + item.totalPaise, 0);
  if (!Number.isSafeInteger(totalPaise) || totalPaise <= 0) throw new Error('Bill total must be greater than zero.');

  return db.transaction(() => {
    if (expenseId !== null && db.prepare('SELECT 1 FROM trip_ledger_settlements WHERE ledger_id = ? LIMIT 1').get(ledgerId)) {
      throw new Error('Undo the recorded settlements before editing trip expenses, so paid amounts remain accurate.');
    }
    let id = expenseId;
    if (id === null) {
      id = Number(db.prepare(`INSERT INTO trip_ledger_expenses (ledger_id, title, description, expense_date, paid_by_participant_id, total_paise) VALUES (?, ?, ?, ?, ?, ?)`).run(ledgerId, title, description, expenseDate, payerId, totalPaise).lastInsertRowid);
    } else {
      db.prepare(`UPDATE trip_ledger_expenses SET title = ?, description = ?, expense_date = ?, paid_by_participant_id = ?, total_paise = ?, updated_at = datetime('now') WHERE id = ? AND ledger_id = ?`).run(title, description, expenseDate, payerId, totalPaise, id, ledgerId);
      db.prepare('DELETE FROM trip_ledger_items WHERE expense_id = ?').run(id);
      db.prepare('DELETE FROM trip_ledger_shares WHERE expense_id = ?').run(id);
    }
    const insertItem = db.prepare('INSERT INTO trip_ledger_items (expense_id, name, unit_price_paise, quantity, total_paise) VALUES (?, ?, ?, ?, ?)');
    const insertConsumer = db.prepare('INSERT INTO trip_ledger_item_consumers (item_id, participant_id, share_paise) VALUES (?, ?, ?)');
    const shareTotals = new Map<number, number>();
    for (const item of normalized) {
      const itemId = Number(insertItem.run(id, item.name, item.unitPricePaise, item.quantity, item.totalPaise).lastInsertRowid);
      for (const allocation of allocateItemCost(item.totalPaise, item.participantIds)) {
        insertConsumer.run(itemId, allocation.participantId, allocation.sharePaise);
        shareTotals.set(allocation.participantId, (shareTotals.get(allocation.participantId) ?? 0) + allocation.sharePaise);
      }
    }
    const insertShare = db.prepare('INSERT INTO trip_ledger_shares (expense_id, participant_id, owed_paise) VALUES (?, ?, ?)');
    for (const [participantId, owedPaise] of shareTotals) insertShare.run(id, participantId, owedPaise);
    db.prepare("UPDATE trip_ledgers SET updated_at = datetime('now') WHERE id = ?").run(ledgerId);
    return { expenseId: id, totalPaise };
  })();
}

tripLedgerRouter.get('/', requireAuth, (req: AuthedRequest, res) => {
  const ledgers = db.prepare('SELECT id, title, description, event_date, created_at FROM trip_ledgers WHERE user_id = ? AND EXISTS (SELECT 1 FROM trip_ledger_participants p WHERE p.ledger_id = trip_ledgers.id) ORDER BY event_date DESC, id DESC').all(req.user!.id) as Array<{ id: number; title: string; description: string; event_date: string; created_at: string }>;
  res.json({ ledgers: ledgers.map((ledger) => ({ ...ledger, ...calculateLedgerSummary(ledger.id) })) });
});

tripLedgerRouter.post('/', requireAuth, (req: AuthedRequest, res) => {
  const title = String(req.body?.title ?? '').trim();
  const description = String(req.body?.description ?? '').trim();
  const eventDate = String(req.body?.eventDate ?? todayYmd());
  if (title.length < 2 || title.length > 100) { res.status(400).json({ error: 'Trip name must be between 2 and 100 characters.' }); return; }
  if (description.length > 500) { res.status(400).json({ error: 'Description must be 500 characters or fewer.' }); return; }
  if (!validDate(eventDate)) { res.status(400).json({ error: 'Please enter a valid trip date.' }); return; }
  const ledgerId = db.transaction(() => {
    const id = Number(db.prepare('INSERT INTO trip_ledgers (user_id, title, description, event_date) VALUES (?, ?, ?, ?)').run(req.user!.id, title, description, eventDate).lastInsertRowid);
    const add = db.prepare('INSERT INTO trip_ledger_participants (ledger_id, display_name) VALUES (?, ?)');
    add.run(id, 'Person A'); add.run(id, 'Person B');
    return id;
  })();
  res.status(201).json({ ledgerId });
});

tripLedgerRouter.get('/:id/export.csv', requireAuth, (req: AuthedRequest, res) => {
  const ledgerId = Number(req.params.id);
  const ledger = ownedLedger(ledgerId, req.user!.id);
  if (!ledger) { res.status(404).json({ error: 'Trip Ledger not found.' }); return; }
  const order = req.query.order === 'oldest' ? 'ASC' : 'DESC';
  const participants = db.prepare('SELECT display_name FROM trip_ledger_participants WHERE ledger_id = ? ORDER BY id').all(ledgerId) as Array<{ display_name: string }>;
  const participantNames = participants.map((participant) => participant.display_name).join(', ');
  // Keep this export intentionally concise: only actual expenses and recorded settlements.
  // Trip Ledger does not currently store a category field, so Category is left blank
  // rather than inventing or deriving a misleading value.
  const rows: Array<Array<string | number | null>> = [[
    'Transaction ID', 'Date', 'Type', 'Category', 'Title', 'Paid By', 'Paid To', 'Amount'
  ]];

  type ExportTransaction = { date: string; id: number; kind: 'expense' | 'settlement'; data: any };
  const transactions: ExportTransaction[] = [];
  const expenses = db.prepare(`SELECT e.*, p.display_name AS payer_name FROM trip_ledger_expenses e JOIN trip_ledger_participants p ON p.id = e.paid_by_participant_id WHERE e.ledger_id = ?`).all(ledgerId) as Array<{ id: number; title: string; expense_date: string; total_paise: number; payer_name: string }>;
  for (const expense of expenses) transactions.push({ date: expense.expense_date, id: expense.id, kind: 'expense', data: expense });
  const settlements = db.prepare(`SELECT s.*, a.display_name AS payer_name, b.display_name AS receiver_name FROM trip_ledger_settlements s JOIN trip_ledger_participants a ON a.id = s.payer_participant_id JOIN trip_ledger_participants b ON b.id = s.receiver_participant_id WHERE s.ledger_id = ?`).all(ledgerId) as Array<{ id: number; settlement_date: string; payer_name: string; receiver_name: string; amount_paise: number }>;
  for (const settlement of settlements) transactions.push({ date: settlement.settlement_date, id: settlement.id, kind: 'settlement', data: settlement });
  transactions.sort((a, b) => {
    const dateCompare = a.date.localeCompare(b.date);
    const idCompare = a.id - b.id;
    const kindCompare = a.kind.localeCompare(b.kind);
    const result = dateCompare || kindCompare || idCompare;
    return order === 'ASC' ? result : -result;
  });

  for (const transaction of transactions) {
    if (transaction.kind === 'expense') {
      const expense = transaction.data as typeof expenses[number];
      rows.push([
        `EXP-${expense.id}`, formatCsvDate(expense.expense_date), 'Expense', '', expense.title,
        expense.payer_name, '', (expense.total_paise / 100).toFixed(2)
      ]);
    } else {
      const settlement = transaction.data as typeof settlements[number];
      rows.push([
        `SET-${settlement.id}`, formatCsvDate(settlement.settlement_date), 'Settlement', '', 'Settlement',
        settlement.payer_name, settlement.receiver_name, (settlement.amount_paise / 100).toFixed(2)
      ]);
    }
  }

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="trip-ledger-${ledgerId}.csv"`);
  res.send(csvDocument(rows));
});

tripLedgerRouter.get('/:id', requireAuth, (req: AuthedRequest, res) => {
  const ledgerId = Number(req.params.id);
  const ledger = ownedLedger(ledgerId, req.user!.id);
  if (!ledger) { res.status(404).json({ error: 'Trip Ledger not found.' }); return; }
  const participants = db.prepare('SELECT * FROM trip_ledger_participants WHERE ledger_id = ? ORDER BY id').all(ledgerId);
  const expenses = db.prepare('SELECT e.*, p.display_name AS payer_name FROM trip_ledger_expenses e JOIN trip_ledger_participants p ON p.id = e.paid_by_participant_id WHERE e.ledger_id = ? ORDER BY e.expense_date DESC, e.id DESC').all(ledgerId) as Array<{ id: number; title: string; description: string; expense_date: string; total_paise: number; paid_by_participant_id: number; payer_name: string }>;
  const detailedExpenses = expenses.map((expense) => {
    const items = db.prepare('SELECT * FROM trip_ledger_items WHERE expense_id = ? ORDER BY id').all(expense.id) as Array<{ id: number; name: string; unit_price_paise: number; quantity: number; total_paise: number }>;
    return { ...expense, items: items.map((item) => ({ ...item, consumers: db.prepare(`SELECT c.participant_id, p.display_name, c.share_paise FROM trip_ledger_item_consumers c JOIN trip_ledger_participants p ON p.id = c.participant_id WHERE c.item_id = ? ORDER BY p.id`).all(item.id) })), shares: db.prepare(`SELECT s.participant_id, p.display_name, s.owed_paise FROM trip_ledger_shares s JOIN trip_ledger_participants p ON p.id = s.participant_id WHERE s.expense_id = ? ORDER BY p.id`).all(expense.id) };
  });
  const settlements = db.prepare(`SELECT s.*, a.display_name AS payer_name, b.display_name AS receiver_name FROM trip_ledger_settlements s JOIN trip_ledger_participants a ON a.id = s.payer_participant_id JOIN trip_ledger_participants b ON b.id = s.receiver_participant_id WHERE s.ledger_id = ? ORDER BY s.settlement_date DESC, s.id DESC`).all(ledgerId);
  res.json({ ledger, participants, expenses: detailedExpenses, settlements, summary: calculateLedgerSummary(ledgerId) });
});

tripLedgerRouter.patch('/:id', requireAuth, (req: AuthedRequest, res) => {
  const ledgerId = Number(req.params.id);
  if (!ownedLedger(ledgerId, req.user!.id)) { res.status(404).json({ error: 'Trip Ledger not found.' }); return; }
  const title = String(req.body?.title ?? '').trim();
  const description = String(req.body?.description ?? '').trim();
  const eventDate = String(req.body?.eventDate ?? '');
  if (title.length < 2 || title.length > 100 || description.length > 500 || !validDate(eventDate)) {
    res.status(400).json({ error: 'Enter a valid trip name, description, and date.' }); return;
  }
  db.prepare("UPDATE trip_ledgers SET title = ?, description = ?, event_date = ?, updated_at = datetime('now') WHERE id = ?").run(title, description, eventDate, ledgerId);
  res.json({ ok: true });
});

tripLedgerRouter.post('/:id/participants', requireAuth, (req: AuthedRequest, res) => {
  const ledgerId = Number(req.params.id);
  if (!ownedLedger(ledgerId, req.user!.id)) { res.status(404).json({ error: 'Trip Ledger not found.' }); return; }
  const name = String(req.body?.displayName ?? '').trim();
  if (name.length < 2 || name.length > 80) { res.status(400).json({ error: 'Participant name must be between 2 and 80 characters.' }); return; }
  const id = Number(db.prepare('INSERT INTO trip_ledger_participants (ledger_id, display_name) VALUES (?, ?)').run(ledgerId, name).lastInsertRowid);
  db.prepare("UPDATE trip_ledgers SET updated_at = datetime('now') WHERE id = ?").run(ledgerId);
  res.status(201).json({ participantId: id, displayName: name });
});

tripLedgerRouter.patch('/participants/:participantId', requireAuth, (req: AuthedRequest, res) => {
  const participantId = Number(req.params.participantId);
  const participant = db.prepare(`SELECT p.ledger_id FROM trip_ledger_participants p JOIN trip_ledgers l ON l.id = p.ledger_id WHERE p.id = ? AND l.user_id = ?`).get(participantId, req.user!.id) as { ledger_id: number } | undefined;
  if (!participant) { res.status(404).json({ error: 'Participant not found.' }); return; }
  const displayName = String(req.body?.displayName ?? '').trim();
  if (displayName.length < 2 || displayName.length > 80) { res.status(400).json({ error: 'Participant name must be between 2 and 80 characters.' }); return; }
  db.prepare('UPDATE trip_ledger_participants SET display_name = ? WHERE id = ?').run(displayName, participantId);
  db.prepare("UPDATE trip_ledgers SET updated_at = datetime('now') WHERE id = ?").run(participant.ledger_id);
  res.json({ ok: true });
});

tripLedgerRouter.post('/:id/expenses', requireAuth, (req: AuthedRequest, res) => {
  const ledgerId = Number(req.params.id);
  if (!ownedLedger(ledgerId, req.user!.id)) { res.status(404).json({ error: 'Trip Ledger not found.' }); return; }
  try { res.status(201).json(saveExpense(ledgerId, null, req.body as ExpenseInput)); }
  catch (err) { res.status(400).json({ error: err instanceof Error ? err.message : 'Unable to save trip expense.' }); }
});

tripLedgerRouter.put('/expenses/:expenseId', requireAuth, (req: AuthedRequest, res) => {
  const expenseId = Number(req.params.expenseId);
  const expense = db.prepare('SELECT ledger_id FROM trip_ledger_expenses WHERE id = ?').get(expenseId) as { ledger_id: number } | undefined;
  if (!expense || !ownedLedger(expense.ledger_id, req.user!.id)) { res.status(404).json({ error: 'Trip expense not found.' }); return; }
  if (db.prepare('SELECT 1 FROM trip_ledger_settlements WHERE ledger_id = ? LIMIT 1').get(expense.ledger_id)) { res.status(409).json({ error: 'Undo the recorded settlements before editing trip expenses, so paid amounts remain accurate.' }); return; }
  try { res.json(saveExpense(expense.ledger_id, expenseId, req.body as ExpenseInput)); }
  catch (err) { res.status(400).json({ error: err instanceof Error ? err.message : 'Unable to update trip expense.' }); }
});

tripLedgerRouter.delete('/expenses/:expenseId', requireAuth, (req: AuthedRequest, res) => {
  const expenseId = Number(req.params.expenseId);
  const expense = db.prepare('SELECT ledger_id FROM trip_ledger_expenses WHERE id = ?').get(expenseId) as { ledger_id: number } | undefined;
  if (!expense || !ownedLedger(expense.ledger_id, req.user!.id)) { res.status(404).json({ error: 'Trip expense not found.' }); return; }
  if (db.prepare('SELECT 1 FROM trip_ledger_settlements WHERE ledger_id = ? LIMIT 1').get(expense.ledger_id)) { res.status(409).json({ error: 'Undo the recorded settlements before deleting trip expenses, so paid amounts remain accurate.' }); return; }
  try {
    db.transaction(() => {
      if (db.prepare('SELECT 1 FROM trip_ledger_settlements WHERE ledger_id = ? LIMIT 1').get(expense.ledger_id)) {
        throw new Error('Undo the recorded settlements before deleting trip expenses, so paid amounts remain accurate.');
      }
      db.prepare('DELETE FROM trip_ledger_expenses WHERE id = ?').run(expenseId);
      db.prepare("UPDATE trip_ledgers SET updated_at = datetime('now') WHERE id = ?").run(expense.ledger_id);
    })();
    res.json({ ok: true });
  } catch (err) {
    res.status(409).json({ error: err instanceof Error ? err.message : 'Unable to delete trip expense.' });
  }
});

tripLedgerRouter.delete('/settlements/:settlementId', requireAuth, (req: AuthedRequest, res) => {
  const settlementId = Number(req.params.settlementId);
  const settlement = db.prepare(`SELECT s.ledger_id FROM trip_ledger_settlements s JOIN trip_ledgers l ON l.id = s.ledger_id WHERE s.id = ? AND l.user_id = ?`).get(settlementId, req.user!.id) as { ledger_id: number } | undefined;
  if (!settlement) { res.status(404).json({ error: 'Settlement record not found.' }); return; }
  db.transaction(() => {
    db.prepare('DELETE FROM trip_ledger_settlements WHERE id = ?').run(settlementId);
    db.prepare("UPDATE trip_ledgers SET updated_at = datetime('now') WHERE id = ?").run(settlement.ledger_id);
  })();
  res.json({ ok: true, ledgerId: settlement.ledger_id });
});

tripLedgerRouter.post('/:id/settlements', requireAuth, (req: AuthedRequest, res) => {
  const ledgerId = Number(req.params.id);
  if (!ownedLedger(ledgerId, req.user!.id)) { res.status(404).json({ error: 'Trip Ledger not found.' }); return; }
  const payerId = Number(req.body?.payerParticipantId);
  const receiverId = Number(req.body?.receiverParticipantId);
  const amountPaise = Number(req.body?.amountPaise);
  const settlementDate = String(req.body?.settlementDate ?? todayYmd());
  const note = String(req.body?.note ?? '').trim();
  const participantIds = new Set((db.prepare('SELECT id FROM trip_ledger_participants WHERE ledger_id = ?').all(ledgerId) as Array<{ id: number }>).map((p) => p.id));
  if (payerId === receiverId || !participantIds.has(payerId) || !participantIds.has(receiverId)) { res.status(400).json({ error: 'Choose two different participants from this trip.' }); return; }
  if (!Number.isSafeInteger(amountPaise) || amountPaise <= 0 || !validDate(settlementDate) || note.length > 250) { res.status(400).json({ error: 'Enter a valid settlement amount, date, and note.' }); return; }
  try {
    const id = Number(db.transaction(() => {
      const transfer = calculateLedgerSummary(ledgerId).transfers.find((t) => t.fromParticipantId === payerId && t.toParticipantId === receiverId);
      if (!transfer || amountPaise > transfer.amountPaise) throw new Error('Settlement cannot exceed the currently suggested amount between these participants.');
      const settlementId = Number(db.prepare('INSERT INTO trip_ledger_settlements (ledger_id, payer_participant_id, receiver_participant_id, amount_paise, settlement_date, note) VALUES (?, ?, ?, ?, ?, ?)').run(ledgerId, payerId, receiverId, amountPaise, settlementDate, note).lastInsertRowid);
      db.prepare("UPDATE trip_ledgers SET updated_at = datetime('now') WHERE id = ?").run(ledgerId);
      return settlementId;
    })());
    res.status(201).json({ settlementId: id });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Unable to record settlement.' });
  }
});
