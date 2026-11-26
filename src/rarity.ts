import type { Look, Vec4 } from './holographic-card/scene';

export type TierId = 'common' | 'rare' | 'epic' | 'legendary' | 'mythic';

export interface Tier {
  id: TierId;
  rank: number;
  label: string;
  ko: string;
  odds: number;      // probability, 0..1
  color: string;     // CSS colour for badges
  glow: [number, number, number];
}

export const TIERS: readonly Tier[] = [
  { id: 'common', rank: 0, label: 'Common', ko: '커먼', odds: 0.6, color: '#b9bec6', glow: [0.72, 0.76, 0.82] },
  { id: 'rare', rank: 1, label: 'Rare', ko: '레어', odds: 0.25, color: '#6fb4ff', glow: [0.3, 0.62, 1.0] },
  { id: 'epic', rank: 2, label: 'Epic', ko: '에픽', odds: 0.1, color: '#c48bff', glow: [0.72, 0.45, 1.0] },
  { id: 'legendary', rank: 3, label: 'Legendary', ko: '레전더리', odds: 0.045, color: '#ffc457', glow: [1.0, 0.72, 0.28] },
  { id: 'mythic', rank: 4, label: '1 of 1', ko: '원 오브 원', odds: 0.005, color: '#ff8ad8', glow: [1.0, 0.55, 0.85] },
];

export interface Card {
  seed: number;
  tier: Tier;
  /** 1..999, or 1 for one-of-ones (shown as 1 / 1). */
  edition: number;
  material: string;
  shape: 'triangle' | 'inverted' | 'hexagram';
  look: Omit<Look, 'fx'> & { rim: number; orbit: number };
}

/** cyrb53: small, well-distributed 53-bit string hash. */
function hash(text: string): number {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/** mulberry32 PRNG. */
function prng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const normalizeName = (name: string) => name.normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase();

const MATERIALS: Record<string, { base: Vec4; ink: Vec4 }> = {
  graphite: { base: [0.062, 0.068, 0.078, 1], ink: [0.77, 0.79, 0.82, 1] },
  midnight: { base: [0.03, 0.045, 0.095, 1], ink: [0.74, 0.8, 0.93, 1.05] },
  moss: { base: [0.035, 0.062, 0.05, 1], ink: [0.76, 0.85, 0.79, 1.05] },
  oxblood: { base: [0.085, 0.03, 0.04, 1], ink: [0.92, 0.79, 0.79, 1.05] },
  pearl: { base: [0.17, 0.172, 0.19, 0.7], ink: [0.96, 0.96, 0.98, 1.4] },
  'obsidian gold': { base: [0.03, 0.024, 0.016, 1], ink: [0.92, 0.75, 0.42, 1.7] },
};

const DEFAULT_PHASE: [number, number, number] = [0.05, 0.38, 0.63];
const range = (r: () => number, lo: number, hi: number) => lo + (hi - lo) * r();
const pick = <T>(r: () => number, items: readonly T[]) => items[Math.floor(r() * items.length)]!;

/** The name alone decides the card: same name, same card, on every device. */
export function rollCard(name: string): Card {
  const seed = hash(normalizeName(name));
  const r = prng(seed);
  const roll = r();
  let acc = 0;
  let tier = TIERS[0]!;
  for (const candidate of [...TIERS].reverse()) {
    acc += candidate.odds;
    if (roll < acc) { tier = candidate; break; }
  }
  const edition = 1 + Math.floor(r() * 999);
  const shift = r();
  const phase = (amount: number): [number, number, number] =>
    [DEFAULT_PHASE[0] + shift * amount, DEFAULT_PHASE[1] + shift * amount, DEFAULT_PHASE[2] + shift * amount];

  let material = 'graphite';
  let shape: Card['shape'] = 'triangle';
  let foil: Vec4 = [1, 1, 1, 1];
  let palette: Vec4 = [...DEFAULT_PHASE, 1];
  let pattern: Vec4 = [142, 0, 6, 1];
  let rim = 0;
  let orbit = 0;
  let mythicBase: Vec4 | undefined;

  switch (tier.id) {
    case 'common':
      palette = [...phase(0.15), 0.75];
      pattern = [range(r, 118, 150), 0, pick(r, [4, 5]), range(r, 0.8, 1.1)];
      foil = [1, 1, 1, 0.8];
      break;
    case 'rare':
      material = pick(r, ['midnight', 'moss', 'oxblood', 'graphite']);
      shape = pick(r, ['triangle', 'inverted'] as const);
      palette = [...phase(1), 1];
      pattern = [range(r, 150, 200), 0, 6, range(r, 0.9, 1.3)];
      foil = [1, 1, 1, 1.3];
      break;
    case 'epic':
      material = 'pearl';
      shape = 'hexagram';
      palette = [...phase(1), 1.15];
      pattern = [range(r, 170, 230), 0, 6, range(r, 1, 1.4)];
      foil = [1, 1, 1, 1.6];
      break;
    case 'legendary':
      material = 'obsidian gold';
      shape = pick(r, ['triangle', 'hexagram'] as const);
      palette = [0.0, 0.12, 0.26, 1];
      pattern = [range(r, 160, 220), 0, 6, range(r, 0.9, 1.3)];
      foil = [1, 0.82, 0.5, 2.2];
      rim = 1;
      break;
    case 'mythic': {
      const hue = r() * Math.PI * 2;
      material = 'prismatic';
      shape = 'hexagram';
      mythicBase = [0.05 + 0.04 * Math.cos(hue), 0.05 + 0.04 * Math.cos(hue + 2.1), 0.06 + 0.04 * Math.cos(hue + 4.2), 1];
      palette = [r(), r(), r(), 1.3];
      pattern = [range(r, 200, 260), 0, 6, range(r, 1.2, 1.6)];
      foil = [1, 1, 1, 2.6];
      rim = 1;
      orbit = 1;
      break;
    }
  }
  pattern[1] = shape === 'triangle' ? 0 : shape === 'inverted' ? 1 : 2;
  const m = MATERIALS[material] ?? { base: mythicBase!, ink: [0.97, 0.95, 0.99, 1.6] as Vec4 };

  return {
    seed,
    tier,
    edition: tier.id === 'mythic' ? 1 : edition,
    material,
    shape,
    look: { base: m.base, ink: m.ink, foil, palette, pattern, glow: [...tier.glow, 0], rim, orbit },
  };
}

/**
 * Duel rule: higher tier wins; within a tier the lower edition number wins
 * (No. 001 beats No. 999); identical names draw. Returns 1 if `a` wins, -1 if `b` wins.
 */
export function compareCards(a: Card, b: Card): 1 | -1 | 0 {
  if (a.seed === b.seed) return 0;
  if (a.tier.rank !== b.tier.rank) return a.tier.rank > b.tier.rank ? 1 : -1;
  if (a.edition !== b.edition) return a.edition < b.edition ? 1 : -1;
  return 0;
}
