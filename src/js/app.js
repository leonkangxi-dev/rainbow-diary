// ======== State ========
const state = {
  currentUser: null,
  currentBook: null,
  currentEntry: null,
  editingEntryId: null,
  selectedCharacter: 'hello-kitty',
  selectedAvatar: '🐱',
  voiceEnabled: false,
  voiceDuration: 30,
  voiceRemaining: 30,
  voiceTranscript: '',
  voiceTimerInterval: null,
  isRecording: false,
  audioBlob: null,
  confirmCallback: null,
  selectedWeather: '',
  selectedMood: '',
  selectedSticker: ''
};

// ======== Router ========
const router = {
  go(page, data) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    const el = document.getElementById(`page-${page}`);
    if (el) {
      el.classList.add('active');
      el.scrollTop = 0;
    }
    if (page === 'home') this.onHome();
    else if (page === 'bookshelf') this.onBookshelf();
    else if (page === 'entries') this.onEntries(data);
    else if (page === 'editor') this.onEditor(data);
    else if (page === 'settings') this.onSettings();
  },

  onHome() {
    renderUserCards();
    setVersion('versionHome');
  },

  onBookshelf() {
    renderBookshelf();
  },

  onEntries(bookId) {
    state.currentBook = bookId;
    renderEntries(bookId);
  },

  onEditor(data) {
    if (data && data.id) {
      state.editingEntryId = data.id;
      loadEntryForEdit(data.id);
    } else {
      state.editingEntryId = null;
      resetEditorForm();
    }
    checkVoiceEnabled();
  },

  onSettings() {
    settings.init();
    settings.renderChildren();
    setVersion('versionSettings');
  }
};

// ======== Version ========
let cachedVersion = null;
async function setVersion(elementId) {
  const el = document.getElementById(elementId);
  if (!el) return;
  if (!cachedVersion) {
    try {
      cachedVersion = await window.api.getVersion();
    } catch (e) {
      cachedVersion = '';
    }
  }
  el.textContent = cachedVersion ? `v${cachedVersion}` : '';
}

// ======== Auth ========
const auth = {
  async verifyParentPin() {
    const pin = document.getElementById('parentPinInput').value;
    const ok = await window.api.verifyParentPin(pin);
    if (ok) {
      document.getElementById('parentPinInput').value = '';
      document.getElementById('parentPinError').classList.add('hidden');
      router.go('settings');
    } else {
      document.getElementById('parentPinError').classList.remove('hidden');
    }
  },

  async selectUser(user) {
    state.currentUser = user;
    if (user.role === 'child') {
      document.getElementById('childLoginName').textContent = `👋 你好，${user.name}！`;
      document.getElementById('childPinInput').value = '';
      document.getElementById('childPinError').classList.add('hidden');
      router.go('child-login');
    } else {
      router.go('bookshelf');
    }
  },

  async verifyChildPin() {
    const pin = document.getElementById('childPinInput').value;
    const ok = await window.api.verifyUserPin(state.currentUser.id, pin);
    if (ok) {
      document.getElementById('childPinInput').value = '';
      document.getElementById('childPinError').classList.add('hidden');
      document.getElementById('bookshelfUser').textContent = `${state.currentUser.avatar} ${state.currentUser.name}`;
      router.go('bookshelf');
    } else {
      document.getElementById('childPinError').classList.remove('hidden');
    }
  },

  async checkExistingUsers() {
    const users = await window.api.getUsers();
    return users;
  }
};

// ======== Settings ========
const settings = {
  async init() {
    const s = await window.api.getSettings();
    document.getElementById('voiceToggle').checked = !!s.voice_input_enabled;
    state.voiceEnabled = !!s.voice_input_enabled;
    state.voiceDuration = s.voice_duration || 30;
    const radios = document.getElementsByName('voiceDuration');
    for (const r of radios) {
      r.checked = parseInt(r.value) === state.voiceDuration;
    }
    if (document.getElementById('xfAppid')) {
      document.getElementById('xfAppid').value = s.xf_appid || '';
      document.getElementById('xfApiKey').value = s.xf_apikey || '';
      document.getElementById('xfApiSecret').value = s.xf_apisecret || '';
    }
  },

  async toggleVoice() {
    const enabled = document.getElementById('voiceToggle').checked ? 1 : 0;
    await window.api.updateSettings({ voice_input_enabled: enabled });
    state.voiceEnabled = !!enabled;
  },

  async setDuration(sec) {
    state.voiceDuration = sec;
    await window.api.updateSettings({ voice_duration: sec });
  },

  async setXfConfig() {
    const appid = document.getElementById('xfAppid').value.trim();
    const apikey = document.getElementById('xfApiKey').value.trim();
    const apisecret = document.getElementById('xfApiSecret').value.trim();
    await window.api.updateSettings({ xf_appid: appid, xf_apikey: apikey, xf_apisecret: apisecret });
    const msg = document.getElementById('xfStatus');
    if (appid && apikey && apisecret) {
      msg.textContent = '✅ 讯飞配置已保存';
      msg.className = 'success-msg';
    } else if (!appid && !apikey && !apisecret) {
      msg.textContent = '⚠️ 未配置讯飞凭据，语音识别将不可用';
      msg.className = 'success-msg';
    } else {
      msg.textContent = '⚠️ 请完整填写 APPID、API Key 和 API Secret';
      msg.className = 'success-msg';
    }
    msg.classList.remove('hidden');
    setTimeout(() => msg.classList.add('hidden'), 3000);
  },

  async renderChildren() {
    const users = await window.api.getUsers();
    const container = document.getElementById('childList');
    const children = users.filter(u => u.role === 'child');
    if (children.length === 0) {
      container.innerHTML = '<p style="color:var(--text-light);padding:8px;">还没有添加孩子～</p>';
      return;
    }
    container.innerHTML = children.map(u => `
      <div class="child-item">
        <span class="avatar">${u.avatar}</span>
        <span class="name">${u.name}</span>
        <div class="child-actions">
          <button class="btn btn-backup btn-sm" onclick="backup.exportChild(${u.id})">💾 备份</button>
          <button class="btn btn-danger btn-sm" onclick="settings.deleteChild(${u.id})">删除</button>
        </div>
      </div>
    `).join('');
  },

  async deleteChild(id) {
    dialog.show('确认删除', '删除后孩子的日记本和日记都会消失哦！', async () => {
      await window.api.deleteUser(id);
      this.renderChildren();
    });
  },

  showAddChild() {
    document.getElementById('childNameInput').value = '';
    state.selectedAvatar = '🐱';
    document.querySelectorAll('#avatarSelect .avatar-option').forEach(el => el.classList.remove('selected'));
    document.querySelector('#avatarSelect .avatar-option').classList.add('selected');
    document.getElementById('addChildModal').classList.remove('hidden');
  },

  hideAddChild() {
    document.getElementById('addChildModal').classList.add('hidden');
  },

  onAvatarClick(event) {
    const el = event.target.closest('.avatar-option');
    if (!el) return;
    state.selectedAvatar = el.dataset.avatar;
    document.querySelectorAll('#avatarSelect .avatar-option').forEach(e => e.classList.remove('selected'));
    el.classList.add('selected');
  },

  async addChild() {
    const name = document.getElementById('childNameInput').value.trim();
    if (!name) return alert('请输入孩子的名字～');
    const defaultPin = '1234';
    await window.api.createUser({ name, avatar: state.selectedAvatar, role: 'child', pin: defaultPin });
    this.hideAddChild();
    this.renderChildren();
  },

  async changeParentPin() {
    const pin = document.getElementById('newParentPin').value;
    if (!pin || pin.length !== 4) return alert('请输入4位数字密码');
    await window.api.updateSettings({ parent_pin: pin });
    document.getElementById('newParentPin').value = '';
    document.getElementById('pinChangeMsg').classList.remove('hidden');
    setTimeout(() => document.getElementById('pinChangeMsg').classList.add('hidden'), 2000);
  },

  async toggleServer() {
    const checked = document.getElementById('serverToggle').checked;
    const status = document.getElementById('serverStatus');
    if (checked) {
      status.textContent = '⏳ 正在启动服务...';
      status.classList.remove('hidden');
      const result = await window.api.startServer();
      if (result.ok) {
        status.textContent = `🌐 服务已启动：${result.url}（局域网：${result.lan}）`;
      } else {
        status.textContent = '❌ 启动失败：' + (result.error || '未知错误');
        document.getElementById('serverToggle').checked = false;
      }
    } else {
      await window.api.stopServer();
      status.textContent = '🔴 服务已停止';
      setTimeout(() => { status.textContent = ''; status.classList.add('hidden'); }, 3000);
    }
  }
};

// ======== Backup / Restore ========
const backup = {
  async exportChild(childId) {
    const result = await window.api.exportChildBackup(childId);
    if (!result.ok) {
      if (result.error && result.error !== '已取消') alert(result.error);
    }
  },
  async importBackup() {
    const result = await window.api.importChildBackup();
    if (result.ok) {
      alert(`✅ 恢复成功！孩子「${result.childName}」已创建，可在下方管理孩子账号中查看。`);
      settings.renderChildren();
    } else if (result.error && result.error !== '已取消') {
      alert('❌ ' + result.error);
    }
  }
};

// ======== Child PIN Change ========
const childSettings = {
  showPinChange() {
    document.getElementById('pinChangeOld').value = '';
    document.getElementById('pinChangeNew').value = '';
    document.getElementById('pinChangeOldError').classList.add('hidden');
    document.getElementById('pinChangeModal').classList.remove('hidden');
  },

  hidePinChange() {
    document.getElementById('pinChangeModal').classList.add('hidden');
  },

  async confirmPinChange() {
    const oldPin = document.getElementById('pinChangeOld').value;
    const newPin = document.getElementById('pinChangeNew').value;
    if (!oldPin || oldPin.length !== 4) return alert('请输入旧密码');
    if (!newPin || newPin.length !== 4) return alert('请输入4位数字的新密码');
    const ok = await window.api.verifyUserPin(state.currentUser.id, oldPin);
    if (!ok) {
      document.getElementById('pinChangeOldError').classList.remove('hidden');
      return;
    }
    await window.api.updateUserPin(state.currentUser.id, newPin);
    this.hidePinChange();
    alert('✅ 密码修改成功！');
  }
};

// ======== Bookshelf ========
const book = {
  editBookId: null,

  showCreateModal() {
    this.editBookId = null;
    document.getElementById('bookModalTitle').textContent = '📖 新建日记本';
    document.getElementById('bookNameInput').value = '';
    document.getElementById('bookPinInput').value = '';
    document.getElementById('bookLockToggle').checked = false;
    document.getElementById('bookLockInput').classList.add('hidden');
    state.selectedCharacter = 'hello-kitty';
    this.renderCharacters();
    document.getElementById('bookModal').classList.remove('hidden');
  },

  showEditModal(bookData) {
    this.editBookId = bookData.id;
    document.getElementById('bookModalTitle').textContent = '✏️ 修改日记本';
    document.getElementById('bookNameInput').value = bookData.title;
    document.getElementById('bookPinInput').value = bookData.lock_pin || '';
    document.getElementById('bookLockToggle').checked = !!bookData.lock_pin;
    document.getElementById('bookLockInput').classList.toggle('hidden', !bookData.lock_pin);
    state.selectedCharacter = bookData.character_id;
    this.renderCharacters();
    document.getElementById('bookModal').classList.remove('hidden');
  },

  hideModal() {
    document.getElementById('bookModal').classList.add('hidden');
  },

  renderCharacters() {
    const container = document.getElementById('characterSelect');
    const chars = [
      { id: 'hello-kitty', icon: '🎀', name: 'Hello Kitty' },
      { id: 'my-melody', icon: '🐰', name: 'My Melody' },
      { id: 'kuromi', icon: '💜', name: 'Kuromi' },
      { id: 'cinnamoroll', icon: '☁️', name: '大耳狗' },
      { id: 'pompompurin', icon: '🍮', name: '布丁狗' },
      { id: 'twin-stars', icon: '⭐', name: '双子星' },
      { id: 'gudetama', icon: '🥚', name: '蛋黄哥' }
    ];
    container.innerHTML = chars.map(c => `
      <div class="char-option ${state.selectedCharacter === c.id ? 'selected' : ''}" data-char="${c.id}">
        <span class="char-icon">${c.icon}</span>
        <span class="char-name">${c.name}</span>
      </div>
    `).join('');
  },

  onCharacterClick(event) {
    const el = event.target.closest('.char-option');
    if (!el) return;
    state.selectedCharacter = el.dataset.char;
    document.querySelectorAll('#characterSelect .char-option').forEach(e => e.classList.remove('selected'));
    el.classList.add('selected');
  },

  toggleLock() {
    const checked = document.getElementById('bookLockToggle').checked;
    document.getElementById('bookLockInput').classList.toggle('hidden', !checked);
  },

  async save() {
    const title = document.getElementById('bookNameInput').value.trim();
    if (!title) return alert('请输入日记本名称～');
    const lockPin = document.getElementById('bookLockToggle').checked
      ? document.getElementById('bookPinInput').value
      : '';
    if (document.getElementById('bookLockToggle').checked && (!lockPin || lockPin.length !== 4)) {
      return alert('请输入4位数字密码');
    }
    if (this.editBookId) {
      await window.api.updateBook(this.editBookId, {
        title,
        character_id: state.selectedCharacter,
        lock_pin: lockPin,
        theme_color: getThemeColor(state.selectedCharacter)
      });
    } else {
      await window.api.createBook({
        user_id: state.currentUser.id,
        title,
        character_id: state.selectedCharacter,
        theme_color: getThemeColor(state.selectedCharacter),
        lock_pin: lockPin
      });
    }
    this.hideModal();
    renderBookshelf();
  },

  async delete(bookId) {
    dialog.show('删除日记本', '日记本里的日记也会一起消失哦，确定吗？', async () => {
      await window.api.deleteBook(bookId);
      renderBookshelf();
    });
  }
};

// ======== Entries ========
async function renderEntries(bookId) {
  const list = document.getElementById('entriesList');
  const entries = await window.api.getEntries(bookId);
  const bookData = await getBookData(bookId);
  document.getElementById('entriesTitle').textContent = `📝 ${bookData ? bookData.title : '日记'}`;

  if (entries.length === 0) {
    list.innerHTML = `
      <div class="empty-state">
        <span class="empty-icon">📖</span>
        <p>还没有日记哦，点击上方按钮写第一篇吧！</p>
      </div>
    `;
    return;
  }

  list.innerHTML = entries.map(e => `
    <div class="entry-card bounce-in" data-entry-id="${e.id}">
      <div class="entry-meta">
        <span class="mood-emoji">${getMoodEmoji(e.mood)}</span>
        <span>${e.entry_date}</span>
        ${e.weather ? `<span>${getWeatherIcon(e.weather)}</span>` : ''}
        ${e.location ? `<span>📍 ${escapeHtml(e.location)}</span>` : ''}
      </div>
      <div class="entry-content">${escapeHtml(e.content || '（没有写内容哦～）')}</div>
      <div class="entry-footer">
        <div class="entry-tags">
          ${e.people ? e.people.split(/[,，、]/).filter(Boolean).map(p => `<span class="entry-tag">${escapeHtml(p.trim())}</span>`).join('') : ''}
          ${e.audio_path ? '<span class="has-audio">🎤 有录音</span>' : ''}
          ${e.sticker ? `<span>${getStickerIcon(e.sticker)}</span>` : ''}
        </div>
        <div class="entry-actions">
          <button class="btn-del-entry" title="删除">🗑️</button>
        </div>
      </div>
    </div>
  `).join('');
}

async function getBookData(bookId) {
  const books = await window.api.getBooks(state.currentUser.id);
  return books.find(b => b.id === bookId);
}

// ======== Editor ========
const editor = {
  async save() {
    const data = {
      book_id: state.currentBook,
      entry_date: document.getElementById('entryDate').value,
      weather: state.selectedWeather,
      mood: state.selectedMood,
      location: document.getElementById('entryLocation').value.trim(),
      people: document.getElementById('entryPeople').value.trim(),
      content: document.getElementById('entryContent').value.trim(),
      sticker: state.selectedSticker,
      audio_path: ''
    };
    if (!data.entry_date) return alert('请选择日期～');
    if (!data.content) return alert('写点内容吧～');

    if (state.editingEntryId) {
      await window.api.updateEntry(state.editingEntryId, data);
    } else {
      await window.api.createEntry(data);
    }

    // Check achievements after saving
    if (state.currentUser && state.currentUser.role === 'child') {
      checkAchievements(state.currentUser.id);
    }

    router.go('entries', state.currentBook);
  },

  cancel() {
    if (state.editingEntryId) {
      router.go('entries', state.currentBook);
    } else {
      router.go('entries', state.currentBook);
    }
  },

  selectWeather(el, value) {
    state.selectedWeather = value;
    document.querySelectorAll('#weatherSelect .icon-option').forEach(e => e.classList.remove('selected'));
    el.classList.add('selected');
  },

  selectMood(el, value) {
    state.selectedMood = value;
    document.querySelectorAll('#moodSelect .icon-option').forEach(e => e.classList.remove('selected'));
    el.classList.add('selected');
  },

  selectSticker(el, value) {
    state.selectedSticker = value;
    document.querySelectorAll('#stickerSelect .icon-option').forEach(e => e.classList.remove('selected'));
    el.classList.add('selected');
  }
};

function resetEditorForm() {
  document.getElementById('editorTitle').textContent = '✏️ 写日记';
  const today = new Date().toISOString().split('T')[0];
  document.getElementById('entryDate').value = today;
  state.selectedWeather = '';
  state.selectedMood = '';
  state.selectedSticker = '';
  document.getElementById('entryLocation').value = '';
  document.getElementById('entryPeople').value = '';
  document.getElementById('entryContent').value = '';
  document.getElementById('charCount').textContent = '0';
  document.querySelectorAll('.icon-option').forEach(el => el.classList.remove('selected'));
  document.getElementById('voiceBtn').textContent = '🎤 开始录音';
  document.getElementById('voiceStatus').textContent = '';
  document.getElementById('voiceTimer').classList.add('hidden');
  document.getElementById('voiceHistory').innerHTML = '';
  voiceRecorder.voiceHistory = [];
}

async function loadEntryForEdit(id) {
  const entry = await window.api.getEntry(id);
  if (!entry) return router.go('entries', state.currentBook);
  document.getElementById('editorTitle').textContent = '✏️ 修改日记';
  document.getElementById('entryDate').value = entry.entry_date;
  document.getElementById('entryLocation').value = entry.location || '';
  document.getElementById('entryPeople').value = entry.people || '';
  document.getElementById('entryContent').value = entry.content || '';
  document.getElementById('charCount').textContent = entry.content ? entry.content.length : 0;
  state.selectedWeather = entry.weather || '';
  state.selectedMood = entry.mood || '';
  state.selectedSticker = entry.sticker || '';
  if (entry.weather) {
    document.querySelectorAll('#weatherSelect .icon-option').forEach(el => {
      if (el.dataset.value === entry.weather) el.classList.add('selected');
    });
  }
  if (entry.mood) {
    document.querySelectorAll('#moodSelect .icon-option').forEach(el => {
      if (el.dataset.value === entry.mood) el.classList.add('selected');
    });
  }
  if (entry.sticker) {
    document.querySelectorAll('#stickerSelect .icon-option').forEach(el => {
      if (el.dataset.value === entry.sticker) el.classList.add('selected');
    });
  }
}

// Content char count
document.addEventListener('input', function(e) {
  if (e.target.id === 'entryContent') {
    document.getElementById('charCount').textContent = e.target.value.length;
  }
});

// ======== Voice Recorder (iFlytek) ========
const voiceRecorder = {
  voiceHistory: [],
  audioContext: null,
  mediaStream: null,
  pcmData: [],

  async toggle() {
    if (state.isRecording) {
      this.stopRecording();
    } else {
      await this.startRecording();
    }
  },

  async startRecording() {
    const s = await window.api.getSettings();
    if (!s.xf_appid || !s.xf_apikey || !s.xf_apisecret) {
      alert('请先在家长设置中配置讯飞语音识别（APPID、API Key、API Secret）');
      return;
    }
    state.isRecording = true;
    state.voiceTranscript = '';
    state.voiceRemaining = state.voiceDuration || 30;
    document.getElementById('voiceBtn').textContent = '⏹ 停止录音';
    document.getElementById('voiceTimer').textContent = this.formatTime(state.voiceRemaining);
    document.getElementById('voiceTimer').classList.remove('hidden');
    document.getElementById('voiceStatus').textContent = '🎤 录音中...';

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.mediaStream = stream;
      this.audioContext = new AudioContext({ sampleRate: 16000 });
      const source = this.audioContext.createMediaStreamSource(stream);
      const processor = this.audioContext.createScriptProcessor(4096, 1, 1);
      this.pcmData = [];
      processor.onaudioprocess = (e) => {
        if (!state.isRecording) return;
        const input = e.inputBuffer.getChannelData(0);
        const pcm = new Int16Array(input.length);
        for (let i = 0; i < input.length; i++) {
          pcm[i] = Math.max(-32768, Math.min(32767, Math.round(input[i] * 32768)));
        }
        this.pcmData.push(pcm);
      };
      source.connect(processor);
      processor.connect(this.audioContext.destination);
    } catch (err) {
      document.getElementById('voiceStatus').textContent = '❌ 麦克风权限被拒绝';
      state.isRecording = false;
      return;
    }

    state.voiceTimerInterval = setInterval(() => {
      state.voiceRemaining--;
      document.getElementById('voiceTimer').textContent = this.formatTime(state.voiceRemaining);
      if (state.voiceRemaining <= 0) {
        this.stopRecording();
      }
    }, 1000);
  },

  async stopRecording() {
    state.isRecording = false;
    clearInterval(state.voiceTimerInterval);

    if (this.audioContext) {
      try { this.audioContext.close(); } catch(e) {}
      this.audioContext = null;
    }
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(t => t.stop());
      this.mediaStream = null;
    }

    document.getElementById('voiceTimer').classList.add('hidden');
    document.getElementById('voiceBtn').textContent = '🎤 开始录音';

    if (this.pcmData.length === 0) {
      document.getElementById('voiceStatus').textContent = '未录制到音频';
      setTimeout(() => { document.getElementById('voiceStatus').textContent = ''; }, 2000);
      return;
    }

    document.getElementById('voiceStatus').textContent = '⏳ 正在识别...';

    const totalLen = this.pcmData.reduce((sum, arr) => sum + arr.length, 0);
    const combined = new Int16Array(totalLen);
    let offset = 0;
    for (const arr of this.pcmData) {
      combined.set(arr, offset);
      offset += arr.length;
    }
    this.pcmData = [];
    const base64 = this._int16ToBase64(combined);

    try {
      const result = await window.api.recognizeSpeech(base64);
      if (result.error) {
        document.getElementById('voiceStatus').textContent = '❌ ' + result.error;
        setTimeout(() => { document.getElementById('voiceStatus').textContent = ''; }, 5000);
        return;
      }
      state.voiceTranscript = result.text || '';
      if (state.voiceTranscript) {
        const ta = document.getElementById('entryContent');
        ta.value += (ta.value ? ' ' : '') + state.voiceTranscript;
        document.getElementById('charCount').textContent = ta.value.length;
        this.saveToHistory(state.voiceTranscript);
        document.getElementById('voiceStatus').textContent = '';
      } else {
        document.getElementById('voiceStatus').textContent = '未识别到语音';
        setTimeout(() => { document.getElementById('voiceStatus').textContent = ''; }, 2000);
      }
    } catch (err) {
      document.getElementById('voiceStatus').textContent = '❌ 识别请求失败';
      setTimeout(() => { document.getElementById('voiceStatus').textContent = ''; }, 3000);
    }
  },

  _int16ToBase64(arr) {
    const bytes = new Uint8Array(arr.buffer);
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  },

  saveToHistory(text) {
    this.voiceHistory.unshift({ text, blob: null, time: Date.now() });
    if (this.voiceHistory.length > 10) this.voiceHistory.pop();
    this.renderHistory();
  },

  renderHistory() {
    const container = document.getElementById('voiceHistory');
    if (this.voiceHistory.length === 0) {
      container.innerHTML = '';
      return;
    }
    container.innerHTML = this.voiceHistory.map((item, idx) => `
      <div class="voice-history-item">
        <span class="vh-text" title="${this.escHtml(item.text)}">${this.escHtml(item.text)}</span>
        <span class="vh-actions">
          <button class="vh-btn" onclick="voiceRecorder.reRecord(${idx})" title="重新录音">🔄</button>
          <button class="vh-btn" onclick="voiceRecorder.deleteHistory(${idx})" title="删除">❌</button>
        </span>
      </div>
    `).join('');
  },

  async reRecord(idx) {
    if (state.isRecording) return alert('正在录音中，请先停止');
    document.getElementById('voiceStatus').textContent = '🔄 重新录音...';
    await this.startRecording();
    const checkDone = setInterval(() => {
      if (!state.isRecording) {
        clearInterval(checkDone);
        if (state.voiceTranscript) {
          const ta = document.getElementById('entryContent');
          ta.value += (ta.value ? ' ' : '') + state.voiceTranscript;
          document.getElementById('charCount').textContent = ta.value.length;
        }
      }
    }, 200);
  },

  deleteHistory(idx) {
    this.voiceHistory.splice(idx, 1);
    this.renderHistory();
  },

  formatTime(sec) {
    return `${Math.floor(sec / 60)}:${(sec % 60).toString().padStart(2, '0')}`;
  },

  escHtml(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }
};

async function checkVoiceEnabled() {
  const row = document.getElementById('voiceRow');
  const s = await window.api.getSettings();
  if (s.voice_input_enabled) {
    row.classList.remove('hidden');
    state.voiceDuration = s.voice_duration || 30;
  } else {
    row.classList.add('hidden');
  }
}

// ======== Dialog ========
const dialog = {
  show(title, msg, callback) {
    document.getElementById('confirmTitle').textContent = title;
    document.getElementById('confirmMsg').textContent = msg;
    document.getElementById('confirmBtn').textContent = '确定';
    document.getElementById('confirmBtn').className = 'btn btn-danger';
    state.confirmCallback = callback;
    document.getElementById('confirmModal').classList.remove('hidden');
  },

  showPin(title, msg, callback) {
    const modal = document.getElementById('confirmModal');
    modal.querySelector('.modal-content').innerHTML = `
      <h3>${title}</h3>
      <p>${msg}</p>
      <div class="pin-input-group">
        <input type="password" id="dialogPinInput" class="pin-input" maxlength="4" inputmode="numeric" placeholder="4位数字密码">
      </div>
      <p id="dialogPinError" class="error-msg hidden">密码错误～</p>
      <div class="btn-row">
        <button class="btn btn-gray" onclick="dialog.cancel()">取消</button>
        <button class="btn btn-pink" id="confirmBtn" onclick="dialog.confirmPin()">确认</button>
      </div>
    `;
    state.confirmCallback = callback;
    modal.classList.remove('hidden');
  },

  confirmPin() {
    const pin = document.getElementById('dialogPinInput').value;
    if (!pin || pin.length !== 4) return;
    const callback = state.confirmCallback;
    if (callback) {
      const result = callback(pin);
      if (result && result.then) {
        result.then(ok => {
          if (ok) {
            this.cancel();
          } else {
            document.getElementById('dialogPinError').classList.remove('hidden');
          }
        });
      } else if (result) {
        this.cancel();
      }
    }
  },

  confirm() {
    const callback = state.confirmCallback;
    state.confirmCallback = null;
    this.cancel();
    if (callback) callback();
  },

  cancel() {
    state.confirmCallback = null;
    document.getElementById('confirmModal').classList.add('hidden');
  }
};

// ======== Render Helpers ========
async function renderUserCards() {
  const container = document.getElementById('userCards');
  const users = await window.api.getUsers();
  if (users.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <p>还没有家庭成员，请家长先去设置中添加～</p>
      </div>
    `;
    return;
  }
  container.innerHTML = users.map(u => `
    <div class="user-card" onclick="auth.selectUser({ id: ${u.id}, name: '${u.name}', avatar: '${u.avatar}', role: '${u.role}' })">
      <span class="avatar">${u.avatar}</span>
      <span class="name">${u.name}</span>
    </div>
  `).join('');
}

async function renderBookshelf() {
  const grid = document.getElementById('bookshelfGrid');
  const books = await window.api.getBooks(state.currentUser.id);
  const user = state.currentUser;
  document.getElementById('bookshelfTitle').textContent = `📚 ${user.name}的日记本`;

  // Show streak
  try {
    const stats = await window.api.getUserStats(state.currentUser.id);
    const streak = calcStreak(stats.dates);
    const streakEl = document.getElementById('streakBadge');
    if (streak > 0) {
      streakEl.innerHTML = `🔥 连续写 <strong>${streak}</strong> 天`;
      streakEl.classList.remove('hidden');
    } else {
      streakEl.classList.add('hidden');
    }
  } catch (e) {
    console.log('streak update error', e);
  }

  let html = books.map(b => `
    <div class="book-card" data-book-id="${b.id}" data-book-title="${escapeHtml(b.title)}" data-book-character="${b.character_id}" data-book-lock="${b.lock_pin || ''}">
      ${b.lock_pin ? '<span class="lock-badge">🔒</span>' : ''}
      <div class="book-actions">
        <button class="btn-edit-book" title="修改">✏️</button>
        <button class="btn-delete-book" title="删除">🗑️</button>
      </div>
      <span class="cover">${getCharacterIcon(b.character_id)}</span>
      <div class="book-title">${escapeHtml(b.title)}</div>
    </div>
  `).join('');

  html += `
    <div class="book-card add-book-card" id="btnNewBook">
      <span class="plus">+</span>
      <div>新建日记本</div>
    </div>
  `;

  grid.innerHTML = html;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ======== Helper Functions ========
function getCharacterIcon(id) {
  const map = {
    'hello-kitty': '🎀',
    'my-melody': '🐰',
    'kuromi': '💜',
    'cinnamoroll': '☁️',
    'pompompurin': '🍮',
    'twin-stars': '⭐',
    'gudetama': '🥚'
  };
  return map[id] || '📔';
}

function getThemeColor(id) {
  const map = {
    'hello-kitty': '#FFB7C5',
    'my-melody': '#FFD1DC',
    'kuromi': '#9B59B6',
    'cinnamoroll': '#87CEEB',
    'pompompurin': '#FFF4B0',
    'twin-stars': '#E6E6FA',
    'gudetama': '#FFFACD'
  };
  return map[id] || '#FFB7C5';
}

function getMoodEmoji(mood) {
  const map = {
    'happy': '😊',
    'sad': '😢',
    'angry': '😡',
    'calm': '😌',
    'love': '🥰',
    'surprise': '😱'
  };
  return map[mood] || '';
}

function getWeatherIcon(weather) {
  const map = {
    'sunny': '☀️',
    'cloudy': '⛅',
    'overcast': '☁️',
    'rainy': '🌧',
    'snowy': '❄️'
  };
  return map[weather] || '';
}

function getStickerIcon(sticker) {
  const map = {
    'star': '⭐',
    'heart': '❤️',
    'flower': '🌸',
    'rainbow': '🌈',
    'cake': '🎂',
    'butterfly': '🦋'
  };
  return map[sticker] || '';
}

// ======== Event Delegation ========
document.addEventListener('click', async (e) => {
  // Bookshelf: open book
  const bookCard = e.target.closest('.book-card:not(.add-book-card)');
  if (bookCard && document.getElementById('page-bookshelf').classList.contains('active')) {
    const id = parseInt(bookCard.dataset.bookId);
    const lock = bookCard.dataset.bookLock;
    if (lock) {
      dialog.showPin('🔒 日记本已加密', '请输入密码', async (pin) => {
        const ok = await window.api.verifyBookLock(id, pin);
        if (ok) {
          router.go('entries', id);
          return true;
        }
        document.getElementById('dialogPinError').classList.remove('hidden');
        return false;
      });
    } else {
      router.go('entries', id);
    }
    return;
  }

  // Bookshelf: new book
  if (e.target.closest('#btnNewBook')) {
    book.showCreateModal();
    return;
  }

  // Bookshelf: edit book
  if (e.target.closest('.btn-edit-book')) {
    e.stopPropagation();
    const card = e.target.closest('.book-card');
    book.showEditModal({
      id: parseInt(card.dataset.bookId),
      title: card.dataset.bookTitle,
      character_id: card.dataset.bookCharacter,
      lock_pin: card.dataset.bookLock
    });
    return;
  }

  // Bookshelf: delete book
  if (e.target.closest('.btn-delete-book')) {
    e.stopPropagation();
    const card = e.target.closest('.book-card');
    const id = parseInt(card.dataset.bookId);
    dialog.show('删除日记本', '日记本里的日记也会一起消失哦，确定吗？', async () => {
      await window.api.deleteBook(id);
      renderBookshelf();
    });
    return;
  }

  // Entries: open entry
  const entryCard = e.target.closest('.entry-card');
  if (entryCard && !e.target.closest('.btn-del-entry') && document.getElementById('page-entries').classList.contains('active')) {
    const id = parseInt(entryCard.dataset.entryId);
    router.go('editor', { id });
    return;
  }

  // Entries: delete entry
  if (e.target.closest('.btn-del-entry')) {
    const card = e.target.closest('.entry-card');
    const id = parseInt(card.dataset.entryId);
    dialog.show('删除日记', '确定要删除这篇日记吗？', async () => {
      await window.api.deleteEntry(id);
      renderEntries(state.currentBook);
    });
    return;
  }
});

// ======== Achievement Definitions ========
const ACHIEVEMENTS = [
  { id: 'first_entry', name: '初次写日记', icon: '🎖', desc: '写下第一篇日记', check: stats => stats.total >= 1 },
  { id: 'three_days', name: '坚持三天', icon: '🌟', desc: '连续写3天日记', check: stats => calcStreak(stats.dates) >= 3 },
  { id: 'seven_days', name: '日记小达人', icon: '📖', desc: '连续写7天日记', check: stats => calcStreak(stats.dates) >= 7 },
  { id: 'fifteen_days', name: '日记之星', icon: '👑', desc: '连续写15天日记', check: stats => calcStreak(stats.dates) >= 15 },
  { id: 'thirty_days', name: '坚持不懈', icon: '🏆', desc: '连续写30天日记', check: stats => calcStreak(stats.dates) >= 30 },
  { id: 'hundred_days', name: '日记大师', icon: '💎', desc: '连续写100天日记', check: stats => calcStreak(stats.dates) >= 100 },
  { id: 'ten_entries', name: '小作家', icon: '✍️', desc: '累计写了10篇日记', check: stats => stats.total >= 10 },
  { id: 'fifty_entries', name: '高产作家', icon: '📚', desc: '累计写了50篇日记', check: stats => stats.total >= 50 },
  { id: 'all_weather', name: '气象员', icon: '🌈', desc: '用过所有天气标记', check: () => false },
  { id: 'all_moods', name: '心情大师', icon: '😊', desc: '用过所有心情标记', check: () => false }
];

function calcStreak(dates) {
  if (!dates || dates.length === 0) return 0;
  const sorted = [...dates].sort().reverse();
  let streak = 1;
  const today = new Date();
  const mostRecent = new Date(sorted[0]);
  const diffDays = Math.floor((today - mostRecent) / (1000 * 60 * 60 * 24));
  if (diffDays > 1) return 0;
  for (let i = 0; i < sorted.length - 1; i++) {
    const current = new Date(sorted[i]);
    const next = new Date(sorted[i + 1]);
    const diff = Math.floor((current - next) / (1000 * 60 * 60 * 24));
    if (diff === 1) streak++;
    else break;
  }
  return streak;
}

function checkWeatherMoods(userId) {
  window.api.getEntries(state.currentBook).then(entries => {
    const weathers = new Set(entries.filter(e => e.weather).map(e => e.weather));
    const moods = new Set(entries.filter(e => e.mood).map(e => e.mood));
    if (weathers.size >= 5) {
      window.api.createAchievement({ user_id: userId, badge_id: 'all_weather', badge_name: '气象员', badge_icon: '🌈' }).catch(() => {});
    }
    if (moods.size >= 6) {
      window.api.createAchievement({ user_id: userId, badge_id: 'all_moods', badge_name: '心情大师', badge_icon: '😊' }).catch(() => {});
    }
  }).catch(() => {});
}

async function checkAchievements(userId) {
  try {
    const stats = await (window.api.getUserStats ? window.api.getUserStats(userId) : Promise.resolve({ total: 0, dates: [] }));
    const earned = await window.api.getAchievements(userId);
    const earnedIds = new Set(earned.map(a => a.badge_id));

    for (const badge of ACHIEVEMENTS) {
      if (earnedIds.has(badge.id)) continue;
      if (badge.check(stats)) {
        await window.api.createAchievement({ user_id: userId, badge_id: badge.id, badge_name: badge.name, badge_icon: badge.icon });
        showAchievementPopup(badge);
      }
    }

    checkWeatherMoods(userId);
  } catch (e) {
    console.log('Achievement check error:', e);
  }
}

function showAchievementPopup(badge) {
  const container = document.getElementById('achievement-popup');
  if (!container) return;
  const inner = container.querySelector('.achievement-inner');
  inner.innerHTML = `
    <div class="achievement-icon">${badge.icon}</div>
    <div class="achievement-text">
      <div class="achievement-title">🎉 获得成就！</div>
      <div class="achievement-name">${badge.name}</div>
      <div class="achievement-desc">${badge.desc}</div>
    </div>
  `;
  container.classList.remove('hidden');
  container.classList.add('show');
  setTimeout(() => {
    container.classList.remove('show');
    setTimeout(() => container.classList.add('hidden'), 500);
  }, 3000);
}

// ======== Init ========
document.addEventListener('DOMContentLoaded', async () => {
  await settings.init();
  await renderUserCards();

  // Add achievement popup element
  const popup = document.createElement('div');
  popup.id = 'achievement-popup';
  popup.className = 'achievement-popup hidden';
  popup.innerHTML = '<div class="achievement-inner"></div>';
  document.body.appendChild(popup);
});
