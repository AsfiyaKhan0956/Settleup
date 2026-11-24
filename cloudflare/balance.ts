
import type { CloudflareEnv } from "./db.ts";
import { dbAll, dbFirst, dbRun } from "./db.ts";
import { hashToken, readSessionToken } from "./security.ts";

interface Env extends CloudflareEnv {
  SESSION_SECRET: string;
}

interface User {
  id: number;
  fullName: string;
}

const json = (data: unknown, status = 200) =>
  Response.json(data, { status });

function formatINR(paise: number): string {
  return `₹${(paise / 100).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;
}

async function getUser(request: Request, env: Env): Promise<User | null> {
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

  const row = await dbFirst<{ id: number; full_name: string }>(
    env.DB,
    "SELECT id, full_name FROM users WHERE id = ?",
    [session.user_id]
  );

  return row ? { id: row.id, fullName: row.full_name } : null;
}

async function membership(
  env: Env,
  groupId: number,
  userId: number
): Promise<{ role: string } | null> {
  return dbFirst(
    env.DB,
    "SELECT role FROM group_members WHERE group_id = ? AND user_id = ?",
    [groupId, userId]
  );
}

interface MemberBalance {
  userId: number;
  fullName: string;
  email: string;
  upiId: string | null;
  avatarUrl: string | null;
  paidPaise: number;
  owedPaise: number;
  settlementsPaidPaise: number;
  settlementsReceivedPaise: number;
  pendingIncomingPaise: number;
  pendingOutgoingPaise: number;
  netPaise: number;
}

interface Transfer {
  fromUserId: number;
  fromName: string;
  toUserId: number;
  toName: string;
  toUpiId: string | null;
  amountPaise: number;
}

async function computeGroupBalances(env: Env, groupId: number) {
  const rows = await dbAll<any>(
    env.DB,
    `SELECT u.id, u.full_name, u.email, u.upi_id,
            u.avatar_url, gm.role
     FROM group_members gm
     JOIN users u ON u.id = gm.user_id
     WHERE gm.group_id = ?
     ORDER BY gm.joined_at ASC`,
    [groupId]
  );

  const map = new Map<number, MemberBalance>();

  for (const row of rows) {
    map.set(row.id, {
      userId: row.id,
      fullName: row.full_name,
      email: row.email,
      upiId: row.upi_id,
      avatarUrl: row.avatar_url,
      paidPaise: 0,
      owedPaise: 0,
      settlementsPaidPaise: 0,
      settlementsReceivedPaise: 0,
      pendingIncomingPaise: 0,
      pendingOutgoingPaise: 0,
      netPaise: 0
    });
  }

  const expenses = await dbAll<any>(
    env.DB,
    "SELECT paid_by_user_id, total_paise FROM expenses WHERE group_id = ?",
    [groupId]
  );

  let totalExpenditurePaise = 0;

  for (const expense of expenses) {
    totalExpenditurePaise += expense.total_paise;
    const payer = map.get(expense.paid_by_user_id);
    if (payer) payer.paidPaise += expense.total_paise;
  }

  const splits = await dbAll<any>(
    env.DB,
    `SELECT es.user_id, es.owed_paise
     FROM expense_splits es
     JOIN expenses e ON e.id = es.expense_id
     WHERE e.group_id = ?`,
    [groupId]
  );

  for (const split of splits) {
    const member = map.get(split.user_id);
    if (member) member.owedPaise += split.owed_paise;
  }

  const settlements = await dbAll<any>(
    env.DB,
    `SELECT payer_user_id, receiver_user_id,
            amount_paise, status
     FROM settlements WHERE group_id = ?`,
    [groupId]
  );

  let confirmedSettledPaise = 0;

  for (const settlement of settlements) {
    const payer = map.get(settlement.payer_user_id);
    const receiver = map.get(settlement.receiver_user_id);

    if (settlement.status === "confirmed") {
      confirmedSettledPaise += settlement.amount_paise;
      if (payer) payer.settlementsPaidPaise += settlement.amount_paise;
      if (receiver) receiver.settlementsReceivedPaise += settlement.amount_paise;
    } else if (
      settlement.status === "recorded" ||
      settlement.status === "pending"
    ) {
      if (payer) payer.pendingOutgoingPaise += settlement.amount_paise;
      if (receiver) receiver.pendingIncomingPaise += settlement.amount_paise;
    }
  }

  const members = Array.from(map.values()).map(member => ({
    ...member,
    netPaise:
      member.paidPaise -
      member.owedPaise +
      member.settlementsPaidPaise -
      member.settlementsReceivedPaise
  }));

  // Greedy minimum-transfer simplification.
  const debtors = members
    .filter(member => member.netPaise < 0)
    .map(member => ({
      userId: member.userId,
      name: member.fullName,
      amount: -member.netPaise
    }));

  const creditors = members
    .filter(member => member.netPaise > 0)
    .map(member => ({
      userId: member.userId,
      name: member.fullName,
      upiId: member.upiId,
      amount: member.netPaise
    }));

  const transfers: Transfer[] = [];
  let i = 0;
  let j = 0;

  while (i < debtors.length && j < creditors.length) {
    const amount = Math.min(debtors[i].amount, creditors[j].amount);

    if (amount > 0) {
      transfers.push({
        fromUserId: debtors[i].userId,
        fromName: debtors[i].name,
        toUserId: creditors[j].userId,
        toName: creditors[j].name,
        toUpiId: creditors[j].upiId,
        amountPaise: amount
      });
    }

    debtors[i].amount -= amount;
    creditors[j].amount -= amount;

    if (debtors[i].amount === 0) i++;
    if (creditors[j].amount === 0) j++;
  }

  return {
    members,
    transfers,
    totalExpenditurePaise,
    confirmedSettledPaise
  };
}

async function overview(env: Env, userId: number): Promise<Response> {
  const groups = await dbAll<any>(
    env.DB,
    `SELECT g.id, g.name, g.category, g.cover_color
     FROM groups g
     JOIN group_members gm ON gm.group_id = g.id
     WHERE gm.user_id = ? AND g.is_archived = 0`,
    [userId]
  );

  let totalIOwePaise = 0;
  let totalOwedToMePaise = 0;
  let totalGroupExpenditurePaise = 0;
  let myTotalContributionsPaise = 0;

  const groupSummaries = [];
  const suggestedTransfers: any[] = [];

  for (const group of groups) {
    const result = await computeGroupBalances(env, group.id);
    const me = result.members.find(member => member.userId === userId);
    const myNet = me?.netPaise ?? 0;

    if (myNet < 0) totalIOwePaise += Math.abs(myNet);
    if (myNet > 0) totalOwedToMePaise += myNet;

    totalGroupExpenditurePaise += result.totalExpenditurePaise;
    myTotalContributionsPaise += me?.paidPaise ?? 0;

    groupSummaries.push({
      groupId: group.id,
      groupName: group.name,
      category: group.category,
      coverColor: group.cover_color,
      totalExpenditurePaise: result.totalExpenditurePaise,
      confirmedSettledPaise: result.confirmedSettledPaise,
      myPaidPaise: me?.paidPaise ?? 0,
      myOwedPaise: me?.owedPaise ?? 0,
      myNetPaise: myNet,
      members: result.members,
      transfers: result.transfers
    });

    for (const transfer of result.transfers) {
      if (
        transfer.fromUserId === userId ||
        transfer.toUserId === userId
      ) {
        suggestedTransfers.push({
          groupId: group.id,
          groupName: group.name,
          ...transfer
        });
      }
    }
  }

  const settlements = await dbAll<any>(
    env.DB,
    `SELECT s.*, g.name AS group_name,
            p.full_name AS payer_name,
            r.full_name AS receiver_name,
            r.upi_id AS receiver_upi_id
     FROM settlements s
     JOIN groups g ON g.id = s.group_id
     JOIN group_members gm ON gm.group_id = g.id AND gm.user_id = ?
     JOIN users p ON p.id = s.payer_user_id
     JOIN users r ON r.id = s.receiver_user_id
     ORDER BY s.created_at DESC, s.id DESC`,
    [userId]
  );

  const pendingSettlementsCount = settlements.filter(
    settlement =>
      settlement.status !== "confirmed" &&
      (settlement.payer_user_id === userId ||
        settlement.receiver_user_id === userId)
  ).length;

  return json({
    summary: {
      totalIOwePaise,
      totalOwedToMePaise,
      netBalancePaise: totalOwedToMePaise - totalIOwePaise,
      totalGroupExpenditurePaise,
      myTotalContributionsPaise,
      pendingSettlementsCount
    },
    groupSummaries,
    suggestedTransfers,
    settlements
  });
}

async function createUpiQr(
  request: Request,
  env: Env,
  userId: number
): Promise<Response> {
  const body = await request.json() as {
    groupId?: number;
    receiverUserId?: number;
    amountPaise?: number;
    note?: string;
  };

  const groupId = Number(body.groupId);
  const receiverId = Number(body.receiverUserId);
  const amount = Math.round(Number(body.amountPaise ?? 0));

  if (
    !await membership(env, groupId, userId) ||
    !await membership(env, groupId, receiverId)
  ) {
    return json({
      error: "Both payer and receiver must belong to the group."
    }, 403);
  }

  if (amount <= 0) {
    return json({ error: "Settlement amount must be greater than ₹0." }, 400);
  }

  const receiver = await dbFirst<any>(
    env.DB,
    "SELECT id, full_name, upi_id FROM users WHERE id = ?",
    [receiverId]
  );

  if (!receiver) return json({ error: "Recipient not found." }, 404);

  const upiVpa = receiver.upi_id ||
    `${receiver.full_name.toLowerCase().replace(/[^a-z0-9]/g, "")}@upi`;

  const amountRupees = (amount / 100).toFixed(2);
  const reference = `SU-${groupId}-${Date.now().toString().slice(-6)}`;
  const note = (body.note || `SettleUp ${reference}`).slice(0, 50);

  const upiUri =
    `upi://pay?pa=${encodeURIComponent(upiVpa)}` +
    `&pn=${encodeURIComponent(receiver.full_name)}` +
    `&am=${amountRupees}&cu=INR` +
    `&tn=${encodeURIComponent(note)}` +
    `&tr=${encodeURIComponent(reference)}`;

  // The Worker returns the UPI payment URI. QR image generation
  // will be connected separately for the Cloudflare environment.
  return json({
    upiUri,
    upiVpa,
    hasConfiguredUpi: Boolean(receiver.upi_id),
    receiverName: receiver.full_name,
    amountPaise: amount,
    amountRupees,
    paymentReference: reference,
    qrDataUrl: null
  });
}

async function createSettlement(
  request: Request,
  env: Env,
  userId: number
): Promise<Response> {
  const body = await request.json() as {
    groupId?: number;
    payerUserId?: number;
    receiverUserId?: number;
    amountPaise?: number;
    paymentMethod?: string;
    referenceCode?: string;
    notes?: string;
    upiUri?: string;
  };

  const groupId = Number(body.groupId);
  const payerId = Number(body.payerUserId);
  const receiverId = Number(body.receiverUserId);
  const amount = Math.round(Number(body.amountPaise ?? 0));

  if (
    !await membership(env, groupId, userId) ||
    !await membership(env, groupId, payerId) ||
    !await membership(env, groupId, receiverId)
  ) {
    return json({
      error: "All settlement participants must belong to the selected group."
    }, 403);
  }

  if (payerId === receiverId) {
    return json({
      error: "Payer and receiver cannot be the same person."
    }, 400);
  }

  if (amount <= 0) {
    return json({
      error: "Settlement amount must be greater than ₹0."
    }, 400);
  }

  const payer = await dbFirst<any>(
    env.DB,
    "SELECT full_name FROM users WHERE id = ?",
    [payerId]
  );

  const receiver = await dbFirst<any>(
    env.DB,
    "SELECT full_name FROM users WHERE id = ?",
    [receiverId]
  );

  if (!payer || !receiver) {
    return json({ error: "Settlement participant not found." }, 404);
  }

  // A payer's record awaits recipient confirmation.
  // If the receiver records it, it starts confirmed.
  const status = userId === receiverId ? "confirmed" : "recorded";
  const confirmedAt = status === "confirmed"
    ? new Date().toISOString()
    : null;

  const result = await env.DB.prepare(
    `INSERT INTO settlements (
      group_id, payer_user_id, receiver_user_id, amount_paise,
      payment_method, reference_code, upi_uri, status, notes,
      created_by, confirmed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    groupId,
    payerId,
    receiverId,
    amount,
    body.paymentMethod || "UPI",
    (body.referenceCode ?? "").trim(),
    (body.upiUri ?? "").trim(),
    status,
    (body.notes ?? "").trim(),
    userId,
    confirmedAt
  ).run();

  const settlementId = Number(result.meta.last_row_id);

  const statements = [
    env.DB.prepare(
      `INSERT INTO activity_logs
       (group_id, user_id, action, entity_type, entity_id, summary)
       VALUES (?, ?, ?, 'settlement', ?, ?)`
    ).bind(
      groupId,
      userId,
      status === "confirmed"
        ? "settlement_confirmed"
        : "settlement_recorded",
      settlementId,
      `${payer.full_name} ${status === "confirmed" ? "settled" : "recorded payment of"} ${formatINR(amount)} to ${receiver.full_name}`
    )
  ];

  if (status === "recorded") {
    statements.push(
      env.DB.prepare(
        `INSERT INTO notifications
         (user_id, group_id, type, title, message, link_path)
         VALUES (?, ?, 'settlement_recorded', 'Confirm received payment', ?, '/settlements')`
      ).bind(
        receiverId,
        groupId,
        `${payer.full_name} recorded a ${formatINR(amount)} ${body.paymentMethod || "UPI"} payment${body.referenceCode ? ` (Ref: ${body.referenceCode.trim()})` : ""}. Please confirm once received.`
      )
    );
  } else {
    statements.push(
      env.DB.prepare(
        `INSERT INTO notifications
         (user_id, group_id, type, title, message, link_path)
         VALUES (?, ?, 'settlement_confirmed', 'Settlement confirmed', ?, '/settlements')`
      ).bind(
        payerId,
        groupId,
        `${receiver.full_name} confirmed your ${formatINR(amount)} settlement.`
      )
    );
  }

  await env.DB.batch(statements);

  return json({ settlementId, status }, 201);
}

async function confirmSettlement(
  env: Env,
  settlementId: number,
  userId: number
): Promise<Response> {
  const settlement = await dbFirst<any>(
    env.DB,
    "SELECT * FROM settlements WHERE id = ?",
    [settlementId]
  );

  if (!settlement) {
    return json({ error: "Settlement record not found." }, 404);
  }

  const groupMembership = await membership(
    env,
    settlement.group_id,
    userId
  );

  if (
    !groupMembership ||
    (settlement.receiver_user_id !== userId &&
      groupMembership.role !== "admin")
  ) {
    return json({
      error: "Only the payment recipient or a group admin can confirm receipt of this settlement."
    }, 403);
  }

  if (settlement.status === "confirmed") {
    return json({ ok: true, status: "confirmed" });
  }

  const payer = await dbFirst<any>(
    env.DB,
    "SELECT full_name FROM users WHERE id = ?",
    [settlement.payer_user_id]
  );

  const receiver = await dbFirst<any>(
    env.DB,
    "SELECT full_name FROM users WHERE id = ?",
    [settlement.receiver_user_id]
  );

  await env.DB.batch([
    env.DB.prepare(
      `UPDATE settlements
       SET status = 'confirmed', confirmed_at = datetime('now')
       WHERE id = ?`
    ).bind(settlementId),

    env.DB.prepare(
      `INSERT INTO activity_logs
       (group_id, user_id, action, entity_type, entity_id, summary)
       VALUES (?, ?, 'settlement_confirmed', 'settlement', ?, ?)`
    ).bind(
      settlement.group_id,
      userId,
      settlementId,
      `${receiver?.full_name ?? "Recipient"} confirmed ${formatINR(settlement.amount_paise)} settlement from ${payer?.full_name ?? "payer"}`
    ),

    env.DB.prepare(
      `INSERT INTO notifications
       (user_id, group_id, type, title, message, link_path)
       VALUES (?, ?, 'settlement_confirmed', 'Payment confirmed', ?, '/settlements')`
    ).bind(
      settlement.payer_user_id,
      settlement.group_id,
      `${receiver?.full_name ?? "Recipient"} confirmed receipt of ${formatINR(settlement.amount_paise)}.`
    )
  ]);

  return json({ ok: true, status: "confirmed" });
}

export async function handleBalances(
  request: Request,
  env: Env
): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";

  if (!path.startsWith("/api/balances")) return null;

  const user = await getUser(request, env);

  if (!user) {
    return json({
      error: "Authentication required. Please sign in."
    }, 401);
  }

  try {
    if (path === "/api/balances/overview" && request.method === "GET") {
      return await overview(env, user.id);
    }

    if (path === "/api/balances/upi-qr" && request.method === "POST") {
      return await createUpiQr(request, env, user.id);
    }

    if (path === "/api/balances/settlements" && request.method === "POST") {
      return await createSettlement(request, env, user.id);
    }

    const match = path.match(/^\/api\/balances\/settlements\/(\d+)\/confirm$/);

    if (match && request.method === "POST") {
      return await confirmSettlement(env, Number(match[1]), user.id);
    }

    return json({ error: "Route not found." }, 404);
  } catch (error) {
    return json({
      error: "An error occurred while processing balances.",
      details: error instanceof Error ? error.message : "Unknown error"
    }, 500);
  }
}
