const initSqlJs = require('sql.js');
const express = require('express');
const path = require('path');
const fs = require('fs');
const http = require('http');
const os = require('os');
const { networkInterfaces } = os;
const multer = require('multer');

const app = express();
const PORT = process.env.PORT || 3000;

// ======== Paths (Cross-platform) ========
// Use the same database as Electron desktop app so data is shared
const ELECTRON_DB_DIR = (() => {
  if (process.platform === 'win32') {
    return path.join(os.homedir(), 'AppData', 'Roaming', 'rainbow-diary');
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'rainbow-diary');
  }
  return path.join(os.homedir(), '.local', 'share', 'rainbow-diary');
})();
const LOCAL_DATA_DIR = path.join(__dirname, 'data');

let DATA_DIR, AUDIO_DIR, DB_PATH;

if (fs.existsSync(path.join(ELECTRON_DB_DIR, 'rainbow-diary.db'))) {
  DATA_DIR = ELECTRON_DB_DIR;
  console.log('📂 使用 Electron 桌面版的数据库');
} else {
  DATA_DIR = LOCAL_DATA_DIR;
  console.log('📂 使用服务器独立数据库');
}

AUDIO_DIR = path.join(DATA_DIR, 'audio');
DB_PATH = path.join(DATA_DIR, 'rainbow-diary.db');
const SCHEMA_PATH = path.join(__dirname, 'database', 'schema.sql');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(AUDIO_DIR)) fs.mkdirSync(AUDIO_DIR, { recursive: true });

// ======== Multer for audio uploads ========
const upload = multer({ dest: AUDIO_DIR });

// ======== Database ========
let db = null;

async function initDb() {
  const SQL = await initSqlJs({
    locateFile: file => path.join(__dirname, 'node_modules', 'sql.js', 'dist', file)
  });
  if (fs.existsSync(DB_PATH)) {
    db = new SQL.Database(fs.readFileSync(DB_PATH));
  } else {
    db = new SQL.Database();
  }
  db.run('PRAGMA foreign_keys = ON');
  const schema = fs.readFileSync(SCHEMA_PATH, 'utf-8');
  db.run(schema);
  try { db.run('ALTER TABLE settings ADD COLUMN voice_duration INTEGER DEFAULT 30'); } catch(e) {}
  saveDb();
}

function saveDb() {
  fs.writeFileSync(DB_PATH, Buffer.from(db.export()));
}

function query(sql, params) {
  if (params) {
    const stmt = db.prepare(sql);
    stmt.bind(params);
    const results = [];
    while (stmt.step()) results.push(stmt.getAsObject());
    stmt.free();
    return results;
  }
  const result = db.exec(sql);
  if (result.length === 0) return [];
  const { columns, values } = result[0];
  return values.map(row => {
    const obj = {};
    columns.forEach((col, i) => { obj[col] = row[i]; });
    return obj;
  });
}

function run(sql, params) {
  if (params) db.run(sql, params);
  else db.run(sql);
  saveDb();
}

function getOne(sql, params) {
  const rows = query(sql, params);
  return rows.length > 0 ? rows[0] : null;
}

// ======== Middleware ========
app.use(express.json());
// Serve static files but NOT index.html (handled by custom route below)
app.use(express.static(path.join(__dirname, 'src'), { index: false }));

// CORS for LAN access
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  next();
});

// ======== REST API ========

// --- Settings ---
app.get('/api/version', (req, res) => {
  res.json({ version: require('./package.json').version });
});

app.get('/api/settings', (req, res) => {
  res.json(getOne('SELECT * FROM settings WHERE id = 1'));
});

app.post('/api/settings', (req, res) => {
  const data = req.body;
  const sets = []; const params = {};
  for (const key of ['parent_pin', 'voice_input_enabled', 'server_port', 'voice_duration']) {
    if (data[key] !== undefined) {
      sets.push(`${key} = @${key}`); params[`@${key}`] = data[key];
    }
  }
  if (sets.length === 0) return res.json({ ok: false });
  run(`UPDATE settings SET ${sets.join(', ')} WHERE id = 1`, params);
  res.json({ ok: true });
});

app.post('/api/settings/verify-pin', (req, res) => {
  const row = getOne('SELECT parent_pin FROM settings WHERE id = 1');
  res.json({ ok: row && row.parent_pin === req.body.pin });
});

// --- Users ---
app.get('/api/users', (req, res) => {
  res.json(query('SELECT id, name, avatar, role FROM users ORDER BY created_at'));
});

app.post('/api/users', (req, res) => {
  const d = req.body;
  run('INSERT INTO users (name, avatar, role, pin) VALUES (?,?,?,?)',
    [d.name, d.avatar || '🐱', d.role || 'child', d.pin || '']);
  const rows = query('SELECT last_insert_rowid() as id');
  res.json({ id: rows[0].id });
});

app.delete('/api/users/:id', (req, res) => {
  run('DELETE FROM users WHERE id = ?', [parseInt(req.params.id)]);
  res.json({ ok: true });
});

app.post('/api/users/:id/verify-pin', (req, res) => {
  const row = getOne('SELECT pin FROM users WHERE id = ? AND role = ?', [parseInt(req.params.id), 'child']);
  res.json({ ok: row && row.pin === req.body.pin });
});

app.post('/api/users/:id/pin', (req, res) => {
  run('UPDATE users SET pin = ? WHERE id = ?', [req.body.pin, parseInt(req.params.id)]);
  res.json({ ok: true });
});

// --- Diary Books ---
app.get('/api/users/:userId/books', (req, res) => {
  res.json(query(
    'SELECT id, user_id, title, character_id, theme_color, lock_pin, created_at FROM diary_books WHERE user_id = ? AND is_deleted = 0 ORDER BY updated_at DESC',
    [parseInt(req.params.userId)]));
});

app.post('/api/books', (req, res) => {
  const d = req.body;
  run('INSERT INTO diary_books (user_id, title, character_id, theme_color, lock_pin) VALUES (?,?,?,?,?)',
    [d.user_id, d.title, d.character_id || 'hello-kitty', d.theme_color || '#FFB7C5', d.lock_pin || '']);
  const rows = query('SELECT last_insert_rowid() as id');
  res.json({ id: rows[0].id });
});

app.put('/api/books/:id', (req, res) => {
  const d = req.body; const id = parseInt(req.params.id);
  const sets = []; const params = [];
  for (const key of ['title', 'character_id', 'theme_color', 'lock_pin']) {
    if (d[key] !== undefined) { sets.push(`${key} = ?`); params.push(d[key]); }
  }
  sets.push('updated_at = CURRENT_TIMESTAMP'); params.push(id);
  run(`UPDATE diary_books SET ${sets.join(', ')} WHERE id = ?`, params);
  res.json({ ok: true });
});

app.delete('/api/books/:id', (req, res) => {
  run('UPDATE diary_books SET is_deleted = 1 WHERE id = ?', [parseInt(req.params.id)]);
  res.json({ ok: true });
});

app.post('/api/books/:id/verify-lock', (req, res) => {
  const row = getOne('SELECT lock_pin FROM diary_books WHERE id = ?', [parseInt(req.params.id)]);
  if (!row || !row.lock_pin) return res.json({ ok: true });
  res.json({ ok: row.lock_pin === req.body.pin });
});

// --- Diary Entries ---
app.get('/api/books/:bookId/entries', (req, res) => {
  res.json(query(
    'SELECT id, book_id, entry_date, weather, mood, location, people, content, audio_path, sticker, created_at FROM diary_entries WHERE book_id = ? AND is_deleted = 0 ORDER BY entry_date DESC, created_at DESC',
    [parseInt(req.params.bookId)]));
});

app.post('/api/entries', (req, res) => {
  const d = req.body;
  run('INSERT INTO diary_entries (book_id, entry_date, weather, mood, location, people, content, audio_path, sticker) VALUES (?,?,?,?,?,?,?,?,?)',
    [d.book_id, d.entry_date, d.weather||'', d.mood||'', d.location||'', d.people||'', d.content||'', d.audio_path||'', d.sticker||'']);
  const rows = query('SELECT last_insert_rowid() as id');
  res.json({ id: rows[0].id });
});

app.put('/api/entries/:id', (req, res) => {
  const d = req.body; const id = parseInt(req.params.id);
  const sets = []; const params = [];
  for (const key of ['entry_date', 'weather', 'mood', 'location', 'people', 'content', 'audio_path', 'sticker']) {
    if (d[key] !== undefined) { sets.push(`${key} = ?`); params.push(d[key]); }
  }
  sets.push('updated_at = CURRENT_TIMESTAMP'); params.push(id);
  run(`UPDATE diary_entries SET ${sets.join(', ')} WHERE id = ?`, params);
  res.json({ ok: true });
});

app.delete('/api/entries/:id', (req, res) => {
  run('UPDATE diary_entries SET is_deleted = 1 WHERE id = ?', [parseInt(req.params.id)]);
  res.json({ ok: true });
});

app.get('/api/entries/:id', (req, res) => {
  res.json(getOne('SELECT * FROM diary_entries WHERE id = ?', [parseInt(req.params.id)]));
});

// --- Audio Upload ---
app.post('/api/audio/upload', upload.single('audio'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });
  const oldPath = req.file.path;
  const newName = `audio_${Date.now()}.webm`;
  const newPath = path.join(AUDIO_DIR, newName);
  fs.renameSync(oldPath, newPath);
  res.json({ audio_path: newPath });
});

app.get('/api/audio/:filename', (req, res) => {
  const filePath = path.join(AUDIO_DIR, req.params.filename);
  if (!fs.existsSync(filePath)) return res.status(404).end();
  res.sendFile(filePath);
});

// --- Achievements ---
app.get('/api/achievements', (req, res) => {
  res.json(query('SELECT * FROM achievements ORDER BY earned_at DESC'));
});

app.post('/api/achievements', (req, res) => {
  const d = req.body;
  run('INSERT OR IGNORE INTO achievements (user_id, badge_id, badge_name, badge_icon) VALUES (?,?,?,?)',
    [d.user_id, d.badge_id, d.badge_name, d.badge_icon]);
  const rows = query('SELECT last_insert_rowid() as id');
  res.json({ id: rows[0].id });
});

app.get('/api/users/:userId/achievements', (req, res) => {
  res.json(query('SELECT * FROM achievements WHERE user_id = ? ORDER BY earned_at DESC',
    [parseInt(req.params.userId)]));
});

// --- Entries count for streak ---
app.get('/api/users/:userId/stats', (req, res) => {
  const uid = parseInt(req.params.userId);
  const total = query('SELECT COUNT(*) as c FROM diary_entries e JOIN diary_books b ON e.book_id = b.id WHERE b.user_id = ? AND e.is_deleted = 0 AND b.is_deleted = 0', [uid]);
  const dates = query('SELECT DISTINCT e.entry_date FROM diary_entries e JOIN diary_books b ON e.book_id = b.id WHERE b.user_id = ? AND e.is_deleted = 0 AND b.is_deleted = 0 ORDER BY e.entry_date DESC', [uid]);
  res.json({ total: total[0].c, dates: dates.map(d => d.entry_date) });
});

// ======== Serve index.html (inject bridge script) ========
app.get('/', (req, res) => {
  let html = fs.readFileSync(path.join(__dirname, 'src', 'index.html'), 'utf-8');
  html = html.replace('</body>', '<script src="js/server-bridge.js"></script></body>');
  res.send(html);
});

// ======== Start Server ========
async function start() {
  await initDb();

  // Auto-migrate: add achievements table if not exists
  db.run(`CREATE TABLE IF NOT EXISTS achievements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    badge_id TEXT NOT NULL,
    badge_name TEXT NOT NULL,
    badge_icon TEXT DEFAULT '🏆',
    earned_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, badge_id)
  )`);
  saveDb();

  const server = http.createServer(app);
  server.listen(PORT, '0.0.0.0', () => {
    const ip = getLocalIP();
    console.log('\n================================');
    console.log('  🌈 彩虹日记本 - 局域网模式');
    console.log('================================');
    console.log(`  本机访问: http://localhost:${PORT}`);
    console.log(`  局域网访问: http://${ip}:${PORT}`);
    console.log(`  数据库位置: ${DB_PATH}`);
    console.log('================================\n');
  });
}

function getLocalIP() {
  const nets = networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return '127.0.0.1';
}

start().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
