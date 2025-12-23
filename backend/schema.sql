DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS bandit_stats; -- 不要になったので削除

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE,
  name TEXT,
  streak INTEGER DEFAULT 0,
  is_pro INTEGER DEFAULT 0,
  
  -- ★ここが進化
  memory TEXT DEFAULT '', -- ユーザーに関する事実（「レポートが苦手」など）
  current_best_style TEXT DEFAULT '優しく、かつ論理的にマイクロステップを提案するスタイル', -- 現在の最強プロンプト
  
  created_at INTEGER
);
