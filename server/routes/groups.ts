import { Router } from 'express';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import QRCode from 'qrcode';
import { db } from '../db.ts';
import { computeGroupBalances, getMembership, requireAuth, type AuthedRequest } from '../middleware.ts';
import { createRateLimiter, generateOpaqueToken, hashToken, isValidEmail, normalizePhone } from '../security.ts';
import { isSmtpConfigured, isSmsConfigured, sendGroupInvitationEmail, sendGroupInvitationSms } from '../mailer.ts';

export const groupsRouter = Router();
const guestGroupViewLimiter = createRateLimiter(60_000, 60);
const emailInviteLimiter = createRateLimiter(60_000, 5);

function canonicalAppUrl(): string | null {
  const configured = process.env.APP_URL?.trim() ?? '';
  let parsed: URL;
  try { parsed = new URL(configured); } catch { return null; }
  const host = parsed.hostname.toLowerCase();
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash || host === 'localhost' || host.endsWith('.localhost') || host === '127.0.0.1' || host === '::1') {
    return null;
  }
  return parsed.origin;
}

function parseSqliteUtcMs(ts: string): number {
  if (!ts) return 0;
  const iso = ts.includes('T') ? (ts.endsWith('Z') ? ts : `${ts}Z`) : `${ts.replace(' ', 'T')}Z`;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : 0;
}

function buildWhatsAppShareUrl(groupName: string, inviteUrl: string, phone?: string | null): string {
  const message = `Hey! I've invited you to join my group "${groupName}" on SettleUp. Open this link to view the group as a guest, or sign in to join:\n${inviteUrl}`;
  const digits = phone ? phone.replace(/\D/g, '') : '';
  return digits
    ? `https://wa.me/${digits}?text=${encodeURIComponent(message)}`
    : `https://wa.me/?text=${encodeURIComponent(message)}`;
}

function buildSmsShareUrl(groupName: string, inviterName: string, inviteUrl: string, phone?: string | null): string {
  const message = `${inviterName} invited you to join "${groupName}" on SettleUp. View the group as a guest, or sign in to join:\n${inviteUrl}`;
  const clean = phone ? phone.replace(/[^\d+]/g, '') : '';
  return clean
    ? `sms:${clean}?body=${encodeURIComponent(message)}`
    : `sms:?body=${encodeURIComponent(message)}`;
}

groupsRouter.get('/', requireAuth, (req: AuthedRequest, res) => {
  const userId = req.user!.id;
  const search = ((req.query.search as string) ?? '').trim().toLowerCase();
  const category = ((req.query.category as string) ?? '').trim();
  const includeArchived = req.query.archived === 'true';

  const groupRows = db
    .prepare(`
      SELECT g.*, gm.role AS my_role
      FROM groups g
      JOIN group_members gm ON gm.group_id = g.id
      WHERE gm.user_id = ?
      ORDER BY g.updated_at DESC, g.id DESC
    `)
    .all(userId) as Array<{
    id: number;
    name: string;
    description: string;
    category: string;
    cover_color: string;
    created_by: number;
    is_archived: number;
    created_at: string;
    updated_at: string;
    my_role: string;
  }>;

  const enriched = groupRows
    .filter((g) => (includeArchived ? true : g.is_archived === 0))
    .filter((g) => (!category || category === 'All' ? true : g.category === category))
    .filter((g) =>
      !search
        ? true
        : g.name.toLowerCase().includes(search) || g.description.toLowerCase().includes(search)
    )
    .map((g) => {
      const { members, totalExpenditurePaise } = computeGroupBalances(g.id);
      const me = members.find((m) => m.userId === userId);
      const expenseCountRow = db
        .prepare('SELECT COUNT(*) AS cnt FROM expenses WHERE group_id = ?')
        .get(g.id) as { cnt: number };

      return {
        id: g.id,
        name: g.name,
        description: g.description,
        category: g.category,
        coverColor: g.cover_color,
        isArchived: g.is_archived === 1,
        myRole: g.my_role,
        createdAt: g.created_at,
        memberCount: members.length,
        expenseCount: expenseCountRow.cnt,
        totalExpenditurePaise,
        myNetBalancePaise: me?.netPaise ?? 0,
        members: members.map((m) => ({
          userId: m.userId,
          fullName: m.fullName,
          avatarUrl: m.avatarUrl,
          netPaise: m.netPaise,
        })),
      };
    });

  res.json({ groups: enriched });
});

groupsRouter.get('/my-pending-invitations', requireAuth, (req: AuthedRequest, res) => {
  const email = req.user!.email.toLowerCase();
  const phone = req.user!.phone;

  const rows = db
    .prepare(`
      SELECT i.id, i.group_id, i.channel, i.token, i.expires_at, i.created_at,
             g.name AS group_name, g.description AS group_description, g.category AS group_category,
             u.full_name AS inviter_name
      FROM invitations i
      JOIN groups g ON g.id = i.group_id
      JOIN users u ON u.id = i.invited_by
      WHERE i.status = 'pending'
        AND datetime(i.expires_at) > datetime('now')
        AND i.use_count < i.max_uses
        AND (
          lower(COALESCE(i.invitee_email, '')) = ?
          OR (? IS NOT NULL AND i.invitee_phone = ?)
        )
        AND NOT EXISTS (
          SELECT 1 FROM group_members gm WHERE gm.group_id = i.group_id AND gm.user_id = ?
        )
      ORDER BY i.created_at DESC
    `)
    .all(email, phone, phone, req.user!.id) as Array<{
    id: number;
    group_id: number;
    channel: string;
    token: string;
    expires_at: string;
    created_at: string;
    group_name: string;
    group_description: string;
    group_category: string;
    inviter_name: string;
  }>;

  res.json({ invitations: rows });
});

groupsRouter.post('/', requireAuth, async (req: AuthedRequest, res) => {
  const userId = req.user!.id;
  const { name, description, category, coverColor, memberEmails } = req.body as {
    name?: string;
    description?: string;
    category?: string;
    coverColor?: string;
    memberEmails?: string[];
  };

  const cleanName = (name ?? '').trim();
  if (cleanName.length < 2 || cleanName.length > 80) {
    res.status(400).json({ error: 'Group name must be between 2 and 80 characters.' });
    return;
  }

  const allowedCategories = ['Friends', 'Travel', 'Home & Roommates', 'Family', 'Work & Events', 'Other'];
  const cleanCategory = allowedCategories.includes(category ?? '') ? category! : 'Friends';
  const cleanColor = /^#[0-9A-Fa-f]{6}$/.test(coverColor ?? '') ? coverColor! : '#065F46';

  const pendingEmailTokens: Array<{ email: string; token: string; inviteId: number }> = [];

  const groupId = db.transaction(() => {
    const newGroupId = Number(
      db
        .prepare(`
          INSERT INTO groups (name, description, category, cover_color, created_by)
          VALUES (?, ?, ?, ?, ?)
        `)
        .run(cleanName, (description ?? '').trim(), cleanCategory, cleanColor, userId).lastInsertRowid
    );

    db.prepare("INSERT INTO group_members (group_id, user_id, role) VALUES (?, ?, 'admin')").run(
      newGroupId,
      userId
    );

    const emails = Array.isArray(memberEmails) ? Array.from(new Set(memberEmails.map((e) => e.trim().toLowerCase()))) : [];
    const invitedEmails: string[] = [];
    for (const cleanEmail of emails) {
      if (!isValidEmail(cleanEmail) || cleanEmail === req.user!.email.toLowerCase()) continue;
      const found = db.prepare('SELECT id, full_name FROM users WHERE lower(email) = ?').get(cleanEmail) as
        | { id: number; full_name: string }
        | undefined;
      const token = generateOpaqueToken(16);
      const inviteId = Number(
        db
          .prepare(`
            INSERT INTO invitations (group_id, invited_by, invitee_email, channel, token, delivery_status, max_uses, expires_at)
            VALUES (?, ?, ?, 'email', ?, 'pending', 1, datetime('now', '+14 days'))
          `)
          .run(newGroupId, userId, cleanEmail, token).lastInsertRowid
      );
      pendingEmailTokens.push({ email: cleanEmail, token, inviteId });
      invitedEmails.push(cleanEmail);

      // Never auto-add someone to a private group without their acceptance; send them a pending notification if registered
      if (found) {
        db.prepare(`
          INSERT INTO notifications (user_id, group_id, type, title, message, link_path)
          VALUES (?, ?, 'group_invite', 'Group invitation received', ?, ?)
        `).run(
          found.id,
          newGroupId,
          `${req.user!.fullName} invited you to join "${cleanName}". Would you like to join?`,
          `/guest-group?invite=${token}`
        );
      }
    }

    db.prepare(`
      INSERT INTO activity_logs (group_id, user_id, action, entity_type, entity_id, summary)
      VALUES (?, ?, 'group_created', 'group', ?, ?)
    `).run(
      newGroupId,
      userId,
      newGroupId,
      `${req.user!.fullName} created group "${cleanName}"${invitedEmails.length ? ` and invited ${invitedEmails.length} member(s)` : ''}`
    );

    return newGroupId;
  })();

  const baseUrl = canonicalAppUrl();
  let emailsSentCount = 0;
  for (const item of pendingEmailTokens) {
    if (!baseUrl) {
      db.prepare("UPDATE invitations SET delivery_status = 'not_configured', delivery_error = 'Public APP_URL is not configured.' WHERE id = ?").run(item.inviteId);
      continue;
    }
    const emailRes = await sendGroupInvitationEmail({
      toEmail: item.email,
      groupName: cleanName,
      groupDescription: (description ?? '').trim(),
      inviterName: req.user!.fullName,
      inviteUrl: `${baseUrl}/guest-group?invite=${item.token}`,
      expiresInDays: 14,
    });
    if (emailRes.delivered) emailsSentCount += 1;
    db.prepare(`
      UPDATE invitations
      SET delivery_status = ?, delivery_error = ?, last_sent_at = CASE WHEN ? = 'sent' THEN datetime('now') ELSE NULL END
      WHERE id = ?
    `).run(emailRes.deliveryStatus, emailRes.errorMessage ?? null, emailRes.deliveryStatus, item.inviteId);
  }

  res.status(201).json({
    groupId,
    invitedCount: pendingEmailTokens.length,
    emailsSentCount,
    emailSetupError: pendingEmailTokens.length && !baseUrl ? 'Public APP_URL is not configured; invitations were created but not emailed.' : null,
    smtpConfigured: isSmtpConfigured(),
  });
});

groupsRouter.get('/invite/:token', (req, res) => {
  const token = (req.params.token ?? '').trim();
  if (!token) {
    res.status(404).json({ error: 'Invitation token is missing.' });
    return;
  }

  const inv = db
    .prepare(`
      SELECT i.id, i.group_id, i.channel, i.status, i.max_uses, i.use_count, i.expires_at,
             i.invitee_email, i.invitee_phone,
             g.name AS group_name, g.description AS group_description, g.category AS group_category,
             u.full_name AS inviter_name
      FROM invitations i
      JOIN groups g ON g.id = i.group_id
      JOIN users u ON u.id = i.invited_by
      WHERE i.token = ?
    `)
    .get(token) as
    | {
        id: number;
        group_id: number;
        channel: string;
        status: string;
        max_uses: number;
        use_count: number;
        expires_at: string;
        invitee_email: string | null;
        invitee_phone: string | null;
        group_name: string;
        group_description: string;
        group_category: string;
        inviter_name: string;
      }
    | undefined;

  if (!inv) {
    res.status(404).json({ error: 'Invitation link was not found or is invalid.' });
    return;
  }

  const isExpired = parseSqliteUtcMs(inv.expires_at) <= Date.now();
  const isExhausted = inv.use_count >= inv.max_uses;
  const effectiveStatus =
    inv.status === 'pending' && isExpired
      ? 'expired'
      : inv.status === 'pending' && isExhausted
      ? 'accepted'
      : inv.status;
  const valid = inv.status === 'pending' && !isExpired && !isExhausted;

  let reason = '';
  if (!valid) {
    if (effectiveStatus === 'expired') reason = 'This invitation link has expired. Ask a group member for a new invite.';
    else if (effectiveStatus === 'revoked') reason = 'This invitation has been revoked by a group admin.';
    else if (effectiveStatus === 'declined') reason = 'This invitation was already declined.';
    else reason = 'This invitation has already been used.';
  }

  res.setHeader('Cache-Control', 'no-store');
  res.json({
    valid,
    status: effectiveStatus,
    reason,
    channel: inv.channel,
    requiresEmailMatch: Boolean(inv.invitee_email),
    groupId: inv.group_id,
    groupName: inv.group_name,
    groupCategory: inv.group_category,
    inviterName: inv.inviter_name,
    expiresAt: inv.expires_at,
  });
});

function setGuestSessionCookie(req: import('express').Request, res: import('express').Response, rawToken: string, maxAgeMs: number): void {
  const secure = Boolean(req.secure || process.env.NODE_ENV === 'production');
  res.cookie('settleup_guest_sid', rawToken, {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: '/api/groups',
    maxAge: maxAgeMs,
  });
}

function clearGuestSessionCookie(req: import('express').Request, res: import('express').Response): void {
  const secure = Boolean(req.secure || process.env.NODE_ENV === 'production');
  res.clearCookie('settleup_guest_sid', { httpOnly: true, secure, sameSite: 'lax', path: '/api/groups' });
}

function activeGuestSession(rawToken: string) {
  return db.prepare(`
    SELECT gs.id, gs.group_id, gs.invitation_id, gs.guest_member_id
    FROM guest_sessions gs
    JOIN invitations i ON i.id = gs.invitation_id AND i.group_id = gs.group_id
    JOIN groups g ON g.id = gs.group_id
    WHERE gs.token_hash = ? AND datetime(gs.expires_at) > datetime('now')
      AND i.status = 'pending' AND i.use_count < i.max_uses AND datetime(i.expires_at) > datetime('now')
  `).get(hashToken(rawToken)) as { id: number; group_id: number; invitation_id: number; guest_member_id: number | null } | undefined;
}

function buildGuestGroupPayload(groupId: number, guestMemberId: number | null = null) {
  const group = db.prepare('SELECT id, name, description, category FROM groups WHERE id = ?').get(groupId) as { id: number; name: string; description: string; category: string } | undefined;
  if (!group) return null;
  const members = db.prepare(`
    SELECT u.id, u.full_name, gm.role, gm.joined_at, 0 AS is_guest
    FROM group_members gm JOIN users u ON u.id = gm.user_id WHERE gm.group_id = ?
    UNION ALL
    SELECT -guest.id AS id, guest.display_name AS full_name, 'guest' AS role, guest.joined_at, 1 AS is_guest
    FROM guest_members guest WHERE guest.group_id = ? AND guest.linked_user_id IS NULL
    ORDER BY joined_at, id
  `).all(groupId, groupId);
  const expenses = db.prepare(`SELECT e.id, e.title, e.description, e.notes, e.category, e.split_method, e.total_paise, e.expense_date, payer.full_name AS payer_name, creator.full_name AS creator_name FROM expenses e JOIN users payer ON payer.id = e.paid_by_user_id JOIN users creator ON creator.id = e.created_by_user_id WHERE e.group_id = ? ORDER BY e.expense_date DESC, e.id DESC`).all(groupId) as Array<{ id: number; title: string; description: string; notes: string; category: string; split_method: string; total_paise: number; expense_date: string; payer_name: string; creator_name: string }>;
  const detailedExpenses = expenses.map((expense) => ({
    ...expense,
    shares: db.prepare(`SELECT u.full_name, es.owed_paise FROM expense_splits es JOIN users u ON u.id = es.user_id WHERE es.expense_id = ? ORDER BY es.owed_paise DESC`).all(expense.id),
    items: db.prepare(`SELECT ei.id, ei.name, ei.unit_price_paise, ei.quantity, ei.total_paise, GROUP_CONCAT(u.full_name, ', ') AS consumers FROM expense_items ei LEFT JOIN item_consumers ic ON ic.item_id = ei.id LEFT JOIN users u ON u.id = ic.user_id WHERE ei.expense_id = ? GROUP BY ei.id ORDER BY ei.id`).all(expense.id),
  }));
  const settlements = db.prepare(`SELECT s.id, s.amount_paise, s.status, s.created_at, payer.full_name AS payer_name, receiver.full_name AS receiver_name FROM settlements s JOIN users payer ON payer.id = s.payer_user_id JOIN users receiver ON receiver.id = s.receiver_user_id WHERE s.group_id = ? ORDER BY s.created_at DESC, s.id DESC`).all(groupId);
  const activity = db.prepare(`SELECT a.action, a.entity_type, a.summary, a.created_at, u.full_name AS actor_name FROM activity_logs a JOIN users u ON u.id = a.user_id WHERE a.group_id = ? ORDER BY a.created_at DESC, a.id DESC LIMIT 30`).all(groupId);
  const balances = computeGroupBalances(groupId);
  const guestBalances = (members as Array<{ id: number; full_name: string; is_guest: number }>).filter((member) => member.is_guest).map((member) => ({
    fullName: member.full_name, paidPaise: 0, owedPaise: 0, netPaise: 0,
  }));
  const categoryTotals = db.prepare(`SELECT category, SUM(total_paise) AS total_paise FROM expenses WHERE group_id = ? GROUP BY category ORDER BY total_paise DESC`).all(groupId);
  const guestMember = guestMemberId ? db.prepare('SELECT display_name FROM guest_members WHERE id = ? AND group_id = ? AND linked_user_id IS NULL').get(guestMemberId, groupId) as { display_name: string } | undefined : undefined;
  return {
    group, members, guestMember: guestMember ? { name: guestMember.display_name } : null, expenses: detailedExpenses,
    balances: { members: [...balances.members.map((member) => ({ fullName: member.fullName, paidPaise: member.paidPaise, owedPaise: member.owedPaise, netPaise: member.netPaise })), ...guestBalances], transfers: balances.transfers.map((transfer) => ({ fromName: transfer.fromName, toName: transfer.toName, amountPaise: transfer.amountPaise })), totalExpenditurePaise: balances.totalExpenditurePaise, confirmedSettledPaise: balances.confirmedSettledPaise },
    settlements, activity, analytics: { expenseCount: expenses.length, categoryTotals }, readOnly: true as const,
  };
}

groupsRouter.post('/invite/:token/guest-session', guestGroupViewLimiter, (req, res) => {
  const token = (req.params.token ?? '').trim();
  const invitation = db.prepare('SELECT id, group_id, status, max_uses, use_count, expires_at FROM invitations WHERE token = ?').get(token) as { id: number; group_id: number; status: string; max_uses: number; use_count: number; expires_at: string } | undefined;
  if (!invitation || invitation.status !== 'pending' || invitation.use_count >= invitation.max_uses || parseSqliteUtcMs(invitation.expires_at) <= Date.now()) {
    res.status(403).json({ error: 'This guest invitation is invalid, expired, revoked, or already used.' });
    return;
  }
  const currentToken = (req.cookies as Record<string, string> | undefined)?.settleup_guest_sid;
  if (currentToken) {
    const current = db.prepare(`SELECT id FROM guest_sessions WHERE token_hash = ? AND invitation_id = ? AND group_id = ? AND datetime(expires_at) > datetime('now')`)
      .get(hashToken(currentToken), invitation.id, invitation.group_id);
    if (current) { res.setHeader('Cache-Control', 'no-store'); res.json({ ok: true }); return; }
  }
  const rawSessionToken = generateOpaqueToken(32);
  const expiryMs = Math.min(Date.now() + 12 * 60 * 60 * 1000, parseSqliteUtcMs(invitation.expires_at));
  const expirySql = new Date(expiryMs).toISOString().slice(0, 19).replace('T', ' ');
  db.prepare('DELETE FROM guest_sessions WHERE datetime(expires_at) <= datetime(\'now\')').run();
  db.prepare('INSERT INTO guest_sessions (token_hash, invitation_id, group_id, expires_at) VALUES (?, ?, ?, ?)').run(hashToken(rawSessionToken), invitation.id, invitation.group_id, expirySql);
  setGuestSessionCookie(req, res, rawSessionToken, Math.max(0, expiryMs - Date.now()));
  res.setHeader('Cache-Control', 'no-store');
  res.json({ ok: true, expiresAt: expirySql });
});

groupsRouter.post('/guest-session/join', guestGroupViewLimiter, (req, res) => {
  const rawToken = (req.cookies as Record<string, string> | undefined)?.settleup_guest_sid;
  const session = rawToken ? activeGuestSession(rawToken) : undefined;
  if (!session) { res.status(410).json({ error: 'This guest invitation has expired or is no longer available. Reopen a valid invitation.' }); return; }
  const cleanName = String((req.body as { name?: unknown }).name ?? '').trim().replace(/\s+/g, ' ');
  if (cleanName.length < 2 || cleanName.length > 80 || /[<>\u0000-\u001f\u007f]/.test(cleanName)) {
    res.status(400).json({ error: 'Enter a name between 2 and 80 characters.' });
    return;
  }
  db.transaction(() => {
    db.prepare(`INSERT INTO guest_members (group_id, source_session_id, display_name)
      SELECT group_id, id, ? FROM guest_sessions WHERE id = ? AND guest_member_id IS NULL
      ON CONFLICT(source_session_id) DO NOTHING`).run(cleanName, session.id);
    db.prepare(`UPDATE guest_sessions SET guest_member_id = (SELECT id FROM guest_members WHERE source_session_id = ?)
      WHERE id = ? AND guest_member_id IS NULL`).run(session.id, session.id);
  })();
  const member = db.prepare('SELECT id, display_name FROM guest_members WHERE source_session_id = ?').get(session.id) as { id: number; display_name: string } | undefined;
  if (!member) { res.status(409).json({ error: 'Unable to join this group. Reopen the invitation and try again.' }); return; }
  res.setHeader('Cache-Control', 'no-store');
  res.json({ ok: true, groupId: session.group_id, guest: { id: member.id, name: member.display_name } });
});

groupsRouter.get('/guest-session/view', guestGroupViewLimiter, (req, res) => {
  const rawToken = (req.cookies as Record<string, string> | undefined)?.settleup_guest_sid;
  if (!rawToken) { res.status(401).json({ error: 'Guest session is missing. Reopen your invitation link.' }); return; }
  const session = activeGuestSession(rawToken);
  if (!session) {
    clearGuestSessionCookie(req, res);
    res.status(401).json({ error: 'Guest access has expired or the invitation was revoked.' });
    return;
  }
  const payload = buildGuestGroupPayload(session.group_id, session.guest_member_id);
  if (!payload) { clearGuestSessionCookie(req, res); res.status(404).json({ error: 'The invited group no longer exists.' }); return; }
  res.setHeader('Cache-Control', 'no-store');
  res.json(payload);
});

groupsRouter.post('/guest-session/convert', requireAuth, (req: AuthedRequest, res) => {
  const rawToken = (req.cookies as Record<string, string> | undefined)?.settleup_guest_sid;
  const session = rawToken ? activeGuestSession(rawToken) : undefined;
  if (!session?.guest_member_id) { res.status(404).json({ error: 'No joined guest membership is available to convert.' }); return; }
  const guest = db.prepare('SELECT id, group_id, linked_user_id FROM guest_members WHERE id = ?').get(session.guest_member_id) as { id: number; group_id: number; linked_user_id: number | null } | undefined;
  if (!guest || guest.group_id !== session.group_id) { res.status(410).json({ error: 'Guest membership is no longer available.' }); return; }
  if (guest.linked_user_id && guest.linked_user_id !== req.user!.id) { res.status(409).json({ error: 'This guest identity is already linked to another account.' }); return; }
  const existing = getMembership(session.group_id, req.user!.id);
  db.transaction(() => {
    db.prepare("INSERT OR IGNORE INTO group_members (group_id, user_id, role) VALUES (?, ?, 'member')").run(session.group_id, req.user!.id);
    db.prepare('UPDATE guest_members SET linked_user_id = ? WHERE id = ? AND group_id = ? AND (linked_user_id IS NULL OR linked_user_id = ?)')
      .run(req.user!.id, guest.id, session.group_id, req.user!.id);
  })();
  const linked = db.prepare('SELECT linked_user_id FROM guest_members WHERE id = ? AND group_id = ?').get(guest.id, session.group_id) as { linked_user_id: number | null } | undefined;
  if (linked?.linked_user_id !== req.user!.id) { res.status(409).json({ error: 'Unable to link this guest identity to your account.' }); return; }
  clearGuestSessionCookie(req, res);
  res.setHeader('Cache-Control', 'no-store');
  res.json({ ok: true, groupId: session.group_id, alreadyMember: Boolean(existing) });
});

groupsRouter.post('/invite/:token/accept', requireAuth, (req: AuthedRequest, res) => {
  const token = (req.params.token ?? '').trim();
  const userId = req.user!.id;

  const inv = db
    .prepare(`
      SELECT i.*, g.name AS group_name
      FROM invitations i
      JOIN groups g ON g.id = i.group_id
      WHERE i.token = ?
    `)
    .get(token) as
    | {
        id: number;
        group_id: number;
        invited_by: number;
        invitee_email: string | null;
        invitee_phone: string | null;
        channel: string;
        status: string;
        max_uses: number;
        use_count: number;
        expires_at: string;
        group_name: string;
      }
    | undefined;

  if (!inv) {
    res.status(404).json({ error: 'Invitation not found.' });
    return;
  }

  if (inv.status === 'revoked') {
    res.status(400).json({ error: 'This invitation has been revoked by a group admin.' });
    return;
  }
  if (inv.status === 'declined') {
    res.status(400).json({ error: 'This invitation was declined and can no longer be accepted.' });
    return;
  }
  if (inv.status === 'accepted' || inv.use_count >= inv.max_uses) {
    res.status(400).json({ error: 'This invitation has already been accepted or reached its usage limit.' });
    return;
  }
  if (parseSqliteUtcMs(inv.expires_at) <= Date.now()) {
    db.prepare("UPDATE invitations SET status = 'expired' WHERE id = ? AND status = 'pending'").run(inv.id);
    res.status(400).json({ error: 'This invitation link has expired.' });
    return;
  }

  if (inv.invitee_email && inv.invitee_email.toLowerCase() !== req.user!.email.toLowerCase()) {
    res.status(403).json({
      error: `This email invitation was issued for a different email address than your signed-in account (${req.user!.email}). Please sign in with the invited email or ask for a shareable QR/WhatsApp link.`,
    });
    return;
  }

  const existing = getMembership(inv.group_id, userId);
  if (existing) {
    res.json({ groupId: inv.group_id, groupName: inv.group_name, alreadyMember: true });
    return;
  }

  db.transaction(() => {
    db.prepare("INSERT INTO group_members (group_id, user_id, role) VALUES (?, ?, 'member')").run(
      inv.group_id,
      userId
    );
    const nextUses = inv.use_count + 1;
    const markAccepted = nextUses >= inv.max_uses;
    db.prepare(`
      UPDATE invitations
      SET use_count = ?,
          status = CASE WHEN ? THEN 'accepted' ELSE status END,
          accepted_by_user_id = ?,
          accepted_at = datetime('now')
      WHERE id = ?
    `).run(nextUses, markAccepted ? 1 : 0, userId, inv.id);

    db.prepare(`
      INSERT INTO activity_logs (group_id, user_id, action, entity_type, entity_id, summary)
      VALUES (?, ?, 'member_joined', 'group', ?, ?)
    `).run(
      inv.group_id,
      userId,
      inv.group_id,
      `${req.user!.fullName} joined the group via ${inv.channel} invitation`
    );

    if (inv.invited_by !== userId) {
      db.prepare(`
        INSERT INTO notifications (user_id, group_id, type, title, message, link_path)
        VALUES (?, ?, 'invite_accepted', 'Invitation accepted', ?, '/groups')
      `).run(inv.invited_by, inv.group_id, `${req.user!.fullName} accepted your invitation to join "${inv.group_name}".`);
    }
  })();

  res.json({ groupId: inv.group_id, groupName: inv.group_name, alreadyMember: false });
});

groupsRouter.post('/invite/:token/decline', (req, res) => {
  const token = (req.params.token ?? '').trim();
  const inv = db.prepare('SELECT id, max_uses, status FROM invitations WHERE token = ?').get(token) as
    | { id: number; max_uses: number; status: string }
    | undefined;

  if (!inv) {
    res.status(404).json({ error: 'Invitation not found.' });
    return;
  }

  // Only permanently mark single-use personal invites declined; multi-use group QR links stay usable by other invitees
  if (inv.max_uses === 1 && inv.status === 'pending') {
    db.prepare("UPDATE invitations SET status = 'declined', declined_at = datetime('now') WHERE id = ?").run(inv.id);
  }

  res.json({ ok: true });
});

groupsRouter.get('/:id', requireAuth, async (req: AuthedRequest, res) => {
  const groupId = Number(req.params.id);
  const userId = req.user!.id;

  const membership = getMembership(groupId, userId);
  if (!membership) {
    res.status(403).json({ error: 'Access denied. You are not a member of this group.' });
    return;
  }

  const group = db.prepare('SELECT * FROM groups WHERE id = ?').get(groupId) as
    | {
        id: number;
        name: string;
        description: string;
        category: string;
        cover_color: string;
        created_by: number;
        is_archived: number;
        created_at: string;
        updated_at: string;
      }
    | undefined;

  if (!group) {
    res.status(404).json({ error: 'Group not found.' });
    return;
  }

  const { members, transfers, totalExpenditurePaise, confirmedSettledPaise } = computeGroupBalances(groupId);

  const memberRoles = db
    .prepare('SELECT user_id, role, joined_at FROM group_members WHERE group_id = ?')
    .all(groupId) as Array<{ user_id: number; role: string; joined_at: string }>;
  const roleMap = new Map(memberRoles.map((r) => [r.user_id, r]));

  const expenses = db
    .prepare(`
      SELECT e.*, payer.full_name AS payer_name, creator.full_name AS creator_name
      FROM expenses e
      JOIN users payer ON payer.id = e.paid_by_user_id
      JOIN users creator ON creator.id = e.created_by_user_id
      WHERE e.group_id = ?
      ORDER BY e.expense_date DESC, e.id DESC
    `)
    .all(groupId) as Array<{
    id: number;
    title: string;
    description: string;
    category: string;
    split_method: string;
    total_paise: number;
    expense_date: string;
    paid_by_user_id: number;
    payer_name: string;
    creator_name: string;
  }>;

  const rawInvitations = db
    .prepare(`
      SELECT id, invitee_email, invitee_phone, channel, token, status, delivery_status,
             delivery_error, max_uses, use_count, expires_at, created_at, last_sent_at
      FROM invitations
      WHERE group_id = ?
      ORDER BY created_at DESC, id DESC
    `)
    .all(groupId) as Array<{
    id: number;
    invitee_email: string | null;
    invitee_phone: string | null;
    channel: string;
    token: string;
    status: string;
    delivery_status: string;
    delivery_error: string | null;
    max_uses: number;
    use_count: number;
    expires_at: string;
    created_at: string;
    last_sent_at: string | null;
  }>;

  const nowMs = Date.now();
  const baseUrl = canonicalAppUrl();
  const invitations = rawInvitations.map((inv) => {
    const expired = inv.status === 'pending' && parseSqliteUtcMs(inv.expires_at) <= nowMs;
    const effectiveStatus = expired ? 'expired' : inv.status;
    return {
      ...inv,
      status: effectiveStatus,
      inviteUrl: baseUrl ? `${baseUrl}/guest-group?invite=${inv.token}` : null,
    };
  });

  const activeQrInvite = invitations.find(
    (inv) =>
      inv.status === 'pending' &&
      !inv.invitee_email &&
      !inv.invitee_phone &&
      Boolean(inv.inviteUrl) &&
      inv.use_count < inv.max_uses
  );

  const inviteQrDataUrl = activeQrInvite
    ? await QRCode.toDataURL(activeQrInvite.inviteUrl!, {
        width: 260,
        margin: 1,
        color: { dark: '#0F172A', light: '#FFFFFF' },
      })
    : null;

  const activities = db
    .prepare(`
      SELECT a.*, u.full_name AS actor_name
      FROM activity_logs a
      JOIN users u ON u.id = a.user_id
      WHERE a.group_id = ?
      ORDER BY a.created_at DESC, a.id DESC
      LIMIT 30
    `)
    .all(groupId);

  const settlements = db
    .prepare(`
      SELECT s.*, p.full_name AS payer_name, r.full_name AS receiver_name
      FROM settlements s
      JOIN users p ON p.id = s.payer_user_id
      JOIN users r ON r.id = s.receiver_user_id
      WHERE s.group_id = ?
      ORDER BY s.created_at DESC, s.id DESC
    `)
    .all(groupId);

  const guestMemberRows = db.prepare(`SELECT id, display_name, joined_at FROM guest_members
    WHERE group_id = ? AND linked_user_id IS NULL ORDER BY joined_at, id`).all(groupId) as Array<{ id: number; display_name: string; joined_at: string }>;
  const workspaceMembers = [
    ...members.map((member) => ({
      ...member,
      role: roleMap.get(member.userId)?.role ?? 'member',
      joinedAt: roleMap.get(member.userId)?.joined_at ?? '',
      isGuest: false,
    })),
    ...guestMemberRows.map((member) => ({
      userId: -member.id, fullName: member.display_name, email: '', upiId: null, avatarUrl: null,
      role: 'guest', isGuest: true, joinedAt: member.joined_at,
      paidPaise: 0, owedPaise: 0, netPaise: 0,
      settlementsPaidPaise: 0, settlementsReceivedPaise: 0, pendingIncomingPaise: 0,
    })),
  ];

  res.json({
    group: {
      id: group.id,
      name: group.name,
      description: group.description,
      category: group.category,
      coverColor: group.cover_color,
      isArchived: group.is_archived === 1,
      myRole: membership.role,
      createdAt: group.created_at,
      totalExpenditurePaise,
      confirmedSettledPaise,
    },
    members: workspaceMembers,
    transfers,
    expenses,
    invitations,
    inviteQrDataUrl,
    activeInviteUrl: activeQrInvite?.inviteUrl ?? null,
    smtpConfigured: isSmtpConfigured(),
    smsConfigured: isSmsConfigured(),
    activities,
    settlements,
  });
});

groupsRouter.patch('/:id', requireAuth, (req: AuthedRequest, res) => {
  const groupId = Number(req.params.id);
  const membership = getMembership(groupId, req.user!.id);
  if (!membership || membership.role !== 'admin') {
    res.status(403).json({ error: 'Only group admins can update group settings.' });
    return;
  }

  const { name, description, category, coverColor, isArchived } = req.body as {
    name?: string;
    description?: string;
    category?: string;
    coverColor?: string;
    isArchived?: boolean;
  };

  if (name !== undefined && name.trim().length < 2) {
    res.status(400).json({ error: 'Group name must be at least 2 characters.' });
    return;
  }

  const existing = db.prepare('SELECT * FROM groups WHERE id = ?').get(groupId) as
    | { name: string; description: string; category: string; cover_color: string; is_archived: number }
    | undefined;
  if (!existing) {
    res.status(404).json({ error: 'Group not found.' });
    return;
  }

  db.prepare(`
    UPDATE groups
    SET name = ?, description = ?, category = ?, cover_color = ?, is_archived = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(
    name !== undefined ? name.trim() : existing.name,
    description !== undefined ? description.trim() : existing.description,
    category !== undefined ? category : existing.category,
    coverColor !== undefined ? coverColor : existing.cover_color,
    isArchived !== undefined ? (isArchived ? 1 : 0) : existing.is_archived,
    groupId
  );

  db.prepare(`
    INSERT INTO activity_logs (group_id, user_id, action, entity_type, entity_id, summary)
    VALUES (?, ?, 'group_updated', 'group', ?, ?)
  `).run(groupId, req.user!.id, groupId, `${req.user!.fullName} updated group settings`);

  res.json({ ok: true });
});

groupsRouter.delete('/:id', requireAuth, (req: AuthedRequest, res) => {
  const groupId = Number(req.params.id);
  const membership = getMembership(groupId, req.user!.id);
  if (!membership || membership.role !== 'admin') {
    res.status(403).json({ error: 'Only group admins can delete this group.' });
    return;
  }

  const { members } = computeGroupBalances(groupId);
  const unsettled = members.some((m) => m.netPaise !== 0);
  if (unsettled) {
    res.status(400).json({
      error: 'Cannot delete a group with unsettled member balances. Settle balances or archive the group instead.',
    });
    return;
  }

  db.prepare('DELETE FROM groups WHERE id = ?').run(groupId);
  res.json({ ok: true });
});

groupsRouter.post('/:id/members', requireAuth, async (req: AuthedRequest, res) => {
  const groupId = Number(req.params.id);
  const membership = getMembership(groupId, req.user!.id);
  if (!membership) {
    res.status(403).json({ error: 'You must be a group member to invite others.' });
    return;
  }

  const { email } = req.body as { email?: string };
  const cleanEmail = (email ?? '').trim().toLowerCase();
  if (!isValidEmail(cleanEmail)) {
    res.status(400).json({ error: 'Enter a valid email address.' });
    return;
  }

  const group = db.prepare('SELECT name, description FROM groups WHERE id = ?').get(groupId) as
    | { name: string; description: string }
    | undefined;
  if (!group) {
    res.status(404).json({ error: 'Group not found.' });
    return;
  }

  const targetUser = db.prepare('SELECT id, full_name FROM users WHERE lower(email) = ?').get(cleanEmail) as
    | { id: number; full_name: string }
    | undefined;

  if (targetUser) {
    const already = getMembership(groupId, targetUser.id);
    if (already) {
      res.status(409).json({ error: `${targetUser.full_name} is already a member of this group.` });
      return;
    }

    db.transaction(() => {
      db.prepare("INSERT INTO group_members (group_id, user_id, role) VALUES (?, ?, 'member')").run(
        groupId,
        targetUser.id
      );
      db.prepare(`
        INSERT INTO notifications (user_id, group_id, type, title, message, link_path)
        VALUES (?, ?, 'group_joined', 'Added to group', ?, '/groups')
      `).run(targetUser.id, groupId, `${req.user!.fullName} added you to "${group.name}".`);
      db.prepare(`
        INSERT INTO activity_logs (group_id, user_id, action, entity_type, entity_id, summary)
        VALUES (?, ?, 'member_added', 'user', ?, ?)
      `).run(groupId, req.user!.id, targetUser.id, `${req.user!.fullName} added ${targetUser.full_name} to the group`);
    })();

    res.status(201).json({ status: 'added', memberName: targetUser.full_name });
    return;
  }

  const baseUrl = canonicalAppUrl();
  if (!baseUrl) {
    res.status(503).json({ error: 'Public APP_URL is not configured. Set it to the verified Cloudflare HTTPS origin before generating invitation links.' });
    return;
  }

  const duplicate = db
    .prepare(`
      SELECT id, token, expires_at FROM invitations
      WHERE group_id = ? AND lower(COALESCE(invitee_email, '')) = ?
        AND status = 'pending' AND datetime(expires_at) > datetime('now')
      ORDER BY created_at DESC, id DESC LIMIT 1
    `)
    .get(groupId, cleanEmail) as { id: number; token: string; expires_at: string } | undefined;

  const token = duplicate?.token ?? generateOpaqueToken(16);
  const inviteId = duplicate?.id ?? Number(
    db.prepare(`
      INSERT INTO invitations (group_id, invited_by, invitee_email, channel, token, delivery_status, max_uses, expires_at)
      VALUES (?, ?, ?, 'email', ?, 'pending', 1, datetime('now', '+14 days'))
    `).run(groupId, req.user!.id, cleanEmail, token).lastInsertRowid
  );
  if (duplicate) db.prepare("UPDATE invitations SET expires_at = datetime('now', '+14 days') WHERE id = ?").run(inviteId);
  const inviteExpiresInDays = 14;

  const inviteUrl = `${baseUrl}/guest-group?invite=${token}`;
  const emailResult = await sendGroupInvitationEmail({
    toEmail: cleanEmail,
    groupName: group.name,
    groupDescription: group.description,
    inviterName: req.user!.fullName,
    inviteUrl,
    expiresInDays: inviteExpiresInDays,
  });

  db.prepare(`
    UPDATE invitations
    SET delivery_status = ?, delivery_error = ?, last_sent_at = CASE WHEN ? = 'sent' THEN datetime('now') ELSE NULL END
    WHERE id = ?
  `).run(emailResult.deliveryStatus, emailResult.errorMessage ?? null, emailResult.deliveryStatus, inviteId);

  res.status(duplicate ? 200 : 201).json({
    status: duplicate ? 'resent' : 'invited',
    invitationId: inviteId,
    reusedExistingInvite: Boolean(duplicate),
    inviteUrl,
    emailDelivered: emailResult.delivered,
    deliveryStatus: emailResult.deliveryStatus,
    deliveryError: emailResult.errorMessage ?? null,
    smtpConfigured: isSmtpConfigured(),
  });
});

groupsRouter.patch('/:id/members/:memberId/role', requireAuth, (req: AuthedRequest, res) => {
  const groupId = Number(req.params.id);
  const memberId = Number(req.params.memberId);
  const { role } = req.body as { role?: string };

  const myMembership = getMembership(groupId, req.user!.id);
  if (!myMembership || myMembership.role !== 'admin') {
    res.status(403).json({ error: 'Only group admins can change member roles.' });
    return;
  }

  if (role !== 'admin' && role !== 'member') {
    res.status(400).json({ error: 'Invalid role.' });
    return;
  }

  if (memberId === req.user!.id && role !== 'admin') {
    const adminCount = (
      db
        .prepare("SELECT COUNT(*) AS cnt FROM group_members WHERE group_id = ? AND role = 'admin'")
        .get(groupId) as { cnt: number }
    ).cnt;
    if (adminCount <= 1) {
      res.status(400).json({ error: 'Assign another admin before stepping down.' });
      return;
    }
  }

  db.prepare('UPDATE group_members SET role = ? WHERE group_id = ? AND user_id = ?').run(
    role,
    groupId,
    memberId
  );
  res.json({ ok: true });
});

groupsRouter.delete('/:id/members/:memberId', requireAuth, (req: AuthedRequest, res) => {
  const groupId = Number(req.params.id);
  const memberId = Number(req.params.memberId);

  const myMembership = getMembership(groupId, req.user!.id);
  if (!myMembership || (myMembership.role !== 'admin' && memberId !== req.user!.id)) {
    res.status(403).json({ error: 'Only group admins can remove other members.' });
    return;
  }

  const { members } = computeGroupBalances(groupId);
  const target = members.find((m) => m.userId === memberId);
  if (!target) {
    res.status(404).json({ error: 'Member not found in group.' });
    return;
  }

  if (target.netPaise !== 0) {
    res.status(400).json({
      error: `${target.fullName} has a non-zero balance in this group. Settle balances before removing.`,
    });
    return;
  }

  db.prepare('DELETE FROM group_members WHERE group_id = ? AND user_id = ?').run(groupId, memberId);
  db.prepare(`
    INSERT INTO activity_logs (group_id, user_id, action, entity_type, entity_id, summary)
    VALUES (?, ?, 'member_removed', 'user', ?, ?)
  `).run(groupId, req.user!.id, memberId, `${target.fullName} left or was removed from the group`);

  res.json({ ok: true });
});

groupsRouter.post('/:id/invitations/email', requireAuth, emailInviteLimiter, async (req: AuthedRequest, res) => {
  const groupId = Number(req.params.id);
  const userId = req.user!.id;
  const expectedOrigin = `${req.protocol}://${req.get('host')}`;
  if (!req.get('origin') || req.get('origin') !== expectedOrigin) { res.status(403).json({ error: 'Request origin could not be verified.' }); return; }
  const recipientsValue = (req.body as { recipients?: unknown }).recipients;
  if (!Array.isArray(recipientsValue) || recipientsValue.length < 1 || recipientsValue.length > 5) {
    res.status(400).json({ error: 'Enter between 1 and 5 recipient addresses.' }); return;
  }
  const recipients = recipientsValue.map((email) => String(email ?? '').trim().toLowerCase());
  if (recipients.some((email) => email.length > 254 || !isValidEmail(email))) { res.status(400).json({ error: 'One or more recipient email addresses are invalid.' }); return; }
  if (new Set(recipients).size !== recipients.length) { res.status(400).json({ error: 'Remove duplicate recipient addresses before sending.' }); return; }
  const requestId = String((req.body as { requestId?: unknown }).requestId ?? '');
  if (!/^[a-zA-Z0-9_-]{16,80}$/.test(requestId)) { res.status(400).json({ error: 'Refresh the invitation form and try again.' }); return; }
  const canonical = canonicalAppUrl();
  if (!canonical) { res.status(503).json({ error: 'Set APP_URL to the verified public HTTPS origin before sending invitations.' }); return; }
  const scriptUrl = process.env.APPS_SCRIPT_URL?.trim() ?? '';
  try {
    const parsed = new URL(scriptUrl);
    if (parsed.protocol !== 'https:' || parsed.hostname !== 'script.google.com' || !/^\/macros\/s\/[^/]+\/exec\/?$/.test(parsed.pathname)) throw new Error();
  } catch { res.status(503).json({ error: 'Email delivery is not configured. Set the Apps Script web app endpoint.' }); return; }
  const secret = process.env.EMAIL_INTEGRATION_SECRET ?? '';
  if (secret.length < 32) { res.status(503).json({ error: 'Email delivery is not configured. Set the Worker integration secret.' }); return; }
  if (!getMembership(groupId, userId)) { res.status(403).json({ error: 'You must be a registered group member to send invitations.' }); return; }
  const group = db.prepare('SELECT id, name FROM groups WHERE id = ?').get(groupId) as { id: number; name: string } | undefined;
  if (!group) { res.status(404).json({ error: 'Group not found.' }); return; }
  const previous = db.prepare('SELECT group_id, requested_by_user_id, response_json FROM email_invite_batches WHERE request_id = ?').get(requestId) as { group_id: number; requested_by_user_id: number; response_json: string | null } | undefined;
  if (previous) {
    if (previous.group_id !== groupId || previous.requested_by_user_id !== userId) { res.status(409).json({ error: 'This request identifier is already in use.' }); return; }
    if (previous.response_json) { res.json(JSON.parse(previous.response_json)); return; }
    res.status(409).json({ error: 'This invitation request is still being processed.' }); return;
  }

  type PendingMailInvite = { id: number; email: string; token: string };
  let invites: PendingMailInvite[];
  try {
    invites = db.transaction(() => {
      const used = db.prepare("SELECT COALESCE(SUM(recipient_count), 0) AS total FROM email_invite_usage WHERE user_id = ? AND date(created_at) = date('now')").get(userId) as { total: number };
      if (Number(used.total) + recipients.length > 50) throw new Error('DAILY_LIMIT');
      db.prepare('INSERT INTO email_invite_usage (request_id, user_id, recipient_count) VALUES (?, ?, ?)').run(requestId, userId, recipients.length);
      db.prepare("INSERT INTO email_invite_batches (request_id, group_id, requested_by_user_id, status) VALUES (?, ?, ?, 'pending')").run(requestId, groupId, userId);
      const expiresAt = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 19).replace('T', ' ');
      const results: PendingMailInvite[] = [];
      for (const email of recipients) {
        const existing = db.prepare(`SELECT id, token FROM invitations WHERE group_id = ? AND lower(COALESCE(invitee_email, '')) = ?
          AND status = 'pending' AND use_count < max_uses AND datetime(expires_at) > datetime('now')
          ORDER BY created_at DESC, id DESC LIMIT 1`).get(groupId, email) as { id: number; token: string } | undefined;
        if (existing) {
          db.prepare("UPDATE invitations SET channel = 'email', expires_at = ?, delivery_status = 'pending', delivery_error = NULL WHERE id = ?").run(expiresAt, existing.id);
          results.push({ id: existing.id, email, token: existing.token });
        } else {
          const token = generateOpaqueToken(32);
          const id = Number(db.prepare(`INSERT INTO invitations
            (group_id, invited_by, invitee_email, channel, token, status, delivery_status, max_uses, expires_at, last_sent_at)
            VALUES (?, ?, ?, 'email', ?, 'pending', 'pending', 1, ?, datetime('now'))`).run(groupId, userId, email, token, expiresAt).lastInsertRowid);
          results.push({ id, email, token });
        }
      }
      return results;
    })();
  } catch (error) {
    if (error instanceof Error && error.message === 'DAILY_LIMIT') { res.status(429).json({ error: 'Daily invitation limit reached (maximum 50 recipients per account).' }); return; }
    res.status(500).json({ error: 'Could not prepare the invitation request.' }); return;
  }

  const payloadJson = JSON.stringify({
    senderName: req.user!.fullName.slice(0, 120), groupName: group.name.slice(0, 120),
    invitations: invites.map(({ email, token }) => ({ email, url: `${canonical}/guest-group?invite=${encodeURIComponent(token)}` }))
  });
  const timestamp = String(Date.now());
  const nonce = randomBytes(24).toString('hex');
  const signed = `${timestamp}\n${nonce}\n${requestId}\n${payloadJson}`;
  const signature = createHmac('sha256', secret).update(signed, 'utf8').digest('hex');
  let delivery: any;
  try {
    const result = await fetch(scriptUrl, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ timestamp, nonce, requestId, payload: payloadJson, signature }),
      redirect: 'follow', signal: AbortSignal.timeout(20_000),
    });
    const text = await result.text();
    if (text.length > 16000) throw new Error('Oversized response');
    delivery = JSON.parse(text);
    if (!result.ok || !Array.isArray(delivery.results)) throw new Error('Unconfirmed delivery');
  } catch {
    const failedIndexes = invites.map((_, index) => index);
    const failedResults = failedIndexes.map((index) => ({ index, ok: false, error: 'delivery_unconfirmed' }));
    const safe = { ok: false, sentCount: 0, failedIndexes, results: failedResults, requestId, error: 'Email delivery could not be confirmed. Check status before creating a new request.' };
    db.transaction(() => {
      for (const invite of invites) db.prepare("UPDATE invitations SET delivery_status = 'failed', delivery_error = 'Email delivery could not be confirmed.' WHERE id = ?").run(invite.id);
      db.prepare("UPDATE email_invite_batches SET status = 'failed', response_json = ?, updated_at = datetime('now') WHERE request_id = ?").run(JSON.stringify(safe), requestId);
    })();
    res.status(502).json(safe); return;
  }
  const results = invites.map((_, index) => {
    const row = delivery.results.find((item: any) => Number(item.index) === index);
    return { index, ok: Boolean(row?.ok), error: row?.ok ? undefined : String(row?.error ?? 'send_failed').slice(0, 180) };
  });
  const sentCount = results.filter((item) => item.ok).length;
  const failedIndexes = results.filter((item) => !item.ok).map((item) => item.index);
  const safe = { ok: failedIndexes.length === 0, sentCount, failedIndexes, results, requestId };
  db.transaction(() => {
    for (const [index, invite] of invites.entries()) db.prepare('UPDATE invitations SET delivery_status = ?, delivery_error = ? WHERE id = ?').run(results[index].ok ? 'sent' : 'failed', results[index].ok ? null : results[index].error, invite.id);
    db.prepare('UPDATE email_invite_batches SET status = ?, response_json = ?, updated_at = datetime(\'now\') WHERE request_id = ?').run(failedIndexes.length === 0 ? 'sent' : sentCount ? 'partial' : 'failed', JSON.stringify(safe), requestId);
  })();
  res.json(safe);
});

groupsRouter.post('/:id/invitations', requireAuth, async (req: AuthedRequest, res) => {
  const groupId = Number(req.params.id);
  const membership = getMembership(groupId, req.user!.id);
  if (!membership) {
    res.status(403).json({ error: 'Only group members can create invitations.' });
    return;
  }

  const group = db.prepare('SELECT name, description FROM groups WHERE id = ?').get(groupId) as
    | { name: string; description: string }
    | undefined;
  if (!group) {
    res.status(404).json({ error: 'Group not found.' });
    return;
  }

  const { channel = 'qr', inviteeEmail, inviteePhone, deliveryMode = 'whatsapp', reuseExisting = false, expiresInDays } = req.body as {
    channel?: 'qr' | 'email' | 'whatsapp' | 'phone' | 'link';
    inviteeEmail?: string;
    inviteePhone?: string;
    deliveryMode?: 'whatsapp' | 'sms';
    reuseExisting?: boolean;
    expiresInDays?: number;
  };

  const validChannels = ['qr', 'email', 'whatsapp', 'phone', 'link'] as const;
  const cleanChannel = validChannels.includes(channel) ? channel : 'qr';
  const days = Math.min(90, Math.max(1, Number(expiresInDays ?? 14) || 14));
  const baseUrl = canonicalAppUrl();
  if (!baseUrl) {
    res.status(503).json({ error: 'Public APP_URL is not configured. Set it to the verified Cloudflare HTTPS origin before generating invitation links.' });
    return;
  }

  if (cleanChannel === 'email') {
    const cleanEmail = (inviteeEmail ?? '').trim().toLowerCase();
    if (!isValidEmail(cleanEmail)) {
      res.status(400).json({ error: 'Please enter a valid email address.' });
      return;
    }

    const existingUser = db.prepare('SELECT id, full_name FROM users WHERE lower(email) = ?').get(cleanEmail) as
      | { id: number; full_name: string }
      | undefined;
    if (existingUser && getMembership(groupId, existingUser.id)) {
      res.status(409).json({ error: `${existingUser.full_name} is already a member of this group.` });
      return;
    }

    const duplicate = db
      .prepare(`
        SELECT id, token, expires_at FROM invitations
        WHERE group_id = ? AND lower(COALESCE(invitee_email, '')) = ?
          AND status = 'pending' AND datetime(expires_at) > datetime('now')
        ORDER BY created_at DESC, id DESC LIMIT 1
      `)
      .get(groupId, cleanEmail) as { id: number; token: string; expires_at: string } | undefined;

    const token = duplicate?.token ?? generateOpaqueToken(16);
    const inviteId = duplicate?.id ?? Number(
      db.prepare(`
        INSERT INTO invitations (group_id, invited_by, invitee_email, channel, token, delivery_status, max_uses, expires_at)
        VALUES (?, ?, ?, 'email', ?, 'pending', 1, datetime('now', '+' || ? || ' days'))
      `).run(groupId, req.user!.id, cleanEmail, token, days).lastInsertRowid
    );
    if (duplicate) db.prepare("UPDATE invitations SET expires_at = datetime('now', '+' || ? || ' days') WHERE id = ?").run(days, inviteId);
    const inviteExpiresInDays = days;

    const inviteUrl = `${baseUrl}/guest-group?invite=${token}`;
    const emailResult = await sendGroupInvitationEmail({
      toEmail: cleanEmail,
      groupName: group.name,
      groupDescription: group.description,
      inviterName: req.user!.fullName,
      inviteUrl,
      expiresInDays: inviteExpiresInDays,
    });

    db.prepare(`
      UPDATE invitations
      SET delivery_status = ?, delivery_error = ?, last_sent_at = CASE WHEN ? = 'sent' THEN datetime('now') ELSE NULL END
      WHERE id = ?
    `).run(emailResult.deliveryStatus, emailResult.errorMessage ?? null, emailResult.deliveryStatus, inviteId);

    if (existingUser) {
      db.prepare(`
        INSERT INTO notifications (user_id, group_id, type, title, message, link_path)
        VALUES (?, ?, 'group_invite', 'Group invitation received', ?, ?)
      `).run(
        existingUser.id,
        groupId,
        `${req.user!.fullName} invited you to join "${group.name}". Would you like to join?`,
        `/guest-group?invite=${token}`
      );
    }

    const qrDataUrl = await QRCode.toDataURL(inviteUrl, {
      width: 260,
      margin: 1,
      color: { dark: '#0F172A', light: '#FFFFFF' },
    });

    res.status(duplicate ? 200 : 201).json({
      invitationId: inviteId,
      reusedExistingInvite: Boolean(duplicate),
      channel: 'email',
      inviteUrl,
      qrDataUrl,
      whatsappShareUrl: buildWhatsAppShareUrl(group.name, inviteUrl),
      emailDelivered: emailResult.delivered,
      deliveryStatus: emailResult.deliveryStatus,
      deliveryError: emailResult.errorMessage ?? null,
      smtpConfigured: isSmtpConfigured(),
    });
    return;
  }

  if (cleanChannel === 'phone') {
    const rawPhone = (inviteePhone ?? '').trim();
    const cleanPhone = normalizePhone(rawPhone);
    if (!cleanPhone) {
      res.status(400).json({ error: 'Enter a valid mobile number with country code (e.g., +91 9876543210).' });
      return;
    }

    const matchedUser = db.prepare('SELECT id, full_name FROM users WHERE phone = ?').get(cleanPhone) as
      | { id: number; full_name: string }
      | undefined;

    if (matchedUser && getMembership(groupId, matchedUser.id)) {
      res.status(409).json({ error: 'A member with this mobile number is already in the group.' });
      return;
    }

    const duplicate = db
      .prepare(`
        SELECT id, token FROM invitations
        WHERE group_id = ? AND invitee_phone = ?
          AND status = 'pending' AND datetime(expires_at) > datetime('now')
        ORDER BY created_at DESC, id DESC LIMIT 1
      `)
      .get(groupId, cleanPhone) as { id: number; token: string } | undefined;

    const token = duplicate?.token ?? generateOpaqueToken(16);
    const inviteId = duplicate?.id ?? Number(
      db.prepare(`
        INSERT INTO invitations (group_id, invited_by, invitee_phone, channel, token, delivery_status, max_uses, expires_at)
        VALUES (?, ?, ?, 'phone', ?, 'pending', 1, datetime('now', '+' || ? || ' days'))
      `).run(groupId, req.user!.id, cleanPhone, token, days).lastInsertRowid
    );

    if (duplicate) db.prepare("UPDATE invitations SET expires_at = datetime('now', '+' || ? || ' days') WHERE id = ?").run(days, inviteId);
    const inviteUrl = `${baseUrl}/guest-group?invite=${token}`;

    let smsDelivered = false;
    let deliveryStatus: 'sent' | 'not_configured' | 'failed' | 'manual_share' = 'manual_share';
    let deliveryError: string | null = null;

    if (deliveryMode === 'sms') {
      const smsRes = await sendGroupInvitationSms({
        toPhone: cleanPhone,
        groupName: group.name,
        inviterName: req.user!.fullName,
        inviteUrl,
      });
      smsDelivered = smsRes.delivered;
      deliveryStatus = smsRes.deliveryStatus;
      deliveryError = smsRes.errorMessage ?? null;
    }

    db.prepare(`
      UPDATE invitations
      SET delivery_status = ?, delivery_error = ?, last_sent_at = CASE WHEN ? = 'sent' THEN datetime('now') ELSE NULL END
      WHERE id = ?
    `).run(deliveryStatus, deliveryError, deliveryStatus, inviteId);

    if (matchedUser) {
      db.prepare(`
        INSERT INTO notifications (user_id, group_id, type, title, message, link_path)
        VALUES (?, ?, 'group_invite', 'Group invitation received', ?, ?)
      `).run(
        matchedUser.id,
        groupId,
        `${req.user!.fullName} invited you to join "${group.name}". Would you like to join?`,
        `/guest-group?invite=${token}`
      );
    }

    const qrDataUrl = await QRCode.toDataURL(inviteUrl, {
      width: 260,
      margin: 1,
      color: { dark: '#0F172A', light: '#FFFFFF' },
    });

    res.status(duplicate ? 200 : 201).json({
      invitationId: inviteId,
      reusedExistingInvite: Boolean(duplicate),
      channel: 'phone',
      deliveryMode,
      inviteUrl,
      qrDataUrl,
      whatsappShareUrl: buildWhatsAppShareUrl(group.name, inviteUrl, cleanPhone),
      smsShareUrl: buildSmsShareUrl(group.name, req.user!.fullName, inviteUrl, cleanPhone),
      hasExistingAccount: Boolean(matchedUser),
      smsSent: smsDelivered,
      smsConfigured: isSmsConfigured(),
      deliveryStatus,
      deliveryError,
    });
    return;
  }

  // QR, WhatsApp, or shareable Link invitation
  if (reuseExisting) {
    const existingActive = db
      .prepare(`
        SELECT id, token, channel
        FROM invitations
        WHERE group_id = ?
          AND invitee_email IS NULL
          AND invitee_phone IS NULL
          AND status = 'pending'
          AND use_count < max_uses
          AND datetime(expires_at) > datetime('now')
        ORDER BY id DESC
        LIMIT 1
      `)
      .get(groupId) as { id: number; token: string; channel: string } | undefined;

    if (existingActive) {
      const inviteUrl = `${baseUrl}/guest-group?invite=${existingActive.token}`;
      const qrDataUrl = await QRCode.toDataURL(inviteUrl, {
        width: 260,
        margin: 1,
        color: { dark: '#0F172A', light: '#FFFFFF' },
      });
      res.status(200).json({
        invitationId: existingActive.id,
        channel: existingActive.channel,
        inviteUrl,
        qrDataUrl,
        whatsappShareUrl: buildWhatsAppShareUrl(group.name, inviteUrl),
        deliveryStatus: 'manual_share',
      });
      return;
    }
  }

  const token = generateOpaqueToken(16);
  const maxUses = cleanChannel === 'qr' || cleanChannel === 'link' ? 25 : 15;
  const inviteId = Number(
    db
      .prepare(`
        INSERT INTO invitations (group_id, invited_by, channel, token, delivery_status, max_uses, expires_at)
        VALUES (?, ?, ?, ?, 'manual_share', ?, datetime('now', '+' || ? || ' days'))
      `)
      .run(groupId, req.user!.id, cleanChannel, token, maxUses, days).lastInsertRowid
  );

  const inviteUrl = `${baseUrl}/guest-group?invite=${token}`;
  const qrDataUrl = await QRCode.toDataURL(inviteUrl, {
    width: 260,
    margin: 1,
    color: { dark: '#0F172A', light: '#FFFFFF' },
  });

  res.status(201).json({
    invitationId: inviteId,
    channel: cleanChannel,
    inviteUrl,
    qrDataUrl,
    whatsappShareUrl: buildWhatsAppShareUrl(group.name, inviteUrl),
    deliveryStatus: 'manual_share',
  });
});

groupsRouter.post('/:id/invitations/:inviteId/resend', requireAuth, async (req: AuthedRequest, res) => {
  const groupId = Number(req.params.id);
  const inviteId = Number(req.params.inviteId);
  const membership = getMembership(groupId, req.user!.id);
  if (!membership) {
    res.status(403).json({ error: 'Only group members can resend invitations.' });
    return;
  }

  const inv = db
    .prepare(`
      SELECT i.*, g.name AS group_name, g.description AS group_description
      FROM invitations i
      JOIN groups g ON g.id = i.group_id
      WHERE i.id = ? AND i.group_id = ?
    `)
    .get(inviteId, groupId) as
    | {
        id: number;
        invitee_email: string | null;
        invitee_phone: string | null;
        token: string;
        status: string;
        expires_at: string;
        group_name: string;
        group_description: string;
      }
    | undefined;

  if (!inv) {
    res.status(404).json({ error: 'Invitation not found.' });
    return;
  }
  if (inv.status !== 'pending' || parseSqliteUtcMs(inv.expires_at) <= Date.now()) {
    res.status(400).json({ error: 'Only active pending invitations can be resent.' });
    return;
  }

  const baseUrl = canonicalAppUrl();
  if (!baseUrl) {
    res.status(503).json({ error: 'Public APP_URL is not configured. Set it to the verified Cloudflare HTTPS origin before resending invitations.' });
    return;
  }

  const inviteUrl = `${baseUrl}/guest-group?invite=${inv.token}`;

  if (inv.invitee_email) {
    const emailResult = await sendGroupInvitationEmail({
      toEmail: inv.invitee_email,
      groupName: inv.group_name,
      groupDescription: inv.group_description,
      inviterName: req.user!.fullName,
      inviteUrl,
      expiresInDays: 14,
    });

    db.prepare(`
      UPDATE invitations
      SET delivery_status = ?, delivery_error = ?, last_sent_at = CASE WHEN ? = 'sent' THEN datetime('now') ELSE last_sent_at END
      WHERE id = ?
    `).run(emailResult.deliveryStatus, emailResult.errorMessage ?? null, emailResult.deliveryStatus, inv.id);

    res.json({
      emailDelivered: emailResult.delivered,
      deliveryStatus: emailResult.deliveryStatus,
      deliveryError: emailResult.errorMessage ?? null,
      inviteUrl,
      smtpConfigured: isSmtpConfigured(),
    });
    return;
  }

  if (inv.invitee_phone) {
    const smsResult = await sendGroupInvitationSms({
      toPhone: inv.invitee_phone,
      groupName: inv.group_name,
      inviterName: req.user!.fullName,
      inviteUrl,
    });

    db.prepare(`
      UPDATE invitations
      SET delivery_status = ?, delivery_error = ?, last_sent_at = CASE WHEN ? = 'sent' THEN datetime('now') ELSE last_sent_at END
      WHERE id = ?
    `).run(smsResult.deliveryStatus, smsResult.errorMessage ?? null, smsResult.deliveryStatus, inv.id);

    res.json({
      smsDelivered: smsResult.delivered,
      deliveryStatus: smsResult.deliveryStatus,
      deliveryError: smsResult.errorMessage ?? null,
      inviteUrl,
      whatsappShareUrl: buildWhatsAppShareUrl(inv.group_name, inviteUrl, inv.invitee_phone),
      smsShareUrl: buildSmsShareUrl(inv.group_name, req.user!.fullName, inviteUrl, inv.invitee_phone),
      smsConfigured: isSmsConfigured(),
    });
    return;
  }

  res.status(400).json({ error: 'Copy or share the invite link directly for link/QR invitations.' });
});

groupsRouter.post('/:id/invitations/:inviteId/revoke', requireAuth, (req: AuthedRequest, res) => {
  const groupId = Number(req.params.id);
  const inviteId = Number(req.params.inviteId);
  const membership = getMembership(groupId, req.user!.id);
  if (!membership || membership.role !== 'admin') {
    res.status(403).json({ error: 'Only group admins can revoke invitations.' });
    return;
  }

  db.prepare("UPDATE invitations SET status = 'revoked' WHERE id = ? AND group_id = ?").run(
    inviteId,
    groupId
  );
  res.json({ ok: true });
});
