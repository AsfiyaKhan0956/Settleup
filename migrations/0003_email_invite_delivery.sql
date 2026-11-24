-- Durable request state prevents a repeated browser request from re-sending email.
CREATE TABLE IF NOT EXISTS email_invite_batches (
  request_id TEXT PRIMARY KEY,
  group_id INTEGER NOT NULL,
  requested_by_user_id INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'sent', 'partial', 'failed')),
  response_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE,
  FOREIGN KEY (requested_by_user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS email_invite_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL,
  recipient_count INTEGER NOT NULL CHECK (recipient_count > 0),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_email_invite_usage_user_day
  ON email_invite_usage(user_id, created_at);
