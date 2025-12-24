DROP TABLE IF EXISTS users;

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE,
  name TEXT,
  streak INTEGER DEFAULT 0,       -- コンボ数
  is_pro INTEGER DEFAULT 0,       -- 課金フラグ (0:無料, 1:有料)
  
  -- ★ここがAIの「脳みそ」になります
  memory TEXT DEFAULT '',         -- 長期記憶（ユーザーの癖や苦手なこと）
  current_best_style TEXT DEFAULT 'タスクを極限まで小さく分解し、優しく励ますパートナー', -- 現在の最適プロンプト
  
  created_at INTEGER
);
