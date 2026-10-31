CREATE TABLE activity (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK (kind IN ('star', 'fork')),
  sender_id INTEGER NOT NULL,
  sender_login TEXT NOT NULL,
  repository_id INTEGER NOT NULL,
  repository TEXT NOT NULL,
  repository_url TEXT,
  star_count INTEGER,
  created_at INTEGER NOT NULL
);

CREATE INDEX activity_repository_sender ON activity (repository_id, sender_id);

CREATE INDEX activity_created_at ON activity (created_at);
