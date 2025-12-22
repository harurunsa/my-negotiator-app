DROP TABLE IF EXISTS users;
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  google_id TEXT UNIQUE,
  email TEXT,
  subscription_status TEXT DEFAULT 'free',
  created_at INTEGER DEFAULT (strftime('%s', 'now'))
);

-- タスク履歴（ここには保存せず、メモリ上で回してもいいが、コンボ用に一応持つ）
DROP TABLE IF EXISTS tasks;
CREATE TABLE tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT,
  original_task TEXT,
  status TEXT DEFAULT 'pending', -- pending, completed
  created_at INTEGER DEFAULT (strftime('%s', 'now'))
);
