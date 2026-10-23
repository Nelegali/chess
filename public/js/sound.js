// Короткие звуки, синтезированные через Web Audio — никаких файлов не нужно.
import { settings } from './store.js';

let ctx = null;

function audio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

// iOS разрешает звук только после касания пользователя.
window.addEventListener('pointerdown', () => audio(), { once: true });

function tone(freq, start, dur, { type = 'sine', gain = 0.18 } = {}) {
  const a = audio();
  if (!a) return;
  const t = a.currentTime + start;
  const osc = a.createOscillator();
  const g = a.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(a.destination);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

export function play(name) {
  if (!settings.sound) return;
  try {
    switch (name) {
      case 'move':
        tone(320, 0, 0.07, { type: 'triangle', gain: 0.25 });
        break;
      case 'capture':
        tone(220, 0, 0.09, { type: 'square', gain: 0.12 });
        tone(160, 0.04, 0.08, { type: 'triangle', gain: 0.2 });
        break;
      case 'correct':
        tone(660, 0, 0.09);
        tone(880, 0.07, 0.12);
        break;
      case 'wrong':
        tone(180, 0, 0.18, { type: 'sawtooth', gain: 0.08 });
        break;
      case 'success':
        [523, 659, 784, 1046].forEach((f, i) => tone(f, i * 0.09, 0.18));
        break;
      case 'achievement':
        [784, 988, 1175, 1568].forEach((f, i) => tone(f, i * 0.07, 0.22, { type: 'triangle', gain: 0.2 }));
        break;
    }
  } catch {
    /* звук не критичен */
  }
}
