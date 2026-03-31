// js/admin.js — Admin Dashboard Controller

import { db } from './firebase-config.js';
import {
  ref, set, get, update, onValue, remove, push
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";
import { loadSettings, saveSettings } from './game.js';
import { loadCategories, clearCategoryCache, FALLBACK_CATEGORIES } from './categories.js';
import { saveCustomSound, removeCustomSound, hasCustomSound, initSounds, playSound, setVolume } from './sounds.js';

// ===================== NAV =====================
document.querySelectorAll('.nav-item[data-section]').forEach(item => {
  item.addEventListener('click', () => {
    const sec = item.dataset.section;
    document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
    document.querySelectorAll('.admin-section').forEach(s => s.classList.remove('active'));
    item.classList.add('active');
    document.getElementById(`section-${sec}`)?.classList.add('active');
  });
});

// ===================== TOAST =====================
let _tt = null;
function toast(msg, dur = 2800) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(_tt);
  _tt = setTimeout(() => el.classList.remove('show'), dur);
}

// ===================== BOOT =====================
async function boot() {
  initSounds();
  const vol = parseFloat(localStorage.getItem('tk_volume') || '0.8');
  setVolume(vol);

  await loadOverview();
  await loadTemplatesSection();
  loadSoundsSection();
  await loadSettingsSection();
  listenRoomsLive();
}

// ===================== OVERVIEW =====================
async function loadOverview() {
  try {
    const snap = await get(ref(db, 'rooms'));
    const rooms = snap.val() || {};
    const active = Object.values(rooms).filter(r => r.status !== 'ended');
    const totalPlayers = active.reduce((acc, r) =>
      acc + Object.values(r.players || {}).filter(p => p.online !== false).length, 0);

    setText('stat-rooms', active.length);
    setText('stat-players', totalPlayers);

    const cats = await loadCategories();
    const totalWords = Object.values(cats).reduce((acc, c) => {
      const words = c.words || c;
      return acc + (Array.isArray(words) ? words.length : 0);
    }, 0);
    setText('stat-words', totalWords);
    setText('stat-categories', Object.keys(cats).length);

    renderOverviewRooms(active);
  } catch (e) {
    console.error('Overview error:', e);
  }
}

function renderOverviewRooms(rooms) {
  const el = document.getElementById('overview-rooms');
  if (!el) return;
  if (!rooms.length) {
    el.innerHTML = '<div class="empty-state">Tidak ada room aktif saat ini</div>';
    return;
  }
  el.innerHTML = rooms.map(r => {
    const players = Object.values(r.players || {}).filter(p => p.online !== false);
    const statusClass = r.status === 'playing' ? 'playing' : 'waiting';
    const statusLabel = r.status === 'playing' ? 'Bermain' : 'Menunggu';
    return `
      <div class="overview-room-item">
        <div class="or-code">${r.code}</div>
        <div class="or-name">${esc(r.name || r.code)}</div>
        <div class="or-meta">${players.length} pemain</div>
        <span class="or-status ${statusClass}">${statusLabel}</span>
      </div>`;
  }).join('');
}

// ===================== ROOMS LIVE =====================
function listenRoomsLive() {
  onValue(ref(db, 'rooms'), snap => {
    const rooms = snap.val() || {};
    const active = Object.values(rooms).filter(r => r.status !== 'ended');
    renderAdminRooms(active);
  });
}

function renderAdminRooms(rooms) {
  const el = document.getElementById('admin-rooms-list');
  if (!el) return;
  if (!rooms.length) {
    el.innerHTML = '<div class="empty-state">Tidak ada room aktif saat ini</div>';
    return;
  }
  el.innerHTML = '';
  rooms.forEach(room => {
    const players = Object.values(room.players || {}).filter(p => p.online !== false);
    const card = document.createElement('div');
    card.className = 'admin-room-card';
    card.innerHTML = `
      <div class="arc-header">
        <div class="arc-code">${room.code}</div>
        <div class="arc-name">${esc(room.name || room.code)}</div>
        <span class="or-status ${room.status === 'playing' ? 'playing' : 'waiting'}">
          ${room.status === 'playing' ? 'Bermain' : 'Menunggu'}
        </span>
      </div>
      <div class="arc-players">
        ${players.map(p => `<div class="arc-player">${esc(p.name)}${p.isHost ? ' (Host)' : ''}</div>`).join('')}
      </div>
      <div class="arc-actions">
        <button class="btn btn-ghost btn-sm btn-danger" data-code="${room.code}">
          <svg viewBox="0 0 16 16" fill="none"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
          Tutup Room
        </button>
      </div>`;
    card.querySelector('.btn-danger').addEventListener('click', async () => {
      if (!confirm(`Tutup room ${room.code}?`)) return;
      await update(ref(db, `rooms/${room.code}`), { status: 'ended' });
      toast('Room ditutup');
    });
    el.appendChild(card);
  });
}

// ===================== TEMPLATES =====================
let localTemplates = {};

async function loadTemplatesSection() {
  const cats = await loadCategories();
  // Convert to editable format
  localTemplates = {};
  Object.entries(cats).forEach(([name, data]) => {
    const words = data.words || data;
    localTemplates[name] = Array.isArray(words) ? [...words] : [];
  });
  renderCategories();
}

function renderCategories() {
  const list = document.getElementById('categories-list');
  if (!list) return;
  list.innerHTML = '';

  if (!Object.keys(localTemplates).length) {
    list.innerHTML = '<div class="empty-state">Belum ada kategori</div>';
    return;
  }

  Object.entries(localTemplates).forEach(([cat, words]) => {
    const block = document.createElement('div');
    block.className = 'category-block';
    block.dataset.cat = cat;
    block.innerHTML = `
      <div class="category-header">
        <span class="cat-name-text">${esc(cat)}</span>
        <span class="cat-count">${words.length} kata</span>
        <div class="cat-header-actions">
          <button class="btn btn-ghost btn-xs btn-danger" data-act="del-cat" data-cat="${esc(cat)}">Hapus</button>
        </div>
      </div>
      <div class="category-body">
        <div class="words-wrap" id="words-${slugify(cat)}">
          ${words.map(w => wordChipHTML(w, cat)).join('')}
          ${words.length === 0 ? '<span class="empty-cat">Belum ada kata</span>' : ''}
        </div>
        <div class="add-word-row">
          <input type="text" class="field-input add-word-input" placeholder="Tambah kata baru..." maxlength="60" />
          <button class="btn btn-outline btn-sm" data-act="add-word" data-cat="${esc(cat)}">
            <svg viewBox="0 0 14 14" fill="none"><path d="M7 2v10M2 7h10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
            Tambah
          </button>
        </div>
      </div>`;

    // Delete category
    block.querySelector('[data-act="del-cat"]').addEventListener('click', async () => {
      if (!confirm(`Hapus seluruh kategori "${cat}"?`)) return;
      delete localTemplates[cat];
      await saveTemplates();
      renderCategories();
    });

    // Add word
    const addBtn = block.querySelector('[data-act="add-word"]');
    const addInput = block.querySelector('.add-word-input');
    const doAdd = async () => {
      const w = addInput.value.trim();
      if (!w) return;
      if (localTemplates[cat].includes(w)) { toast('Kata sudah ada'); return; }
      localTemplates[cat].push(w);
      await saveTemplates();
      renderCategories();
    };
    addBtn.addEventListener('click', doAdd);
    addInput.addEventListener('keydown', e => { if (e.key === 'Enter') doAdd(); });

    list.appendChild(block);
  });

  // Remove word — event delegation on list
  list.addEventListener('click', async e => {
    const btn = e.target.closest('[data-act="remove-word"]');
    if (!btn) return;
    const { cat, word } = btn.dataset;
    if (!localTemplates[cat]) return;
    localTemplates[cat] = localTemplates[cat].filter(w => w !== word);
    await saveTemplates();
    renderCategories();
  });
}

function wordChipHTML(word, cat) {
  return `<div class="word-chip">
    <span class="word-chip-text">${esc(word)}</span>
    <button class="word-chip-remove" data-act="remove-word" data-cat="${esc(cat)}" data-word="${esc(word)}" title="Hapus">
      <svg viewBox="0 0 10 10" fill="none"><path d="M2 2l6 6M8 2L2 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
    </button>
  </div>`;
}

async function saveTemplates() {
  // Save to Firebase
  const toSave = {};
  Object.entries(localTemplates).forEach(([cat, words]) => {
    toSave[cat] = words;
  });
  try {
    await set(ref(db, 'admin/templates'), toSave);
    clearCategoryCache();
    toast('Template disimpan ke Firebase');
  } catch (e) {
    toast('Gagal menyimpan: ' + e.message);
  }
  // Update stats
  setText('stat-words', Object.values(localTemplates).reduce((a, w) => a + w.length, 0));
  setText('stat-categories', Object.keys(localTemplates).length);
}

document.getElementById('btn-add-category')?.addEventListener('click', async () => {
  const input = document.getElementById('new-category');
  const cat = input?.value.trim();
  if (!cat) return toast('Masukkan nama kategori');
  if (localTemplates[cat]) return toast('Kategori sudah ada');
  localTemplates[cat] = [];
  await saveTemplates();
  renderCategories();
  if (input) input.value = '';
});

document.getElementById('new-category')?.addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('btn-add-category')?.click();
});

// ===================== SOUNDS SECTION =====================
function loadSoundsSection() {
  const types = ['yes', 'no', 'maybe'];

  // Volume slider
  const volSlider = document.getElementById('global-volume');
  const volDisplay = document.getElementById('volume-display');
  if (volSlider) {
    const saved = parseInt(localStorage.getItem('tk_volume_pct') || '80');
    volSlider.value = saved;
    if (volDisplay) volDisplay.textContent = `${saved}%`;
    volSlider.addEventListener('input', () => {
      const v = parseInt(volSlider.value);
      if (volDisplay) volDisplay.textContent = `${v}%`;
      const normalized = v / 100;
      setVolume(normalized);
      localStorage.setItem('tk_volume', normalized);
      localStorage.setItem('tk_volume_pct', v);
    });
  }

  types.forEach(type => {
    updateSoundPreview(type);

    // Upload button
    const uploadInput = document.getElementById(`upload-${type}`);
    if (uploadInput) {
      uploadInput.addEventListener('change', e => {
        const file = e.target.files[0];
        if (!file) return;
        if (file.size > 2 * 1024 * 1024) { toast('File terlalu besar, maksimal 2MB'); return; }

        const reader = new FileReader();
        reader.onload = ev => {
          try {
            saveCustomSound(type, ev.target.result);
            updateSoundPreview(type);
            toast(`Suara "${getLabelForType(type)}" berhasil diupload`);
          } catch (err) {
            toast('Gagal menyimpan suara: storage penuh?');
          }
        };
        reader.readAsDataURL(file);
        e.target.value = '';
      });
    }

    // Test button
    document.getElementById(`btn-test-${type}`)?.addEventListener('click', () => {
      playSound(type);
    });

    // Reset button
    document.getElementById(`btn-reset-${type}`)?.addEventListener('click', () => {
      removeCustomSound(type);
      updateSoundPreview(type);
      toast(`Suara "${getLabelForType(type)}" direset ke default`);
    });
  });
}

function updateSoundPreview(type) {
  const preview = document.getElementById(`preview-${type}`);
  if (!preview) return;
  if (hasCustomSound(type)) {
    preview.innerHTML = `
      <div class="sound-file-active">
        <svg viewBox="0 0 16 16" fill="none"><path d="M3 8a5 5 0 0010 0M8 1v7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
        Suara custom aktif
      </div>`;
  } else {
    preview.innerHTML = `<span class="no-sound-text">Menggunakan nada default</span>`;
  }
}

function getLabelForType(type) {
  return { yes: 'Iya', no: 'Tidak', maybe: 'Bisa Jadi' }[type] || type;
}

// ===================== SETTINGS SECTION =====================
async function loadSettingsSection() {
  const s = await loadSettings();
  setVal('setting-max-players', s.maxPlayers ?? 8);
  setVal('setting-rounds', s.totalRounds ?? 5);
  setVal('setting-round-time', s.roundTime ?? 120);
  setVal('setting-points', s.pointsPerAnswer ?? 10);
  setCheck('setting-spectator', s.allowSpectator !== false);
  setCheck('setting-require-clue', s.requireClue || false);
  setVal('setting-app-title', s.appTitle || 'TebakKata');
}

document.getElementById('btn-save-settings')?.addEventListener('click', async () => {
  const s = {
    maxPlayers: intVal('setting-max-players', 8),
    totalRounds: intVal('setting-rounds', 5),
    roundTime: intVal('setting-round-time', 120),
    pointsPerAnswer: intVal('setting-points', 10),
    allowSpectator: getCheck('setting-spectator'),
    requireClue: getCheck('setting-require-clue'),
    appTitle: document.getElementById('setting-app-title')?.value.trim() || 'TebakKata'
  };
  try {
    await saveSettings(s);
    toast('Pengaturan berhasil disimpan!');
  } catch (e) {
    toast('Gagal menyimpan: ' + e.message);
  }
});

// ===================== UTILS =====================
function setText(id, val) { const el = document.getElementById(id); if (el) el.textContent = val; }
function setVal(id, val) { const el = document.getElementById(id); if (el) el.value = val; }
function setCheck(id, val) { const el = document.getElementById(id); if (el) el.checked = val; }
function intVal(id, def) { const el = document.getElementById(id); return el ? (parseInt(el.value) || def) : def; }
function getCheck(id) { const el = document.getElementById(id); return el ? el.checked : false; }
function slugify(s) { return s.replace(/[^a-zA-Z0-9]/g, '_'); }
function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ===================== START =====================
boot().catch(e => {
  console.error('Admin boot error:', e);
  toast('Error: ' + e.message);
});
