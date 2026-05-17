const initSqlJs = require('sql.js');
const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const https = require('https');
const http = require('http');
const os = require('os');
const { networkInterfaces } = os;
const multer = require('multer');

const PORT = process.env.PORT || 3300;

// ======== Paths ========
const ELECTRON_DB_DIR = (() => {
  if (process.platform === 'win32') return path.join(os.homedir(), 'AppData', 'Roaming', 'rainbow-diary');
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', 'rainbow-diary');
  return path.join(os.homedir(), '.local', 'share', 'rainbow-diary');
})();
const LOCAL_DATA_DIR = path.join(__dirname, 'data');

let DATA_DIR, AUDIO_DIR, DB_PATH;
if (fs.existsSync(path.join(ELECTRON_DB_DIR, 'rainbow-diary.db'))) {
  DATA_DIR = ELECTRON_DB_DIR;
} else {
  DATA_DIR = LOCAL_DATA_DIR;
}
AUDIO_DIR = path.join(DATA_DIR, 'audio');
DB_PATH = path.join(DATA_DIR, 'rainbow-diary.db');
const SCHEMA_PATH = path.join(__dirname, 'database', 'schema.sql');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(AUDIO_DIR)) fs.mkdirSync(AUDIO_DIR, { recursive: true });

const upload = multer({ dest: AUDIO_DIR });

// ======== Database (standalone) ========
let db = null;

async function initDb() {
  const SQL = await initSqlJs({
    locateFile: file => path.join(__dirname, 'node_modules', 'sql.js', 'dist', file)
  });
  db = new SQL.Database(fs.existsSync(DB_PATH) ? fs.readFileSync(DB_PATH) : undefined);
  db.run('PRAGMA foreign_keys = ON');
  const schema = fs.readFileSync(SCHEMA_PATH, 'utf-8');
  db.run(schema);
  ['voice_duration', 'xf_appid', 'xf_apikey', 'xf_apisecret'].forEach(col => {
    try { db.run(`ALTER TABLE settings ADD COLUMN ${col} TEXT DEFAULT ''`); } catch(e) {}
  });
  saveDb();
}

function saveDb() { fs.writeFileSync(DB_PATH, Buffer.from(db.export())); }
function query(sql, params) {
  if (params) {
    const stmt = db.prepare(sql); stmt.bind(params);
    const r = []; while (stmt.step()) r.push(stmt.getAsObject()); stmt.free(); return r;
  }
  const r = db.exec(sql);
  if (!r.length) return [];
  const { columns, values } = r[0];
  return values.map(row => { const o = {}; columns.forEach((c, i) => { o[c] = row[i]; }); return o; });
}
function run(sql, params) { if (params) db.run(sql, params); else db.run(sql); saveDb(); }
function getOne(sql, params) { const r = query(sql, params); return r.length ? r[0] : null; }
function runInsert(sql, params) {
  db.exec('BEGIN'); const stmt = db.prepare(sql); stmt.bind(params); stmt.step(); stmt.free();
  const r = db.exec('SELECT last_insert_rowid() as id'); db.exec('COMMIT'); saveDb();
  return (r.length && r[0].values.length) ? r[0].values[0][0] : 0;
}

// ======== App factory (used by both standalone and Electron) ========
function createApp(dbApi) {
  const app = express();
  app.use(express.json({ limit: '50mb' }));
  app.use(express.static(path.join(__dirname, 'src'), { index: false }));
  app.use((req, res, next) => { res.header('Access-Control-Allow-Origin', '*'); res.header('Access-Control-Allow-Headers', 'Content-Type'); next(); });

  // Version
  app.get('/api/version', (req, res) => res.json({ version: require('./package.json').version }));

  // Settings
  app.get('/api/settings', (req, res) => res.json(dbApi.getOne('SELECT * FROM settings WHERE id = 1')));
  app.post('/api/settings', (req, res) => {
    const data = req.body; const sets = []; const params = {};
    for (const key of ['parent_pin','voice_input_enabled','server_port','voice_duration','xf_appid','xf_apikey','xf_apisecret']) {
      if (data[key] !== undefined) { sets.push(`${key} = @${key}`); params[`@${key}`] = data[key]; }
    }
    if (!sets.length) return res.json({ ok: false });
    dbApi.run(`UPDATE settings SET ${sets.join(', ')} WHERE id = 1`, params);
    res.json({ ok: true });
  });
  app.post('/api/settings/verify-pin', (req, res) => {
    const row = dbApi.getOne('SELECT parent_pin FROM settings WHERE id = 1');
    res.json({ ok: row && row.parent_pin === req.body.pin });
  });

  // Users
  app.get('/api/users', (req, res) => res.json(dbApi.query('SELECT id, name, avatar, role FROM users ORDER BY created_at')));
  app.post('/api/users', (req, res) => {
    const d = req.body;
    const id = dbApi.runInsert('INSERT INTO users (name, avatar, role, pin) VALUES (?,?,?,?)', [d.name, d.avatar||'🐱', d.role||'child', d.pin||'1234']);
    res.json({ id });
  });
  app.delete('/api/users/:id', (req, res) => { dbApi.run('DELETE FROM users WHERE id = ?', [parseInt(req.params.id)]); res.json({ ok: true }); });
  app.post('/api/users/:id/verify-pin', (req, res) => {
    const row = dbApi.getOne('SELECT pin FROM users WHERE id = ? AND role = ?', [parseInt(req.params.id), 'child']);
    res.json({ ok: row && row.pin === req.body.pin });
  });
  app.post('/api/users/:id/pin', (req, res) => { dbApi.run('UPDATE users SET pin = ? WHERE id = ?', [req.body.pin, parseInt(req.params.id)]); res.json({ ok: true }); });

  // Books
  app.get('/api/users/:userId/books', (req, res) => res.json(dbApi.query('SELECT id, user_id, title, character_id, theme_color, lock_pin, created_at FROM diary_books WHERE user_id = ? AND is_deleted = 0 ORDER BY updated_at DESC', [parseInt(req.params.userId)])));
  app.post('/api/books', (req, res) => {
    const d = req.body;
    const id = dbApi.runInsert('INSERT INTO diary_books (user_id, title, character_id, theme_color, lock_pin) VALUES (?,?,?,?,?)', [d.user_id, d.title, d.character_id||'hello-kitty', d.theme_color||'#FFB7C5', d.lock_pin||'']);
    res.json({ id });
  });
  app.put('/api/books/:id', (req, res) => {
    const d = req.body; const id = parseInt(req.params.id); const sets=[]; const params=[];
    for (const key of ['title','character_id','theme_color','lock_pin']) { if (d[key]!==undefined) { sets.push(`${key}=?`); params.push(d[key]); } }
    sets.push('updated_at=CURRENT_TIMESTAMP'); params.push(id);
    dbApi.run(`UPDATE diary_books SET ${sets.join(',')} WHERE id=?`, params); res.json({ ok: true });
  });
  app.delete('/api/books/:id', (req, res) => { dbApi.run('UPDATE diary_books SET is_deleted=1 WHERE id=?', [parseInt(req.params.id)]); res.json({ ok: true }); });
  app.post('/api/books/:id/verify-lock', (req, res) => {
    const row = dbApi.getOne('SELECT lock_pin FROM diary_books WHERE id=?', [parseInt(req.params.id)]);
    if (!row||!row.lock_pin) return res.json({ ok: true });
    res.json({ ok: row.lock_pin === req.body.pin });
  });

  // Entries
  app.get('/api/books/:bookId/entries', (req, res) => res.json(dbApi.query('SELECT id, book_id, entry_date, weather, mood, location, people, content, audio_path, sticker, created_at FROM diary_entries WHERE book_id=? AND is_deleted=0 ORDER BY entry_date DESC, created_at DESC', [parseInt(req.params.bookId)])));
  app.post('/api/entries', (req, res) => {
    const d = req.body;
    const id = dbApi.runInsert('INSERT INTO diary_entries (book_id, entry_date, weather, mood, location, people, content, audio_path, sticker) VALUES (?,?,?,?,?,?,?,?,?)', [d.book_id, d.entry_date, d.weather||'', d.mood||'', d.location||'', d.people||'', d.content||'', d.audio_path||'', d.sticker||'']);
    res.json({ id });
  });
  app.put('/api/entries/:id', (req, res) => {
    const d = req.body; const id = parseInt(req.params.id); const sets=[]; const params=[];
    for (const key of ['entry_date','weather','mood','location','people','content','audio_path','sticker']) { if (d[key]!==undefined) { sets.push(`${key}=?`); params.push(d[key]); } }
    sets.push('updated_at=CURRENT_TIMESTAMP'); params.push(id);
    dbApi.run(`UPDATE diary_entries SET ${sets.join(',')} WHERE id=?`, params); res.json({ ok: true });
  });
  app.delete('/api/entries/:id', (req, res) => { dbApi.run('UPDATE diary_entries SET is_deleted=1 WHERE id=?', [parseInt(req.params.id)]); res.json({ ok: true }); });
  app.get('/api/entries/:id', (req, res) => res.json(dbApi.getOne('SELECT * FROM diary_entries WHERE id=?', [parseInt(req.params.id)])));

  // Audio
  app.post('/api/audio/upload', upload.single('audio'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file' });
    const newName = `audio_${Date.now()}.webm`; const newPath = path.join(AUDIO_DIR, newName);
    fs.renameSync(req.file.path, newPath); res.json({ audio_path: newPath });
  });
  app.get('/api/audio/:filename', (req, res) => {
    const fp = path.join(AUDIO_DIR, req.params.filename);
    if (!fs.existsSync(fp)) return res.status(404).end(); res.sendFile(fp);
  });

  // Achievements
  app.get('/api/achievements', (req, res) => res.json(dbApi.query('SELECT * FROM achievements ORDER BY earned_at DESC')));
  app.post('/api/achievements', (req, res) => {
    const d = req.body;
    const id = dbApi.runInsert('INSERT OR IGNORE INTO achievements (user_id, badge_id, badge_name, badge_icon) VALUES (?,?,?,?)', [d.user_id, d.badge_id, d.badge_name, d.badge_icon]);
    res.json({ id });
  });
  app.get('/api/users/:userId/achievements', (req, res) => res.json(dbApi.query('SELECT * FROM achievements WHERE user_id=? ORDER BY earned_at DESC', [parseInt(req.params.userId)])));
  app.get('/api/users/:userId/stats', (req, res) => {
    const uid = parseInt(req.params.userId);
    const total = dbApi.query('SELECT COUNT(*) as c FROM diary_entries e JOIN diary_books b ON e.book_id=b.id WHERE b.user_id=? AND e.is_deleted=0 AND b.is_deleted=0', [uid]);
    const dates = dbApi.query('SELECT DISTINCT e.entry_date FROM diary_entries e JOIN diary_books b ON e.book_id=b.id WHERE b.user_id=? AND e.is_deleted=0 AND b.is_deleted=0 ORDER BY e.entry_date DESC', [uid]);
    res.json({ total: total[0].c, dates: dates.map(d=>d.entry_date) });
  });

  // Backup
  app.get('/api/backup/export/:childId', (req, res) => {
    const data = dbApi.exportChildBackup(parseInt(req.params.childId));
    if (!data) return res.status(404).json({ error: '找不到该孩子' });
    const fname = encodeURIComponent(`backup-${data.child.name}-${new Date().toISOString().slice(0, 10)}.json`);
    res.setHeader('Content-Disposition', `attachment; filename="${fname}"; filename*=UTF-8''${fname}`);
    res.json(data);
  });
  app.post('/api/backup/import', (req, res) => {
    const data = req.body;
    if (!data.child || !data.books) return res.status(400).json({ ok: false, error: '无效的备份文件' });
    const result = dbApi.importChildBackup(data);
    res.json({ ok: true, childName: result.childName });
  });

  // Speech Recognition
  app.post('/api/speech/recognize', (req, res) => {
    const { audio, xf_appid, xf_apikey, xf_apisecret } = req.body;
    if (!xf_appid || !xf_apikey || !xf_apisecret) return res.json({ error: '请先在家长设置中配置讯飞 API 凭据' });
    const curTime = Math.floor(Date.now()/1000).toString();
    const param = JSON.stringify({ auf:'audio/L16;rate=16000', aue:'raw', voice_name:'xiaoyan', speed:'50', volume:'50', pitch:'50', engine_type:'nova' });
    const paramBase64 = Buffer.from(param).toString('base64');
    const checkSum = crypto.createHash('sha1').update(xf_apikey + curTime + paramBase64).digest('hex');
    const body = JSON.stringify({
      common: { app_id: xf_appid },
      business: { language:'zh_cn', domain:'iat', accent:'mandarin', nunum:0, vad_eos:2000 },
      data: { status:2, format:'audio/L16;rate=16000', encoding:'raw', audio }
    });
    const xfReq = https.request({
      hostname:'iat-api.xfyun.cn', path:'/v2/iat', method:'POST',
      headers: { 'Content-Type':'application/json', 'Content-Length':Buffer.byteLength(body), 'X-Appid':xf_appid, 'X-CurTime':curTime, 'X-Param':paramBase64, 'X-CheckSum':checkSum }
    }, xfRes => {
      let data=''; xfRes.on('data',c=>data+=c);
      xfRes.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.code===0 && json.data) {
            const result = JSON.parse(json.data).cn||{}; const texts=[];
            for (const st of result.st||[]) for (const rt of st.rt||[]) for (const ws of rt.ws||[]) for (const cw of ws.cw||[]) if (cw.w) texts.push(cw.w);
            res.json({ text: texts.join('') });
          } else res.json({ error: json.message||`讯飞错误 code=${json.code}` });
        } catch(e) { res.json({ error:'解析讯飞响应失败: '+data.slice(0,200) }); }
      });
    });
    xfReq.on('error',e=>res.json({error:e.message})); xfReq.write(body); xfReq.end();
  });

  // Serve index.html
  app.get('/', (req, res) => {
    let html = fs.readFileSync(path.join(__dirname, 'src', 'index.html'), 'utf-8');
    html = html.replace('</body>', '<script src="js/server-bridge.js"></script></body>');
    res.send(html);
  });

  return app;
}

// ======== Backup / Restore helpers ========

function exportChildBackup(childId) {
  const child = getOne('SELECT id, name, avatar, role FROM users WHERE id = ? AND role = ?', [childId, 'child']);
  if (!child) return null;
  const books = query('SELECT * FROM diary_books WHERE user_id = ? AND is_deleted = 0 ORDER BY updated_at DESC', [childId]);
  const booksData = books.map(b => {
    const entries = query('SELECT * FROM diary_entries WHERE book_id = ? AND is_deleted = 0 ORDER BY entry_date DESC', [b.id]);
    return {
      title: b.title, character_id: b.character_id, theme_color: b.theme_color, lock_pin: b.lock_pin,
      entries: entries.map(e => ({
        entry_date: e.entry_date, weather: e.weather, mood: e.mood,
        location: e.location, people: e.people, content: e.content, sticker: e.sticker
      }))
    };
  });
  const achievements = query('SELECT * FROM achievements WHERE user_id = ? ORDER BY earned_at DESC', [childId]);
  return {
    version: require('./package.json').version,
    exportedAt: new Date().toISOString(),
    child: { name: child.name, avatar: child.avatar, role: child.role },
    books: booksData,
    achievements: achievements.map(a => ({ badge_id: a.badge_id, badge_name: a.badge_name, badge_icon: a.badge_icon, earned_at: a.earned_at }))
  };
}

function importChildBackup(data) {
  const existing = getOne('SELECT id FROM users WHERE name = ? AND role = ?', [data.child.name, 'child']);
  const childName = existing ? data.child.name + '（恢复）' : data.child.name;
  const newUserId = runInsert('INSERT INTO users (name, avatar, role, pin) VALUES (?,?,?,?)',
    [childName, data.child.avatar || '🐱', 'child', '1234']);
  for (const book of (data.books || [])) {
    const newBookId = runInsert('INSERT INTO diary_books (user_id, title, character_id, theme_color, lock_pin) VALUES (?,?,?,?,?)',
      [newUserId, book.title, book.character_id || 'hello-kitty', book.theme_color || '#FFB7C5', book.lock_pin || '']);
    for (const entry of (book.entries || [])) {
      runInsert('INSERT INTO diary_entries (book_id, entry_date, weather, mood, location, people, content, sticker) VALUES (?,?,?,?,?,?,?,?)',
        [newBookId, entry.entry_date, entry.weather || '', entry.mood || '', entry.location || '', entry.people || '', entry.content || '', entry.sticker || '']);
    }
  }
  for (const ach of (data.achievements || [])) {
    run('INSERT OR IGNORE INTO achievements (user_id, badge_id, badge_name, badge_icon) VALUES (?,?,?,?)',
      [newUserId, ach.badge_id, ach.badge_name, ach.badge_icon]);
  }
  return { childName };
}

// ======== Middleware ========
app.use(express.json({ limit: '50mb' }));
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
  for (const key of ['parent_pin', 'voice_input_enabled', 'server_port', 'voice_duration', 'xf_appid', 'xf_apikey', 'xf_apisecret']) {
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
  const id = runInsert('INSERT INTO users (name, avatar, role, pin) VALUES (?,?,?,?)',
    [d.name, d.avatar || '🐱', d.role || 'child', d.pin || '1234']);
  res.json({ id });
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
  const id = runInsert('INSERT INTO diary_books (user_id, title, character_id, theme_color, lock_pin) VALUES (?,?,?,?,?)',
    [d.user_id, d.title, d.character_id || 'hello-kitty', d.theme_color || '#FFB7C5', d.lock_pin || '']);
  res.json({ id });
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
  const id = runInsert('INSERT INTO diary_entries (book_id, entry_date, weather, mood, location, people, content, audio_path, sticker) VALUES (?,?,?,?,?,?,?,?,?)',
    [d.book_id, d.entry_date, d.weather||'', d.mood||'', d.location||'', d.people||'', d.content||'', d.audio_path||'', d.sticker||'']);
  res.json({ id });
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

// --- Speech Recognition (iFlytek) ---
app.post('/api/speech/recognize', (req, res) => {
  const { audio, xf_appid, xf_apikey, xf_apisecret } = req.body;
  if (!xf_appid || !xf_apikey || !xf_apisecret) {
    return res.json({ error: '请先在家长设置中配置讯飞 API 凭据' });
  }
  const curTime = Math.floor(Date.now() / 1000).toString();
  const param = JSON.stringify({
    auf: 'audio/L16;rate=16000', aue: 'raw',
    voice_name: 'xiaoyan', speed: '50', volume: '50', pitch: '50', engine_type: 'nova'
  });
  const paramBase64 = Buffer.from(param).toString('base64');
  const checkSum = crypto.createHash('sha1').update(xf_apikey + curTime + paramBase64).digest('hex');
  const body = JSON.stringify({
    common: { app_id: xf_appid },
    business: { language: 'zh_cn', domain: 'iat', accent: 'mandarin', nunum: 0, vad_eos: 2000 },
    data: { status: 2, format: 'audio/L16;rate=16000', encoding: 'raw', audio }
  });
  const opts = {
    hostname: 'iat-api.xfyun.cn', path: '/v2/iat', method: 'POST',
    headers: {
      'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body),
      'X-Appid': xf_appid, 'X-CurTime': curTime,
      'X-Param': paramBase64, 'X-CheckSum': checkSum
    }
  };
  const xfReq = https.request(opts, (xfRes) => {
    let data = '';
    xfRes.on('data', c => data += c);
    xfRes.on('end', () => {
      try {
        const json = JSON.parse(data);
        if (json.code === 0 && json.data) {
          const result = JSON.parse(json.data).cn || {};
          const texts = [];
          for (const st of (result.st || [])) {
            for (const rt of (st.rt || [])) {
              for (const ws of (rt.ws || [])) {
                for (const cw of (ws.cw || [])) {
                  if (cw.w) texts.push(cw.w);
                }
              }
            }
          }
          res.json({ text: texts.join('') });
        } else {
          res.json({ error: json.message || `讯飞错误 code=${json.code}` });
        }
      } catch(e) {
        res.json({ error: '解析讯飞响应失败: ' + data.slice(0, 200) });
      }
    });
  });
  xfReq.on('error', e => res.json({ error: e.message }));
  xfReq.write(body);
  xfReq.end();
});

// --- Achievements ---
app.get('/api/achievements', (req, res) => {
  res.json(query('SELECT * FROM achievements ORDER BY earned_at DESC'));
});

app.post('/api/achievements', (req, res) => {
  const d = req.body;
  const id = runInsert('INSERT OR IGNORE INTO achievements (user_id, badge_id, badge_name, badge_icon) VALUES (?,?,?,?)',
    [d.user_id, d.badge_id, d.badge_name, d.badge_icon]);
  res.json({ id });
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

// --- Backup / Restore ---
app.get('/api/backup/export/:childId', (req, res) => {
  const data = exportChildBackup(parseInt(req.params.childId));
  if (!data) return res.status(404).json({ error: '找不到该孩子' });
  const fname = encodeURIComponent(`backup-${data.child.name}-${new Date().toISOString().slice(0, 10)}.json`);
  res.setHeader('Content-Disposition', `attachment; filename="${fname}"; filename*=UTF-8''${fname}`);
  res.json(data);
});

app.post('/api/backup/import', (req, res) => {
  const data = req.body;
  if (!data.child || !data.books) return res.status(400).json({ ok: false, error: '无效的备份文件' });
  const result = importChildBackup(data);
  res.json({ ok: true, childName: result.childName });
});

// ======== Start Server (standalone) ========
async function startWithDb() {
  await initDb();
  await createAchievementsTable();
  const app = createApp({ query, run, getOne, runInsert, saveDb, getDbPath: () => DB_PATH, exportChildBackup, importChildBackup });
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
  return server;
}

async function createAchievementsTable() {
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

if (require.main === module) {
  startWithDb().catch(err => { console.error('Failed to start server:', err); process.exit(1); });
}

module.exports = { createApp, startWithDb, initDb, query, run, getOne, runInsert, saveDb, exportChildBackup, importChildBackup, getLocalIP, DB_PATH };
