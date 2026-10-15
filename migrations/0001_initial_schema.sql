CREATE TABLE settings (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL
);

CREATE TABLE secrets (
  key TEXT PRIMARY KEY NOT NULL,
  iv TEXT NOT NULL CHECK (length(iv) = 16),
  ciphertext TEXT NOT NULL
);

CREATE TABLE deliveries (
  id TEXT PRIMARY KEY NOT NULL,
  event TEXT NOT NULL,
  received_at INTEGER NOT NULL
);

CREATE INDEX deliveries_received_at ON deliveries (received_at);

CREATE TABLE outbox (
  id INTEGER PRIMARY KEY,
  text TEXT NOT NULL,
  button_url TEXT,
  silent INTEGER NOT NULL DEFAULT 0 CHECK (silent IN (0, 1)),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
  created_at INTEGER NOT NULL
);

CREATE INDEX outbox_status_created_at ON outbox (status, created_at);

CREATE TABLE token_cache (
  installation_id INTEGER PRIMARY KEY NOT NULL,
  iv TEXT NOT NULL CHECK (length(iv) = 16),
  ciphertext TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE meta (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL
);
