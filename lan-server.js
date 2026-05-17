const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const https = require('https');
const http = require('http');
const os = require('os');

function getLocalIP() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return '127.0.0.1';
}

async function startLanServer(db) {
  const app = express();
  app.use(express.json({ limit: '50mb' }));
  app.use(express.static(path.join(__dirname, 'src'), { index: false }));
  app.use((req, res, next) => { res.header('Access-Control-Allow-Origin', '*'); res.header('Access-Control-Allow-Headers', 'Content-Type'); next(); });

  const port = 3300;

  // Version
  app.get('/api/version', (req, res) => res.json({ version: require('./package.json').version }));

  // Settings
  app.get('/api/settings', (req, res) => res.json(db.getOne('SELECT * FROM settings WHERE id = 1')));
  app.post('/api/settings', (req, res) => {
    const data = req.body; const sets = []; const params = {};
    for (const key of ['parent_pin','voice_input_enabled','server_port','voice_duration','xf_appid','xf_apikey','xf_apisecret']) {
      if (data[key] !== undefined) { sets.push(`${key} = @${key}`); params[`@${key}`] = data[key]; }
    }
    if (!sets.length) return res.json({ ok: false });
    db.run(`UPDATE settings SET ${sets.join(', ')} WHERE id = 1`, params);
    res.json({ ok: true });
  });
  app.post('/api/settings/verify-pin', (req, res) => {
    const row = db.getOne('SELECT parent_pin FROM settings WHERE id = 1');
    res.json({ ok: row && row.parent_pin === req.body.pin });
  });

  // Users
  app.get('/api/users', (req, res) => res.json(db.query('SELECT id, name, avatar, role FROM users ORDER BY created_at')));
  app.post('/api/users', (req, res) => {
    const d = req.body;
    const id = db.runInsert('INSERT INTO users (name, avatar, role, pin) VALUES (?,?,?,?)', [d.name, d.avatar||'🐱', d.role||'child', d.pin||'1234']);
    res.json({ id });
  });
  app.delete('/api/users/:id', (req, res) => { db.run('DELETE FROM users WHERE id = ?', [parseInt(req.params.id)]); res.json({ ok: true }); });
  app.post('/api/users/:id/verify-pin', (req, res) => {
    const row = db.getOne('SELECT pin FROM users WHERE id = ? AND role = ?', [parseInt(req.params.id), 'child']);
    res.json({ ok: row && row.pin === req.body.pin });
  });
  app.post('/api/users/:id/pin', (req, res) => { db.run('UPDATE users SET pin = ? WHERE id = ?', [req.body.pin, parseInt(req.params.id)]); res.json({ ok: true }); });

  // Books
  app.get('/api/users/:userId/books', (req, res) => res.json(db.query('SELECT id, user_id, title, character_id, theme_color, lock_pin, created_at FROM diary_books WHERE user_id = ? AND is_deleted = 0 ORDER BY updated_at DESC', [parseInt(req.params.userId)])));
  app.post('/api/books', (req, res) => {
    const d = req.body;
    const id = db.runInsert('INSERT INTO diary_books (user_id, title, character_id, theme_color, lock_pin) VALUES (?,?,?,?,?)', [d.user_id, d.title, d.character_id||'hello-kitty', d.theme_color||'#FFB7C5', d.lock_pin||'']);
    res.json({ id });
  });
  app.put('/api/books/:id', (req, res) => {
    const d = req.body; const id = parseInt(req.params.id); const sets=[]; const params=[];
    for (const key of ['title','character_id','theme_color','lock_pin']) { if (d[key]!==undefined) { sets.push(`${key}=?`); params.push(d[key]); } }
    sets.push('updated_at=CURRENT_TIMESTAMP'); params.push(id);
    db.run(`UPDATE diary_books SET ${sets.join(',')} WHERE id=?`, params); res.json({ ok: true });
  });
  app.delete('/api/books/:id', (req, res) => { db.run('UPDATE diary_books SET is_deleted=1 WHERE id=?', [parseInt(req.params.id)]); res.json({ ok: true }); });
  app.post('/api/books/:id/verify-lock', (req, res) => {
    const row = db.getOne('SELECT lock_pin FROM diary_books WHERE id=?', [parseInt(req.params.id)]);
    if (!row||!row.lock_pin) return res.json({ ok: true });
    res.json({ ok: row.lock_pin === req.body.pin });
  });

  // Entries
  app.get('/api/books/:bookId/entries', (req, res) => res.json(db.query('SELECT id, book_id, entry_date, weather, mood, location, people, content, audio_path, sticker, created_at FROM diary_entries WHERE book_id=? AND is_deleted=0 ORDER BY entry_date DESC, created_at DESC', [parseInt(req.params.bookId)])));
  app.post('/api/entries', (req, res) => {
    const d = req.body;
    const id = db.runInsert('INSERT INTO diary_entries (book_id, entry_date, weather, mood, location, people, content, audio_path, sticker) VALUES (?,?,?,?,?,?,?,?,?)', [d.book_id, d.entry_date, d.weather||'', d.mood||'', d.location||'', d.people||'', d.content||'', d.audio_path||'', d.sticker||'']);
    res.json({ id });
  });
  app.put('/api/entries/:id', (req, res) => {
    const d = req.body; const id = parseInt(req.params.id); const sets=[]; const params=[];
    for (const key of ['entry_date','weather','mood','location','people','content','audio_path','sticker']) { if (d[key]!==undefined) { sets.push(`${key}=?`); params.push(d[key]); } }
    sets.push('updated_at=CURRENT_TIMESTAMP'); params.push(id);
    db.run(`UPDATE diary_entries SET ${sets.join(',')} WHERE id=?`, params); res.json({ ok: true });
  });
  app.delete('/api/entries/:id', (req, res) => { db.run('UPDATE diary_entries SET is_deleted=1 WHERE id=?', [parseInt(req.params.id)]); res.json({ ok: true }); });
  app.get('/api/entries/:id', (req, res) => res.json(db.getOne('SELECT * FROM diary_entries WHERE id=?', [parseInt(req.params.id)])));

  // Audio
  const AUDIO_DIR = path.join(path.dirname(db.getDbPath()), 'audio');
  if (!fs.existsSync(AUDIO_DIR)) fs.mkdirSync(AUDIO_DIR, { recursive: true });
  const multer = require('multer');
  const upload = multer({ dest: AUDIO_DIR });
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
  app.get('/api/achievements', (req, res) => res.json(db.query('SELECT * FROM achievements ORDER BY earned_at DESC')));
  app.post('/api/achievements', (req, res) => {
    const d = req.body;
    const id = db.runInsert('INSERT OR IGNORE INTO achievements (user_id, badge_id, badge_name, badge_icon) VALUES (?,?,?,?)', [d.user_id, d.badge_id, d.badge_name, d.badge_icon]);
    res.json({ id });
  });
  app.get('/api/users/:userId/achievements', (req, res) => res.json(db.query('SELECT * FROM achievements WHERE user_id=? ORDER BY earned_at DESC', [parseInt(req.params.userId)])));
  app.get('/api/users/:userId/stats', (req, res) => {
    const uid = parseInt(req.params.userId);
    const total = db.query('SELECT COUNT(*) as c FROM diary_entries e JOIN diary_books b ON e.book_id=b.id WHERE b.user_id=? AND e.is_deleted=0 AND b.is_deleted=0', [uid]);
    const dates = db.query('SELECT DISTINCT e.entry_date FROM diary_entries e JOIN diary_books b ON e.book_id=b.id WHERE b.user_id=? AND e.is_deleted=0 AND b.is_deleted=0 ORDER BY e.entry_date DESC', [uid]);
    res.json({ total: total[0].c, dates: dates.map(d=>d.entry_date) });
  });

  // Backup
  app.get('/api/backup/export/:childId', (req, res) => {
    const data = db.exportChildBackup(parseInt(req.params.childId));
    if (!data) return res.status(404).json({ error: '找不到该孩子' });
    const fname = encodeURIComponent(`backup-${data.child.name}-${new Date().toISOString().slice(0, 10)}.json`);
    res.setHeader('Content-Disposition', `attachment; filename="${fname}"; filename*=UTF-8''${fname}`);
    res.json(data);
  });
  app.post('/api/backup/import', (req, res) => {
    const data = req.body;
    if (!data.child || !data.books) return res.status(400).json({ ok: false, error: '无效的备份文件' });
    const result = db.importChildBackup(data);
    res.json({ ok: true, childName: result.childName });
  });

  // Speech
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

  // Serve page
  app.get('/', (req, res) => {
    let html = fs.readFileSync(path.join(__dirname, 'src', 'index.html'), 'utf-8');
    html = html.replace('</body>', '<script src="js/server-bridge.js"></script></body>');
    res.send(html);
  });

  const server = http.createServer(app);
  const actualPort = await new Promise((resolve, reject) => {
    const tryPort = (p) => {
      server.listen(p, '0.0.0.0')
        .once('listening', () => resolve(server.address().port))
        .once('error', (err) => {
          if (err.code === 'EADDRINUSE') {
            if (p < port + 100) tryPort(p + 1);
            else reject(new Error('端口被占用，尝试了100个端口均失败'));
          } else reject(err);
        });
    };
    tryPort(port);
  });
  const ip = getLocalIP();
  console.log(`🌐 LAN Server started at http://localhost:${actualPort} (LAN: http://${ip}:${actualPort})`);
  return { server, url: `http://localhost:${actualPort}`, lan: `http://${ip}:${actualPort}` };
}

module.exports = { startLanServer };
