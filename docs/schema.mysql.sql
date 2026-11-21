-- =============================================================================
-- SettleUp Relational Database Schema (MySQL 8.0 Parity DDL)
-- Academic MySQL 8.0 reference DDL for the core group-expense and new Trip Ledger structures.
-- The live SQLite schema in server/db.ts is authoritative and also contains additional application tables.
-- All monetary columns use BIGINT in integer PAISE (100 paise = ₹1 INR).
-- =============================================================================

CREATE DATABASE IF NOT EXISTS settleup_db
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE settleup_db;

CREATE TABLE schema_migrations (
  version INT PRIMARY KEY,
  applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE users (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  full_name VARCHAR(80) NOT NULL,
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  avatar_url MEDIUMTEXT NULL,
  upi_id VARCHAR(120) NULL,
  is_demo TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- 1:1 relationship with users
CREATE TABLE user_preferences (
  user_id BIGINT UNSIGNED PRIMARY KEY,
  currency CHAR(3) NOT NULL DEFAULT 'INR',
  theme VARCHAR(20) NOT NULL DEFAULT 'daylight',
  email_notifications TINYINT(1) NOT NULL DEFAULT 1,
  settlement_alerts TINYINT(1) NOT NULL DEFAULT 1,
  onboarding_completed TINYINT(1) NOT NULL DEFAULT 0,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_pref_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE sessions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  token_hash CHAR(64) NOT NULL UNIQUE,
  user_id BIGINT UNSIGNED NOT NULL,
  remember_me TINYINT(1) NOT NULL DEFAULT 0,
  expires_at DATETIME NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_sessions_user (user_id),
  CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE password_resets (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  token_hash CHAR(64) NOT NULL UNIQUE,
  used TINYINT(1) NOT NULL DEFAULT 0,
  expires_at DATETIME NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_reset_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE `groups` (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(80) NOT NULL,
  description TEXT NULL,
  category VARCHAR(40) NOT NULL DEFAULT 'Friends',
  cover_color CHAR(7) NOT NULL DEFAULT '#065F46',
  created_by BIGINT UNSIGNED NOT NULL,
  is_archived TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_groups_creator FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB;

-- M:N junction table between groups and users
CREATE TABLE trip_ledgers (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  group_id BIGINT UNSIGNED NULL,
  title VARCHAR(100) NOT NULL,
  description VARCHAR(500) NOT NULL DEFAULT '',
  event_date DATE NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_trip_ledger_user_date (user_id, event_date),
  CONSTRAINT fk_trip_ledger_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_trip_ledger_group FOREIGN KEY (group_id) REFERENCES `groups`(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE group_members (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  group_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  role ENUM('admin', 'member') NOT NULL DEFAULT 'member',
  joined_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_group_user (group_id, user_id),
  INDEX idx_gm_user (user_id),
  CONSTRAINT fk_gm_group FOREIGN KEY (group_id) REFERENCES `groups`(id) ON DELETE CASCADE,
  CONSTRAINT fk_gm_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE invitations (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  group_id BIGINT UNSIGNED NOT NULL,
  invited_by BIGINT UNSIGNED NOT NULL,
  invitee_email VARCHAR(255) NULL,
  token VARCHAR(128) NOT NULL UNIQUE,
  status ENUM('pending', 'accepted', 'revoked', 'expired') NOT NULL DEFAULT 'pending',
  max_uses INT NOT NULL DEFAULT 10,
  use_count INT NOT NULL DEFAULT 0,
  expires_at DATETIME NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_inv_group FOREIGN KEY (group_id) REFERENCES `groups`(id) ON DELETE CASCADE,
  CONSTRAINT fk_inv_user FOREIGN KEY (invited_by) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE guest_sessions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  token_hash CHAR(64) NOT NULL UNIQUE,
  invitation_id BIGINT UNSIGNED NOT NULL,
  group_id BIGINT UNSIGNED NOT NULL,
  expires_at DATETIME NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_guest_sessions_expiry (expires_at),
  CONSTRAINT fk_guest_session_invite FOREIGN KEY (invitation_id) REFERENCES invitations(id) ON DELETE CASCADE,
  CONSTRAINT fk_guest_session_group FOREIGN KEY (group_id) REFERENCES `groups`(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE trip_ledger_participants (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  ledger_id BIGINT UNSIGNED NOT NULL,
  display_name VARCHAR(80) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_trip_ledger_participants_ledger (ledger_id),
  CONSTRAINT fk_trip_participant_ledger FOREIGN KEY (ledger_id) REFERENCES trip_ledgers(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE trip_ledger_expenses (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  ledger_id BIGINT UNSIGNED NOT NULL,
  title VARCHAR(120) NOT NULL,
  description VARCHAR(500) NOT NULL DEFAULT '',
  expense_date DATE NOT NULL,
  paid_by_participant_id BIGINT UNSIGNED NOT NULL,
  total_paise BIGINT NOT NULL CHECK (total_paise > 0),
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_trip_ledger_expenses_ledger_date (ledger_id, expense_date, id),
  CONSTRAINT fk_trip_expense_ledger FOREIGN KEY (ledger_id) REFERENCES trip_ledgers(id) ON DELETE CASCADE,
  CONSTRAINT fk_trip_expense_payer FOREIGN KEY (paid_by_participant_id) REFERENCES trip_ledger_participants(id) ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE trip_ledger_items (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  expense_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(100) NOT NULL,
  unit_price_paise BIGINT NOT NULL CHECK (unit_price_paise > 0),
  quantity INT NOT NULL CHECK (quantity > 0),
  total_paise BIGINT NOT NULL CHECK (total_paise > 0),
  INDEX idx_trip_ledger_items_expense (expense_id, id),
  CONSTRAINT fk_trip_item_expense FOREIGN KEY (expense_id) REFERENCES trip_ledger_expenses(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE trip_ledger_item_consumers (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  item_id BIGINT UNSIGNED NOT NULL,
  participant_id BIGINT UNSIGNED NOT NULL,
  share_paise BIGINT NOT NULL CHECK (share_paise >= 0),
  UNIQUE KEY uq_trip_item_consumer (item_id, participant_id),
  INDEX idx_trip_consumers_participant (participant_id, item_id),
  CONSTRAINT fk_trip_consumer_item FOREIGN KEY (item_id) REFERENCES trip_ledger_items(id) ON DELETE CASCADE,
  CONSTRAINT fk_trip_consumer_participant FOREIGN KEY (participant_id) REFERENCES trip_ledger_participants(id) ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE trip_ledger_shares (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  expense_id BIGINT UNSIGNED NOT NULL,
  participant_id BIGINT UNSIGNED NOT NULL,
  owed_paise BIGINT NOT NULL CHECK (owed_paise >= 0),
  UNIQUE KEY uq_trip_expense_share (expense_id, participant_id),
  INDEX idx_trip_ledger_shares_expense (expense_id, participant_id),
  CONSTRAINT fk_trip_share_expense FOREIGN KEY (expense_id) REFERENCES trip_ledger_expenses(id) ON DELETE CASCADE,
  CONSTRAINT fk_trip_share_participant FOREIGN KEY (participant_id) REFERENCES trip_ledger_participants(id) ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE trip_ledger_settlements (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  ledger_id BIGINT UNSIGNED NOT NULL,
  payer_participant_id BIGINT UNSIGNED NOT NULL,
  receiver_participant_id BIGINT UNSIGNED NOT NULL,
  amount_paise BIGINT NOT NULL CHECK (amount_paise > 0),
  settlement_date DATE NOT NULL,
  note VARCHAR(250) NOT NULL DEFAULT '',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_trip_ledger_settlements_ledger (ledger_id, settlement_date, id),
  CONSTRAINT fk_trip_settle_ledger FOREIGN KEY (ledger_id) REFERENCES trip_ledgers(id) ON DELETE CASCADE,
  CONSTRAINT fk_trip_settle_payer FOREIGN KEY (payer_participant_id) REFERENCES trip_ledger_participants(id) ON DELETE RESTRICT,
  CONSTRAINT fk_trip_settle_receiver FOREIGN KEY (receiver_participant_id) REFERENCES trip_ledger_participants(id) ON DELETE RESTRICT,
  CHECK (payer_participant_id <> receiver_participant_id)
) ENGINE=InnoDB;

CREATE TABLE expenses (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  group_id BIGINT UNSIGNED NOT NULL,
  paid_by_user_id BIGINT UNSIGNED NOT NULL,
  created_by_user_id BIGINT UNSIGNED NOT NULL,
  title VARCHAR(120) NOT NULL,
  description TEXT NULL,
  notes TEXT NULL,
  category VARCHAR(40) NOT NULL DEFAULT 'Food',
  split_method ENUM('equal', 'exact', 'percentage', 'shares', 'itemized') NOT NULL,
  subtotal_paise BIGINT NOT NULL CHECK (subtotal_paise >= 0),
  tax_paise BIGINT NOT NULL DEFAULT 0 CHECK (tax_paise >= 0),
  tip_paise BIGINT NOT NULL DEFAULT 0 CHECK (tip_paise >= 0),
  discount_paise BIGINT NOT NULL DEFAULT 0 CHECK (discount_paise >= 0),
  total_paise BIGINT NOT NULL CHECK (total_paise > 0),
  currency CHAR(3) NOT NULL DEFAULT 'INR',
  expense_date DATE NOT NULL,
  receipt_data_url MEDIUMTEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_exp_group_date (group_id, expense_date),
  CONSTRAINT fk_exp_group FOREIGN KEY (group_id) REFERENCES `groups`(id) ON DELETE CASCADE,
  CONSTRAINT fk_exp_payer FOREIGN KEY (paid_by_user_id) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_exp_creator FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE expense_items (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  expense_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(120) NOT NULL,
  unit_price_paise BIGINT NOT NULL CHECK (unit_price_paise > 0),
  quantity INT NOT NULL DEFAULT 1 CHECK (quantity >= 1),
  total_paise BIGINT NOT NULL CHECK (total_paise > 0),
  CONSTRAINT fk_item_expense FOREIGN KEY (expense_id) REFERENCES expenses(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- M:N junction table mapping each bill item to the specific members who consumed it
CREATE TABLE item_consumers (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  item_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  share_weight INT NOT NULL DEFAULT 1 CHECK (share_weight >= 1),
  UNIQUE KEY uq_item_user (item_id, user_id),
  CONSTRAINT fk_ic_item FOREIGN KEY (item_id) REFERENCES expense_items(id) ON DELETE CASCADE,
  CONSTRAINT fk_ic_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE expense_splits (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  expense_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  owed_paise BIGINT NOT NULL CHECK (owed_paise >= 0),
  item_subtotal_paise BIGINT NOT NULL DEFAULT 0,
  shared_charges_paise BIGINT NOT NULL DEFAULT 0,
  share_meta VARCHAR(120) NULL,
  UNIQUE KEY uq_exp_user (expense_id, user_id),
  INDEX idx_splits_user (user_id),
  CONSTRAINT fk_es_expense FOREIGN KEY (expense_id) REFERENCES expenses(id) ON DELETE CASCADE,
  CONSTRAINT fk_es_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE settlements (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  group_id BIGINT UNSIGNED NOT NULL,
  payer_user_id BIGINT UNSIGNED NOT NULL,
  receiver_user_id BIGINT UNSIGNED NOT NULL,
  amount_paise BIGINT NOT NULL CHECK (amount_paise > 0),
  payment_method VARCHAR(40) NOT NULL DEFAULT 'UPI',
  reference_code VARCHAR(120) NULL,
  upi_uri TEXT NULL,
  status ENUM('pending', 'recorded', 'confirmed') NOT NULL DEFAULT 'pending',
  notes TEXT NULL,
  created_by BIGINT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  confirmed_at DATETIME NULL,
  CHECK (payer_user_id <> receiver_user_id),
  INDEX idx_settle_group_status (group_id, status),
  CONSTRAINT fk_settle_group FOREIGN KEY (group_id) REFERENCES `groups`(id) ON DELETE CASCADE,
  CONSTRAINT fk_settle_payer FOREIGN KEY (payer_user_id) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_settle_receiver FOREIGN KEY (receiver_user_id) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_settle_creator FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE notifications (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  group_id BIGINT UNSIGNED NULL,
  type VARCHAR(40) NOT NULL,
  title VARCHAR(140) NOT NULL,
  message TEXT NOT NULL,
  link_path VARCHAR(120) DEFAULT '/dashboard',
  is_read TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_notif_user_read (user_id, is_read),
  CONSTRAINT fk_notif_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_notif_group FOREIGN KEY (group_id) REFERENCES `groups`(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE activity_logs (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  group_id BIGINT UNSIGNED NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  action VARCHAR(60) NOT NULL,
  entity_type VARCHAR(40) NOT NULL,
  entity_id BIGINT UNSIGNED NULL,
  summary TEXT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_act_group (group_id, created_at),
  CONSTRAINT fk_act_group FOREIGN KEY (group_id) REFERENCES `groups`(id) ON DELETE CASCADE,
  CONSTRAINT fk_act_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;
