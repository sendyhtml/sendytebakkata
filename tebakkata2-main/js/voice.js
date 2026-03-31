// js/voice.js — WebRTC Mesh Voice Chat via Firebase Signaling

import { db, ensureAuth } from './firebase-config.js';
import {
  ref, set, onChildAdded, onChildRemoved,
  remove, onDisconnect, off
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

const ICE = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' }
];

let localStream = null;
let peers = {};
let roomId = null;
let myUID = null;
let isMicOn = false;
let isMuted = false;
let audioCtx = null;
let analyser = null;
let animFrame = null;

let onSpeakingChange = null;
let onPeersChange = null;
let onStateChange = null;

export async function initVoice(rid, callbacks = {}) {
  roomId = rid;
  myUID = await ensureAuth();
  onSpeakingChange = callbacks.onSpeakingChange || null;
  onPeersChange = callbacks.onPeersChange || null;
  onStateChange = callbacks.onStateChange || null;
}

export async function startMic() {
  if (isMicOn) return true;
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    isMicOn = true;
    isMuted = false;
    setupVisualizer();
    await announcePresence();
    listenSignals();
    if (onStateChange) onStateChange({ isMicOn: true, isMuted: false });
    return true;
  } catch (e) {
    console.error('Mic error:', e.name, e.message);
    return false;
  }
}

export function stopMic() {
  if (!isMicOn) return;
  isMicOn = false;
  isMuted = false;

  if (localStream) { localStream.getTracks().forEach(t => t.stop()); localStream = null; }
  Object.keys(peers).forEach(uid => closePeer(uid));
  peers = {};

  if (roomId && myUID) {
    remove(ref(db, `voice/${roomId}/presence/${myUID}`));
    remove(ref(db, `voice/${roomId}/signals/${myUID}`));
  }

  if (animFrame) { cancelAnimationFrame(animFrame); animFrame = null; }
  if (audioCtx) { audioCtx.close(); audioCtx = null; }
  analyser = null;

  // Clear visualizer
  const canvas = document.getElementById('mic-visualizer');
  if (canvas) {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  if (onPeersChange) onPeersChange({});
  if (onStateChange) onStateChange({ isMicOn: false, isMuted: false });
}

export function toggleMute() {
  if (!localStream) return false;
  isMuted = !isMuted;
  localStream.getAudioTracks().forEach(t => { t.enabled = !isMuted; });
  if (onStateChange) onStateChange({ isMicOn: true, isMuted });
  return isMuted;
}

export function getMicState() { return { isMicOn, isMuted }; }

// ---- Presence ----
async function announcePresence() {
  const presRef = ref(db, `voice/${roomId}/presence/${myUID}`);
  await set(presRef, { uid: myUID, ts: Date.now() });
  onDisconnect(presRef).remove();

  const presListRef = ref(db, `voice/${roomId}/presence`);
  onChildAdded(presListRef, async snap => {
    const uid = snap.key;
    if (uid === myUID) return;
    if (myUID > uid) await createOffer(uid);
  });
  onChildRemoved(presListRef, snap => {
    closePeer(snap.key);
    if (onPeersChange) onPeersChange({ ...peers });
  });
}

// ---- Signaling ----
function listenSignals() {
  const sigRef = ref(db, `voice/${roomId}/signals/${myUID}`);
  onChildAdded(sigRef, async snap => {
    const fromUID = snap.key;
    const data = snap.val();
    if (!data) return;
    remove(ref(db, `voice/${roomId}/signals/${myUID}/${fromUID}`));
    if (data.offer) await handleOffer(fromUID, data);
    else if (data.answer) await handleAnswer(fromUID, data);
  });
}

async function createOffer(toUID) {
  const pc = createPC(toUID);
  if (localStream) localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  await waitICE(pc);
  const candidates = pc.localDescription ? gatherCandidates(pc) : [];
  await set(ref(db, `voice/${roomId}/signals/${toUID}/${myUID}`), {
    offer: { type: pc.localDescription.type, sdp: pc.localDescription.sdp }
  });
}

async function handleOffer(fromUID, data) {
  const pc = createPC(fromUID);
  if (localStream) localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
  await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  await waitICE(pc);
  await set(ref(db, `voice/${roomId}/signals/${fromUID}/${myUID}`), {
    answer: { type: pc.localDescription.type, sdp: pc.localDescription.sdp }
  });
}

async function handleAnswer(fromUID, data) {
  const peer = peers[fromUID];
  if (!peer) return;
  await peer.pc.setRemoteDescription(new RTCSessionDescription(data.answer)).catch(console.warn);
}

function createPC(uid) {
  if (peers[uid]) peers[uid].pc.close();
  const pc = new RTCPeerConnection({ iceServers: ICE });
  peers[uid] = { pc, audioEl: null };

  pc.ontrack = e => {
    const stream = e.streams[0];
    let el = document.getElementById(`voice-audio-${uid}`);
    if (!el) {
      el = document.createElement('audio');
      el.id = `voice-audio-${uid}`;
      el.autoplay = true;
      el.setAttribute('playsinline', '');
      document.body.appendChild(el);
    }
    el.srcObject = stream;
    peers[uid].audioEl = el;
    if (onPeersChange) onPeersChange({ ...peers });
  };

  pc.oniceconnectionstatechange = () => {
    if (['disconnected', 'failed', 'closed'].includes(pc.iceConnectionState)) {
      closePeer(uid);
    }
  };

  return pc;
}

function closePeer(uid) {
  if (!peers[uid]) return;
  try { peers[uid].pc.close(); } catch (e) {}
  if (peers[uid].audioEl) { peers[uid].audioEl.srcObject = null; peers[uid].audioEl.remove(); }
  delete peers[uid];
  if (onPeersChange) onPeersChange({ ...peers });
}

function waitICE(pc) {
  return new Promise(resolve => {
    if (pc.iceGatheringState === 'complete') { resolve(); return; }
    const handler = () => { if (pc.iceGatheringState === 'complete') { pc.removeEventListener('icegatheringstatechange', handler); resolve(); } };
    pc.addEventListener('icegatheringstatechange', handler);
    setTimeout(resolve, 4000);
  });
}

function gatherCandidates(pc) { return []; }

// ---- Visualizer ----
function setupVisualizer() {
  if (!localStream) return;
  try {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const src = audioCtx.createMediaStreamSource(localStream);
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 128;
    analyser.smoothingTimeConstant = 0.8;
    src.connect(analyser);
    drawViz();
  } catch (e) { console.warn('Visualizer error:', e); }
}

function drawViz() {
  animFrame = requestAnimationFrame(drawViz);
  const canvas = document.getElementById('mic-visualizer');
  if (!canvas || !analyser) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const data = new Uint8Array(analyser.frequencyBinCount);
  analyser.getByteFrequencyData(data);

  ctx.clearRect(0, 0, W, H);
  const barCount = 20;
  const step = Math.floor(data.length / barCount);
  const barW = W / barCount - 1;

  let avg = 0;
  for (let i = 0; i < barCount; i++) {
    const val = data[i * step];
    avg += val;
    const h = Math.max(2, (val / 255) * H);
    const alpha = 0.3 + (val / 255) * 0.7;
    ctx.fillStyle = `rgba(201,168,76,${alpha})`;
    ctx.beginPath();
    ctx.roundRect(i * (barW + 1), H - h, barW, h, 2);
    ctx.fill();
  }
  avg /= barCount;
  if (onSpeakingChange) onSpeakingChange(myUID, avg > 18);
}
