/** Tiny Web Audio synth: no sound files, nothing plays until the user interacts. */
const KEY = 'holo-mint:muted';
let ctx: AudioContext | null = null;
let muted = (() => { try { return localStorage.getItem(KEY) === '1'; } catch { return false; } })();
let lastCrinkle = 0;

function ac(): AudioContext | null {
  if (muted) return null;
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch { return null; }
}

export const isMuted = () => muted;
export function setMuted(value: boolean) {
  muted = value;
  try { localStorage.setItem(KEY, value ? '1' : '0'); } catch { /* storage unavailable */ }
}

/** A short filtered-noise rustle, throttled so dragging sounds like foil, not static. */
export function crinkle(amount: number) {
  const a = ac();
  if (!a) return;
  const now = a.currentTime;
  if (now - lastCrinkle < 0.05) return;
  lastCrinkle = now;
  const length = Math.floor(a.sampleRate * 0.06);
  const buffer = a.createBuffer(1, length, a.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length) ** 2;
  const src = a.createBufferSource();
  src.buffer = buffer;
  const filter = a.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = 2500 + Math.random() * 3500;
  filter.Q.value = 0.8;
  const gain = a.createGain();
  gain.gain.value = 0.04 + Math.min(1, amount) * 0.08;
  src.connect(filter).connect(gain).connect(a.destination);
  src.start();
}

const SCALE = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21];

/** A rising chime; higher tiers get more notes and a low shimmer underneath. */
export function chime(rank: number) {
  const a = ac();
  if (!a) return;
  const now = a.currentTime;
  const master = a.createGain();
  master.gain.value = 0.18;
  master.connect(a.destination);
  const notes = 3 + rank * 2;
  const root = 523.25 * (rank >= 3 ? 0.75 : 1);
  for (let i = 0; i < notes; i++) {
    const t = now + i * (0.07 + rank * 0.012);
    const osc = a.createOscillator();
    osc.type = i % 2 ? 'triangle' : 'sine';
    osc.frequency.value = root * 2 ** (SCALE[i % SCALE.length]! / 12);
    const g = a.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.5, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9 + rank * 0.25);
    osc.connect(g).connect(master);
    osc.start(t);
    osc.stop(t + 1.4 + rank * 0.3);
  }
  if (rank >= 3) {
    const pad = a.createOscillator();
    pad.type = 'sawtooth';
    pad.frequency.value = root / 4;
    const lp = a.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(200, now);
    lp.frequency.exponentialRampToValueAtTime(1800, now + 1.2);
    const g = a.createGain();
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(0.25, now + 0.3);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 2.6);
    pad.connect(lp).connect(g).connect(master);
    pad.start(now);
    pad.stop(now + 2.7);
  }
}
