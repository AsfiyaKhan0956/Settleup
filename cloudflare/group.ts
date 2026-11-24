
import type { CloudflareEnv } from "./db.ts";
import { dbAll, dbFirst, dbRun } from "./db.ts";
import { hashToken, readSessionToken, generateOpaqueToken, isValidEmail, normalizePhone } from "./security.ts";
import { sendInvitationEmails } from "./emailInvitations.ts";

interface Env extends CloudflareEnv {
  SESSION_SECRET: string;
  CANONICAL_APP_URL?: string;
  APPS_SCRIPT_URL?: string;
  EMAIL_INTEGRATION_SECRET?: string;
}

interface User {
  id: number;
  fullName: string;
  email: string;
  phone: string | null;
}

const json = (data: unknown, status = 200) =>
  Response.json(data, { status });

const noStoreJson = (data: unknown, status = 200, extraHeaders: Record<string, string> = {}) => {
  const response = Response.json(data, { status });
  response.headers.set("Cache-Control", "no-store");
  for (const [name, value] of Object.entries(extraHeaders)) response.headers.set(name, value);
  return response;
};

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

  const user = await dbFirst<any>(
    env.DB,
    "SELECT id, full_name, email, phone FROM users WHERE id = ?",
    [session.user_id]
  );

  return user ? {
    id: user.id,
    fullName: user.full_name,
    email: user.email,
    phone: user.phone
  } : null;
}

async function membership(env: Env, groupId: number, userId: number) {
  return dbFirst<{ role: string }>(
    env.DB,
    "SELECT role FROM group_members WHERE group_id = ? AND user_id = ?",
    [groupId, userId]
  );
}

async function logActivity(
  env: Env,
  groupId: number,
  userId: number,
  action: string,
  entityType: string,
  entityId: number,
  summary: string
) {
  await dbRun(
    env.DB,
    `INSERT INTO activity_logs
     (group_id, user_id, action, entity_type, entity_id, summary)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [groupId, userId, action, entityType, entityId, summary]
  );
}

async function getGroupBalances(env: Env, groupId: number) {
  const registeredMembers = await dbAll<any>(
    env.DB,
    `SELECT u.id AS user_id, u.full_name, u.avatar_url,
            gm.role, gm.joined_at
     FROM group_members gm
     JOIN users u ON u.id = gm.user_id
     WHERE gm.group_id = ?
     ORDER BY gm.joined_at, u.id`,
    [groupId]
  );
  const guestMembers = await dbAll<any>(env.DB,
    `SELECT id, display_name, joined_at FROM guest_members
     WHERE group_id = ? AND linked_user_id IS NULL ORDER BY joined_at, id`, [groupId]);
  const members = [
    ...registeredMembers,
    ...guestMembers.map((guest: any) => ({
      user_id: -Number(guest.id), full_name: guest.display_name, avatar_url: null,
      role: "guest", joined_at: guest.joined_at, is_guest: true
    }))
  ];

  const paid = await dbAll<any>(
    env.DB,
    `SELECT paid_by_user_id AS user_id, SUM(total_paise) AS total
     FROM expenses WHERE group_id = ?
     GROUP BY paid_by_user_id`,
    [groupId]
  );

  const owed = await dbAll<any>(
    env.DB,
    `SELECT es.user_id, SUM(es.owed_paise) AS total
     FROM expense_splits es
     JOIN expenses e ON e.id = es.expense_id
     WHERE e.group_id = ?
     GROUP BY es.user_id`,
    [groupId]
  );

  const settlements = await dbAll<any>(
    env.DB,
    `SELECT payer_user_id, receiver_user_id, amount_paise
     FROM settlements
     WHERE group_id = ? AND status = 'confirmed'`,
    [groupId]
  );

  const paidMap = new Map(paid.map(r => [r.user_id, r.total ?? 0]));
  const owedMap = new Map(owed.map(r => [r.user_id, r.total ?? 0]));

  const membersWithBalances = members.map(member => {
    const paidPaise = paidMap.get(member.user_id) ?? 0;
    const owedPaise = owedMap.get(member.user_id) ?? 0;

    const settlementsPaid = settlements
      .filter(s => s.payer_user_id === member.user_id)
      .reduce((sum, s) => sum + s.amount_paise, 0);

    const settlementsReceived = settlements
      .filter(s => s.receiver_user_id === member.user_id)
      .reduce((sum, s) => sum + s.amount_paise, 0);

    return {
      userId: member.user_id,
      fullName: member.full_name,
      avatarUrl: member.avatar_url,
      role: member.role,
      isGuest: Boolean(member.is_guest),
      joinedAt: member.joined_at,
      paidPaise,
      owedPaise,
      netPaise: paidPaise - owedPaise + settlementsPaid - settlementsReceived
    };
  });

  const expenses = await dbFirst<{ total: number | null }>(
    env.DB,
    "SELECT SUM(total_paise) AS total FROM expenses WHERE group_id = ?",
    [groupId]
  );

  const settled = await dbFirst<{ total: number | null }>(
    env.DB,
    `SELECT SUM(amount_paise) AS total FROM settlements
     WHERE group_id = ? AND status = 'confirmed'`,
    [groupId]
  );

  const debtors = membersWithBalances
    .filter(m => m.netPaise < 0)
    .map(m => ({ id: m.userId, name: m.fullName, amount: -m.netPaise }));

  const creditors = membersWithBalances
    .filter(m => m.netPaise > 0)
    .map(m => ({ id: m.userId, name: m.fullName, amount: m.netPaise }));

  const transfers = [];
  let i = 0;
  let j = 0;

  while (i < debtors.length && j < creditors.length) {
    const amount = Math.min(debtors[i].amount, creditors[j].amount);

    if (amount > 0) {
      transfers.push({
        fromUserId: debtors[i].id,
        fromName: debtors[i].name,
        toUserId: creditors[j].id,
        toName: creditors[j].name,
        amountPaise: amount
      });
    }

    debtors[i].amount -= amount;
    creditors[j].amount -= amount;

    if (debtors[i].amount === 0) i++;
    if (creditors[j].amount === 0) j++;
  }

  return {
    members: membersWithBalances,
    transfers,
    totalExpenditurePaise: expenses?.total ?? 0,
    confirmedSettledPaise: settled?.total ?? 0
  };
}

async function listGroups(request: Request, env: Env, user: User) {
  const url = new URL(request.url);
  const search = (url.searchParams.get("search") ?? "").trim().toLowerCase();
  const category = (url.searchParams.get("category") ?? "").trim();
  const includeArchived = url.searchParams.get("archived") === "true";

  const groups = await dbAll<any>(
    env.DB,
    `SELECT g.*, gm.role AS my_role
     FROM groups g
     JOIN group_members gm ON gm.group_id = g.id
     WHERE gm.user_id = ?
     ORDER BY g.updated_at DESC, g.id DESC`,
    [user.id]
  );

  const result = [];

  for (const group of groups) {
    if (!includeArchived && group.is_archived === 1) continue;
    if (category && category !== "All" && group.category !== category) continue;

    if (search &&
      !group.name.toLowerCase().includes(search) &&
      !(group.description ?? "").toLowerCase().includes(search)) continue;

    const balances = await getGroupBalances(env, group.id);
    const me = balances.members.find(m => m.userId === user.id);

    const count = await dbFirst<{ cnt: number }>(
      env.DB,
      "SELECT COUNT(*) AS cnt FROM expenses WHERE group_id = ?",
      [group.id]
    );

    result.push({
      id: group.id,
      name: group.name,
      description: group.description,
      category: group.category,
      coverColor: group.cover_color,
      isArchived: group.is_archived === 1,
      myRole: group.my_role,
      createdAt: group.created_at,
      memberCount: balances.members.length,
      expenseCount: count?.cnt ?? 0,
      totalExpenditurePaise: balances.totalExpenditurePaise,
      myNetBalancePaise: me?.netPaise ?? 0,
      members: balances.members.map(m => ({
        userId: m.userId,
        fullName: m.fullName,
        avatarUrl: m.avatarUrl,
        netPaise: m.netPaise,
        isGuest: Boolean(m.isGuest)
      }))
    });
  }

  return json({ groups: result });
}

async function createGroup(request: Request, env: Env, user: User) {
  const body = await request.json() as any;
  const name = (body.name ?? "").trim();

  if (name.length < 2 || name.length > 80) {
    return json({
      error: "Group name must be between 2 and 80 characters."
    }, 400);
  }

  const categories = [
    "Friends", "Travel", "Home & Roommates",
    "Family", "Work & Events", "Other"
  ];

  const category = categories.includes(body.category)
    ? body.category
    : "Friends";

  const coverColor = /^#[0-9A-Fa-f]{6}$/.test(body.coverColor ?? "")
    ? body.coverColor
    : "#065F46";

  const result = await env.DB.prepare(
    `INSERT INTO groups
     (name, description, category, cover_color, created_by)
     VALUES (?, ?, ?, ?, ?)`
  ).bind(
    name,
    (body.description ?? "").trim(),
    category,
    coverColor,
    user.id
  ).run();

  const groupId = Number(result.meta.last_row_id);

  const statements = [
    env.DB.prepare(
      `INSERT INTO group_members (group_id, user_id, role)
       VALUES (?, ?, 'admin')`
    ).bind(groupId, user.id),

    env.DB.prepare(
      `INSERT INTO activity_logs
       (group_id, user_id, action, entity_type, entity_id, summary)
       VALUES (?, ?, 'group_created', 'group', ?, ?)`
    ).bind(
      groupId,
      user.id,
      groupId,
      `${user.fullName} created group "${name}"`
    )
  ];

  await env.DB.batch(statements);

  // Invitations supplied during group creation are handled
  // by the dedicated invitation routes added separately.
  return json({
    groupId,
    invitedCount: 0,
    emailsSentCount: 0,
    smtpConfigured: false
  }, 201);
}

async function getGroup(request: Request, env: Env, groupId: number, user: User) {
  const member = await membership(env, groupId, user.id);

  if (!member) {
    return json({
      error: "Access denied. You are not a member of this group."
    }, 403);
  }

  const group = await dbFirst<any>(
    env.DB,
    "SELECT * FROM groups WHERE id = ?",
    [groupId]
  );

  if (!group) return json({ error: "Group not found." }, 404);

  const balances = await getGroupBalances(env, groupId);

  const expenses = await dbAll<any>(
    env.DB,
    `SELECT e.*, payer.full_name AS payer_name,
            creator.full_name AS creator_name
     FROM expenses e
     JOIN users payer ON payer.id = e.paid_by_user_id
     JOIN users creator ON creator.id = e.created_by_user_id
     WHERE e.group_id = ?
     ORDER BY e.expense_date DESC, e.id DESC`,
    [groupId]
  );

  const activities = await dbAll<any>(
    env.DB,
    `SELECT a.*, u.full_name AS actor_name
     FROM activity_logs a
     JOIN users u ON u.id = a.user_id
     WHERE a.group_id = ?
     ORDER BY a.created_at DESC, a.id DESC
     LIMIT 30`,
    [groupId]
  );

  const settlements = await dbAll<any>(
    env.DB,
    `SELECT s.*, p.full_name AS payer_name,
            r.full_name AS receiver_name
     FROM settlements s
     JOIN users p ON p.id = s.payer_user_id
     JOIN users r ON r.id = s.receiver_user_id
     WHERE s.group_id = ?
     ORDER BY s.created_at DESC, s.id DESC`,
    [groupId]
  );

  const categoryTotals = await dbAll<any>(
    env.DB,
    `SELECT category, SUM(total_paise) AS total_paise
     FROM expenses WHERE group_id = ?
     GROUP BY category ORDER BY total_paise DESC`,
    [groupId]
  );
  const activeInvitation = await dbFirst<any>(env.DB,
    `SELECT token FROM invitations WHERE group_id = ? AND status = 'pending'
     AND invitee_email IS NULL AND invitee_phone IS NULL
     AND datetime(expires_at) > datetime('now') AND use_count < max_uses
     ORDER BY created_at DESC LIMIT 1`, [groupId]);

  return json({
    group: {
      id: group.id,
      name: group.name,
      description: group.description,
      category: group.category,
      coverColor: group.cover_color,
      isArchived: group.is_archived === 1,
      myRole: member.role,
      createdAt: group.created_at,
      totalExpenditurePaise: balances.totalExpenditurePaise,
      confirmedSettledPaise: balances.confirmedSettledPaise
    },
    members: balances.members,
    transfers: balances.transfers,
    expenses,
    invitations: await listInvitations(request, env, groupId),
    inviteQrDataUrl: null,
    activeInviteUrl: configuredInviteUrl(env, activeInvitation?.token),
    smtpConfigured: false,
    smsConfigured: false,
    activities,
    settlements,
    analytics: {
      expenseCount: expenses.length,
      categoryTotals
    }
  });
}

async function updateGroup(
  request: Request,
  env: Env,
  groupId: number,
  user: User
) {
  const member = await membership(env, groupId, user.id);

  if (!member || member.role !== "admin") {
    return json({
      error: "Only group admins can update group settings."
    }, 403);
  }

  const body = await request.json() as any;
  const existing = await dbFirst<any>(
    env.DB,
    "SELECT * FROM groups WHERE id = ?",
    [groupId]
  );

  if (!existing) return json({ error: "Group not found." }, 404);

  const name = body.name !== undefined
    ? body.name.trim()
    : existing.name;

  if (name.length < 2 || name.length > 80) {
    return json({
      error: "Group name must be between 2 and 80 characters."
    }, 400);
  }

  const color = body.coverColor !== undefined &&
    /^#[0-9A-Fa-f]{6}$/.test(body.coverColor)
    ? body.coverColor
    : existing.cover_color;

  await dbRun(
    env.DB,
    `UPDATE groups
     SET name = ?, description = ?, category = ?,
         cover_color = ?, is_archived = ?,
         updated_at = datetime('now')
     WHERE id = ?`,
    [
      name,
      body.description !== undefined ? body.description.trim() : existing.description,
      body.category ?? existing.category,
      color,
      body.isArchived !== undefined
        ? (body.isArchived ? 1 : 0)
        : existing.is_archived,
      groupId
    ]
  );

  await logActivity(
    env, groupId, user.id,
    "group_updated", "group", groupId,
    `${user.fullName} updated group settings`
  );

  return json({ ok: true });
}

async function deleteGroup(env: Env, groupId: number, user: User) {
  const member = await membership(env, groupId, user.id);

  if (!member || member.role !== "admin") {
    return json({
      error: "Only group admins can delete this group."
    }, 403);
  }

  const balances = await getGroupBalances(env, groupId);

  if (balances.members.some(m => m.netPaise !== 0)) {
    return json({
      error: "Cannot delete a group with unsettled member balances. Settle balances or archive the group instead."
    }, 400);
  }

  await dbRun(env.DB, "DELETE FROM groups WHERE id = ?", [groupId]);

  return json({ ok: true });
}

async function addMember(
  request: Request,
  env: Env,
  groupId: number,
  user: User
) {
  if (!await membership(env, groupId, user.id)) {
    return json({
      error: "You must be a group member to invite others."
    }, 403);
  }

  const body = await request.json() as { email?: string };
  const email = (body.email ?? "").trim().toLowerCase();

  if (!isValidEmail(email)) {
    return json({ error: "Enter a valid email address." }, 400);
  }

  const group = await dbFirst<any>(
    env.DB,
    "SELECT name FROM groups WHERE id = ?",
    [groupId]
  );

  if (!group) return json({ error: "Group not found." }, 404);

  const target = await dbFirst<any>(
    env.DB,
    "SELECT id, full_name FROM users WHERE lower(email) = ?",
    [email]
  );

  if (!target) {
    return json({
      error: "This person does not have a SettleUp account yet. Use the invitation link feature to invite them."
    }, 404);
  }

  if (await membership(env, groupId, target.id)) {
    return json({
      error: `${target.full_name} is already a member of this group.`
    }, 409);
  }

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO group_members (group_id, user_id, role)
       VALUES (?, ?, 'member')`
    ).bind(groupId, target.id),

    env.DB.prepare(
      `INSERT INTO notifications
       (user_id, group_id, type, title, message, link_path)
       VALUES (?, ?, 'group_joined', 'Added to group', ?, '/groups')`
    ).bind(
      target.id,
      groupId,
      `${user.fullName} added you to "${group.name}".`
    ),

    env.DB.prepare(
      `INSERT INTO activity_logs
       (group_id, user_id, action, entity_type, entity_id, summary)
       VALUES (?, ?, 'member_added', 'user', ?, ?)`
    ).bind(
      groupId,
      user.id,
      target.id,
      `${user.fullName} added ${target.full_name} to the group`
    )
  ]);

  return json({ status: "added", memberName: target.full_name }, 201);
}

async function changeMemberRole(
  request: Request,
  env: Env,
  groupId: number,
  memberId: number,
  user: User
) {
  const admin = await membership(env, groupId, user.id);

  if (!admin || admin.role !== "admin") {
    return json({
      error: "Only group admins can change member roles."
    }, 403);
  }

  const body = await request.json() as { role?: string };

  if (body.role !== "admin" && body.role !== "member") {
    return json({ error: "Invalid role." }, 400);
  }

  if (memberId === user.id && body.role !== "admin") {
    const count = await dbFirst<{ cnt: number }>(
      env.DB,
      `SELECT COUNT(*) AS cnt FROM group_members
       WHERE group_id = ? AND role = 'admin'`,
      [groupId]
    );

    if ((count?.cnt ?? 0) <= 1) {
      return json({
        error: "Assign another admin before stepping down."
      }, 400);
    }
  }

  await dbRun(
    env.DB,
    "UPDATE group_members SET role = ? WHERE group_id = ? AND user_id = ?",
    [body.role, groupId, memberId]
  );

  return json({ ok: true });
}

async function removeMember(
  env: Env,
  groupId: number,
  memberId: number,
  user: User
) {
  const myMembership = await membership(env, groupId, user.id);

  if (!myMembership ||
    (myMembership.role !== "admin" && memberId !== user.id)) {
    return json({
      error: "Only group admins can remove other members."
    }, 403);
  }

  const balances = await getGroupBalances(env, groupId);
  const target = balances.members.find(m => m.userId === memberId);

  if (!target) {
    return json({ error: "Member not found in group." }, 404);
  }

  if (target.netPaise !== 0) {
    return json({
      error: `${target.fullName} has a non-zero balance in this group. Settle balances before removing.`
    }, 400);
  }

  await dbRun(
    env.DB,
    "DELETE FROM group_members WHERE group_id = ? AND user_id = ?",
    [groupId, memberId]
  );

  await logActivity(
    env, groupId, user.id,
    "member_removed", "user", memberId,
    `${target.fullName} left or was removed from the group`
  );

  return json({ ok: true });
}


const GUEST_COOKIE = "settleup_guest";

export function buildInvitationUrl(canonicalAppUrl: string | undefined, token: string) {
  const configured = canonicalAppUrl?.trim();
  if (!configured) throw new Error("CANONICAL_APP_URL is not configured for invitation links.");
  let canonical: URL;
  try { canonical = new URL(configured); } catch { throw new Error("CANONICAL_APP_URL must be a public HTTPS origin."); }
  const host = canonical.hostname.toLowerCase();
  const isIpLiteral = /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) || host.startsWith("[");
  if (canonical.protocol !== "https:" || canonical.username || canonical.password || canonical.pathname !== "/" || canonical.search || canonical.hash || host === "localhost" || host.endsWith(".localhost") || isIpLiteral) {
    throw new Error("CANONICAL_APP_URL must be a public HTTPS origin only.");
  }
  return `${canonical.origin}/guest-group?invite=${encodeURIComponent(token)}`;
}

function inviteUrlFor(env: Env, token: string) {
  return buildInvitationUrl(env.CANONICAL_APP_URL, token);
}

function configuredInviteUrl(env: Env, token: string | null | undefined): string | null {
  if (!token) return null;
  try { return inviteUrlFor(env, token); } catch { return null; }
}

function inviteMessage(inviterName: string, groupName: string, inviteUrl: string) {
  return `Hello! ${inviterName} has invited you to join the group "${groupName}" on SettleUp. Open the secure invitation link to view the group and accept the invitation:\n\n${inviteUrl}\n\nThis invitation link expires in 14 days.`;
}

function guestCookie(request: Request, token: string) {
  const secure = new URL(request.url).protocol === "https:";
  return `${GUEST_COOKIE}=${encodeURIComponent(token)}; Path=/api/groups; HttpOnly; SameSite=Lax; Max-Age=1800${secure ? "; Secure" : ""}`;
}

function clearGuestCookie(request: Request) {
  const secure = new URL(request.url).protocol === "https:";
  return `${GUEST_COOKIE}=; Path=/api/groups; HttpOnly; SameSite=Lax; Max-Age=0${secure ? "; Secure" : ""}`;
}

function readGuestCookie(request: Request): string | null {
  const value = (request.headers.get("Cookie") ?? "").split(";").map(v => v.trim()).find(v => v.startsWith(`${GUEST_COOKIE}=`));
  return value ? decodeURIComponent(value.slice(GUEST_COOKIE.length + 1)) : null;
}

export function normalizeGuestName(value: unknown): string | null {
  const rawName = String(value ?? "");
  if (/[\u0000-\u001f\u007f]/.test(rawName)) return null;
  const name = rawName.trim().replace(/\s+/g, " ");
  return name.length >= 2 && name.length <= 80 && !/[<>\u0000-\u001f\u007f]/.test(name) ? name : null;
}

async function invitationByToken(env: Env, token: string) {
  return dbFirst<any>(env.DB,
    `SELECT i.*, g.name AS group_name, g.description AS group_description,
            g.category AS group_category, u.full_name AS inviter_name
     FROM invitations i
     JOIN groups g ON g.id = i.group_id
     JOIN users u ON u.id = i.invited_by
     WHERE i.token = ?`, [token]);
}

function invitationValidity(inv: any) {
  if (!inv) return { valid: false, status: "invalid", reason: "This invitation link is invalid." };
  if (inv.status !== "pending") return { valid: false, status: inv.status, reason: `This invitation is ${inv.status}.` };
  if (new Date(`${inv.expires_at.replace(" ", "T")}Z`).getTime() <= Date.now()) return { valid: false, status: "expired", reason: "This invitation has expired." };
  if (Number(inv.use_count) >= Number(inv.max_uses)) return { valid: false, status: "accepted", reason: "This invitation has reached its maximum number of uses." };
  return { valid: true, status: "pending", reason: "" };
}

async function previewInvitation(env: Env, token: string) {
  const inv = await invitationByToken(env, token);
  const validity = invitationValidity(inv);
  if (inv && validity.status === "expired") {
    await dbRun(env.DB, "UPDATE invitations SET status = 'expired' WHERE id = ? AND status = 'pending'", [inv.id]);
  }
  if (!validity.valid) {
    return {
      ...validity,
      inviterName: "A SettleUp member",
      groupName: "",
      groupCategory: "",
      requiresEmailMatch: false,
      groupId: null,
      token
    };
  }
  return {
    ...validity,
    inviterName: inv?.inviter_name ?? "A SettleUp member",
    groupName: inv?.group_name ?? "",
    groupCategory: inv?.group_category ?? "",
    requiresEmailMatch: Boolean(inv?.invitee_email),
    groupId: inv?.group_id ?? null,
    token
  };
}

async function createInvitation(request: Request, env: Env, groupId: number, user: User) {
  if (!await membership(env, groupId, user.id)) return json({ error: "You must be a group member to invite others." }, 403);
  const body = await request.json() as any;
  const channel = ["email", "phone", "qr", "link"].includes(body.channel) ? body.channel : null;
  if (!channel) return json({ error: "Choose a valid invitation method." }, 400);
  const group = await dbFirst<any>(env.DB, "SELECT id, name FROM groups WHERE id = ?", [groupId]);
  if (!group) return json({ error: "Group not found." }, 404);

  const inviteeEmail = channel === "email" ? String(body.inviteeEmail ?? "").trim().toLowerCase() : null;
  if (channel === "email" && !isValidEmail(inviteeEmail ?? "")) return json({ error: "Enter a valid email address." }, 400);
  const rawPhone = channel === "phone" ? String(body.inviteePhone ?? "").trim() : "";
  const inviteePhone = channel === "phone" ? normalizePhone(rawPhone) : null;
  if (channel === "phone" && !inviteePhone) return json({ error: "Enter a valid mobile number with country code." }, 400);

  const days = Math.max(1, Math.min(30, Number(body.expiresInDays) || 14));
  const expiresAt = new Date(Date.now() + days * 86400000).toISOString().slice(0, 19).replace("T", " ");
  const storedChannel = channel === "phone" && body.deliveryMode === "whatsapp" ? "whatsapp" : channel;
  const maxUses = channel === "email" || channel === "phone" ? 1 : 10;

  let matchedUser: any = null;
  let existingInvitation: any = null;
  if (inviteeEmail) {
    matchedUser = await dbFirst<any>(env.DB, "SELECT id, full_name FROM users WHERE lower(email) = ?", [inviteeEmail]);
    if (matchedUser && await membership(env, groupId, matchedUser.id)) {
      return json({ error: `${matchedUser.full_name} is already a member of this group.` }, 409);
    }
    existingInvitation = await dbFirst<any>(env.DB,
      `SELECT id, token FROM invitations WHERE group_id = ? AND lower(COALESCE(invitee_email, '')) = ?
       AND status = 'pending' AND datetime(expires_at) > datetime('now')
       ORDER BY created_at DESC, id DESC LIMIT 1`, [groupId, inviteeEmail]);
  } else if (inviteePhone) {
    matchedUser = await dbFirst<any>(env.DB, "SELECT id, full_name FROM users WHERE phone = ?", [inviteePhone]);
    if (matchedUser && await membership(env, groupId, matchedUser.id)) {
      return json({ error: "A member with this mobile number is already in the group." }, 409);
    }
    existingInvitation = await dbFirst<any>(env.DB,
      `SELECT id, token FROM invitations WHERE group_id = ? AND invitee_phone = ?
       AND status = 'pending' AND datetime(expires_at) > datetime('now')
       ORDER BY created_at DESC, id DESC LIMIT 1`, [groupId, inviteePhone]);
  } else if (body.reuseExisting) {
    existingInvitation = await dbFirst<any>(env.DB,
      `SELECT id, token, channel FROM invitations WHERE group_id = ?
       AND invitee_email IS NULL AND invitee_phone IS NULL
       AND status = 'pending' AND use_count < max_uses AND datetime(expires_at) > datetime('now')
       ORDER BY id DESC LIMIT 1`, [groupId]);
  }

  const token = existingInvitation?.token ?? generateOpaqueToken(32);
  let invitationId: number;
  if (existingInvitation) {
    invitationId = Number(existingInvitation.id);
    await dbRun(env.DB,
      "UPDATE invitations SET channel = ?, expires_at = ?, delivery_status = 'manual_share', delivery_error = NULL, last_sent_at = datetime('now') WHERE id = ?",
      [storedChannel, expiresAt, invitationId]);
  } else {
    const created = await dbRun(env.DB,
      `INSERT INTO invitations
       (group_id, invited_by, invitee_email, invitee_phone, channel, token, status, delivery_status, max_uses, expires_at, last_sent_at)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', 'manual_share', ?, ?, datetime('now'))`,
      [groupId, user.id, inviteeEmail, inviteePhone, storedChannel, token, maxUses, expiresAt]);
    invitationId = Number(created.meta.last_row_id);
  }

  const inviteUrl = inviteUrlFor(env, token);
  const message = inviteMessage(user.fullName, group.name, inviteUrl);
  const digits = (inviteePhone ?? "").replace(/\D/g, "");
  const whatsappShareUrl = `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
  const smsShareUrl = `sms:${inviteePhone ?? ""}?body=${encodeURIComponent(message)}`;
  const emailShareUrl = `mailto:${inviteeEmail ?? ""}?subject=${encodeURIComponent(`${user.fullName} invited you to join ${group.name} on SettleUp`)}&body=${encodeURIComponent(message)}`;

  if (matchedUser) {
    await dbRun(env.DB,
      `INSERT INTO notifications (user_id, group_id, type, title, message, link_path)
       VALUES (?, ?, 'group_invite', 'Group invitation received', ?, ?)`,
      [matchedUser.id, groupId, `${user.fullName} invited you to join "${group.name}". Would you like to join?`, `/guest-group?invite=${token}`]);
  }

  return json({
    invitationId,
    reusedExistingInvite: Boolean(existingInvitation),
    channel: storedChannel,
    inviteUrl,
    whatsappShareUrl,
    smsShareUrl,
    emailShareUrl,
    emailDelivered: false,
    smsSent: false,
    deliveryStatus: "manual_share",
    deliveryError: null,
    smtpConfigured: false,
    smsConfigured: false,
    hasExistingAccount: Boolean(matchedUser),
    deliveryMode: body.deliveryMode === "sms" ? "sms" : "whatsapp",
    message
  }, existingInvitation ? 200 : 201);
}

async function listInvitations(request: Request, env: Env, groupId: number) {
  const rows = await dbAll<any>(env.DB,
    `SELECT id, invitee_email, invitee_phone, channel, token, status, delivery_status,
            delivery_error, max_uses, use_count, expires_at, created_at, last_sent_at
     FROM invitations WHERE group_id = ? ORDER BY created_at DESC LIMIT 30`, [groupId]);
  return rows.map(row => ({ ...row, inviteUrl: configuredInviteUrl(env, row.token) }));
}

async function acceptInvitation(env: Env, token: string, user: User) {
  const inv = await invitationByToken(env, token);
  const validity = invitationValidity(inv);
  if (!validity.valid) return json({ error: validity.reason }, 400);
  if (inv.invitee_email && inv.invitee_email.toLowerCase() !== user.email.toLowerCase()) {
    return json({ error: `This invitation was sent to ${inv.invitee_email}. Sign in with that email address to accept it.` }, 403);
  }
  if (await membership(env, inv.group_id, user.id)) {
    return json({ groupId: inv.group_id, groupName: inv.group_name, alreadyMember: true });
  }
  const acceptedAt = new Date().toISOString().slice(0, 19).replace("T", " ");
  const acceptance = await env.DB.batch([
    env.DB.prepare(
      `UPDATE invitations SET use_count = use_count + 1,
         status = CASE WHEN use_count + 1 >= max_uses THEN 'accepted' ELSE 'pending' END,
         accepted_by_user_id = ?, accepted_at = ?
       WHERE id = ? AND status = 'pending'
         AND datetime(expires_at) > datetime('now') AND use_count < max_uses
         AND NOT EXISTS (SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?)`
    ).bind(user.id, acceptedAt, inv.id, inv.group_id, user.id),
    env.DB.prepare(
      `INSERT OR IGNORE INTO group_members (group_id, user_id, role)
       SELECT ?, ?, 'member' WHERE EXISTS (
         SELECT 1 FROM invitations WHERE id = ? AND accepted_by_user_id = ? AND accepted_at = ?
       )`
    ).bind(inv.group_id, user.id, inv.id, user.id, acceptedAt)
  ]);
  if (!acceptance[0]?.meta.changes || !acceptance[1]?.meta.changes) {
    return json({ error: "This invitation is no longer available. Please ask the group admin for a new link." }, 409);
  }
  await dbRun(env.DB,
    `INSERT INTO activity_logs (group_id, user_id, action, entity_type, entity_id, summary)
     VALUES (?, ?, 'member_joined', 'user', ?, ?)`,
    [inv.group_id, user.id, user.id, `${user.fullName} joined the group using an invitation`]);
  await dbRun(env.DB,
    `INSERT INTO notifications (user_id, group_id, type, title, message, link_path)
     SELECT invited_by, group_id, 'group_joined', 'New group member', ?, '/groups'
     FROM invitations WHERE id = ?`,
    [`${user.fullName} joined "${inv.group_name}".`, inv.id]);
  return json({ groupId: inv.group_id, groupName: inv.group_name, alreadyMember: false });
}

async function createGuestSession(request: Request, env: Env, token: string) {
  const inv = await invitationByToken(env, token);
  const validity = invitationValidity(inv);
  if (!validity.valid) return noStoreJson({ error: validity.reason }, 410);
  const currentRaw = readGuestCookie(request);
  if (currentRaw) {
    const currentHash = await hashToken(currentRaw, env.SESSION_SECRET);
    const current = await dbFirst<any>(env.DB,
      `SELECT id FROM guest_sessions WHERE token_hash = ? AND invitation_id = ?
       AND group_id = ? AND datetime(expires_at) > datetime('now')`,
      [currentHash, inv.id, inv.group_id]);
    if (current) return noStoreJson({ ok: true });
  }
  const raw = generateOpaqueToken(32);
  const tokenHash = await hashToken(raw, env.SESSION_SECRET);
  const invitationExpiry = new Date(`${inv.expires_at.replace(" ", "T")}Z`).getTime();
  const expiresAt = new Date(Math.min(Date.now() + 30 * 60000, invitationExpiry)).toISOString().slice(0, 19).replace("T", " ");
  await dbRun(env.DB,
    `INSERT INTO guest_sessions (token_hash, invitation_id, group_id, expires_at) VALUES (?, ?, ?, ?)`,
    [tokenHash, inv.id, inv.group_id, expiresAt]);
  return new Response(JSON.stringify({ ok: true }), {
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", "Set-Cookie": guestCookie(request, raw) }
  });
}

async function guestSessionRecord(request: Request, env: Env) {
  const raw = readGuestCookie(request);
  if (!raw) return null;
  const tokenHash = await hashToken(raw, env.SESSION_SECRET);
  return await dbFirst<any>(env.DB,
    `SELECT gs.id, gs.group_id, gs.invitation_id, gs.guest_member_id,
            i.status AS invitation_status, i.expires_at AS invitation_expires_at,
            i.use_count, i.max_uses
     FROM guest_sessions gs
     JOIN invitations i ON i.id = gs.invitation_id AND i.group_id = gs.group_id
     JOIN groups g ON g.id = gs.group_id
     WHERE gs.token_hash = ? AND datetime(gs.expires_at) > datetime('now')
       AND i.status = 'pending' AND datetime(i.expires_at) > datetime('now')
       AND i.use_count < i.max_uses`, [tokenHash]);
}

async function joinAsGuest(request: Request, env: Env) {
  const session = await guestSessionRecord(request, env);
  if (!session) return noStoreJson({ error: "This guest invitation has expired or is no longer available. Reopen a valid invitation." }, 410);
  let body: any;
  try { body = await request.json(); } catch { return noStoreJson({ error: "Enter your name to join this group." }, 400); }
  const displayName = normalizeGuestName(body?.name);
  if (!displayName) {
    return noStoreJson({ error: "Enter a name between 2 and 80 characters." }, 400);
  }
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO guest_members (group_id, source_session_id, display_name)
       SELECT group_id, id, ? FROM guest_sessions
       WHERE id = ? AND guest_member_id IS NULL
       ON CONFLICT(source_session_id) DO NOTHING`
    ).bind(displayName, session.id),
    env.DB.prepare(
      `UPDATE guest_sessions SET guest_member_id = (
         SELECT id FROM guest_members WHERE source_session_id = ?
       ) WHERE id = ? AND guest_member_id IS NULL`
    ).bind(session.id, session.id)
  ]);
  const guest = await dbFirst<any>(env.DB,
    `SELECT id, display_name, group_id FROM guest_members WHERE source_session_id = ?`, [session.id]);
  if (!guest || Number(guest.group_id) !== Number(session.group_id)) {
    return noStoreJson({ error: "Unable to join this group. Reopen the invitation and try again." }, 409);
  }
  return noStoreJson({ ok: true, guest: { id: guest.id, name: guest.display_name }, groupId: session.group_id });
}

async function convertGuestMembership(request: Request, env: Env, user: User) {
  const session = await guestSessionRecord(request, env);
  if (!session?.guest_member_id) return noStoreJson({ error: "No joined guest membership is available to convert." }, 404);
  const guest = await dbFirst<any>(env.DB,
    `SELECT id, group_id, linked_user_id FROM guest_members WHERE id = ?`, [session.guest_member_id]);
  if (!guest || Number(guest.group_id) !== Number(session.group_id)) return noStoreJson({ error: "Guest membership is no longer available." }, 410);
  if (guest.linked_user_id && Number(guest.linked_user_id) !== user.id) return noStoreJson({ error: "This guest identity is already linked to another account." }, 409);
  const currentMember = await membership(env, Number(session.group_id), user.id);
  await env.DB.batch([
    env.DB.prepare(
      `INSERT OR IGNORE INTO group_members (group_id, user_id, role)
       SELECT ?, ?, 'member' WHERE NOT EXISTS (
         SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?
       )`
    ).bind(session.group_id, user.id, session.group_id, user.id),
    env.DB.prepare(
      `UPDATE guest_members SET linked_user_id = ?
       WHERE id = ? AND group_id = ? AND (linked_user_id IS NULL OR linked_user_id = ?)`
    ).bind(user.id, guest.id, session.group_id, user.id)
  ]);
  const linked = await dbFirst<any>(env.DB,
    `SELECT linked_user_id FROM guest_members WHERE id = ? AND group_id = ?`, [guest.id, session.group_id]);
  if (Number(linked?.linked_user_id) !== user.id) return noStoreJson({ error: "Unable to link this guest identity to your account." }, 409);
  return noStoreJson({ ok: true, groupId: session.group_id, alreadyMember: Boolean(currentMember) }, 200, { "Set-Cookie": clearGuestCookie(request) });
}

async function guestGroupView(request: Request, env: Env) {
  const session = await guestSessionRecord(request, env);
  if (!session) return noStoreJson({ error: "This guest invitation has expired or is no longer available." }, 410);
  const group = await dbFirst<any>(env.DB, "SELECT id, name, description, category FROM groups WHERE id = ?", [session.group_id]);
  if (!group) return noStoreJson({ error: "Group not found." }, 404);
  const members = await dbAll<any>(env.DB,
    `SELECT u.id, u.full_name, gm.role, gm.joined_at, 0 AS is_guest FROM group_members gm
     JOIN users u ON u.id = gm.user_id WHERE gm.group_id = ?
     UNION ALL
     SELECT -guest.id AS id, guest.display_name AS full_name, 'guest' AS role, guest.joined_at, 1 AS is_guest
     FROM guest_members guest WHERE guest.group_id = ? AND guest.linked_user_id IS NULL
     ORDER BY joined_at, id`, [session.group_id, session.group_id]);
  const expenses = await dbAll<any>(env.DB,
    `SELECT e.*, p.full_name AS payer_name, c.full_name AS creator_name
     FROM expenses e JOIN users p ON p.id = e.paid_by_user_id
     JOIN users c ON c.id = e.created_by_user_id
     WHERE e.group_id = ? ORDER BY e.expense_date DESC, e.id DESC`, [session.group_id]);
  for (const expense of expenses) {
    expense.shares = await dbAll<any>(env.DB,
      `SELECT u.full_name, es.owed_paise FROM expense_splits es JOIN users u ON u.id = es.user_id WHERE es.expense_id = ?`, [expense.id]);
    const items = await dbAll<any>(env.DB, "SELECT * FROM expense_items WHERE expense_id = ? ORDER BY id", [expense.id]);
    for (const item of items) {
      const consumers = await dbAll<any>(env.DB,
        `SELECT u.full_name FROM item_consumers ic JOIN users u ON u.id = ic.user_id WHERE ic.item_id = ? ORDER BY u.full_name`, [item.id]);
      item.consumers = consumers.map(c => c.full_name).join(", ");
    }
    expense.items = items;
  }
  const balances = await getGroupBalances(env, session.group_id);
  const settlements = await dbAll<any>(env.DB,
    `SELECT s.*, p.full_name AS payer_name, r.full_name AS receiver_name
     FROM settlements s JOIN users p ON p.id = s.payer_user_id
     JOIN users r ON r.id = s.receiver_user_id WHERE s.group_id = ?
     ORDER BY s.created_at DESC`, [session.group_id]);
  const activity = await dbAll<any>(env.DB,
    `SELECT a.action, a.summary, a.created_at, u.full_name AS actor_name
     FROM activity_logs a JOIN users u ON u.id = a.user_id
     WHERE a.group_id = ? ORDER BY a.created_at DESC LIMIT 20`, [session.group_id]);
  const categoryTotals = await dbAll<any>(env.DB,
    `SELECT category, SUM(total_paise) AS total_paise FROM expenses
     WHERE group_id = ? GROUP BY category ORDER BY total_paise DESC`, [session.group_id]);
  const guestMember = session.guest_member_id ? await dbFirst<any>(env.DB,
    "SELECT display_name FROM guest_members WHERE id = ? AND group_id = ? AND linked_user_id IS NULL",
    [session.guest_member_id, session.group_id]) : null;
  return noStoreJson({
    group, members, guestMember: guestMember ? { name: guestMember.display_name } : null, expenses,
    balances: { members: balances.members, transfers: balances.transfers, totalExpenditurePaise: balances.totalExpenditurePaise, confirmedSettledPaise: balances.confirmedSettledPaise },
    settlements, activity,
    analytics: { expenseCount: expenses.length, categoryTotals },
    readOnly: true
  });
}

export async function handleGroups(
  request: Request,
  env: Env
): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";

  if (path !== "/api/groups" && !path.startsWith("/api/groups/")) {
    return null;
  }

  const invitePreviewMatch = path.match(/^\/api\/groups\/invite\/([a-f0-9]{32,})$/i);
  const guestSessionMatch = path.match(/^\/api\/groups\/invite\/([a-f0-9]{32,})\/guest-session$/i);
  if (invitePreviewMatch && request.method === "GET") {
    return noStoreJson(await previewInvitation(env, invitePreviewMatch[1]));
  }
  if (guestSessionMatch && request.method === "POST") {
    return await createGuestSession(request, env, guestSessionMatch[1]);
  }
  const declineMatch = path.match(/^\/api\/groups\/invite\/([a-f0-9]{32,})\/decline$/i);
  if (declineMatch && request.method === "POST") {
    const invitation = await invitationByToken(env, declineMatch[1]);
    if (!invitation || !invitationValidity(invitation).valid) return json({ ok: true });
    if (invitation.invitee_email) {
      await dbRun(env.DB, "UPDATE invitations SET status = 'declined', declined_at = datetime('now') WHERE id = ? AND status = 'pending'", [invitation.id]);
    }
    return json({ ok: true });
  }
  if (path === "/api/groups/guest-session/view" && request.method === "GET") {
    return await guestGroupView(request, env);
  }
  if (path === "/api/groups/guest-session/join" && request.method === "POST") {
    return await joinAsGuest(request, env);
  }

  const user = await getUser(request, env);

  if (!user) {
    return json({
      error: "Authentication required. Please sign in."
    }, 401);
  }

  if (path === "/api/groups/guest-session/convert" && request.method === "POST") {
    return await convertGuestMembership(request, env, user);
  }

  const acceptMatch = path.match(/^\/api\/groups\/invite\/([a-f0-9]{32,})\/accept$/i);
  if (acceptMatch && request.method === "POST") {
    return await acceptInvitation(env, acceptMatch[1], user);
  }

  try {
    const emailInviteMatch = path.match(/^\/api\/groups\/(\d+)\/invitations\/email$/);
    if (emailInviteMatch && request.method === "POST") {
      return await sendInvitationEmails(request, env, Number(emailInviteMatch[1]), user);
    }
    const invitationCreateMatch = path.match(/^\/api\/groups\/(\d+)\/invitations$/);
    if (invitationCreateMatch && request.method === "POST") {
      return await createInvitation(request, env, Number(invitationCreateMatch[1]), user);
    }
    const invitationActionMatch = path.match(/^\/api\/groups\/(\d+)\/invitations\/(\d+)\/(resend|revoke)$/);
    if (invitationActionMatch && request.method === "POST") {
      const groupId = Number(invitationActionMatch[1]);
      const invitationId = Number(invitationActionMatch[2]);
      const member = await membership(env, groupId, user.id);
      if (!member) return json({ error: "You are not a member of this group." }, 403);
      const invitation = await dbFirst<any>(env.DB, "SELECT * FROM invitations WHERE id = ? AND group_id = ?", [invitationId, groupId]);
      if (!invitation) return json({ error: "Invitation not found." }, 404);
      if (invitationActionMatch[3] === "revoke") {
        if (member.role !== "admin") return json({ error: "Only group admins can revoke invitations." }, 403);
        await dbRun(env.DB, "UPDATE invitations SET status = 'revoked' WHERE id = ? AND status = 'pending'", [invitationId]);
        return json({ ok: true });
      }
      if (invitation.status !== "pending" || new Date(`${invitation.expires_at.replace(" ", "T")}Z`).getTime() <= Date.now()) {
        return json({ error: "This invitation is no longer active." }, 400);
      }
      if (invitation.invitee_email) {
        const resendRequest = new Request(request.url, {
          method: "POST",
          headers: { "Origin": new URL(request.url).origin, "Content-Type": "application/json" },
          body: JSON.stringify({ recipients: [invitation.invitee_email], requestId: generateOpaqueToken(16) })
        });
        return await sendInvitationEmails(resendRequest, env, groupId, user);
      }
      await dbRun(env.DB, "UPDATE invitations SET last_sent_at = datetime('now'), delivery_status = 'manual_share', delivery_error = NULL WHERE id = ?", [invitationId]);
      const group = await dbFirst<any>(env.DB, "SELECT name FROM groups WHERE id = ?", [groupId]);
      const inviteUrl = inviteUrlFor(env, invitation.token);
      const message = inviteMessage(user.fullName, group?.name ?? "a SettleUp group", inviteUrl);
      const phoneDigits = String(invitation.invitee_phone ?? "").replace(/\D/g, "");
      return json({ inviteUrl, deliveryStatus: "manual_share", deliveryError: null,
        whatsappShareUrl: `https://wa.me/${phoneDigits}?text=${encodeURIComponent(message)}`,
        smsShareUrl: `sms:${invitation.invitee_phone ?? ""}?body=${encodeURIComponent(message)}`,
        emailShareUrl: `mailto:${invitation.invitee_email ?? ""}?subject=${encodeURIComponent(`Invitation to ${group?.name ?? "SettleUp"}`)}&body=${encodeURIComponent(message)}`,
        emailDelivered: false, smsDelivered: false });
    }

    if (path === "/api/groups" && request.method === "GET") {
      return await listGroups(request, env, user);
    }

    if (path === "/api/groups" && request.method === "POST") {
      return await createGroup(request, env, user);
    }

    const roleMatch = path.match(
      /^\/api\/groups\/(\d+)\/members\/(\d+)\/role$/
    );

    if (roleMatch && request.method === "PATCH") {
      return await changeMemberRole(
        request, env,
        Number(roleMatch[1]),
        Number(roleMatch[2]),
        user
      );
    }

    const memberMatch = path.match(
      /^\/api\/groups\/(\d+)\/members\/(\d+)$/
    );

    if (memberMatch && request.method === "DELETE") {
      return await removeMember(
        env,
        Number(memberMatch[1]),
        Number(memberMatch[2]),
        user
      );
    }

    const memberAddMatch = path.match(/^\/api\/groups\/(\d+)\/members$/);

    if (memberAddMatch && request.method === "POST") {
      return await addMember(
        request, env, Number(memberAddMatch[1]), user
      );
    }

    const groupMatch = path.match(/^\/api\/groups\/(\d+)$/);
    if (
  path === "/api/groups/my-pending-invitations" &&
  request.method === "GET"
) {
  const invitations = await dbAll<any>(
    env.DB,
    `SELECT
       i.id,
       i.group_id AS groupId,
       i.invitee_email AS inviteeEmail,
       i.channel,
       i.status,
       i.expires_at AS expiresAt,
       i.created_at AS createdAt,
       g.name AS groupName,
       u.full_name AS invitedByName
     FROM invitations i
     JOIN groups g ON g.id = i.group_id
     JOIN users u ON u.id = i.invited_by
     WHERE LOWER(i.invitee_email) = LOWER(?)
       AND i.status = 'pending'
       AND i.expires_at > datetime('now')
     ORDER BY i.created_at DESC`,
    [user.email]
  );

  return json({ invitations });
}
    if (groupMatch) {
      const groupId = Number(groupMatch[1]);

      if (request.method === "GET") {
        return await getGroup(request, env, groupId, user);
      }

      if (request.method === "PATCH") {
        return await updateGroup(request, env, groupId, user);
      }

      if (request.method === "DELETE") {
        return await deleteGroup(env, groupId, user);
      }
    }

    return json({ error: "Group route not found." }, 404);
  } catch (error) {
    const configurationError = error instanceof Error && error.message.startsWith("CANONICAL_APP_URL");
    console.error("SettleUp group request failed", { method: request.method, errorType: error instanceof Error ? error.name : "UnknownError" });
    return noStoreJson({
      error: configurationError
        ? "Invitation links are unavailable until the verified public CANONICAL_APP_URL is configured."
        : "The group request could not be completed. Check Worker configuration and required D1 migrations."
    }, 500);
  }
}
