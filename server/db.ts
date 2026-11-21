import Database from 'better-sqlite3';
import path from 'node:path';
import { assertDatabaseFileState } from './dbSafety.ts';
import { hashPassword, generateOpaqueToken } from './security.ts';
import { dateToYmd } from './date.ts';

const isProduction = process.env.NODE_ENV === 'production';
const isExplicitDatabaseInit = process.env.DB_INIT_MODE === 'true';
const configuredDbPath = process.env.DB_PATH?.trim();
if (isProduction && (!configuredDbPath || configuredDbPath === ':memory:')) {
  throw new Error('Production requires DB_PATH to point to a persistent SQLite database file.');
}
const dbPath = configuredDbPath || path.resolve(process.cwd(), 'settleup.db');
// A missing production database may only be created by the explicit `npm run db:init` command.
// Normal production startup must never create an empty database after a path/configuration mistake.
assertDatabaseFileState(dbPath, isProduction && !isExplicitDatabaseInit);
export const db = new Database(dbPath, isProduction && !isExplicitDatabaseInit ? { fileMustExist: true } : {});
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export function initializeDatabase(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

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

    CREATE TABLE IF NOT EXISTS guest_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token_hash TEXT NOT NULL UNIQUE,
      invitation_id INTEGER NOT NULL,
      group_id INTEGER NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (invitation_id) REFERENCES invitations(id) ON DELETE CASCADE,
      FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_guest_sessions_expiry ON guest_sessions(expires_at);

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

    CREATE TABLE IF NOT EXISTS personal_categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'expense' CHECK (type IN ('income', 'expense')),
      color TEXT NOT NULL DEFAULT '#065F46',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (user_id, name, type),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS personal_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      amount_paise INTEGER NOT NULL CHECK (amount_paise > 0),
      type TEXT NOT NULL CHECK (type IN ('income', 'expense')),
      category TEXT NOT NULL,
      transaction_date TEXT NOT NULL,
      notes TEXT DEFAULT '',
      payment_method TEXT DEFAULT '',
      linked_group_expense_id INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (linked_group_expense_id) REFERENCES expenses(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS personal_budgets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      scope TEXT NOT NULL CHECK (scope IN ('overall', 'category')),
      category TEXT NOT NULL DEFAULT '',
      period TEXT NOT NULL CHECK (period IN ('weekly', 'monthly')),
      limit_paise INTEGER NOT NULL CHECK (limit_paise > 0),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (user_id, scope, category, period),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS personal_savings_goals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      target_paise INTEGER NOT NULL CHECK (target_paise > 0),
      current_saved_paise INTEGER NOT NULL DEFAULT 0 CHECK (current_saved_paise >= 0),
      target_date TEXT,
      notes TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS trip_ledgers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      group_id INTEGER,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      event_date TEXT NOT NULL DEFAULT (date('now')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS external_participants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      trip_ledger_id INTEGER,
      display_name TEXT NOT NULL,
      phone TEXT,
      email TEXT,
      linked_user_id INTEGER,
      notes TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (trip_ledger_id) REFERENCES trip_ledgers(id) ON DELETE CASCADE,
      FOREIGN KEY (linked_user_id) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS manual_balances (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      trip_ledger_id INTEGER,
      external_participant_id INTEGER,
      linked_user_id INTEGER,
      person_name TEXT NOT NULL,
      contact_ref TEXT DEFAULT '',
      participant_type TEXT NOT NULL DEFAULT 'external' CHECK (participant_type IN ('external', 'registered')),
      direction TEXT NOT NULL CHECK (direction IN ('to_pay', 'to_receive')),
      amount_paise INTEGER NOT NULL CHECK (amount_paise > 0),
      settled_paise INTEGER NOT NULL DEFAULT 0 CHECK (settled_paise >= 0),
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'partially_settled', 'settled')),
      trip_name TEXT DEFAULT '',
      description TEXT DEFAULT '',
      entry_date TEXT NOT NULL DEFAULT (date('now')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (trip_ledger_id) REFERENCES trip_ledgers(id) ON DELETE CASCADE,
      FOREIGN KEY (external_participant_id) REFERENCES external_participants(id) ON DELETE SET NULL,
      FOREIGN KEY (linked_user_id) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS manual_balance_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      manual_balance_id INTEGER,
      trip_ledger_id INTEGER,
      action TEXT NOT NULL,
      amount_paise INTEGER NOT NULL DEFAULT 0,
      note TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (manual_balance_id) REFERENCES manual_balances(id) ON DELETE SET NULL,
      FOREIGN KEY (trip_ledger_id) REFERENCES trip_ledgers(id) ON DELETE CASCADE
    );

    -- Itemised Trip Ledger v2 tables. Legacy manual_balances and events are retained unchanged.
    CREATE TABLE IF NOT EXISTS trip_ledger_participants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ledger_id INTEGER NOT NULL,
      display_name TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (ledger_id) REFERENCES trip_ledgers(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS trip_ledger_expenses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ledger_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      expense_date TEXT NOT NULL,
      paid_by_participant_id INTEGER NOT NULL,
      total_paise INTEGER NOT NULL CHECK (total_paise > 0),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (ledger_id) REFERENCES trip_ledgers(id) ON DELETE CASCADE,
      FOREIGN KEY (paid_by_participant_id) REFERENCES trip_ledger_participants(id) ON DELETE RESTRICT
    );

    CREATE TABLE IF NOT EXISTS trip_ledger_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      expense_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      unit_price_paise INTEGER NOT NULL CHECK (unit_price_paise > 0),
      quantity INTEGER NOT NULL CHECK (quantity > 0),
      total_paise INTEGER NOT NULL CHECK (total_paise > 0),
      FOREIGN KEY (expense_id) REFERENCES trip_ledger_expenses(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS trip_ledger_item_consumers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id INTEGER NOT NULL,
      participant_id INTEGER NOT NULL,
      share_paise INTEGER NOT NULL CHECK (share_paise >= 0),
      FOREIGN KEY (item_id) REFERENCES trip_ledger_items(id) ON DELETE CASCADE,
      FOREIGN KEY (participant_id) REFERENCES trip_ledger_participants(id) ON DELETE RESTRICT,
      UNIQUE (item_id, participant_id)
    );

    CREATE TABLE IF NOT EXISTS trip_ledger_shares (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      expense_id INTEGER NOT NULL,
      participant_id INTEGER NOT NULL,
      owed_paise INTEGER NOT NULL CHECK (owed_paise >= 0),
      FOREIGN KEY (expense_id) REFERENCES trip_ledger_expenses(id) ON DELETE CASCADE,
      FOREIGN KEY (participant_id) REFERENCES trip_ledger_participants(id) ON DELETE RESTRICT,
      UNIQUE (expense_id, participant_id)
    );

    CREATE TABLE IF NOT EXISTS trip_ledger_settlements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ledger_id INTEGER NOT NULL,
      payer_participant_id INTEGER NOT NULL,
      receiver_participant_id INTEGER NOT NULL,
      amount_paise INTEGER NOT NULL CHECK (amount_paise > 0),
      settlement_date TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (ledger_id) REFERENCES trip_ledgers(id) ON DELETE CASCADE,
      FOREIGN KEY (payer_participant_id) REFERENCES trip_ledger_participants(id) ON DELETE RESTRICT,
      FOREIGN KEY (receiver_participant_id) REFERENCES trip_ledger_participants(id) ON DELETE RESTRICT
    );

    CREATE INDEX IF NOT EXISTS idx_trip_ledger_participants_ledger ON trip_ledger_participants(ledger_id);
    CREATE INDEX IF NOT EXISTS idx_trip_ledger_expenses_ledger_date ON trip_ledger_expenses(ledger_id, expense_date, id);
    CREATE INDEX IF NOT EXISTS idx_trip_ledger_items_expense ON trip_ledger_items(expense_id, id);
    CREATE INDEX IF NOT EXISTS idx_trip_ledger_item_consumers_item ON trip_ledger_item_consumers(item_id, participant_id);
    CREATE INDEX IF NOT EXISTS idx_trip_ledger_item_consumers_participant ON trip_ledger_item_consumers(participant_id, item_id);
    CREATE INDEX IF NOT EXISTS idx_trip_ledger_shares_expense ON trip_ledger_shares(expense_id, participant_id);
    CREATE INDEX IF NOT EXISTS idx_trip_ledger_settlements_ledger ON trip_ledger_settlements(ledger_id, settlement_date, id);

    CREATE INDEX IF NOT EXISTS idx_personal_tx_user_date ON personal_transactions(user_id, transaction_date);
    CREATE INDEX IF NOT EXISTS idx_personal_tx_user_type ON personal_transactions(user_id, type);
    CREATE INDEX IF NOT EXISTS idx_manual_balances_user_trip ON manual_balances(user_id, trip_ledger_id);
    CREATE INDEX IF NOT EXISTS idx_external_participants_user ON external_participants(user_id, trip_ledger_id);
  `);

  applyIncrementalMigrations();
  db.prepare('INSERT OR IGNORE INTO schema_migrations (version) VALUES (1), (2), (3)').run();
  if (process.env.SEED_DEMO_DATA === 'true') {
    seedDemoWorkspaceIfNeeded();
    seedDemoPersonalAndTripData();
  }
}

function applyIncrementalMigrations(): void {
  const userCols = db.prepare('PRAGMA table_info(users)').all() as Array<{ name: string }>;
  if (!userCols.some((c) => c.name === 'phone')) {
    db.exec(`ALTER TABLE users ADD COLUMN phone TEXT;`);
  }
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_phone ON users(phone) WHERE phone IS NOT NULL;`);

  const invMaster = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'invitations'")
    .get() as { sql: string } | undefined;
  const invCols = db.prepare('PRAGMA table_info(invitations)').all() as Array<{ name: string }>;
  const needsInvUpgrade =
    !invCols.some((c) => c.name === 'delivery_status') ||
    !invCols.some((c) => c.name === 'invitee_phone') ||
    !(invMaster?.sql || '').includes("'declined'");

  if (needsInvUpgrade) {
    db.pragma('foreign_keys = OFF');
    db.transaction(() => {
      db.exec(`
        CREATE TABLE invitations_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          group_id INTEGER NOT NULL,
          invited_by INTEGER NOT NULL,
          invitee_email TEXT,
          invitee_phone TEXT,
          channel TEXT NOT NULL DEFAULT 'link' CHECK (channel IN ('qr', 'email', 'whatsapp', 'phone', 'link')),
          token TEXT NOT NULL UNIQUE,
          status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined', 'revoked', 'expired')),
          delivery_status TEXT NOT NULL DEFAULT 'pending' CHECK (delivery_status IN ('pending', 'sent', 'not_configured', 'failed', 'manual_share')),
          delivery_error TEXT,
          accepted_by_user_id INTEGER,
          accepted_at TEXT,
          declined_at TEXT,
          last_sent_at TEXT,
          max_uses INTEGER NOT NULL DEFAULT 10,
          use_count INTEGER NOT NULL DEFAULT 0,
          expires_at TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE,
          FOREIGN KEY (invited_by) REFERENCES users(id) ON DELETE CASCADE,
          FOREIGN KEY (accepted_by_user_id) REFERENCES users(id) ON DELETE SET NULL
        );

        INSERT INTO invitations_new (
          id, group_id, invited_by, invitee_email, channel, token, status, delivery_status, max_uses, use_count, expires_at, created_at
        )
        SELECT
          id,
          group_id,
          invited_by,
          invitee_email,
          CASE WHEN invitee_email IS NOT NULL THEN 'email' ELSE 'qr' END,
          token,
          status,
          CASE WHEN invitee_email IS NOT NULL THEN 'not_configured' ELSE 'manual_share' END,
          max_uses,
          use_count,
          expires_at,
          created_at
        FROM invitations;

        DROP TABLE invitations;
        ALTER TABLE invitations_new RENAME TO invitations;
        CREATE INDEX IF NOT EXISTS idx_invitations_group_status ON invitations(group_id, status);
      `);
    })();
    db.pragma('foreign_keys = ON');
  }
}

/**
 * Seeds sample personal transactions & a large-trip manual ledger ONLY for the demo account (aarav@settleup.app)
 * if none exist yet, so demo users can explore charts while newly registered users always start empty.
 */
function seedDemoPersonalAndTripData(): void {
  const aarav = db.prepare('SELECT id FROM users WHERE email = ?').get('aarav@settleup.app') as
    | { id: number }
    | undefined;
  if (!aarav) return;

  const existingTx = db
    .prepare('SELECT 1 FROM personal_transactions WHERE user_id = ? LIMIT 1')
    .get(aarav.id);

  if (!existingTx) {
    db.transaction(() => {
      const insertTx = db.prepare(`
        INSERT INTO personal_transactions (user_id, title, amount_paise, type, category, transaction_date, notes, payment_method)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      insertTx.run(aarav.id, 'Monthly Stipend & Freelance', 2200000, 'income', 'Salary & stipend', dateOffset(0, -12), 'Monthly internship stipend', 'Bank Transfer');
      insertTx.run(aarav.id, 'BESCOM Electricity Share', 150000, 'expense', 'Electricity and utilities', dateOffset(0, -9), 'Home power bill', 'UPI');
      insertTx.run(aarav.id, 'Weekly Groceries & Milk', 200000, 'expense', 'Food and groceries', dateOffset(0, -6), 'Fresh vegetables & pantry', 'UPI');
      insertTx.run(aarav.id, 'Metro & Bus Pass', 80000, 'expense', 'Transportation', dateOffset(0, -4), 'Monthly transit recharge', 'Debit Card');
      insertTx.run(aarav.id, 'Bookstore & Lab Notebook', 120000, 'expense', 'Education', dateOffset(0, -2), 'Semester reference book', 'UPI');
      insertTx.run(aarav.id, 'Weekend Movie & Dinner', 95000, 'expense', 'Entertainment', dateOffset(0, -1), 'Personal outing', 'UPI');
      insertTx.run(aarav.id, 'Last Month Stipend', 1800000, 'income', 'Salary & stipend', dateOffset(0, -40), 'Previous month stipend', 'Bank Transfer');
      insertTx.run(aarav.id, 'Hostel & Room Rent', 650000, 'expense', 'Rent and accommodation', dateOffset(0, -35), 'Monthly accommodation', 'Bank Transfer');

      db.prepare(`
        INSERT OR IGNORE INTO personal_budgets (user_id, scope, category, period, limit_paise)
        VALUES (?, 'overall', '', 'monthly', 1400000)
      `).run(aarav.id);

      db.prepare(`
        INSERT INTO personal_savings_goals (user_id, title, target_paise, current_saved_paise, target_date, notes)
        VALUES (?, 'Emergency Laptop Fund', 4500000, 1555000, date('now', '+120 days'), 'Building steady semester savings')
      `).run(aarav.id);
    })();
  }

  const existingTrip = db.prepare('SELECT 1 FROM trip_ledgers WHERE user_id = ? LIMIT 1').get(aarav.id);
  if (!existingTrip) {
    db.transaction(() => {
      const tripId = Number(
        db
          .prepare(`
            INSERT INTO trip_ledgers (user_id, title, description, event_date)
            VALUES (?, 'Coorg Industrial Visit Bus', 'External classmates who joined the trip without SettleUp accounts.', date('now', '-3 days'))
          `)
          .run(aarav.id).lastInsertRowid
      );

      const addExt = db.prepare(`
        INSERT INTO external_participants (user_id, trip_ledger_id, display_name, phone, notes)
        VALUES (?, ?, ?, ?, ?)
      `);
      const bunnyExtId = Number(addExt.run(aarav.id, tripId, 'Bunny', '+919800000001', 'External classmate').lastInsertRowid);
      const rahulExtId = Number(addExt.run(aarav.id, tripId, 'Rahul', '+919800000002', 'External classmate').lastInsertRowid);
      const priyaExtId = Number(addExt.run(aarav.id, tripId, 'Priya', '+919800000003', 'Bus coordinator').lastInsertRowid);

      const addBal = db.prepare(`
        INSERT INTO manual_balances (
          user_id, trip_ledger_id, external_participant_id, person_name, contact_ref,
          participant_type, direction, amount_paise, settled_paise, status, trip_name, description, entry_date
        ) VALUES (?, ?, ?, ?, ?, 'external', ?, ?, 0, 'pending', 'Coorg Industrial Visit Bus', ?, date('now', '-3 days'))
      `);
      addBal.run(aarav.id, tripId, bunnyExtId, 'Bunny', '+919800000001', 'to_pay', 50000, 'Bus seat & toll contribution');
      addBal.run(aarav.id, tripId, rahulExtId, 'Rahul', '+919800000002', 'to_pay', 80000, 'Homestay deposit share');
      addBal.run(aarav.id, tripId, priyaExtId, 'Priya', '+919800000003', 'to_receive', 100000, 'Paid driver advance upfront');
      addBal.run(aarav.id, tripId, null, 'Aarav Sharma', 'aarav@settleup.app', 'to_receive', 30000, 'Paid highway snacks');
    })();
  }
}

function dateOffset(monthsDelta: number, daysDelta: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() + monthsDelta);
  d.setDate(d.getDate() + daysDelta);
  return dateToYmd(d);
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
