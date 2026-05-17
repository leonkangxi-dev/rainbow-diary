// 彩虹日记本 - 浏览器模式 API 桥接层
// 在非 Electron 环境下创建与 preload.js 相同接口的 window.api

(function() {
  if (window.api) return; // 已有 API（Electron 模式）

  const BASE = '';

  async function api(method, url, body) {
    const opts = { method, headers: { 'Content-Type': 'application/json' } };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(BASE + url, opts);
    return res.json();
  }

  async function uploadAudio(blob) {
    const form = new FormData();
    form.append('audio', blob, 'recording.webm');
    const res = await fetch(BASE + '/api/audio/upload', { method: 'POST', body: form });
    return res.json();
  }

  window.api = {
    // Settings
    getSettings: () => api('GET', '/api/settings'),
    updateSettings: (data) => api('POST', '/api/settings', data),
    verifyParentPin: (pin) => api('POST', '/api/settings/verify-pin', { pin }).then(r => r.ok),

    // Users
    getUsers: () => api('GET', '/api/users'),
    createUser: (data) => api('POST', '/api/users', data),
    deleteUser: (id) => api('DELETE', `/api/users/${id}`),
    verifyUserPin: (userId, pin) => api('POST', `/api/users/${userId}/verify-pin`, { pin }).then(r => r.ok),
    updateUserPin: (userId, pin) => api('POST', `/api/users/${userId}/pin`, { pin }),

    // Books
    getBooks: (userId) => api('GET', `/api/users/${userId}/books`),
    createBook: (data) => api('POST', '/api/books', data),
    updateBook: (id, data) => api('PUT', `/api/books/${id}`, data),
    deleteBook: (id) => api('DELETE', `/api/books/${id}`),
    verifyBookLock: (bookId, pin) => api('POST', `/api/books/${bookId}/verify-lock`, { pin }).then(r => r.ok),

    // Entries
    getEntries: (bookId) => api('GET', `/api/books/${bookId}/entries`),
    createEntry: (data) => api('POST', '/api/entries', data),
    updateEntry: (id, data) => api('PUT', `/api/entries/${id}`, data),
    deleteEntry: (id) => api('DELETE', `/api/entries/${id}`),
    getEntry: (id) => api('GET', `/api/entries/${id}`),

    // Audio
    saveAudio: async (buffer) => {
      const blob = new Blob([buffer], { type: 'audio/webm' });
      const result = await uploadAudio(blob);
      return result.audio_path;
    },
    getAudioPath: (entryId) => api('GET', `/api/entries/${entryId}`).then(e => e.audio_path),

    // App
    getVersion: () => api('GET', '/api/version').then(r => r.version),

    // Achievements
    getAchievements: (userId) => api('GET', `/api/users/${userId}/achievements`),
    createAchievement: (data) => api('POST', '/api/achievements', data),
    getUserStats: (userId) => api('GET', `/api/users/${userId}/stats`),

    // LAN Server (server mode already has the server running)
    startServer: () => Promise.resolve({ ok: true, url: window.location.origin }),
    stopServer: () => Promise.resolve({ ok: true }),

    // Speech Recognition
    recognizeSpeech: async (audioBase64) => {
      const settings = await api('GET', '/api/settings');
      const res = await fetch(BASE + '/api/speech/recognize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          audio: audioBase64,
          xf_appid: settings.xf_appid,
          xf_apikey: settings.xf_apikey,
          xf_apisecret: settings.xf_apisecret
        })
      });
      return res.json();
    },

    // Backup / Restore
    exportChildBackup: async (childId) => {
      const data = await api('GET', `/api/backup/export/${childId}`);
      if (!data.child) return { ok: false, error: '找不到该孩子' };
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `彩虹日记本-备份-${data.child.name}-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(a.href);
      return { ok: true };
    },
    importChildBackup: async () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json';
      return new Promise(resolve => {
        input.onchange = async () => {
          if (!input.files[0]) return resolve({ ok: false, error: '已取消' });
          try {
            const text = await input.files[0].text();
            const data = JSON.parse(text);
            const result = await api('POST', '/api/backup/import', data);
            resolve(result);
          } catch(e) {
            resolve({ ok: false, error: '文件格式错误' });
          }
        };
        input.click();
      });
    }
  };

  console.log('🌈 彩虹日记本 - 浏览器模式已启动');
})();
