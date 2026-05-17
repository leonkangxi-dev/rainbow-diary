const { app, BrowserWindow, ipcMain, dialog, protocol, net, session } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const https = require('https');
const { pathToFileURL } = require('url');
const db = require('./src/js/database');

// Register app:// as privileged scheme (needed before app.ready for SpeechRecognition secure context)
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { secure: true, standard: true, supportFetchAPI: true, corsEnabled: true } }
]);

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 960,
    height: 680,
    minWidth: 800,
    minHeight: 600,
    resizable: true,
    title: '彩虹日记本',
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  // Load from app:// (secure context) so Web Speech API works
  protocol.handle('app', (request) => {
    const url = new URL(request.url);
    const relPath = url.pathname.replace(/^\//, '') || 'index.html';
    const filePath = path.resolve(__dirname, 'src', relPath);
    return net.fetch(pathToFileURL(filePath).href);
  });

  mainWindow.loadURL('app:///index.html');
  mainWindow.setMenuBarVisibility(false);
}

// ======== IPC Handlers ========

// --- Settings ---
ipcMain.handle('settings:get', () => {
  return db.getSettings();
});

ipcMain.handle('settings:update', (_event, data) => {
  return db.updateSettings(data);
});

ipcMain.handle('settings:verifyPin', (_event, pin) => {
  return db.verifyParentPin(pin);
});

// --- Users ---
ipcMain.handle('users:list', () => {
  return db.getUsers();
});

ipcMain.handle('users:create', (_event, data) => {
  return db.createUser(data);
});

ipcMain.handle('users:delete', (_event, id) => {
  return db.deleteUser(id);
});

ipcMain.handle('users:verifyPin', (_event, userId, pin) => {
  return db.verifyUserPin(userId, pin);
});

ipcMain.handle('users:updatePin', (_event, userId, pin) => {
  return db.updateUserPin(userId, pin);
});

// --- Diary Books ---
ipcMain.handle('books:list', (_event, userId) => {
  return db.getBooks(userId);
});

ipcMain.handle('books:create', (_event, data) => {
  return db.createBook(data);
});

ipcMain.handle('books:update', (_event, id, data) => {
  return db.updateBook(id, data);
});

ipcMain.handle('books:delete', (_event, id) => {
  return db.deleteBook(id);
});

ipcMain.handle('books:verifyLock', (_event, bookId, pin) => {
  return db.verifyBookLock(bookId, pin);
});

// --- Diary Entries ---
ipcMain.handle('entries:list', (_event, bookId) => {
  return db.getEntries(bookId);
});

ipcMain.handle('entries:create', (_event, data) => {
  return db.createEntry(data);
});

ipcMain.handle('entries:update', (_event, id, data) => {
  return db.updateEntry(id, data);
});

ipcMain.handle('entries:delete', (_event, id) => {
  return db.deleteEntry(id);
});

ipcMain.handle('entries:get', (_event, id) => {
  return db.getEntry(id);
});

// --- Achievements ---
ipcMain.handle('achievements:list', (_event, userId) => {
  return db.getAchievements(userId);
});

ipcMain.handle('achievements:add', (_event, data) => {
  return db.addAchievement(data);
});

ipcMain.handle('users:stats', (_event, userId) => {
  return db.getUserStats(userId);
});

// --- Audio ---
ipcMain.handle('audio:save', (_event, buffer) => {
  return db.saveAudioFile(buffer);
});

ipcMain.handle('audio:getPath', (_event, entryId) => {
  return db.getAudioPath(entryId);
});

// --- Speech Recognition (iFlytek) ---
ipcMain.handle('speech:recognize', async (_event, audioBase64) => {
  const settings = db.getSettings();
  if (!settings.xf_appid || !settings.xf_apikey || !settings.xf_apisecret) {
    return { error: '请先在家长设置中配置讯飞 API 凭据' };
  }
  try {
    const result = await callIflytek(audioBase64, settings);
    return { text: result };
  } catch (e) {
    return { error: e.message };
  }
});

async function callIflytek(audioBase64, settings) {
  const { xf_appid, xf_apikey, xf_apisecret } = settings;
  const curTime = Math.floor(Date.now() / 1000).toString();
  const param = JSON.stringify({
    auf: 'audio/L16;rate=16000',
    aue: 'raw',
    voice_name: 'xiaoyan',
    speed: '50',
    volume: '50',
    pitch: '50',
    engine_type: 'nova'
  });
  const paramBase64 = Buffer.from(param).toString('base64');
  const checkSum = crypto.createHash('sha1').update(xf_apikey + curTime + paramBase64).digest('hex');

  const body = JSON.stringify({
    common: { app_id: xf_appid },
    business: { language: 'zh_cn', domain: 'iat', accent: 'mandarin', nunum: 0, vad_eos: 2000 },
    data: { status: 2, format: 'audio/L16;rate=16000', encoding: 'raw', audio: audioBase64 }
  });

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'iat-api.xfyun.cn',
      path: '/v2/iat',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Appid': xf_appid,
        'X-CurTime': curTime,
        'X-Param': paramBase64,
        'X-CheckSum': checkSum
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
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
            resolve(texts.join(''));
          } else {
            reject(new Error(json.message || `讯飞 API 错误: code=${json.code}`));
          }
        } catch (e) {
          reject(new Error('解析讯飞响应失败: ' + data.slice(0, 200)));
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// --- App Info ---
ipcMain.handle('app:version', () => {
  return require('./package.json').version;
});

// --- Backup / Restore ---
ipcMain.handle('backup:export', async (_event, childId) => {
  const data = db.exportChildBackup(childId);
  if (!data) return { ok: false, error: '找不到该孩子' };
  const { filePath: savePath } = await dialog.showSaveDialog(mainWindow, {
    title: '导出备份',
    defaultPath: `彩虹日记本-备份-${data.child.name}-${new Date().toISOString().slice(0, 10)}.json`,
    filters: [{ name: 'JSON 备份文件', extensions: ['json'] }]
  });
  if (!savePath) return { ok: false, error: '已取消' };
  fs.writeFileSync(savePath, JSON.stringify(data, null, 2), 'utf-8');
  return { ok: true };
});

ipcMain.handle('backup:import', async () => {
  try {
    const { filePaths } = await dialog.showOpenDialog(mainWindow, {
      title: '选择备份文件',
      filters: [{ name: 'JSON 备份文件', extensions: ['json'] }],
      properties: ['openFile']
    });
    if (!filePaths || filePaths.length === 0) return { ok: false, error: '已取消' };
    const raw = fs.readFileSync(filePaths[0], 'utf-8');
    let data;
    try { data = JSON.parse(raw); } catch(e) { return { ok: false, error: '文件格式错误' }; }
    if (!data.child || !data.books) return { ok: false, error: '无效的备份文件' };
    const result = db.importChildBackup(data);
    if (result.error) return { ok: false, error: result.error };
    return { ok: true, childName: result.childName };
  } catch(e) {
    return { ok: false, error: e.message };
  }
});

// ======== LAN Server (Express in-process, sharing Electron's DB) ========
let lanServer = null;

ipcMain.handle('server:start', async () => {
  if (lanServer) return { ok: true, url: `http://localhost:3000` };
  try {
    const { startLanServer } = require('./lan-server');
    const result = await startLanServer(db);
    lanServer = result.server;
    return { ok: true, url: result.url, lan: result.lan };
  } catch (e) {
    console.error('❌ LAN Server start failed:', e);
    return { ok: false, error: e.message || String(e) };
  }
});

ipcMain.handle('server:stop', () => {
  if (lanServer) {
    lanServer.close();
    lanServer = null;
  }
  return { ok: true };
});

// ======== App Lifecycle ========

app.whenReady().then(async () => {
  await db.initialize();

  // Auto-grant microphone permission for voice input (before window loads)
  session.defaultSession.setPermissionRequestHandler((wc, permission, callback) => {
    if (permission === 'media') callback(true);
    else callback(false);
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
