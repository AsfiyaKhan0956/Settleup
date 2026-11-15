import Database from 'better-sqlite3';
import path from 'node:path';
import { hashPassword, generateOpaqueToken } from './security.ts';

const dbPath = process.env.DB_PATH || path.resolve(process.cwd(), 'settleup.db');

export const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export function initializeDatabase(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      avatar_url TEXT,
      upi_id TEXT,
      is_demo INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS user_preferences (
      user_id INTEGER PRIMARY KEY,
      currency TEXT NOT NULL DEFAULT 'INR',
      theme TEXT NOT NULL DEFAULT 'daylight',
      email_notifications INTEGER NOT NULL DEFAULT 1,
      settlement_alerts INTEGER NOT NULL DEFAULT 1,
      onboarding_completed INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token_hash TEXT NOT NULL UNIQUE,
      user_id INTEGER NOT NULL,
      remember_me INTEGER NOT NULL DEFAULT 0,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS password_resets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      used INTEGER NOT NULL DEFAULT 0,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      category TEXT NOT NULL DEFAULT 'Friends',
      cover_color TEXT NOT NULL DEFAULT '#065F46',
      created_by INTEGER NOT NULL,
      is_archived INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT
    );

    CREATE TABLE IF NOT EXISTS group_members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
      joined_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (group_id, user_id),
      FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS invitations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id INTEGER NOT NULL,
      invited_by INTEGER NOT NULL,
      invitee_email TEXT,
      token TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'revoked', 'expired')),
      max_uses INTEGER NOT NULL DEFAULT 10,
      use_count INTEGER NOT NULL DEFAULT 0,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE,
      FOREIGN KEY (invited_by) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS expenses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id INTEGER NOT NULL,
      paid_by_user_id INTEGER NOT NULL,
      created_by_user_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      category TEXT NOT NULL DEFAULT 'Food',
      split_method TEXT NOT NULL CHECK (split_method IN ('equal', 'exact', 'percentage', 'shares', 'itemized')),
      subtotal_paise INTEGER NOT NULL CHECK (subtotal_paise >= 0),
      tax_paise INTEGER NOT NULL DEFAULT 0 CHECK (tax_paise >= 0),
      tip_paise INTEGER NOT NULL DEFAULT 0 CHECK (tip_paise >= 0),
      discount_paise INTEGER NOT NULL DEFAULT 0 CHECK (discount_paise >= 0),
      total_paise INTEGER NOT NULL CHECK (total_paise > 0),
      currency TEXT NOT NULL DEFAULT 'INR',
      expense_date TEXT NOT NULL,
      receipt_data_url TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE,
      FOREIGN KEY (paid_by_user_id) REFERENCES users(id) ON DELETE RESTRICT,
      FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE RESTRICT
    );

    CREATE TABLE IF NOT EXISTS expense_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      expense_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      unit_price_paise INTEGER NOT NULL CHECK (unit_price_paise > 0),
      quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity >= 1),
      total_paise INTEGER NOT NULL CHECK (total_paise > 0),
      FOREIGN KEY (expense_id) REFERENCES expenses(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS item_consumers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      share_weight INTEGER NOT NULL DEFAULT 1 CHECK (share_weight >= 1),
      UNIQUE (item_id, user_id),
      FOREIGN KEY (item_id) REFERENCES expense_items(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS expense_splits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      expense_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      owed_paise INTEGER NOT NULL CHECK (owed_paise >= 0),
      item_subtotal_paise INTEGER NOT NULL DEFAULT 0,
      shared_charges_paise INTEGER NOT NULL DEFAULT 0,
      share_meta TEXT DEFAULT '',
      UNIQUE (expense_id, user_id),
      FOREIGN KEY (expense_id) REFERENCES expenses(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS settlements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id INTEGER NOT NULL,
      payer_user_id INTEGER NOT NULL,
      receiver_user_id INTEGER NOT NULL,
      amount_paise INTEGER NOT NULL CHECK (amount_paise > 0),
      payment_method TEXT NOT NULL DEFAULT 'UPI',
      reference_code TEXT DEFAULT '',
      upi_uri TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'recorded', 'confirmed')),
      notes TEXT DEFAULT '',
      created_by INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      confirmed_at TEXT,
      CHECK (payer_user_id <> receiver_user_id),
      FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE,
      FOREIGN KEY (payer_user_id) REFERENCES users(id) ON DELETE RESTRICT,
      FOREIGN KEY (receiver_user_id) REFERENCES users(id) ON DELETE RESTRICT,
      FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      group_id INTEGER,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      link_path TEXT DEFAULT '/dashboard',
      is_read INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS activity_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id INTEGER,
      user_id INTEGER NOT NULL,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id INTEGER,
      summary TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_group_members_user ON group_members(user_id);
    CREATE INDEX IF NOT EXISTS idx_expenses_group_date ON expenses(group_id, expense_date);
    CREATE INDEX IF NOT EXISTS idx_expense_splits_user ON expense_splits(user_id);
    CREATE INDEX IF NOT EXISTS idx_settlements_group_status ON settlements(group_id, status);
    CREATE INDEX IF NOT EXISTS idx_notifications_user_read ON notifications(user_id, is_read);
    CREATE INDEX IF NOT EXISTS idx_activity_group ON activity_logs(group_id, created_at);
  `);

  seedDemoWorkspaceIfNeeded();
}

/**
 * Seeds a realistic demo cohort ONLY once so evaluators/faculty can immediately explore
 * the 5-person Tea/Coffee/Samosa item-wise split, Goa Trip, and Flat 402 expenses.
 * Newly registered users NEVER inherit this demo data.
 */
function seedDemoWorkspaceIfNeeded(): void {
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get('aarav@settleup.app') as
    | { id: number }
    | undefined;
  if (existing) return;

  const insertSeed = db.transaction(() => {
    const demoPass = hashPassword('Demo@1234');
    const insertUser = db.prepare(`
      INSERT INTO users (full_name, email, password_hash, upi_id, is_demo)
      VALUES (?, ?, ?, ?, 1)
    `);

    const aaravId = Number(insertUser.run('Aarav Sharma', 'aarav@settleup.app', demoPass, 'aarav.sharma@okaxis').lastInsertRowid);
    const diyaId = Number(insertUser.run('Diya Nair', 'diya@settleup.app', demoPass, 'diya.nair@okicici').lastInsertRowid);
    const rohanId = Number(insertUser.run('Rohan Kulkarni', 'rohan@settleup.app', demoPass, 'rohan.k@ybl').lastInsertRowid);
    const meeraId = Number(insertUser.run('Meera Iyer', 'meera@settleup.app', demoPass, 'meera.iyer@okhdfcbank').lastInsertRowid);
    const kabirId = Number(insertUser.run('Kabir Verma', 'kabir@settleup.app', demoPass, 'kabir.v@paytm').lastInsertRowid);

    const insertPref = db.prepare(`
      INSERT INTO user_preferences (user_id, onboarding_completed) VALUES (?, 1)
    `);
    [aaravId, diyaId, rohanId, meeraId, kabirId].forEach((uid) => insertPref.run(uid));

    const insertGroup = db.prepare(`
      INSERT INTO groups (name, description, category, cover_color, created_by)
      VALUES (?, ?, ?, ?, ?)
    `);

    const campusGroupId = Number(
      insertGroup.run(
        'Campus Chai & Snacks',
        'Post-lab canteen runs and evening tea splits among our 5-person CSE project team.',
        'Friends',
        '#065F46',
        aaravId
      ).lastInsertRowid
    );

    const flatGroupId = Number(
      insertGroup.run(
        'Flat 402 — Indiranagar',
        'Shared rent, broadband, electricity, and weekly groceries.',
        'Home & Roommates',
        '#0F172A',
        aaravId
      ).lastInsertRowid
    );

    const goaGroupId = Number(
      insertGroup.run(
        'Goa Semester Break',
        'Train tickets, beach shack dinners, scooter rentals, and homestay booking.',
        'Travel',
        '#047857',
        diyaId
      ).lastInsertRowid
    );

    const insertMember = db.prepare(`
      INSERT INTO group_members (group_id, user_id, role) VALUES (?, ?, ?)
    `);
    [aaravId, diyaId, rohanId, meeraId, kabirId].forEach((uid, idx) => {
      insertMember.run(campusGroupId, uid, idx === 0 ? 'admin' : 'member');
      insertMember.run(goaGroupId, uid, uid === diyaId ? 'admin' : 'member');
    });
    [aaravId, rohanId, kabirId].forEach((uid, idx) => {
      insertMember.run(flatGroupId, uid, idx === 0 ? 'admin' : 'member');
    });

    // Create sample shareable invite for Campus Chai & Snacks
    db.prepare(`
      INSERT INTO invitations (group_id, invited_by, token, status, max_uses, expires_at)
      VALUES (?, ?, ?, 'pending', 25, datetime('now', '+30 days'))
    `).run(campusGroupId, aaravId, generateOpaqueToken(16));

    // Expense 1: The exact 5-person Tea (₹100/4), Coffee (₹120/1), Samosas (₹150/5) scenario!
    // Total = ₹370 (37000 paise). Paid by Aarav.
    // Four tea drinkers (Aarav, Diya, Rohan, Meera) owe ₹25 + ₹30 = ₹55 (5500 paise) each.
    // Coffee consumer (Kabir) owes ₹120 + ₹30 = ₹150 (15000 paise).
    const exp1Id = Number(
      db.prepare(`
        INSERT INTO expenses (
          group_id, paid_by_user_id, created_by_user_id, title, description,
          category, split_method, subtotal_paise, tax_paise, tip_paise, discount_paise,
          total_paise, expense_date
        ) VALUES (?, ?, ?, ?, ?, ?, 'itemized', 37000, 0, 0, 0, 37000, date('now', '-2 days'))
      `).run(
        campusGroupId,
        aaravId,
        aaravId,
        'Udupi Cafe Evening Break',
        '4 cutting teas, 1 cold brew coffee for Kabir, and 5 plate samosas shared by all.',
        'Food'
      ).lastInsertRowid
    );

    const insertItem = db.prepare(`
      INSERT INTO expense_items (expense_id, name, unit_price_paise, quantity, total_paise)
      VALUES (?, ?, ?, ?, ?)
    `);
    const insertConsumer = db.prepare(`
      INSERT INTO item_consumers (item_id, user_id, share_weight) VALUES (?, ?, 1)
    `);
    const insertSplit = db.prepare(`
      INSERT INTO expense_splits (expense_id, user_id, owed_paise, item_subtotal_paise, shared_charges_paise, share_meta)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const teaItemId = Number(insertItem.run(exp1Id, 'Masala Chai (4 cups)', 2500, 4, 10000).lastInsertRowid);
    [aaravId, diyaId, rohanId, meeraId].forEach((u) => insertConsumer.run(teaItemId, u));

    const coffeeItemId = Number(insertItem.run(exp1Id, 'Iced Espresso Coffee', 12000, 1, 12000).lastInsertRowid);
    insertConsumer.run(coffeeItemId, kabirId);

    const samosaItemId = Number(insertItem.run(exp1Id, 'Crispy Samosas (5 pcs)', 3000, 5, 15000).lastInsertRowid);
    [aaravId, diyaId, rohanId, meeraId, kabirId].forEach((u) => insertConsumer.run(samosaItemId, u));

    insertSplit.run(exp1Id, aaravId, 5500, 5500, 0, 'items:5500,adj:0');
    insertSplit.run(exp1Id, diyaId, 5500, 5500, 0, 'items:5500,adj:0');
    insertSplit.run(exp1Id, rohanId, 5500, 5500, 0, 'items:5500,adj:0');
    insertSplit.run(exp1Id, meeraId, 5500, 5500, 0, 'items:5500,adj:0');
    insertSplit.run(exp1Id, kabirId, 15000, 15000, 0, 'items:15000,adj:0');

    // Expense 2: Flat 402 Electricity & Fiber Internet (Equal split across 3 flatmates)
    const exp2Id = Number(
      db.prepare(`
        INSERT INTO expenses (
          group_id, paid_by_user_id, created_by_user_id, title, description,
          category, split_method, subtotal_paise, total_paise, expense_date
        ) VALUES (?, ?, ?, ?, ?, ?, 'equal', 345000, 345000, date('now', '-8 days'))
      `).run(
        flatGroupId,
        rohanId,
        rohanId,
        'BESCOM Electricity + ACT Fiber',
        'Monthly power bill ₹2,250 + 300Mbps fiber ₹1,200.',
        'Utilities'
      ).lastInsertRowid
    );
    [aaravId, rohanId, kabirId].forEach((u) => insertSplit.run(exp2Id, u, 115000, 115000, 0, 'equal:1/3'));

    // Expense 3: Fresh Groceries & Pantry Restock (Exact split)
    const exp3Id = Number(
      db.prepare(`
        INSERT INTO expenses (
          group_id, paid_by_user_id, created_by_user_id, title, description,
          category, split_method, subtotal_paise, total_paise, expense_date
        ) VALUES (?, ?, ?, ?, ?, ?, 'exact', 184000, 184000, date('now', '-5 days'))
      `).run(
        flatGroupId,
        aaravId,
        aaravId,
        'BigBasket Weekly Groceries',
        'Fresh produce, milk, oats, and Kabir protein bars.',
        'Groceries'
      ).lastInsertRowid
    );
    insertSplit.run(exp3Id, aaravId, 52000, 52000, 0, 'exact:52000');
    insertSplit.run(exp3Id, rohanId, 52000, 52000, 0, 'exact:52000');
    insertSplit.run(exp3Id, kabirId, 80000, 80000, 0, 'exact:80000');

    // Expense 4: Goa Villa Stay (Equal across 5)
    const exp4Id = Number(
      db.prepare(`
        INSERT INTO expenses (
          group_id, paid_by_user_id, created_by_user_id, title, description,
          category, split_method, subtotal_paise, total_paise, expense_date
        ) VALUES (?, ?, ?, ?, ?, ?, 'equal', 1500000, 1500000, date('now', '-22 days'))
      `).run(
        goaGroupId,
        diyaId,
        diyaId,
        'Anjuna Heritage Villa (2 Nights)',
        'Advance booking for 5 guests near Vagator.',
        'Accommodation'
      ).lastInsertRowid
    );
    [aaravId, diyaId, rohanId, meeraId, kabirId].forEach((u) => insertSplit.run(exp4Id, u, 300000, 300000, 0, 'equal:1/5'));

    // Expense 5: Scooter Rental & Fuel (Equal across 5)
    const exp5Id = Number(
      db.prepare(`
        INSERT INTO expenses (
          group_id, paid_by_user_id, created_by_user_id, title, description,
          category, split_method, subtotal_paise, total_paise, expense_date
        ) VALUES (?, ?, ?, ?, ?, ?, 'equal', 350000, 350000, date('now', '-18 days'))
      `).run(
        goaGroupId,
        aaravId,
        aaravId,
        '3 Activa Scooters + Petrol',
        '48-hour rental for North Goa coastal ride.',
        'Transportation'
      ).lastInsertRowid
    );
    [aaravId, diyaId, rohanId, meeraId, kabirId].forEach((u) => insertSplit.run(exp5Id, u, 70000, 70000, 0, 'equal:1/5'));

    // Expense 6: Beach Shack Dinner (Earlier month for trend chart)
    const exp6Id = Number(
      db.prepare(`
        INSERT INTO expenses (
          group_id, paid_by_user_id, created_by_user_id, title, description,
          category, split_method, subtotal_paise, total_paise, expense_date
        ) VALUES (?, ?, ?, ?, ?, ?, 'equal', 420000, 420000, date('now', '-42 days'))
      `).run(
        goaGroupId,
        meeraId,
        meeraId,
        'Thalassa Coastal Dinner',
        'Group farewell dinner overlooking the bay.',
        'Entertainment'
      ).lastInsertRowid
    );
    [aaravId, diyaId, rohanId, meeraId, kabirId].forEach((u) => insertSplit.run(exp6Id, u, 84000, 84000, 0, 'equal:1/5'));

    // Confirmed Settlement in Goa Group: Kabir paid Diya ₹3,000
    db.prepare(`
      INSERT INTO settlements (
        group_id, payer_user_id, receiver_user_id, amount_paise,
        payment_method, reference_code, status, notes, created_by, confirmed_at
      ) VALUES (?, ?, ?, 300000, 'UPI', 'UTR431982019442', 'confirmed', 'Villa share settled via GPay', ?, datetime('now', '-15 days'))
    `).run(goaGroupId, kabirId, diyaId, kabirId);

    // Recorded (awaiting recipient confirmation) Settlement in Flat 402
    db.prepare(`
      INSERT INTO settlements (
        group_id, payer_user_id, receiver_user_id, amount_paise,
        payment_method, reference_code, status, notes, created_by
      ) VALUES (?, ?, ?, 50000, 'UPI', 'UTR432001928311', 'recorded', 'Partial electricity share sent via PhonePe', ?)
    `).run(flatGroupId, aaravId, rohanId, aaravId);

    // Activity logs & Notifications for Aarav
    const insertActivity = db.prepare(`
      INSERT INTO activity_logs (group_id, user_id, action, entity_type, entity_id, summary)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    insertActivity.run(campusGroupId, aaravId, 'expense_created', 'expense', exp1Id, 'Aarav Sharma logged itemised bill "Udupi Cafe Evening Break" (₹370.00)');
    insertActivity.run(flatGroupId, rohanId, 'expense_created', 'expense', exp2Id, 'Rohan Kulkarni logged "BESCOM Electricity + ACT Fiber" (₹3,450.00)');
    insertActivity.run(goaGroupId, kabirId, 'settlement_confirmed', 'settlement', 1, 'Kabir Verma settled ₹3,000.00 with Diya Nair');

    const insertNotif = db.prepare(`
      INSERT INTO notifications (user_id, group_id, type, title, message, link_path)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    insertNotif.run(aaravId, flatGroupId, 'settlement_recorded', 'Settlement awaiting confirmation', 'Your ₹500.00 UPI payment to Rohan Kulkarni is awaiting his confirmation.', '/settlements');
    insertNotif.run(aaravId, campusGroupId, 'expense_added', 'Itemised split verified', 'Udupi Cafe Evening Break (₹370.00) is split across 5 friends. Kabir owes ₹150.00.', '/expenses');
  });

  insertSeed();
}
