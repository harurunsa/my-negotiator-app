DROP TABLE IF EXISTS users;
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT,
  google_id TEXT,
  created_at INTEGER DEFAULT (strftime('%s', 'now'))
);
