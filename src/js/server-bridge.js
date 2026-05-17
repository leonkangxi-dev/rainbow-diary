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
    getUserStats: (userId) => api('GET', `/api/users/${userId}/stats`)
  };

  console.log('🌈 彩虹日记本 - 浏览器模式已启动');
})();
