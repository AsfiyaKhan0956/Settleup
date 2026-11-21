import { Router } from 'express';
import { db } from '../db.ts';
import { getMembership, requireAuth, type AuthedRequest } from '../middleware.ts';
import { formatINR, simplifyDebts, type MemberNetBalance } from '../math.ts';
import { isValidEmail, normalizePhone } from '../security.ts';

export const manualBalancesRouter = Router();

interface ManualBalanceRow {
  id: number;
  user_id: number;
  trip_ledger_id: number | null;
  external_participant_id: number | null;
  linked_user_id: number | null;
  person_name: string;
  contact_ref: string;
  participant_type: 'external' | 'registered';
  direction: 'to_pay' | 'to_receive';
  amount_paise: number;
  settled_paise: number;
  status: 'pending' | 'partially_settled' | 'settled';
  trip_name: string;
  description: string;
  entry_date: string;
  created_at: string;
  updated_at: string;
}

function buildManualSimplification(entries: ManualBalanceRow[]) {
  // Aggregate net remaining balance per unique participant key so SettleUp's existing simplifyDebts algorithm applies cleanly
  const netByPerson = new Map<
    string,
    {
      syntheticId: number;
      fullName: string;
      participantType: 'external' | 'registered';
      linkedUserId: number | null;
      netPaise: number;
    }
  >();

  let nextSyntheticId = 1;
  let totalToPayPaise = 0;
  let totalToReceivePaise = 0;
  let remainingToPayPaise = 0;
  let remainingToReceivePaise = 0;

  for (const e of entries) {
    const remaining = Math.max(0, e.amount_paise - e.settled_paise);
    if (e.direction === 'to_pay') {
      totalToPayPaise += e.amount_paise;
      remainingToPayPaise += remaining;
    } else {
      totalToReceivePaise += e.amount_paise;
      remainingToReceivePaise += remaining;
    }

    if (remaining === 0) continue;

    const key = e.linked_user_id
      ? `reg:${e.linked_user_id}`
      : `ext:${e.person_name.trim().toLowerCase()}`;
    const existing = netByPerson.get(key) ?? {
      syntheticId: e.linked_user_id ? e.linked_user_id + 100000 : nextSyntheticId++,
      fullName: `${e.person_name.trim()}${e.participant_type === 'external' && !e.linked_user_id ? ' (External)' : ''}`,
      participantType: e.linked_user_id ? 'registered' : e.participant_type,
      linkedUserId: e.linked_user_id,
      netPaise: 0,
    };

    existing.netPaise += e.direction === 'to_receive' ? remaining : -remaining;
    netByPerson.set(key, existing);
  }

  const pseudoBalances: MemberNetBalance[] = Array.from(netByPerson.values()).map((p) => ({
    userId: p.syntheticId,
    fullName: p.fullName,
    email: '',
    upiId: null,
    avatarUrl: null,
    paidPaise: p.netPaise > 0 ? p.netPaise : 0,
    owedPaise: p.netPaise < 0 ? Math.abs(p.netPaise) : 0,
    settlementsPaidPaise: 0,
    settlementsReceivedPaise: 0,
    pendingIncomingPaise: 0,
    pendingOutgoingPaise: 0,
    netPaise: p.netPaise,
  }));

  const transfers = simplifyDebts(pseudoBalances);
  const imbalancePaise = remainingToReceivePaise - remainingToPayPaise;

  return {
    totalToPayPaise,
    totalToReceivePaise,
    remainingToPayPaise,
    remainingToReceivePaise,
    imbalancePaise,
    isBalanced: imbalancePaise === 0,
    transfers,
  };
}

manualBalancesRouter.get('/ledgers', requireAuth, (req: AuthedRequest, res) => {
  const userId = req.user!.id;
  const ledgers = db
    .prepare(`
      SELECT t.*, g.name AS group_name
      FROM trip_ledgers t
      LEFT JOIN groups g ON g.id = t.group_id
      WHERE t.user_id = ?
      ORDER BY t.event_date DESC, t.id DESC
    `)
    .all(userId) as Array<{
    id: number;
    user_id: number;
    group_id: number | null;
    group_name: string | null;
    title: string;
    description: string;
    event_date: string;
    created_at: string;
  }>;

  const enriched = ledgers.map((l) => {
    const entries = db
      .prepare('SELECT * FROM manual_balances WHERE trip_ledger_id = ? AND user_id = ?')
      .all(l.id, userId) as ManualBalanceRow[];
    const calc = buildManualSimplification(entries);
    return {
      ...l,
      entryCount: entries.length,
      ...calc,
    };
  });

  res.json({ ledgers: enriched });
});

manualBalancesRouter.post('/ledgers', requireAuth, (req: AuthedRequest, res) => {
  const userId = req.user!.id;
  const { title, description, eventDate, groupId } = req.body as {
    title?: string;
    description?: string;
    eventDate?: string;
    groupId?: number | null;
  };

  const cleanTitle = (title ?? '').trim();
  if (cleanTitle.length < 2 || cleanTitle.length > 100) {
    res.status(400).json({ error: 'Trip or ledger title must be between 2 and 100 characters.' });
    return;
  }

  if (groupId && !getMembership(Number(groupId), userId)) {
    res.status(403).json({ error: 'You can only link groups you belong to.' });
    return;
  }

  const cleanDate =
    eventDate && /^\d{4}-\d{2}-\d{2}$/.test(eventDate)
      ? eventDate
      : todayYmd();

  const ledgerId = Number(
    db
      .prepare(`
        INSERT INTO trip_ledgers (user_id, group_id, title, description, event_date)
        VALUES (?, ?, ?, ?, ?)
      `)
      .run(userId, groupId ? Number(groupId) : null, cleanTitle, (description ?? '').trim(), cleanDate).lastInsertRowid
  );

  res.status(201).json({ ledgerId });
});

manualBalancesRouter.delete('/ledgers/:id', requireAuth, (req: AuthedRequest, res) => {
  const info = db
    .prepare('DELETE FROM trip_ledgers WHERE id = ? AND user_id = ?')
    .run(Number(req.params.id), req.user!.id);
  if (info.changes === 0) {
    res.status(404).json({ error: 'Trip ledger not found.' });
    return;
  }
  res.json({ ok: true });
});

manualBalancesRouter.get('/ledgers/:id', requireAuth, (req: AuthedRequest, res) => {
  const userId = req.user!.id;
  const ledgerId = Number(req.params.id);

  const ledger = db
    .prepare(`
      SELECT t.*, g.name AS group_name
      FROM trip_ledgers t
      LEFT JOIN groups g ON g.id = t.group_id
      WHERE t.id = ? AND t.user_id = ?
    `)
    .get(ledgerId, userId) as
    | {
        id: number;
        user_id: number;
        group_id: number | null;
        group_name: string | null;
        title: string;
        description: string;
        event_date: string;
      }
    | undefined;

  if (!ledger) {
    res.status(404).json({ error: 'Trip ledger not found.' });
    return;
  }

  const entries = db
    .prepare(`
      SELECT *
      FROM manual_balances
      WHERE trip_ledger_id = ? AND user_id = ?
      ORDER BY entry_date DESC, id DESC
    `)
    .all(ledgerId, userId) as ManualBalanceRow[];

  const participants = db
    .prepare(`
      SELECT ep.id, ep.display_name, ep.phone, ep.email, ep.linked_user_id, ep.notes, ep.created_at,
             u.full_name AS linked_user_name
      FROM external_participants ep
      LEFT JOIN users u ON u.id = ep.linked_user_id
      WHERE ep.trip_ledger_id = ? AND ep.user_id = ?
      ORDER BY ep.display_name ASC
    `)
    .all(ledgerId, userId);

  const events = db
    .prepare(`
      SELECT *
      FROM manual_balance_events
      WHERE trip_ledger_id = ? AND user_id = ?
      ORDER BY created_at DESC, id DESC
      LIMIT 40
    `)
    .all(ledgerId, userId);

  const summary = buildManualSimplification(entries);

  res.json({
    ledger,
    entries,
    participants,
    events,
    summary,
  });
});

manualBalancesRouter.post('/ledgers/:id/entries', requireAuth, (req: AuthedRequest, res) => {
  const userId = req.user!.id;
  const ledgerId = Number(req.params.id);

  const ledger = db
    .prepare('SELECT id, title FROM trip_ledgers WHERE id = ? AND user_id = ?')
    .get(ledgerId, userId) as { id: number; title: string } | undefined;
  if (!ledger) {
    res.status(404).json({ error: 'Trip ledger not found.' });
    return;
  }

  const {
    personName,
    direction,
    amountPaise,
    contactRef,
    description,
    entryDate,
    participantType,
    allowDuplicate,
  } = req.body as {
    personName?: string;
    direction?: 'to_pay' | 'to_receive';
    amountPaise?: number;
    contactRef?: string;
    description?: string;
    entryDate?: string;
    participantType?: 'external' | 'registered';
    allowDuplicate?: boolean;
  };

  const cleanName = (personName ?? '').trim();
  const cleanAmt = Math.round(Number(amountPaise ?? 0));
  const cleanContact = (contactRef ?? '').trim();
  const cleanDesc = (description ?? '').trim();
  const cleanDate =
    entryDate && /^\d{4}-\d{2}-\d{2}$/.test(entryDate)
      ? entryDate
      : todayYmd();

  if (cleanName.length < 2 || cleanName.length > 80) {
    res.status(400).json({ error: "Person's name must be between 2 and 80 characters." });
    return;
  }
  if (direction !== 'to_pay' && direction !== 'to_receive') {
    res.status(400).json({ error: 'Specify whether the person has to pay or receive.' });
    return;
  }
  if (!Number.isFinite(cleanAmt) || cleanAmt <= 0) {
    res.status(400).json({ error: 'Amount must be greater than ₹0.' });
    return;
  }

  // Prevent accidental duplicate entry unless explicitly confirmed
  if (!allowDuplicate) {
    const dup = db
      .prepare(`
        SELECT id FROM manual_balances
        WHERE trip_ledger_id = ? AND user_id = ?
          AND lower(person_name) = ? AND direction = ? AND amount_paise = ? AND entry_date = ?
          AND lower(description) = ? AND status <> 'settled'
      `)
      .get(ledgerId, userId, cleanName.toLowerCase(), direction, cleanAmt, cleanDate, cleanDesc.toLowerCase());
    if (dup) {
      res.status(409).json({
        error: `A matching entry (${cleanName} · ${direction === 'to_pay' ? 'to pay' : 'to receive'} · ${formatINR(cleanAmt)}) already exists on ${cleanDate}.`,
        code: 'DUPLICATE_MANUAL_BALANCE',
      });
      return;
    }
  }

  // Only associate with a registered SettleUp user if user is self or shares a group membership (privacy guardrail!)
  let linkedUserId: number | null = null;
  let resolvedType: 'external' | 'registered' = participantType === 'registered' ? 'registered' : 'external';

  if (cleanName.toLowerCase() === req.user!.fullName.toLowerCase() || cleanContact.toLowerCase() === req.user!.email.toLowerCase()) {
    linkedUserId = userId;
    resolvedType = 'registered';
  } else if (cleanContact && isValidEmail(cleanContact)) {
    const sharedMember = db
      .prepare(`
        SELECT u.id FROM users u
        JOIN group_members gm1 ON gm1.user_id = u.id
        JOIN group_members gm2 ON gm2.group_id = gm1.group_id AND gm2.user_id = ?
        WHERE lower(u.email) = ?
        LIMIT 1
      `)
      .get(userId, cleanContact.toLowerCase()) as { id: number } | undefined;
    if (sharedMember) {
      linkedUserId = sharedMember.id;
      resolvedType = 'registered';
    }
  }

  const normalizedContactPhone = cleanContact && !cleanContact.includes('@') ? normalizePhone(cleanContact) : null;

  const entryId = db.transaction(() => {
    let extParticipantId: number | null = null;
    if (!linkedUserId) {
      const existingExt = db
        .prepare(`
          SELECT id FROM external_participants
          WHERE trip_ledger_id = ? AND user_id = ? AND lower(display_name) = ?
        `)
        .get(ledgerId, userId, cleanName.toLowerCase()) as { id: number } | undefined;
      if (existingExt) {
        extParticipantId = existingExt.id;
      } else {
        extParticipantId = Number(
          db
            .prepare(`
              INSERT INTO external_participants (user_id, trip_ledger_id, display_name, phone, email)
              VALUES (?, ?, ?, ?, ?)
            `)
            .run(
              userId,
              ledgerId,
              cleanName,
              normalizedContactPhone,
              isValidEmail(cleanContact) ? cleanContact.toLowerCase() : null
            ).lastInsertRowid
        );
      }
    }

    const newId = Number(
      db
        .prepare(`
          INSERT INTO manual_balances (
            user_id, trip_ledger_id, external_participant_id, linked_user_id,
            person_name, contact_ref, participant_type, direction, amount_paise,
            settled_paise, status, trip_name, description, entry_date
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'pending', ?, ?, ?)
        `)
        .run(
          userId,
          ledgerId,
          extParticipantId,
          linkedUserId,
          cleanName,
          cleanContact,
          resolvedType,
          direction,
          cleanAmt,
          ledger.title,
          cleanDesc,
          cleanDate
        ).lastInsertRowid
    );

    db.prepare(`
      INSERT INTO manual_balance_events (user_id, manual_balance_id, trip_ledger_id, action, amount_paise, note)
      VALUES (?, ?, ?, 'entry_added', ?, ?)
    `).run(
      userId,
      newId,
      ledgerId,
      cleanAmt,
      `Added ${cleanName} (${resolvedType}): ${direction === 'to_pay' ? 'to pay' : 'to receive'} ${formatINR(cleanAmt)}${cleanDesc ? ` — ${cleanDesc}` : ''}`
    );

    return newId;
  })();

  res.status(201).json({ entryId });
});

manualBalancesRouter.patch('/entries/:entryId', requireAuth, (req: AuthedRequest, res) => {
  const userId = req.user!.id;
  const entryId = Number(req.params.entryId);

  const existing = db
    .prepare('SELECT * FROM manual_balances WHERE id = ? AND user_id = ?')
    .get(entryId, userId) as ManualBalanceRow | undefined;

  if (!existing) {
    res.status(404).json({ error: 'Manual balance entry not found.' });
    return;
  }

  const {
    personName,
    direction,
    amountPaise,
    contactRef,
    description,
    entryDate,
    recordSettlementPaise,
    markSettled,
  } = req.body as {
    personName?: string;
    direction?: 'to_pay' | 'to_receive';
    amountPaise?: number;
    contactRef?: string;
    description?: string;
    entryDate?: string;
    recordSettlementPaise?: number;
    markSettled?: boolean;
  };

  db.transaction(() => {
    if (markSettled) {
      const remaining = Math.max(0, existing.amount_paise - existing.settled_paise);
      db.prepare(`
        UPDATE manual_balances
        SET settled_paise = amount_paise, status = 'settled', updated_at = datetime('now')
        WHERE id = ? AND user_id = ?
      `).run(entryId, userId);

      db.prepare(`
        INSERT INTO manual_balance_events (user_id, manual_balance_id, trip_ledger_id, action, amount_paise, note)
        VALUES (?, ?, ?, 'marked_settled', ?, ?)
      `).run(
        userId,
        entryId,
        existing.trip_ledger_id,
        remaining,
        `Marked ${existing.person_name}'s balance (${formatINR(existing.amount_paise)}) as manually settled`
      );
      return;
    }

    if (recordSettlementPaise !== undefined) {
      const payAmt = Math.round(Number(recordSettlementPaise));
      if (!Number.isFinite(payAmt) || payAmt <= 0) {
        throw new Error('Settlement payment must be greater than ₹0.');
      }
      const nextSettled = Math.min(existing.amount_paise, existing.settled_paise + payAmt);
      const nextStatus =
        nextSettled >= existing.amount_paise
          ? 'settled'
          : nextSettled > 0
          ? 'partially_settled'
          : 'pending';

      db.prepare(`
        UPDATE manual_balances
        SET settled_paise = ?, status = ?, updated_at = datetime('now')
        WHERE id = ? AND user_id = ?
      `).run(nextSettled, nextStatus, entryId, userId);

      db.prepare(`
        INSERT INTO manual_balance_events (user_id, manual_balance_id, trip_ledger_id, action, amount_paise, note)
        VALUES (?, ?, ?, 'manual_settlement', ?, ?)
      `).run(
        userId,
        entryId,
        existing.trip_ledger_id,
        payAmt,
        `Recorded manual ${nextStatus === 'settled' ? 'full' : 'partial'} settlement of ${formatINR(payAmt)} for ${existing.person_name}`
      );
      return;
    }

    const nextName = personName !== undefined && personName.trim() ? personName.trim() : existing.person_name;
    const nextDir = direction === 'to_pay' || direction === 'to_receive' ? direction : existing.direction;
    const nextAmt = amountPaise !== undefined && amountPaise > 0 ? Math.round(amountPaise) : existing.amount_paise;
    const clampedSettled = Math.min(existing.settled_paise, nextAmt);
    const nextStatus =
      clampedSettled >= nextAmt ? 'settled' : clampedSettled > 0 ? 'partially_settled' : 'pending';

    db.prepare(`
      UPDATE manual_balances
      SET person_name = ?, direction = ?, amount_paise = ?, settled_paise = ?, status = ?,
          contact_ref = ?, description = ?, entry_date = ?, updated_at = datetime('now')
      WHERE id = ? AND user_id = ?
    `).run(
      nextName,
      nextDir,
      nextAmt,
      clampedSettled,
      nextStatus,
      contactRef !== undefined ? contactRef.trim() : existing.contact_ref,
      description !== undefined ? description.trim() : existing.description,
      entryDate && /^\d{4}-\d{2}-\d{2}$/.test(entryDate) ? entryDate : existing.entry_date,
      entryId,
      userId
    );

    db.prepare(`
      INSERT INTO manual_balance_events (user_id, manual_balance_id, trip_ledger_id, action, amount_paise, note)
      VALUES (?, ?, ?, 'entry_updated', ?, ?)
    `).run(userId, entryId, existing.trip_ledger_id, nextAmt, `Updated entry for ${nextName} (${formatINR(nextAmt)})`);
  })();

  res.json({ ok: true });
});

manualBalancesRouter.delete('/entries/:entryId', requireAuth, (req: AuthedRequest, res) => {
  const userId = req.user!.id;
  const entryId = Number(req.params.entryId);

  const existing = db
    .prepare('SELECT * FROM manual_balances WHERE id = ? AND user_id = ?')
    .get(entryId, userId) as ManualBalanceRow | undefined;

  if (!existing) {
    res.status(404).json({ error: 'Manual balance entry not found.' });
    return;
  }

  db.transaction(() => {
    db.prepare('DELETE FROM manual_balances WHERE id = ? AND user_id = ?').run(entryId, userId);
    db.prepare(`
      INSERT INTO manual_balance_events (user_id, manual_balance_id, trip_ledger_id, action, amount_paise, note)
      VALUES (?, NULL, ?, 'entry_removed', ?, ?)
    `).run(
      userId,
      existing.trip_ledger_id,
      existing.amount_paise,
      `Removed entry for ${existing.person_name} (${formatINR(existing.amount_paise)})`
    );
  })();

  res.json({ ok: true });
});

/**
 * Safely associates an external participant record with a verified co-member SettleUp account
 * (never leaks arbitrary user directory records; requires shared group membership).
 */
manualBalancesRouter.post('/participants/:participantId/link', requireAuth, (req: AuthedRequest, res) => {
  const userId = req.user!.id;
  const participantId = Number(req.params.participantId);
  const { targetEmail } = req.body as { targetEmail?: string };
  const cleanEmail = (targetEmail ?? '').trim().toLowerCase();

  if (!isValidEmail(cleanEmail)) {
    res.status(400).json({ error: 'Enter the verified email address of the registered SettleUp user.' });
    return;
  }

  const ext = db
    .prepare('SELECT * FROM external_participants WHERE id = ? AND user_id = ?')
    .get(participantId, userId) as { id: number; display_name: string; trip_ledger_id: number } | undefined;

  if (!ext) {
    res.status(404).json({ error: 'External participant not found.' });
    return;
  }

  // Only allow linking to self OR a verified member of a shared SettleUp group
  const targetUser = db
    .prepare(`
      SELECT u.id, u.full_name
      FROM users u
      WHERE lower(u.email) = ?
        AND (
          u.id = ?
          OR EXISTS (
            SELECT 1 FROM group_members gm1
            JOIN group_members gm2 ON gm2.group_id = gm1.group_id
            WHERE gm1.user_id = u.id AND gm2.user_id = ?
          )
        )
      LIMIT 1
    `)
    .get(cleanEmail, userId, userId) as { id: number; full_name: string } | undefined;

  if (!targetUser) {
    res.status(404).json({
      error:
        'No shared group member matches that email. Invite them to a SettleUp group first so their account is mutually verified.',
    });
    return;
  }

  db.transaction(() => {
    db.prepare('UPDATE external_participants SET linked_user_id = ?, email = ? WHERE id = ?').run(
      targetUser.id,
      cleanEmail,
      ext.id
    );
    db.prepare(`
      UPDATE manual_balances
      SET linked_user_id = ?, participant_type = 'registered', updated_at = datetime('now')
      WHERE external_participant_id = ? AND user_id = ?
    `).run(targetUser.id, ext.id, userId);

    db.prepare(`
      INSERT INTO manual_balance_events (user_id, trip_ledger_id, action, amount_paise, note)
      VALUES (?, ?, 'participant_linked', 0, ?)
    `).run(userId, ext.trip_ledger_id, `Linked external contact "${ext.display_name}" to verified member ${targetUser.full_name}`);
  })();

  res.json({ ok: true, linkedUserName: targetUser.full_name });
});
