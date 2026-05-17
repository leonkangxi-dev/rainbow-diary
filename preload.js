const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {

  // Settings
  getSettings: () => ipcRenderer.invoke('settings:get'),
  updateSettings: (data) => ipcRenderer.invoke('settings:update', data),
  verifyParentPin: (pin) => ipcRenderer.invoke('settings:verifyPin', pin),

  // Users
  getUsers: () => ipcRenderer.invoke('users:list'),
  createUser: (data) => ipcRenderer.invoke('users:create', data),
  deleteUser: (id) => ipcRenderer.invoke('users:delete', id),
  verifyUserPin: (userId, pin) => ipcRenderer.invoke('users:verifyPin', userId, pin),
  updateUserPin: (userId, pin) => ipcRenderer.invoke('users:updatePin', userId, pin),

  // Diary Books
  getBooks: (userId) => ipcRenderer.invoke('books:list', userId),
  createBook: (data) => ipcRenderer.invoke('books:create', data),
  updateBook: (id, data) => ipcRenderer.invoke('books:update', id, data),
  deleteBook: (id) => ipcRenderer.invoke('books:delete', id),
  verifyBookLock: (bookId, pin) => ipcRenderer.invoke('books:verifyLock', bookId, pin),

  // Diary Entries
  getEntries: (bookId) => ipcRenderer.invoke('entries:list', bookId),
  createEntry: (data) => ipcRenderer.invoke('entries:create', data),
  updateEntry: (id, data) => ipcRenderer.invoke('entries:update', id, data),
  deleteEntry: (id) => ipcRenderer.invoke('entries:delete', id),
  getEntry: (id) => ipcRenderer.invoke('entries:get', id),

  // Audio
  saveAudio: (buffer) => ipcRenderer.invoke('audio:save', buffer),
  getAudioPath: (entryId) => ipcRenderer.invoke('audio:getPath', entryId),

  // App
  getVersion: () => ipcRenderer.invoke('app:version'),

  // Achievements
  getAchievements: (userId) => ipcRenderer.invoke('achievements:list', userId),
  createAchievement: (data) => ipcRenderer.invoke('achievements:add', data),
  getUserStats: (userId) => ipcRenderer.invoke('users:stats', userId)
});
