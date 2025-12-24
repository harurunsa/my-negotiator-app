DROP TABLE IF EXISTS users;

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE,
  name TEXT,
  streak INTEGER DEFAULT 0,
  is_pro INTEGER DEFAULT 0,
  memory TEXT DEFAULT '',
  current_best_style TEXT DEFAULT 'タスクを極限まで小さく分解し、優しく励ますパートナー',
  
  -- ★追加: 回数制限用
  usage_count INTEGER DEFAULT 0,       -- 今日の使用回数
  last_usage_date TEXT DEFAULT '',     -- 最後に使った日付 (YYYY-MM-DD)
  
  created_at INTEGER
);
