-- SettleUp initial Cloudflare D1 schema
-- Derived from server/db.ts in the uploaded project.
-- Creates the final current schema, including the invitation upgrades previously
-- performed at runtime. This migration intentionally inserts no demo/user data.
-- Wrangler tracks applied migrations in d1_migrations; the legacy app-specific
-- schema_migrations table is therefore not created here.

CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      avatar_url TEXT,
      phone TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_phone ON users(phone) WHERE phone IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_invitations_group_status ON invitations(group_id, status);
