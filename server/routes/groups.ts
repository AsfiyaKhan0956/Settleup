import { Router } from 'express';
import QRCode from 'qrcode';
import { db } from '../db.ts';
import { computeGroupBalances, getMembership, requireAuth, type AuthedRequest } from '../middleware.ts';
import { generateOpaqueToken, isValidEmail } from '../security.ts';

export const groupsRouter = Router();

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

groupsRouter.post('/', requireAuth, (req: AuthedRequest, res) => {
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

  const result = db.transaction(() => {
    const groupId = Number(
      db
        .prepare(`
          INSERT INTO groups (name, description, category, cover_color, created_by)
          VALUES (?, ?, ?, ?, ?)
        `)
        .run(cleanName, (description ?? '').trim(), cleanCategory, cleanColor, userId).lastInsertRowid
    );

    db.prepare("INSERT INTO group_members (group_id, user_id, role) VALUES (?, ?, 'admin')").run(
      groupId,
      userId
    );

    // Add existing registered users if emails supplied, otherwise create pending invitations
    const emails = Array.isArray(memberEmails) ? memberEmails : [];
    const addedNames: string[] = [];
    for (const rawEmail of emails) {
      const cleanEmail = rawEmail.trim().toLowerCase();
      if (!isValidEmail(cleanEmail) || cleanEmail === req.user!.email) continue;
      const found = db.prepare('SELECT id, full_name FROM users WHERE email = ?').get(cleanEmail) as
        | { id: number; full_name: string }
        | undefined;
      if (found) {
        db.prepare("INSERT OR IGNORE INTO group_members (group_id, user_id, role) VALUES (?, ?, 'member')").run(
          groupId,
          found.id
        );
        addedNames.push(found.full_name);
        db.prepare(`
          INSERT INTO notifications (user_id, group_id, type, title, message, link_path)
          VALUES (?, ?, 'group_joined', 'Added to new group', ?, ?)
        `).run(found.id, groupId, `${req.user!.fullName} added you to "${cleanName}".`, `/groups/${groupId}`);
      } else {
        db.prepare(`
          INSERT INTO invitations (group_id, invited_by, invitee_email, token, expires_at)
          VALUES (?, ?, ?, ?, datetime('now', '+14 days'))
        `).run(groupId, userId, cleanEmail, generateOpaqueToken(16));
      }
    }

    db.prepare(`
      INSERT INTO activity_logs (group_id, user_id, action, entity_type, entity_id, summary)
      VALUES (?, ?, 'group_created', 'group', ?, ?)
    `).run(
      groupId,
      userId,
      groupId,
      `${req.user!.fullName} created group "${cleanName}"${addedNames.length ? ` with ${addedNames.join(', ')}` : ''}`
    );

    return groupId;
  })();

  res.status(201).json({ groupId: result });
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

  const invitations = db
    .prepare(`
      SELECT id, invitee_email, token, status, max_uses, use_count, expires_at, created_at
      FROM invitations
      WHERE group_id = ?
      ORDER BY created_at DESC
    `)
    .all(groupId) as Array<{
    id: number;
    invitee_email: string | null;
    token: string;
    status: string;
    max_uses: number;
    use_count: number;
    expires_at: string;
    created_at: string;
  }>;

  const baseUrl = `${req.protocol}://${req.get('host')}`;
  const activeInvite = invitations.find(
    (inv) => inv.status === 'pending' && !inv.invitee_email && new Date(inv.expires_at).getTime() > Date.now()
  );
  const inviteQrDataUrl = activeInvite
    ? await QRCode.toDataURL(`${baseUrl}/?invite=${activeInvite.token}`, {
        width: 240,
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
    members: members.map((m) => ({
      ...m,
      role: roleMap.get(m.userId)?.role ?? 'member',
      joinedAt: roleMap.get(m.userId)?.joined_at ?? '',
    })),
    transfers,
    expenses,
    invitations,
    inviteQrDataUrl,
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

groupsRouter.post('/:id/members', requireAuth, (req: AuthedRequest, res) => {
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

  const group = db.prepare('SELECT name FROM groups WHERE id = ?').get(groupId) as { name: string };
  const targetUser = db.prepare('SELECT id, full_name FROM users WHERE email = ?').get(cleanEmail) as
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
        VALUES (?, ?, 'group_joined', 'Added to group', ?, ?)
      `).run(
        targetUser.id,
        groupId,
        `${req.user!.fullName} added you to "${group.name}".`,
        `/groups/${groupId}`
      );
      db.prepare(`
        INSERT INTO activity_logs (group_id, user_id, action, entity_type, entity_id, summary)
        VALUES (?, ?, 'member_added', 'user', ?, ?)
      `).run(groupId, req.user!.id, targetUser.id, `${req.user!.fullName} added ${targetUser.full_name} to the group`);
    })();

    res.status(201).json({ status: 'added', memberName: targetUser.full_name });
    return;
  }

  const token = generateOpaqueToken(16);
  db.prepare(`
    INSERT INTO invitations (group_id, invited_by, invitee_email, token, expires_at)
    VALUES (?, ?, ?, ?, datetime('now', '+14 days'))
  `).run(groupId, req.user!.id, cleanEmail, token);

  res.status(201).json({ status: 'invited', token });
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

groupsRouter.post('/:id/invitations', requireAuth, async (req: AuthedRequest, res) => {
  const groupId = Number(req.params.id);
  const membership = getMembership(groupId, req.user!.id);
  if (!membership) {
    res.status(403).json({ error: 'Only group members can create invitations.' });
    return;
  }

  const { inviteeEmail, expiresInDays } = req.body as { inviteeEmail?: string; expiresInDays?: number };
  const days = Math.min(90, Math.max(1, Number(expiresInDays ?? 14)));
  const token = generateOpaqueToken(16);

  db.prepare(`
    INSERT INTO invitations (group_id, invited_by, invitee_email, token, expires_at)
    VALUES (?, ?, ?, ?, datetime('now', '+' || ? || ' days'))
  `).run(groupId, req.user!.id, inviteeEmail?.trim().toLowerCase() || null, token, days);

  const baseUrl = `${req.protocol}://${req.get('host')}`;
  const inviteUrl = `${baseUrl}/?invite=${token}`;
  const qrDataUrl = await QRCode.toDataURL(inviteUrl, {
    width: 240,
    margin: 1,
    color: { dark: '#0F172A', light: '#FFFFFF' },
  });

  res.status(201).json({ token, inviteUrl, qrDataUrl });
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

groupsRouter.get('/invite/:token', (req, res) => {
  const token = req.params.token;
  const inv = db
    .prepare(`
      SELECT i.*, g.name AS group_name, g.description AS group_description, g.category AS group_category,
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
        status: string;
        max_uses: number;
        use_count: number;
        expires_at: string;
        group_name: string;
        group_description: string;
        group_category: string;
        inviter_name: string;
      }
    | undefined;

  if (!inv) {
    res.status(404).json({ error: 'Invitation not found.' });
    return;
  }

  const isExpired = new Date(inv.expires_at).getTime() <= Date.now();
  const isExhausted = inv.use_count >= inv.max_uses;
  const valid = inv.status === 'pending' && !isExpired && !isExhausted;

  res.json({
    valid,
    status: isExpired ? 'expired' : inv.status,
    groupId: inv.group_id,
    groupName: inv.group_name,
    groupDescription: inv.group_description,
    groupCategory: inv.group_category,
    inviterName: inv.inviter_name,
    expiresAt: inv.expires_at,
  });
});

groupsRouter.post('/invite/:token/accept', requireAuth, (req: AuthedRequest, res) => {
  const token = req.params.token;
  const userId = req.user!.id;

  const inv = db.prepare('SELECT * FROM invitations WHERE token = ?').get(token) as
    | {
        id: number;
        group_id: number;
        status: string;
        max_uses: number;
        use_count: number;
        expires_at: string;
      }
    | undefined;

  if (!inv || inv.status !== 'pending' || new Date(inv.expires_at).getTime() <= Date.now() || inv.use_count >= inv.max_uses) {
    res.status(400).json({ error: 'This invitation link is invalid, revoked, or expired.' });
    return;
  }

  db.transaction(() => {
    const existing = getMembership(inv.group_id, userId);
    if (!existing) {
      db.prepare("INSERT INTO group_members (group_id, user_id, role) VALUES (?, ?, 'member')").run(
        inv.group_id,
        userId
      );
      db.prepare('UPDATE invitations SET use_count = use_count + 1 WHERE id = ?').run(inv.id);
      db.prepare(`
        INSERT INTO activity_logs (group_id, user_id, action, entity_type, entity_id, summary)
        VALUES (?, ?, 'member_joined', 'group', ?, ?)
      `).run(inv.group_id, userId, inv.group_id, `${req.user!.fullName} joined the group via invitation`);
    }
  })();

  res.json({ groupId: inv.group_id });
});
