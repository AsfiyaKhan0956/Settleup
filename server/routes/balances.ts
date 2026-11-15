import { Router } from 'express';
import QRCode from 'qrcode';
import { db } from '../db.ts';
import { computeGroupBalances, getMembership, requireAuth, type AuthedRequest } from '../middleware.ts';
import { formatINR } from '../math.ts';

export const balancesRouter = Router();

balancesRouter.get('/overview', requireAuth, (req: AuthedRequest, res) => {
  const userId = req.user!.id;

  const userGroups = db
    .prepare(`
      SELECT g.id, g.name, g.category, g.cover_color
      FROM groups g
      JOIN group_members gm ON gm.group_id = g.id
      WHERE gm.user_id = ? AND g.is_archived = 0
    `)
    .all(userId) as Array<{ id: number; name: string; category: string; cover_color: string }>;

  let totalIOwePaise = 0;
  let totalOwedToMePaise = 0;
  let totalGroupExpenditurePaise = 0;
  let myTotalContributionsPaise = 0;

  const groupSummaries = [];
  const suggestedTransfers: Array<{
    groupId: number;
    groupName: string;
    fromUserId: number;
    fromName: string;
    toUserId: number;
    toName: string;
    toUpiId: string | null;
    amountPaise: number;
  }> = [];

  for (const g of userGroups) {
    const { members, transfers, totalExpenditurePaise, confirmedSettledPaise } = computeGroupBalances(g.id);
    const me = members.find((m) => m.userId === userId);
    const myNet = me?.netPaise ?? 0;

    if (myNet < 0) totalIOwePaise += Math.abs(myNet);
    if (myNet > 0) totalOwedToMePaise += myNet;
    totalGroupExpenditurePaise += totalExpenditurePaise;
    myTotalContributionsPaise += me?.paidPaise ?? 0;

    groupSummaries.push({
      groupId: g.id,
      groupName: g.name,
      category: g.category,
      coverColor: g.cover_color,
      totalExpenditurePaise,
      confirmedSettledPaise,
      myPaidPaise: me?.paidPaise ?? 0,
      myOwedPaise: me?.owedPaise ?? 0,
      myNetPaise: myNet,
      members,
      transfers,
    });

    for (const t of transfers) {
      if (t.fromUserId === userId || t.toUserId === userId) {
        suggestedTransfers.push({
          groupId: g.id,
          groupName: g.name,
          ...t,
        });
      }
    }
  }

  const settlements = db
    .prepare(`
      SELECT s.*, g.name AS group_name, p.full_name AS payer_name, r.full_name AS receiver_name,
             r.upi_id AS receiver_upi_id
      FROM settlements s
      JOIN groups g ON g.id = s.group_id
      JOIN group_members gm ON gm.group_id = g.id AND gm.user_id = ?
      JOIN users p ON p.id = s.payer_user_id
      JOIN users r ON r.id = s.receiver_user_id
      ORDER BY s.created_at DESC, s.id DESC
    `)
    .all(userId) as Array<{
    id: number;
    group_id: number;
    group_name: string;
    payer_user_id: number;
    payer_name: string;
    receiver_user_id: number;
    receiver_name: string;
    receiver_upi_id: string | null;
    amount_paise: number;
    payment_method: string;
    reference_code: string;
    status: string;
    notes: string;
    created_at: string;
    confirmed_at: string | null;
  }>;

  const pendingSettlementsCount = settlements.filter(
    (s) => s.status !== 'confirmed' && (s.payer_user_id === userId || s.receiver_user_id === userId)
  ).length;

  res.json({
    summary: {
      totalIOwePaise,
      totalOwedToMePaise,
      netBalancePaise: totalOwedToMePaise - totalIOwePaise,
      totalGroupExpenditurePaise,
      myTotalContributionsPaise,
      pendingSettlementsCount,
    },
    groupSummaries,
    suggestedTransfers,
    settlements,
  });
});

balancesRouter.post('/upi-qr', requireAuth, async (req: AuthedRequest, res) => {
  const { groupId, receiverUserId, amountPaise, note } = req.body as {
    groupId?: number;
    receiverUserId?: number;
    amountPaise?: number;
    note?: string;
  };

  const gId = Number(groupId);
  const rId = Number(receiverUserId);
  const amt = Math.round(Number(amountPaise ?? 0));

  if (!getMembership(gId, req.user!.id) || !getMembership(gId, rId)) {
    res.status(403).json({ error: 'Both payer and receiver must belong to the group.' });
    return;
  }

  if (amt <= 0) {
    res.status(400).json({ error: 'Settlement amount must be greater than ₹0.' });
    return;
  }

  const receiver = db
    .prepare('SELECT id, full_name, upi_id FROM users WHERE id = ?')
    .get(rId) as { id: number; full_name: string; upi_id: string | null } | undefined;

  if (!receiver) {
    res.status(404).json({ error: 'Recipient not found.' });
    return;
  }

  const upiVpa = receiver.upi_id || `${receiver.full_name.toLowerCase().replace(/[^a-z0-9]/g, '')}@upi`;
  const amountRupees = (amt / 100).toFixed(2);
  const refTag = `SU-${gId}-${Date.now().toString().slice(-6)}`;
  const cleanNote = (note || `SettleUp ${refTag}`).slice(0, 50);

  const upiUri = `upi://pay?pa=${encodeURIComponent(upiVpa)}&pn=${encodeURIComponent(
    receiver.full_name
  )}&am=${amountRupees}&cu=INR&tn=${encodeURIComponent(cleanNote)}&tr=${encodeURIComponent(refTag)}`;

  const qrDataUrl = await QRCode.toDataURL(upiUri, {
    width: 260,
    margin: 1,
    color: { dark: '#0F172A', light: '#FFFFFF' },
  });

  res.json({
    upiUri,
    upiVpa,
    hasConfiguredUpi: Boolean(receiver.upi_id),
    receiverName: receiver.full_name,
    amountPaise: amt,
    amountRupees,
    paymentReference: refTag,
    qrDataUrl,
  });
});

balancesRouter.post('/settlements', requireAuth, (req: AuthedRequest, res) => {
  const userId = req.user!.id;
  const { groupId, payerUserId, receiverUserId, amountPaise, paymentMethod, referenceCode, notes, upiUri } =
    req.body as {
      groupId?: number;
      payerUserId?: number;
      receiverUserId?: number;
      amountPaise?: number;
      paymentMethod?: string;
      referenceCode?: string;
      notes?: string;
      upiUri?: string;
    };

  const gId = Number(groupId);
  const pId = Number(payerUserId);
  const rId = Number(receiverUserId);
  const amt = Math.round(Number(amountPaise ?? 0));

  if (!getMembership(gId, userId) || !getMembership(gId, pId) || !getMembership(gId, rId)) {
    res.status(403).json({ error: 'All settlement participants must belong to the selected group.' });
    return;
  }
  if (pId === rId) {
    res.status(400).json({ error: 'Payer and receiver cannot be the same person.' });
    return;
  }
  if (amt <= 0) {
    res.status(400).json({ error: 'Settlement amount must be greater than ₹0.' });
    return;
  }

  const payer = db.prepare('SELECT full_name FROM users WHERE id = ?').get(pId) as { full_name: string };
  const receiver = db.prepare('SELECT full_name FROM users WHERE id = ?').get(rId) as { full_name: string };

  // Honest confirmation policy:
  // - If the receiver logs the settlement directly ("I received this"), it can start as 'confirmed'.
  // - If the payer logs it ("I paid via UPI/Cash"), it starts as 'recorded' until receiver confirms!
  const initialStatus = userId === rId ? 'confirmed' : 'recorded';
  const confirmedAt = initialStatus === 'confirmed' ? new Date().toISOString() : null;

  const settlementId = db.transaction(() => {
    const id = Number(
      db
        .prepare(`
          INSERT INTO settlements (
            group_id, payer_user_id, receiver_user_id, amount_paise,
            payment_method, reference_code, upi_uri, status, notes, created_by, confirmed_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          gId,
          pId,
          rId,
          amt,
          paymentMethod || 'UPI',
          (referenceCode ?? '').trim(),
          (upiUri ?? '').trim(),
          initialStatus,
          (notes ?? '').trim(),
          userId,
          confirmedAt
        ).lastInsertRowid
    );

    db.prepare(`
      INSERT INTO activity_logs (group_id, user_id, action, entity_type, entity_id, summary)
      VALUES (?, ?, ?, 'settlement', ?, ?)
    `).run(
      gId,
      userId,
      initialStatus === 'confirmed' ? 'settlement_confirmed' : 'settlement_recorded',
      id,
      `${payer.full_name} ${initialStatus === 'confirmed' ? 'settled' : 'recorded payment of'} ${formatINR(amt)} to ${receiver.full_name}`
    );

    if (initialStatus === 'recorded') {
      db.prepare(`
        INSERT INTO notifications (user_id, group_id, type, title, message, link_path)
        VALUES (?, ?, 'settlement_recorded', 'Confirm received payment', ?, '/settlements')
      `).run(
        rId,
        gId,
        `${payer.full_name} recorded a ${formatINR(amt)} ${paymentMethod || 'UPI'} payment${
          referenceCode ? ` (Ref: ${referenceCode.trim()})` : ''
        }. Please confirm once received.`
      );
    } else {
      db.prepare(`
        INSERT INTO notifications (user_id, group_id, type, title, message, link_path)
        VALUES (?, ?, 'settlement_confirmed', 'Settlement confirmed', ?, '/settlements')
      `).run(pId, gId, `${receiver.full_name} confirmed your ${formatINR(amt)} settlement.`);
    }

    return id;
  })();

  res.status(201).json({ settlementId, status: initialStatus });
});

balancesRouter.post('/settlements/:id/confirm', requireAuth, (req: AuthedRequest, res) => {
  const settlementId = Number(req.params.id);
  const userId = req.user!.id;

  const st = db.prepare('SELECT * FROM settlements WHERE id = ?').get(settlementId) as
    | {
        id: number;
        group_id: number;
        payer_user_id: number;
        receiver_user_id: number;
        amount_paise: number;
        status: string;
      }
    | undefined;

  if (!st) {
    res.status(404).json({ error: 'Settlement record not found.' });
    return;
  }

  const membership = getMembership(st.group_id, userId);
  if (!membership || (st.receiver_user_id !== userId && membership.role !== 'admin')) {
    res.status(403).json({
      error: 'Only the payment recipient or a group admin can confirm receipt of this settlement.',
    });
    return;
  }

  if (st.status === 'confirmed') {
    res.json({ ok: true, status: 'confirmed' });
    return;
  }

  const payer = db.prepare('SELECT full_name FROM users WHERE id = ?').get(st.payer_user_id) as {
    full_name: string;
  };
  const receiver = db.prepare('SELECT full_name FROM users WHERE id = ?').get(st.receiver_user_id) as {
    full_name: string;
  };

  db.transaction(() => {
    db.prepare("UPDATE settlements SET status = 'confirmed', confirmed_at = datetime('now') WHERE id = ?").run(
      settlementId
    );
    db.prepare(`
      INSERT INTO activity_logs (group_id, user_id, action, entity_type, entity_id, summary)
      VALUES (?, ?, 'settlement_confirmed', 'settlement', ?, ?)
    `).run(
      st.group_id,
      userId,
      settlementId,
      `${receiver.full_name} confirmed ${formatINR(st.amount_paise)} settlement from ${payer.full_name}`
    );
    db.prepare(`
      INSERT INTO notifications (user_id, group_id, type, title, message, link_path)
      VALUES (?, ?, 'settlement_confirmed', 'Payment confirmed', ?, '/settlements')
    `).run(
      st.payer_user_id,
      st.group_id,
      `${receiver.full_name} confirmed receipt of ${formatINR(st.amount_paise)}.`
    );
  })();

  res.json({ ok: true, status: 'confirmed' });
});
