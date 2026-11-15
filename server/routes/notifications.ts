import { Router } from 'express';
import { db } from '../db.ts';
import { requireAuth, type AuthedRequest } from '../middleware.ts';

export const notificationsRouter = Router();

notificationsRouter.get('/', requireAuth, (req: AuthedRequest, res) => {
  const userId = req.user!.id;
  const notifications = db
    .prepare(`
      SELECT * FROM notifications
      WHERE user_id = ?
      ORDER BY created_at DESC, id DESC
      LIMIT 40
    `)
    .all(userId);

  const activities = db
    .prepare(`
      SELECT a.*, g.name AS group_name, u.full_name AS actor_name
      FROM activity_logs a
      LEFT JOIN groups g ON g.id = a.group_id
      JOIN users u ON u.id = a.user_id
      WHERE a.group_id IN (SELECT group_id FROM group_members WHERE user_id = ?) OR a.user_id = ?
      ORDER BY a.created_at DESC, a.id DESC
      LIMIT 30
    `)
    .all(userId, userId);

  res.json({ notifications, activities });
});

notificationsRouter.post('/mark-read', requireAuth, (req: AuthedRequest, res) => {
  const { id } = req.body as { id?: number };
  if (id) {
    db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?').run(id, req.user!.id);
  } else {
    db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ?').run(req.user!.id);
  }
  res.json({ ok: true });
});
