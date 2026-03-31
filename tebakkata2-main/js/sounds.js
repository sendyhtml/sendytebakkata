// js/sounds.js — Sound Manager for answer buttons

let _volume = 0.8;

export function setVolume(v) { _volume = Math.max(0, Math.min(1, v)); }
export function getVolume() { return _volume; }

/**
 * Play sound for answer type: 'yes' | 'no' | 'maybe'
 * Checks localStorage for custom audio (base64 data URL), else plays default tone
 */
export function playSound(type) {
  const key = `sound_custom_${type}`;
  const stored = localStorage.getItem(key);

  if (stored) {
    try {
      const audio = new Audio(stored);
      audio.volume = _volume;
      audio.play().catch(e => console.warn('Audio play failed:', e));
      return;
    } catch (e) {
      console.warn('Custom sound playback error:', e);
    }
  }

  // Default Web Audio API tones
  playDefaultTone(type);
}

function playDefaultTone(type) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();

    const configs = {
      yes: { freqs: [523.25, 659.25, 783.99], dur: 0.12, wave: 'sine' },
      maybe: { freqs: [440, 494.88, 440], dur: 0.14, wave: 'triangle' },
      no: { freqs: [349.23, 311.13, 261.63], dur: 0.12, wave: 'sawtooth' }
    };
    const cfg = configs[type] || configs.maybe;

    const gain = ctx.createGain();
    gain.connect(ctx.destination);
    gain.gain.setValueAtTime(_volume * 0.25, ctx.currentTime);

    let t = ctx.currentTime;
    cfg.freqs.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      osc.type = cfg.wave;
      osc.frequency.setValueAtTime(freq, t);
      osc.connect(gain);
      osc.start(t);
      osc.stop(t + cfg.dur);
      t += cfg.dur;
    });

    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
    setTimeout(() => ctx.close(), (t + 0.2) * 1000);
  } catch (e) {
    console.warn('Default tone error:', e);
  }
}

/** Save custom sound (base64 data URL) to localStorage */
export function saveCustomSound(type, dataUrl) {
  localStorage.setItem(`sound_custom_${type}`, dataUrl);
}

/** Remove custom sound, revert to default */
export function removeCustomSound(type) {
  localStorage.removeItem(`sound_custom_${type}`);
}

/** Check if custom sound exists */
export function hasCustomSound(type) {
  return !!localStorage.getItem(`sound_custom_${type}`);
}

/** Get all sound settings */
export function getSoundSettings() {
  return {
    volume: _volume,
    yes: hasCustomSound('yes'),
    no: hasCustomSound('no'),
    maybe: hasCustomSound('maybe')
  };
}

/** Init volume from localStorage */
export function initSounds() {
  const stored = parseFloat(localStorage.getItem('tk_volume') || '0.8');
  _volume = stored;
}
