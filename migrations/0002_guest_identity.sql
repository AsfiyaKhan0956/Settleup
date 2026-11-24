-- Add guest identities without changing or rebuilding registered group_members.
CREATE TABLE IF NOT EXISTS guest_members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER NOT NULL,
  source_session_id INTEGER NOT NULL UNIQUE,
  display_name TEXT NOT NULL CHECK (length(trim(display_name)) BETWEEN 1 AND 80),
  linked_user_id INTEGER,
  joined_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE,
  FOREIGN KEY (source_session_id) REFERENCES guest_sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (linked_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_guest_members_group
  ON guest_members(group_id, joined_at);

ALTER TABLE guest_sessions
  ADD COLUMN guest_member_id INTEGER REFERENCES guest_members(id) ON DELETE SET NULL;
