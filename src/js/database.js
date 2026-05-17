const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');
const { app } = require('electron');

let db = null;
let SQL = null;

function getDbPath() {
  const userDataPath = app.getPath('userData');
  return path.join(userDataPath, 'rainbow-diary.db');
}

function getAudioDir() {
  const userDataPath = app.getPath('userData');
  const audioDir = path.join(userDataPath, 'audio');
  if (!fs.existsSync(audioDir)) {
    fs.mkdirSync(audioDir, { recursive: true });
  }
  return audioDir;
}

function saveDb() {
  const data = Buffer.from(db.export());
  fs.writeFileSync(getDbPath(), data);
}

function query(sql, params) {
  if (params) {
    const stmt = db.prepare(sql);
    stmt.bind(params);
    const results = [];
    while (stmt.step()) {
      results.push(stmt.getAsObject());
    }
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
  if (params) {
    db.run(sql, params);
  } else {
    db.run(sql);
  }
  saveDb();
}

function getOne(sql, params) {
  const rows = query(sql, params);
  return rows.length > 0 ? rows[0] : null;
}

function runInsert(sql, params) {
  db.exec('BEGIN');
  const stmt = db.prepare(sql);
  stmt.bind(params);
  stmt.step();
  stmt.free();
  const r = db.exec('SELECT last_insert_rowid() as id');
  db.exec('COMMIT');
  saveDb();
  return (r.length > 0 && r[0].values.length > 0) ? r[0].values[0][0] : 0;
}

async function initialize() {
  SQL = await initSqlJs({
    locateFile: file => path.join(__dirname, '..', '..', 'node_modules', 'sql.js', 'dist', file)
  });
  const dbPath = getDbPath();
  if (fs.existsSync(dbPath)) {
    const buffer = fs.readFileSync(dbPath);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }
  db.run('PRAGMA foreign_keys = ON');
  const schema = fs.readFileSync(
    path.join(__dirname, '..', '..', 'database', 'schema.sql'),
    'utf-8'
  );
  db.run(schema);
  // Migrations for existing databases
  try { db.run('ALTER TABLE settings ADD COLUMN voice_duration INTEGER DEFAULT 30'); } catch(e) {}
  try { db.run("ALTER TABLE settings ADD COLUMN xf_appid TEXT DEFAULT ''"); } catch(e) {}
  try { db.run("ALTER TABLE settings ADD COLUMN xf_apikey TEXT DEFAULT ''"); } catch(e) {}
  try { db.run("ALTER TABLE settings ADD COLUMN xf_apisecret TEXT DEFAULT ''"); } catch(e) {}
  saveDb();
}

// ======== Settings ========

function getSettings() {
  return getOne('SELECT * FROM settings WHERE id = 1');
}

function updateSettings(data) {
  const sets = [];
  const params = {};
  for (const [key, val] of Object.entries(data)) {
    if (['parent_pin', 'voice_input_enabled', 'server_port', 'voice_duration', 'xf_appid', 'xf_apikey', 'xf_apisecret'].includes(key)) {
      sets.push(`${key} = @${key}`);
      params[`@${key}`] = val;
    }
  }
  if (sets.length === 0) return;
  const sql = `UPDATE settings SET ${sets.join(', ')} WHERE id = 1`;
  run(sql, params);
}

function verifyParentPin(pin) {
  const row = getOne('SELECT parent_pin FROM settings WHERE id = 1');
  return row && row.parent_pin === pin;
}

// ======== Users ========

function getUsers() {
  return query('SELECT id, name, avatar, role FROM users ORDER BY created_at');
}

function createUser(data) {
  const id = runInsert(
    'INSERT INTO users (name, avatar, role, pin) VALUES (?, ?, ?, ?)',
    [data.name, data.avatar || '🐱', data.role || 'child', data.pin || '']
  );
  return { id };
}

function deleteUser(id) {
  run('DELETE FROM users WHERE id = ?', [id]);
}

function verifyUserPin(userId, pin) {
  const row = getOne('SELECT pin FROM users WHERE id = ? AND role = ?', [userId, 'child']);
  return row && row.pin === pin;
}

function updateUserPin(userId, pin) {
  run('UPDATE users SET pin = ? WHERE id = ?', [pin, userId]);
}

// ======== Diary Books ========

function getBooks(userId) {
  return query(
    'SELECT id, user_id, title, character_id, theme_color, lock_pin, created_at FROM diary_books WHERE user_id = ? AND is_deleted = 0 ORDER BY updated_at DESC',
    [userId]
  );
}

function createBook(data) {
  const id = runInsert(
    'INSERT INTO diary_books (user_id, title, character_id, theme_color, lock_pin) VALUES (?, ?, ?, ?, ?)',
    [data.user_id, data.title, data.character_id || 'hello-kitty', data.theme_color || '#FFB7C5', data.lock_pin || '']
  );
  return { id };
}

function updateBook(id, data) {
  const sets = [];
  const params = [];
  for (const key of ['title', 'character_id', 'theme_color', 'lock_pin']) {
    if (data[key] !== undefined) {
      sets.push(`${key} = ?`);
      params.push(data[key]);
    }
  }
  sets.push('updated_at = CURRENT_TIMESTAMP');
  params.push(id);
  run(`UPDATE diary_books SET ${sets.join(', ')} WHERE id = ?`, params);
}

function deleteBook(id) {
  run('UPDATE diary_books SET is_deleted = 1 WHERE id = ?', [id]);
}

function verifyBookLock(bookId, pin) {
  const row = getOne('SELECT lock_pin FROM diary_books WHERE id = ?', [bookId]);
  if (!row || !row.lock_pin) return true;
  return row.lock_pin === pin;
}

// ======== Diary Entries ========

function getEntries(bookId) {
  return query(
    'SELECT id, book_id, entry_date, weather, mood, location, people, content, audio_path, sticker, created_at FROM diary_entries WHERE book_id = ? AND is_deleted = 0 ORDER BY entry_date DESC, created_at DESC',
    [bookId]
  );
}

function createEntry(data) {
  const id = runInsert(
    'INSERT INTO diary_entries (book_id, entry_date, weather, mood, location, people, content, audio_path, sticker) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [data.book_id, data.entry_date, data.weather || '', data.mood || '', data.location || '', data.people || '', data.content || '', data.audio_path || '', data.sticker || '']
  );
  return { id };
}

function updateEntry(id, data) {
  const sets = [];
  const params = [];
  for (const key of ['entry_date', 'weather', 'mood', 'location', 'people', 'content', 'audio_path', 'sticker']) {
    if (data[key] !== undefined) {
      sets.push(`${key} = ?`);
      params.push(data[key]);
    }
  }
  sets.push('updated_at = CURRENT_TIMESTAMP');
  params.push(id);
  run(`UPDATE diary_entries SET ${sets.join(', ')} WHERE id = ?`, params);
}

function deleteEntry(id) {
  run('UPDATE diary_entries SET is_deleted = 1 WHERE id = ?', [id]);
}

function getEntry(id) {
  return getOne('SELECT * FROM diary_entries WHERE id = ?', [id]);
}

// ======== Audio ========

function saveAudioFile(buffer) {
  const audioDir = getAudioDir();
  const filename = `audio_${Date.now()}.webm`;
  const filePath = path.join(audioDir, filename);
  fs.writeFileSync(filePath, Buffer.from(buffer));
  return filePath;
}

function getAudioPath(entryId) {
  const row = getOne('SELECT audio_path FROM diary_entries WHERE id = ?', [entryId]);
  return row ? row.audio_path : '';
}

// ======== Achievements ========

function getAchievements(userId) {
  return query('SELECT * FROM achievements WHERE user_id = ? ORDER BY earned_at DESC', [userId]);
}

function addAchievement(data) {
  run('INSERT OR IGNORE INTO achievements (user_id, badge_id, badge_name, badge_icon) VALUES (?, ?, ?, ?)',
    [data.user_id, data.badge_id, data.badge_name, data.badge_icon]);
  const rows = query('SELECT last_insert_rowid() as id');
  return { id: rows[0].id };
}

function getUserStats(userId) {
  const total = getOne(
    'SELECT COUNT(*) as count FROM diary_entries e JOIN diary_books b ON e.book_id = b.id WHERE b.user_id = ? AND e.is_deleted = 0 AND b.is_deleted = 0',
    [userId]
  );
  const dates = query(
    'SELECT DISTINCT e.entry_date FROM diary_entries e JOIN diary_books b ON e.book_id = b.id WHERE b.user_id = ? AND e.is_deleted = 0 AND b.is_deleted = 0 ORDER BY e.entry_date DESC',
    [userId]
  );
  return {
    total: total ? total.count : 0,
    dates: dates.map(d => d.entry_date)
  };
}

// ======== Backup / Restore ========

function exportChildBackup(childId) {
  const child = getOne('SELECT id, name, avatar, role FROM users WHERE id = ? AND role = ?', [childId, 'child']);
  if (!child) return null;
  const books = getBooks(childId);
  const booksData = books.map(b => {
    const entries = getEntries(b.id);
    return {
      title: b.title,
      character_id: b.character_id,
      theme_color: b.theme_color,
      lock_pin: b.lock_pin,
      entries: entries.map(e => ({
        entry_date: e.entry_date,
        weather: e.weather,
        mood: e.mood,
        location: e.location,
        people: e.people,
        content: e.content,
        sticker: e.sticker
      }))
    };
  });
  const achievements = getAchievements(childId);
  return {
    version: require('./package.json').version,
    exportedAt: new Date().toISOString(),
    child: { name: child.name, avatar: child.avatar, role: child.role },
    books: booksData,
    achievements: achievements.map(a => ({ badge_id: a.badge_id, badge_name: a.badge_name, badge_icon: a.badge_icon, earned_at: a.earned_at }))
  };
}

function importChildBackup(data) {
  try {
    const existing = getOne('SELECT id FROM users WHERE name = ? AND role = ?', [data.child.name, 'child']);
    const childName = existing ? data.child.name + '（恢复）' : data.child.name;
    const result = createUser({ name: childName, avatar: data.child.avatar, role: 'child', pin: '1234' });
    const newUserId = result.id;
    for (const book of (data.books || [])) {
      const bookResult = createBook({
        user_id: newUserId, title: book.title,
        character_id: book.character_id || 'hello-kitty',
        theme_color: book.theme_color || '#FFB7C5',
        lock_pin: book.lock_pin || ''
      });
      for (const entry of (book.entries || [])) {
        createEntry({
          book_id: bookResult.id, entry_date: entry.entry_date,
          weather: entry.weather || '', mood: entry.mood || '',
          location: entry.location || '', people: entry.people || '',
          content: entry.content || '', sticker: entry.sticker || ''
        });
      }
    }
    for (const ach of (data.achievements || [])) {
      addAchievement({ user_id: newUserId, badge_id: ach.badge_id, badge_name: ach.badge_name, badge_icon: ach.badge_icon });
    }
    return { childName };
  } catch(e) {
    return { childName: data.child.name, error: e.message };
  }
}

module.exports = {
  initialize,
  query, run, getOne, runInsert, saveDb, getDbPath,
  getSettings,
  updateSettings,
  verifyParentPin,
  getUsers,
  createUser,
  deleteUser,
  verifyUserPin,
  updateUserPin,
  getBooks,
  createBook,
  updateBook,
  deleteBook,
  verifyBookLock,
  getEntries,
  createEntry,
  updateEntry,
  deleteEntry,
  getEntry,
  saveAudioFile,
  getAudioPath,
  getAchievements,
  addAchievement,
  getUserStats,
  getChildBackup: exportChildBackup,
  exportChildBackup,
  importChildBackup
};
