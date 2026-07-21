CREATE TABLE IF NOT EXISTS attendance_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  is_open INTEGER NOT NULL DEFAULT 0 CHECK (is_open IN (0, 1)),
  session_id INTEGER,
  attendance_id INTEGER,
  opened_at INTEGER
);

INSERT OR IGNORE INTO attendance_state (id, is_open) VALUES (1, 0);

CREATE TABLE IF NOT EXISTS login_attempts (
  ip TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL,
  reset_at INTEGER NOT NULL
);
