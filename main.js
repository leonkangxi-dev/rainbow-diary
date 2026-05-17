const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const db = require('./src/js/database');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 960,
    height: 680,
    minWidth: 800,
    minHeight: 600,
    resizable: true,
    title: '彩虹日记本',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));
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

// --- App Info ---
ipcMain.handle('app:version', () => {
  return require('./package.json').version;
});

// ======== App Lifecycle ========

app.whenReady().then(async () => {
  await db.initialize();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
