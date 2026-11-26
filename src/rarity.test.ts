import { expect, test } from 'vitest';
import { rollCard, TIERS } from './rarity';

test('the same name always rolls the same card, regardless of case and spacing', () => {
  const a = rollCard('Holographic');
  const b = rollCard('  holographic ');
  expect(b.seed).toBe(a.seed);
  expect(b.tier.id).toBe(a.tier.id);
  expect(b.edition).toBe(a.edition);
  expect(b.look).toEqual(a.look);
});

test('odds add up and the observed distribution tracks them', () => {
  expect(TIERS.reduce((sum, t) => sum + t.odds, 0)).toBeCloseTo(1);
  const counts = new Map<string, number>();
  const n = 40000;
  for (let i = 0; i < n; i++) {
    const id = rollCard(`name-${i}`).tier.id;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  for (const tier of TIERS) {
    const observed = (counts.get(tier.id) ?? 0) / n;
    expect(Math.abs(observed - tier.odds)).toBeLessThan(Math.max(0.01, tier.odds * 0.25));
  }
});

test('every tier produces valid shader values', () => {
  const seen = new Set<string>();
  for (let i = 0; i < 20000 && seen.size < TIERS.length; i++) {
    const card = rollCard(`probe-${i}`);
    seen.add(card.tier.id);
    for (const v of [card.look.base, card.look.ink, card.look.foil, card.look.palette, card.look.pattern, card.look.glow]) {
      expect(v).toHaveLength(4);
      for (const x of v) expect(Number.isFinite(x)).toBe(true);
    }
    expect(card.edition).toBeGreaterThanOrEqual(1);
    expect(card.edition).toBeLessThanOrEqual(999);
  }
  expect(seen.size).toBe(TIERS.length);
});

test('duels: tier first, then the lower edition, and a name cannot beat itself', async () => {
  const { compareCards } = await import('./rarity');
  const cards = Array.from({ length: 400 }, (_, i) => rollCard(`duel-${i}`));
  const hi = cards.find((c) => c.tier.rank >= 2)!;
  const lo = cards.find((c) => c.tier.rank === 0)!;
  expect(compareCards(hi, lo)).toBe(1);
  expect(compareCards(lo, hi)).toBe(-1);
  const commons = cards.filter((c) => c.tier.rank === 0 && c.edition !== lo.edition);
  const other = commons[0]!;
  expect(compareCards(lo, other)).toBe(lo.edition < other.edition ? 1 : -1);
  expect(compareCards(lo, rollCard(`duel-${cards.indexOf(lo)}`))).toBe(0);
});
