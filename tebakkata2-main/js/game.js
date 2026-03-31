// js/game.js — Game State Machine + Firebase Sync

import { db, ensureAuth, getCurrentUID } from './firebase-config.js';
import {
  ref, set, get, update, push, onValue, off,
  remove, onDisconnect, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

// ===================== UTILS =====================
export function genCode(len = 6) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

// ===================== ROOM CREATION =====================
export async function createRoom(playerName, roomName) {
  const uid = await ensureAuth();
  const code = genCode();

  const defaultSettings = await loadSettings();

  const roomData = {
    code,
    name: roomName || `Room ${code}`,
    hostUID: uid,
    status: 'waiting',
    createdAt: Date.now(),
    settings: defaultSettings,
    players: {
      [uid]: {
        uid,
        name: playerName,
        score: 0,
        isHost: true,
        joinedAt: Date.now(),
        online: true,
        isSpectator: false
      }
    },
    game: {
      round: 0,
      totalRounds: defaultSettings.totalRounds || 5,
      status: 'waiting',
      currentHostUID: null,
      currentWord: null,
      currentClue: null,
      guessCount: 0,
      lastGuess: null,
      lastGuesserUID: null,
      lastGuesserName: null
    }
  };

  await set(ref(db, `rooms/${code}`), roomData);

  // Auto-cleanup on disconnect
  const onlineRef = ref(db, `rooms/${code}/players/${uid}/online`);
  onDisconnect(onlineRef).set(false);

  return { code, uid };
}

// ===================== JOIN ROOM =====================
export async function joinRoom(code, playerName) {
  const uid = await ensureAuth();
  const snap = await get(ref(db, `rooms/${code}`));

  if (!snap.exists()) throw new Error('Room tidak ditemukan. Cek kembali kode room.');

  const room = snap.val();
  if (room.status === 'ended') throw new Error('Room sudah berakhir.');

  const settings = room.settings || {};
  const maxPlayers = settings.maxPlayers || 8;
  const existingPlayers = Object.values(room.players || {});

  // Already in room - rejoin
  if (room.players && room.players[uid]) {
    await update(ref(db, `rooms/${code}/players/${uid}`), {
      online: true,
      name: playerName
    });
    onDisconnect(ref(db, `rooms/${code}/players/${uid}/online`)).set(false);
    return { code, uid, isHost: room.players[uid].isHost, isSpectator: room.players[uid].isSpectator || false };
  }

  // Game in progress - check spectator
  if (room.status === 'playing') {
    if (settings.allowSpectator === false) throw new Error('Game sudah dimulai dan spectator tidak diizinkan.');
    await set(ref(db, `rooms/${code}/players/${uid}`), {
      uid, name: playerName, score: 0, isHost: false,
      joinedAt: Date.now(), online: true, isSpectator: true
    });
    onDisconnect(ref(db, `rooms/${code}/players/${uid}/online`)).set(false);
    await pushSystemMsg(code, `${playerName} bergabung sebagai penonton`);
    return { code, uid, isHost: false, isSpectator: true };
  }

  // Check max players (exclude offline)
  const onlinePlayers = existingPlayers.filter(p => p.online !== false);
  if (onlinePlayers.length >= maxPlayers) throw new Error(`Room sudah penuh (${maxPlayers} pemain).`);

  await set(ref(db, `rooms/${code}/players/${uid}`), {
    uid, name: playerName, score: 0, isHost: false,
    joinedAt: Date.now(), online: true, isSpectator: false
  });
  onDisconnect(ref(db, `rooms/${code}/players/${uid}/online`)).set(false);
  await pushSystemMsg(code, `${playerName} bergabung ke room`);

  return { code, uid, isHost: false, isSpectator: false };
}

// ===================== START GAME =====================
export async function startGame(code) {
  const uid = await ensureAuth();
  const snap = await get(ref(db, `rooms/${code}`));
  const room = snap.val();

  const activePlayers = Object.values(room.players || {})
    .filter(p => !p.isSpectator && p.online !== false);

  if (activePlayers.length < 2) throw new Error('Minimal 2 pemain aktif untuk memulai game.');

  const settings = room.settings || await loadSettings();
  const totalRounds = settings.totalRounds || 5;

  // Pick first word giver randomly
  const firstGiver = activePlayers[Math.floor(Math.random() * activePlayers.length)];

  await update(ref(db, `rooms/${code}`), {
    status: 'playing',
    'game/status': 'choosing',
    'game/round': 1,
    'game/totalRounds': totalRounds,
    'game/currentHostUID': firstGiver.uid,
    'game/currentWord': null,
    'game/currentClue': null,
    'game/guessCount': 0,
    'game/lastGuess': null,
    'game/lastGuesserUID': null,
    'game/lastGuesserName': null,
    'game/startedAt': Date.now()
  });

  await pushSystemMsg(code, `Game dimulai! ${totalRounds} ronde. ${firstGiver.name} memilih kata pertama.`);
}

// ===================== SET WORD =====================
export async function setWord(code, word, clue) {
  await update(ref(db, `rooms/${code}/game`), {
    currentWord: word.trim(),
    currentClue: clue ? clue.trim() : null,
    status: 'playing',
    guessCount: 0,
    lastGuess: null,
    lastGuesserUID: null,
    lastGuesserName: null,
    wordSetAt: Date.now()
  });
  await pushSystemMsg(code, `Kata sudah ditetapkan. Silakan tebak!`);
}

// ===================== SEND GUESS =====================
export async function sendGuess(code, uid, playerName, guess) {
  // Push to chat
  await pushChatMsg(code, {
    uid, senderName: playerName,
    text: guess,
    type: 'guess',
    ts: Date.now()
  });

  // Update last guess on game node
  const snap = await get(ref(db, `rooms/${code}/game/guessCount`));
  const count = snap.val() || 0;

  await update(ref(db, `rooms/${code}/game`), {
    lastGuess: guess,
    lastGuesserUID: uid,
    lastGuesserName: playerName,
    guessCount: count + 1
  });
}

// ===================== ANSWER GUESS =====================
export async function answerGuess(code, uid, hostName, type) {
  const labelMap = { yes: 'IYA!', no: 'TIDAK!', maybe: 'BISA JADI!' };
  await pushChatMsg(code, {
    uid, senderName: hostName,
    text: labelMap[type] || type,
    type: `answer-${type}`,
    ts: Date.now()
  });
}

// ===================== END ROUND =====================
export async function endRound(code, winnerUID, winnerName, word) {
  const snap = await get(ref(db, `rooms/${code}`));
  const room = snap.val();
  const game = room.game || {};
  const settings = room.settings || {};
  const pts = settings.pointsPerAnswer || 10;
  const round = game.round || 1;
  const total = game.totalRounds || 5;

  // Award points
  if (winnerUID) {
    const curScore = (room.players[winnerUID] && room.players[winnerUID].score) || 0;
    await update(ref(db, `rooms/${code}/players/${winnerUID}`), { score: curScore + pts });
    await pushSystemMsg(code, `${winnerName} berhasil menebak! Kata: "${word}". +${pts} poin`);
  }

  // Last round?
  if (round >= total) {
    await update(ref(db, `rooms/${code}`), {
      status: 'ended',
      'game/status': 'ended',
      'game/currentWord': null
    });
    await pushSystemMsg(code, `Game selesai! Lihat hasil akhir.`);
    return 'ended';
  }

  // Next round — pick next word giver
  const activePlayers = Object.values(room.players || {})
    .filter(p => !p.isSpectator && p.online !== false);
  const curIdx = activePlayers.findIndex(p => p.uid === game.currentHostUID);
  const nextGiver = activePlayers[(curIdx + 1) % activePlayers.length];

  await update(ref(db, `rooms/${code}/game`), {
    status: 'choosing',
    round: round + 1,
    currentHostUID: nextGiver.uid,
    currentWord: null,
    currentClue: null,
    guessCount: 0,
    lastGuess: null,
    lastGuesserUID: null,
    lastGuesserName: null
  });

  await pushSystemMsg(code, `Ronde ${round + 1} dari ${total}. ${nextGiver.name} giliran memberi kata.`);
  return 'next';
}

// ===================== RESET GAME =====================
export async function resetGame(code) {
  const snap = await get(ref(db, `rooms/${code}/players`));
  const players = snap.val() || {};
  const updates = {};

  // Reset all scores
  Object.keys(players).forEach(uid => {
    updates[`rooms/${code}/players/${uid}/score`] = 0;
  });

  await update(ref(db), updates);

  await update(ref(db, `rooms/${code}`), {
    status: 'waiting',
    'game/status': 'waiting',
    'game/round': 0,
    'game/currentHostUID': null,
    'game/currentWord': null,
    'game/currentClue': null,
    'game/guessCount': 0,
    'game/lastGuess': null,
    'game/lastGuesserUID': null,
    'game/lastGuesserName': null
  });

  // Clear chat
  await remove(ref(db, `rooms/${code}/chat`));
  await pushSystemMsg(code, 'Game di-reset. Siap bermain lagi!');
}

// ===================== LEAVE ROOM =====================
export async function leaveRoom(code, uid) {
  try {
    await update(ref(db, `rooms/${code}/players/${uid}`), { online: false });
  } catch (e) {}
}

// ===================== CHAT =====================
export async function pushChatMsg(code, msg) {
  await push(ref(db, `rooms/${code}/chat`), msg);
}

export async function pushSystemMsg(code, text) {
  await push(ref(db, `rooms/${code}/chat`), {
    uid: 'system',
    senderName: null,
    text,
    type: 'system',
    ts: Date.now()
  });
}

// ===================== LISTENERS =====================
export function listenRoom(code, cb) {
  const r = ref(db, `rooms/${code}`);
  onValue(r, snap => cb(snap.exists() ? snap.val() : null));
  return () => off(r);
}

export function listenChat(code, cb) {
  const r = ref(db, `rooms/${code}/chat`);
  const msgs = [];
  const handler = onValue(r, snap => {
    const arr = [];
    snap.forEach(child => arr.push({ key: child.key, ...child.val() }));
    cb(arr);
  });
  return () => off(r);
}

// ===================== SETTINGS =====================
export async function loadSettings() {
  try {
    const snap = await get(ref(db, 'admin/settings'));
    if (snap.exists()) return snap.val();
  } catch (e) {}
  return {
    maxPlayers: 8,
    totalRounds: 5,
    roundTime: 120,
    pointsPerAnswer: 10,
    allowSpectator: true,
    requireClue: false
  };
}

export async function saveSettings(settings) {
  await set(ref(db, 'admin/settings'), settings);
}
