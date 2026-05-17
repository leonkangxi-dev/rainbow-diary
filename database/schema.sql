-- 彩虹日记本 数据库Schema

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  avatar TEXT DEFAULT '🐱',
  role TEXT NOT NULL DEFAULT 'child',     -- 'parent' | 'child'
  pin TEXT DEFAULT '',                     -- 家长密码 / 孩子 PIN
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS diary_books (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  character_id TEXT NOT NULL DEFAULT 'hello-kitty',
  theme_color TEXT DEFAULT '#FFB7C5',
  lock_pin TEXT DEFAULT '',                -- 日记本加密PIN，空表示不加密
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  is_deleted INTEGER DEFAULT 0,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS diary_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id INTEGER NOT NULL,
  entry_date DATE NOT NULL,
  weather TEXT DEFAULT '',
  mood TEXT DEFAULT '',
  location TEXT DEFAULT '',
  people TEXT DEFAULT '',
  content TEXT DEFAULT '',
  audio_path TEXT DEFAULT '',
  sticker TEXT DEFAULT '',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  is_deleted INTEGER DEFAULT 0,
  FOREIGN KEY (book_id) REFERENCES diary_books(id)
);

CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  parent_pin TEXT DEFAULT '1234',
  voice_input_enabled INTEGER DEFAULT 0,
  server_port INTEGER DEFAULT 3000,
  voice_duration INTEGER DEFAULT 30
);

CREATE TABLE IF NOT EXISTS achievements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  badge_id TEXT NOT NULL,
  badge_name TEXT NOT NULL,
  badge_icon TEXT DEFAULT '🏆',
  earned_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, badge_id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- 默认插入一条设置记录
INSERT OR IGNORE INTO settings (id, parent_pin, voice_input_enabled) VALUES (1, '1234', 0);
