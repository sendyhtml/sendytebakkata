// js/app.js — Main App Controller (FIXED)

import { ensureAuth, getCurrentUID } from './firebase-config.js';
import {
  createRoom, joinRoom, startGame, setWord, sendGuess,
  answerGuess, endRound, resetGame, leaveRoom,
  listenRoom, listenChat, loadSettings
} from './game.js';
import { loadCategories } from './categories.js';
import { initSounds, playSound, setVolume } from './sounds.js';
import { initVoice, startMic, stopMic, toggleMute, getMicState } from './voice.js';

// ===================== APP STATE =====================
const State = {
  myUID: null,
  myName: '',
  roomCode: '',
  roomData: null,
  isHost: false,
  isSpectator: false,
  isWordGiver: false,
  unsubRoom: null,
  unsubChat: null,
  chatMsgs: [],
  settings: {},
  categories: {},
  gameButtonsBound: false,
  micBound: false
};

// ===================== BOOT =====================
async function boot() {
  initSounds();

  // Load volume from storage
  const vol = parseFloat(localStorage.getItem('tk_volume') || '0.8');
  setVolume(vol);

  State.myUID = await ensureAuth();
  State.settings = await loadSettings();
  State.categories = await loadCategories();

  bindLobbyEvents();
  showScreen('lobby');
}

// ===================== SCREEN =====================
function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const el = document.getElementById(`screen-${name}`);
  if (el) el.classList.add('active');
  else console.error(`Screen not found: screen-${name}`);
}

// ===================== TOAST =====================
let toastTimer = null;
function toast(msg, duration = 2800) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), duration);
}

// ===================== LOBBY =====================
function bindLobbyEvents() {
  // Tab switching
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const which = tab.dataset.tab;
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(tc => tc.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById(`tab-${which}`)?.classList.add('active');
    });
  });

  // Create room
  document.getElementById('btn-create-room').addEventListener('click', handleCreateRoom);
  document.getElementById('create-name').addEventListener('keydown', e => { if (e.key === 'Enter') handleCreateRoom(); });
  document.getElementById('create-room-name').addEventListener('keydown', e => { if (e.key === 'Enter') handleCreateRoom(); });

  // Join room
  document.getElementById('btn-join-room').addEventListener('click', handleJoinRoom);
  document.getElementById('join-code').addEventListener('keydown', e => { if (e.key === 'Enter') handleJoinRoom(); });
  document.getElementById('join-name').addEventListener('keydown', e => { if (e.key === 'Enter') handleJoinRoom(); });

  // Auto-uppercase room code input
  document.getElementById('join-code').addEventListener('input', e => {
    e.target.value = e.target.value.toUpperCase();
  });
}

async function handleCreateRoom() {
  const name = document.getElementById('create-name').value.trim();
  const roomName = document.getElementById('create-room-name').value.trim();
  if (!name) return setStatus('Masukkan nama kamu terlebih dahulu', 'error');

  setStatus('Membuat room...');
  setBtnLoading('btn-create-room', true);

  try {
    const res = await createRoom(name, roomName);
    State.myName = name;
    State.roomCode = res.code;
    State.myUID = res.uid;
    State.isHost = true;
    State.isSpectator = false;
    setStatus('');
    enterWaiting();
  } catch (e) {
    console.error('createRoom error:', e);
    setStatus(`Gagal: ${e.message}`, 'error');
  } finally {
    setBtnLoading('btn-create-room', false);
  }
}

async function handleJoinRoom() {
  const name = document.getElementById('join-name').value.trim();
  const code = document.getElementById('join-code').value.trim().toUpperCase();
  if (!name) return setStatus('Masukkan nama kamu', 'error');
  if (!code || code.length < 4) return setStatus('Masukkan kode room yang valid', 'error');

  setStatus('Mencari room...');
  setBtnLoading('btn-join-room', true);

  try {
    const res = await joinRoom(code, name);
    State.myName = name;
    State.roomCode = res.code;
    State.myUID = res.uid;
    State.isHost = res.isHost;
    State.isSpectator = res.isSpectator || false;
    setStatus('');
    enterWaiting();
  } catch (e) {
    console.error('joinRoom error:', e);
    setStatus(`Gagal: ${e.message}`, 'error');
  } finally {
    setBtnLoading('btn-join-room', false);
  }
}

function setStatus(msg, type = '') {
  const el = document.getElementById('lobby-status');
  if (!el) return;
  el.textContent = msg;
  el.className = `lobby-status ${type}`;
}

function setBtnLoading(id, loading) {
  const btn = document.getElementById(id);
  if (!btn) return;
  btn.disabled = loading;
  btn.style.opacity = loading ? '0.6' : '1';
}

// ===================== WAITING ROOM =====================
function enterWaiting() {
  document.getElementById('display-room-code').textContent = State.roomCode;
  showScreen('waiting');
  startRoomListeners();
  setupVoice();

  // Bind waiting-room buttons (only once is fine since screen persists)
  document.getElementById('btn-copy-code').onclick = () => {
    navigator.clipboard.writeText(State.roomCode)
      .then(() => toast('Kode room disalin!'))
      .catch(() => {
        // Fallback for non-HTTPS
        const ta = document.createElement('textarea');
        ta.value = State.roomCode;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
        toast('Kode room disalin!');
      });
  };

  document.getElementById('btn-start-game').onclick = async () => {
    try {
      State.settings = await loadSettings();
      await startGame(State.roomCode);
    } catch (e) { toast(e.message); }
  };

  document.getElementById('btn-leave-room').onclick = () => goLobby();

  if (!State.micBound) {
    document.getElementById('btn-mic-toggle').addEventListener('click', handleMicClick);
    State.micBound = true;
  }
}

function setupVoice() {
  initVoice(State.roomCode, {
    onSpeakingChange: (uid, speaking) => {
      if (!State.roomData) return;
      const players = State.roomData.players || {};
      const p = players[uid];
      if (p) updateVoiceChip(uid, p.name, speaking);
    },
    onPeersChange: (peers) => {
      renderVoiceUsers();
    },
    onStateChange: (micState) => {
      updateMicUI(micState.isMicOn, micState.isMuted);
    }
  });
}

// ===================== ROOM LISTENERS =====================
function startRoomListeners() {
  stopRoomListeners();

  State.chatMsgs = [];

  State.unsubRoom = listenRoom(State.roomCode, (data) => {
    if (!data) { toast('Room tidak ditemukan atau sudah dihapus.'); goLobby(); return; }
    State.roomData = data;
    onRoomUpdate(data);
  });

  State.unsubChat = listenChat(State.roomCode, (msgs) => {
    State.chatMsgs = msgs;
    renderChat(msgs);
  });
}

function stopRoomListeners() {
  if (State.unsubRoom) { State.unsubRoom(); State.unsubRoom = null; }
  if (State.unsubChat) { State.unsubChat(); State.unsubChat = null; }
}

// ===================== ROOM UPDATE HANDLER =====================
function onRoomUpdate(data) {
  const myPlayer = (data.players || {})[State.myUID];
  if (myPlayer) {
    State.isHost = myPlayer.isHost || false;
    State.isSpectator = myPlayer.isSpectator || false;
  }

  const curScreen = document.querySelector('.screen.active')?.id;

  if (curScreen === 'screen-waiting') {
    renderWaitingPlayers(data.players || {});
    const startBtn = document.getElementById('btn-start-game');
    if (startBtn) startBtn.style.display = State.isHost ? 'inline-flex' : 'none';
    if (data.status === 'playing') { enterGame(data); return; }
    if (data.status === 'ended') { enterFinal(data); return; }
  }

  if (curScreen === 'screen-game') {
    if (data.status === 'ended') { enterFinal(data); return; }
    updateGameScreen(data);
  }
}

function renderWaitingPlayers(players) {
  const list = document.getElementById('players-list');
  if (!list) return;
  list.innerHTML = '';
  const sorted = Object.values(players)
    .filter(p => p.online !== false)
    .sort((a, b) => (b.isHost ? 1 : 0) - (a.isHost ? 1 : 0));

  sorted.forEach(p => {
    const div = document.createElement('div');
    div.className = `player-item ${p.isHost ? 'is-host' : ''} ${p.uid === State.myUID ? 'is-me' : ''}`;
    div.innerHTML = `
      <div class="player-avatar">${p.name.charAt(0).toUpperCase()}</div>
      <span class="player-name">${p.name}${p.uid === State.myUID ? ' <span class="you-tag">(Kamu)</span>' : ''}</span>
      ${p.isHost ? '<span class="badge host-badge">Host</span>' : ''}
      ${p.isSpectator ? '<span class="badge spec-badge">Penonton</span>' : ''}
    `;
    list.appendChild(div);
  });
}

// ===================== GAME SCREEN =====================
function enterGame(data) {
  showScreen('game');
  State.gameButtonsBound = false; // reset so we rebind
  bindGameButtons();
  renderTemplates();
  updateGameScreen(data);
}

function bindGameButtons() {
  if (State.gameButtonsBound) return;
  State.gameButtonsBound = true;

  document.getElementById('btn-leave-game').onclick = () => goLobby();

  // Set word
  document.getElementById('btn-set-custom-word').onclick = handleSetWord;
  document.getElementById('custom-word-input').onkeydown = e => { if (e.key === 'Enter') handleSetWord(); };

  // Set clue
  document.getElementById('btn-set-clue').onclick = handleSetClue;

  // Guess
  document.getElementById('btn-send-guess').onclick = handleSendGuess;
  document.getElementById('guess-input').onkeydown = e => { if (e.key === 'Enter') handleSendGuess(); };

  // Answer buttons
  document.getElementById('btn-yes').onclick = () => handleAnswer('yes');
  document.getElementById('btn-maybe').onclick = () => handleAnswer('maybe');
  document.getElementById('btn-no').onclick = () => handleAnswer('no');

  // Next round overlay button
  document.getElementById('btn-next-round').onclick = () => {
    document.getElementById('round-result-overlay').style.display = 'none';
  };

  // Mic in game
  document.getElementById('btn-mic-game').onclick = handleMicClick;

  // Final screen buttons
  document.getElementById('btn-play-again').onclick = async () => {
    if (State.isHost) {
      try { await resetGame(State.roomCode); } catch (e) { toast(e.message); }
    } else {
      toast('Hanya host yang bisa memulai ulang');
    }
  };
  document.getElementById('btn-back-lobby').onclick = () => goLobby();
}

async function handleSetWord() {
  const word = document.getElementById('custom-word-input').value.trim();
  if (!word) { toast('Masukkan kata dulu'); return; }
  const clue = document.getElementById('clue-input').value.trim();
  try {
    await setWord(State.roomCode, word, clue);
    document.getElementById('custom-word-input').value = '';
  } catch (e) { toast(e.message); }
}

async function handleSetClue() {
  const clue = document.getElementById('clue-input').value.trim();
  const word = State.roomData?.game?.currentWord;
  if (!word) { toast('Set kata dulu sebelum menambah petunjuk'); return; }
  try {
    await setWord(State.roomCode, word, clue || null);
    toast('Petunjuk diperbarui');
  } catch (e) { toast(e.message); }
}

async function handleSendGuess() {
  const input = document.getElementById('guess-input');
  const guess = input.value.trim();
  if (!guess) return;
  input.value = '';
  input.focus();
  try {
    await sendGuess(State.roomCode, State.myUID, State.myName, guess);
  } catch (e) { toast(e.message); }
}

async function handleAnswer(type) {
  const game = State.roomData?.game || {};
  playSound(type);
  try {
    await answerGuess(State.roomCode, State.myUID, State.myName, type);
    if (type === 'yes' && game.lastGuesserUID) {
      const result = await endRound(State.roomCode, game.lastGuesserUID, game.lastGuesserName, game.currentWord);
      if (result === 'ended') enterFinal(State.roomData);
    }
  } catch (e) { toast(e.message); }
}

function renderTemplates() {
  const grid = document.getElementById('template-grid');
  if (!grid) return;
  grid.innerHTML = '';
  const cats = State.categories;

  Object.entries(cats).forEach(([catName, catData]) => {
    const words = catData.words || catData;

    const header = document.createElement('div');
    header.className = 'tmpl-cat-header';
    header.innerHTML = `
      <span class="tmpl-cat-name">${catName}</span>
      <span class="tmpl-cat-count">${words.length} kata</span>
    `;
    grid.appendChild(header);

    const row = document.createElement('div');
    row.className = 'tmpl-row';
    words.forEach(w => {
      const tag = document.createElement('button');
      tag.className = 'tmpl-tag';
      tag.textContent = w;
      tag.title = `Pilih: ${w}`;
      tag.onclick = () => {
        document.getElementById('custom-word-input').value = w;
        tag.classList.add('selected');
        setTimeout(() => tag.classList.remove('selected'), 600);
      };
      row.appendChild(tag);
    });
    grid.appendChild(row);
  });
}

// ===================== GAME UI UPDATE =====================
function updateGameScreen(data) {
  if (!data) return;
  const game = data.game || {};
  const players = data.players || {};
  const myPlayer = players[State.myUID];

  const amIWordGiver = game.currentHostUID === State.myUID;
  const amISpectator = myPlayer?.isSpectator || false;
  State.isWordGiver = amIWordGiver;

  // Header info
  const giverPlayer = game.currentHostUID ? players[game.currentHostUID] : null;
  document.getElementById('game-room-label').textContent = `#${State.roomCode}`;
  document.getElementById('game-round-label').textContent =
    `Ronde ${game.round || 1} / ${game.totalRounds || 5}`;
  document.getElementById('game-giver-label').textContent =
    giverPlayer ? `Pemberi kata: ${giverPlayer.name}` : '';

  // Scoreboard
  const scoresEl = document.getElementById('game-scores');
  scoresEl.innerHTML = '';
  Object.values(players)
    .filter(p => p.online !== false && !p.isSpectator)
    .sort((a, b) => (b.score || 0) - (a.score || 0))
    .slice(0, 6)
    .forEach(p => {
      const chip = document.createElement('div');
      chip.className = `score-chip ${p.uid === State.myUID ? 'is-me' : ''}`;
      chip.innerHTML = `
        <div class="score-avatar">${p.name.charAt(0).toUpperCase()}</div>
        <div class="score-info">
          <span class="score-name">${p.name}</span>
          <span class="score-value">${p.score || 0}</span>
        </div>
      `;
      scoresEl.appendChild(chip);
    });

  // Panel visibility
  const hostView = document.getElementById('host-view');
  const guesserView = document.getElementById('guesser-view');
  const spectatorView = document.getElementById('spectator-view');
  const answerBtns = document.getElementById('host-answer-btns');
  const clueCard = document.getElementById('host-clue-card');

  [hostView, guesserView, spectatorView].forEach(el => el && (el.style.display = 'none'));
  answerBtns.style.display = 'none';

  if (amISpectator) {
    spectatorView.style.display = 'block';
    document.getElementById('spectator-giver-name').textContent =
      giverPlayer ? `${giverPlayer.name} sedang memberi kata` : 'Menunggu...';
  } else if (amIWordGiver) {
    hostView.style.display = 'block';

    const wordEl = document.getElementById('host-word-display');
    wordEl.textContent = game.currentWord || '---';
    document.getElementById('host-hint-text').textContent =
      game.currentClue ? `Petunjuk: ${game.currentClue}` : '';
    clueCard.style.display = game.status === 'playing' ? 'block' : 'none';

    if (game.status === 'choosing') {
      document.getElementById('host-choosing-label').style.display = 'block';
      document.getElementById('host-playing-label').style.display = 'none';
    } else {
      document.getElementById('host-choosing-label').style.display = 'none';
      document.getElementById('host-playing-label').style.display = 'block';
    }

    // Show answer buttons when there's a pending guess
    if (game.status === 'playing' && game.lastGuess) {
      answerBtns.style.display = 'grid';
      document.getElementById('last-guess-preview').textContent =
        `"${game.lastGuess}" — ${game.lastGuesserName || ''}`;
    }
  } else {
    guesserView.style.display = 'block';
    const wordEl = document.getElementById('guesser-word-display');

    if (game.status === 'choosing') {
      wordEl.textContent = '...';
      wordEl.className = 'word-display masked';
      document.getElementById('guesser-hint-text').textContent = `${giverPlayer?.name || 'Host'} sedang memilih kata...`;
    } else if (game.currentWord) {
      const masked = buildMasked(game.currentWord);
      wordEl.innerHTML = masked;
      wordEl.className = 'word-display masked';
      document.getElementById('guesser-hint-text').textContent =
        game.currentClue ? `Petunjuk: ${game.currentClue}` : 'Belum ada petunjuk';
    }

    const guessCard = document.getElementById('guesser-guess-card');
    guessCard.style.display = game.status === 'playing' ? 'block' : 'none';
  }
}

function buildMasked(word) {
  return word.split('').map(ch => {
    if (ch === ' ') return '<span class="mask-space"> </span>';
    return `<span class="mask-char">_</span>`;
  }).join('');
}

// ===================== CHAT =====================
function renderChat(msgs) {
  const box = document.getElementById('chat-box');
  if (!box) return;

  const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
  box.innerHTML = '';

  msgs.forEach((msg, i) => {
    const el = buildChatBubble(msg, i, msgs);
    box.appendChild(el);
  });

  if (atBottom) box.scrollTop = box.scrollHeight;
}

function buildChatBubble(msg, idx, allMsgs) {
  const isMe = msg.uid === State.myUID;
  const isSystem = msg.type === 'system';
  const isAnswerYes = msg.type === 'answer-yes';
  const isAnswerNo = msg.type === 'answer-no';
  const isAnswerMaybe = msg.type === 'answer-maybe';
  const isAnswer = isAnswerYes || isAnswerNo || isAnswerMaybe;

  const wrapper = document.createElement('div');
  wrapper.className = `chat-row ${isMe ? 'me' : ''} ${isSystem ? 'system' : ''} ${isAnswer ? 'answer-row' : ''}`;

  if (isSystem) {
    wrapper.innerHTML = `<div class="chat-system-msg">${escHtml(msg.text)}</div>`;
    return wrapper;
  }

  if (isAnswer) {
    const typeClass = isAnswerYes ? 'yes' : isAnswerNo ? 'no' : 'maybe';
    const icon = isAnswerYes
      ? `<svg viewBox="0 0 20 20" fill="none"><path d="M4 10l4 4 8-8" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`
      : isAnswerNo
      ? `<svg viewBox="0 0 20 20" fill="none"><path d="M6 6l8 8M14 6l-8 8" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>`
      : `<svg viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="7" stroke="currentColor" stroke-width="2"/><path d="M10 6v4l2 2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`;
    wrapper.innerHTML = `
      <div class="chat-answer-bubble ${typeClass}">
        <span class="answer-icon">${icon}</span>
        <span class="answer-text">${escHtml(msg.text)}</span>
        <span class="answer-by">${escHtml(msg.senderName || '')}</span>
      </div>`;
    return wrapper;
  }

  // Show avatar only if different sender than previous
  const prev = idx > 0 ? allMsgs[idx - 1] : null;
  const showAvatar = !prev || prev.uid !== msg.uid || prev.type === 'system';
  const senderName = msg.senderName || (isMe ? State.myName : 'Pemain');

  wrapper.innerHTML = `
    ${!isMe && showAvatar ? `
      <div class="chat-avatar" title="${escHtml(senderName)}">${escHtml(senderName.charAt(0).toUpperCase())}</div>
    ` : `<div class="chat-avatar-spacer"></div>`}
    <div class="chat-bubble-wrap">
      ${showAvatar && !isMe ? `<div class="chat-sender">${escHtml(senderName)}</div>` : ''}
      <div class="chat-bubble ${isMe ? 'mine' : 'theirs'} ${msg.type === 'guess' ? 'is-guess' : ''}">
        ${msg.type === 'guess' ? `<span class="guess-prefix"><svg viewBox="0 0 14 14" fill="none"><path d="M2 7h10M9 4l3 3-3 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></span>` : ''}
        ${escHtml(msg.text)}
      </div>
    </div>
  `;
  return wrapper;
}

function escHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ===================== FINAL SCREEN =====================
function enterFinal(data) {
  showScreen('final');
  const players = Object.values(data?.players || {})
    .filter(p => !p.isSpectator)
    .sort((a, b) => (b.score || 0) - (a.score || 0));

  const list = document.getElementById('final-scores-list');
  list.innerHTML = '';

  const medals = ['🥇', '🥈', '🥉'];
  players.forEach((p, i) => {
    const el = document.createElement('div');
    el.className = `final-row ${i === 0 ? 'winner' : ''}`;
    el.innerHTML = `
      <div class="final-rank">${medals[i] || (i + 1)}</div>
      <div class="final-avatar">${p.name.charAt(0).toUpperCase()}</div>
      <div class="final-name">${escHtml(p.name)}${p.uid === State.myUID ? ' <span class="you-tag">(Kamu)</span>' : ''}</div>
      <div class="final-pts">${p.score || 0} <span>poin</span></div>
    `;
    list.appendChild(el);
  });

  const btnReplay = document.getElementById('btn-play-again');
  if (btnReplay) btnReplay.style.display = State.isHost ? 'inline-flex' : 'none';
}

// ===================== MIC =====================
async function handleMicClick() {
  const state = getMicState();
  if (!state.isMicOn) {
    toast('Menghubungkan mikrofon...');
    const ok = await startMic();
    if (!ok) {
      toast('Gagal akses mic. Izinkan akses mikrofon di browser lalu coba lagi.');
    }
  } else {
    const muted = toggleMute();
    toast(muted ? 'Mikrofon di-mute' : 'Mikrofon aktif');
  }
}

function updateMicUI(isOn, isMuted) {
  const ids = ['btn-mic-toggle', 'btn-mic-game'];
  ids.forEach(id => {
    const btn = document.getElementById(id);
    if (!btn) return;
    btn.classList.remove('active', 'muted');
    if (isOn && !isMuted) btn.classList.add('active');
    if (isOn && isMuted) btn.classList.add('muted');
  });

  const label = document.getElementById('mic-label');
  if (label) {
    if (!isOn) label.textContent = 'Mic Mati';
    else if (isMuted) label.textContent = 'Mic Di-mute';
    else label.textContent = 'Mic Aktif';
  }

  const iconOn = document.getElementById('mic-icon-on');
  const iconOff = document.getElementById('mic-icon-off');
  if (iconOn) iconOn.style.display = isMuted ? 'none' : 'block';
  if (iconOff) iconOff.style.display = isMuted ? 'block' : 'none';
}

function updateVoiceChip(uid, name, speaking) {
  document.querySelectorAll(`.voice-chip[data-uid="${uid}"]`).forEach(chip => {
    chip.classList.toggle('speaking', speaking);
  });
}

function renderVoiceUsers() {
  if (!State.roomData) return;
  const players = State.roomData.players || {};
  const containers = ['voice-users', 'voice-users-game'];
  containers.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.innerHTML = '';
    Object.values(players).filter(p => p.online !== false).forEach(p => {
      const chip = document.createElement('div');
      chip.className = 'voice-chip';
      chip.dataset.uid = p.uid;
      chip.textContent = p.name.charAt(0).toUpperCase();
      chip.title = p.name;
      el.appendChild(chip);
    });
  });
}

// ===================== LEAVE / CLEANUP =====================
async function goLobby() {
  stopRoomListeners();
  stopMic();
  if (State.roomCode && State.myUID) {
    await leaveRoom(State.roomCode, State.myUID).catch(() => {});
  }
  State.roomCode = '';
  State.roomData = null;
  State.chatMsgs = [];
  State.gameButtonsBound = false;
  State.micBound = false;
  showScreen('lobby');
}

// ===================== START =====================
boot().catch(e => {
  console.error('Boot failed:', e);
  document.getElementById('lobby-status').textContent = `Error: ${e.message}. Cek konfigurasi Firebase.`;
  document.getElementById('lobby-status').className = 'lobby-status error';
});
