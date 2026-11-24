import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('additive D1 guest and email migrations preserve existing registered rows and foreign keys', () => {
  const db = new Database(':memory:');
  try {
    db.exec(fs.readFileSync(path.join(root, 'migrations/0001_initial_schema.sql'), 'utf8'));
    db.prepare('INSERT INTO users (id, full_name, email, password_hash) VALUES (1, ?, ?, ?)').run('Owner', 'owner@example.test', 'hash');
    db.prepare('INSERT INTO groups (id, name, created_by) VALUES (1, ?, 1)').run('Baseline group');
    db.prepare("INSERT INTO group_members (group_id, user_id, role) VALUES (1, 1, 'admin')").run();
    db.exec(fs.readFileSync(path.join(root, 'migrations/0002_guest_identity.sql'), 'utf8'));
    db.exec(fs.readFileSync(path.join(root, 'migrations/0003_email_invite_delivery.sql'), 'utf8'));

    assert.deepEqual(db.prepare('SELECT group_id, user_id, role FROM group_members').get(), { group_id: 1, user_id: 1, role: 'admin' });
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'guest_members'").get() as { count: number }).count, 1);
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'email_invite_batches'").get() as { count: number }).count, 1);
    assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0);
  } finally { db.close(); }
});
