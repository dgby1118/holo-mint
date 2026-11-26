import type { Look } from './holographic-card/scene';
import type { Card } from './rarity';
import { chime, crinkle } from './audio';

export type Phase = 'sealed' | 'dragging' | 'opening' | 'open';

interface Target {
  setLook(look: Partial<Look>): void;
}

interface Hooks {
  onPhase?(phase: Phase): void;
  onReveal?(card: Card): void;
}

/** Seconds the automatic tear takes, per tier rank. Rarer cards keep you waiting. */
const DURATION = [0.55, 0.75, 1.35, 1.95, 2.7];
/** How strongly the tier colour leaks through the tear, per tier rank. */
const LEAK = [0.35, 0.6, 0.95, 1.35, 1.8];

const easeOut = (t: number) => 1 - (1 - t) ** 3;
const easeIn = (t: number) => t ** 3;
const easeInOut = (t: number) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2);

/**
 * Drives the sealed-pack → torn → revealed sequence through the shader's fx/glow uniforms.
 * Drag down on the card to tear the wrapper; let go past a threshold and it rips open.
 */
export function createOpening(canvas: HTMLCanvasElement, target: Target, hooks: Hooks = {}) {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let card: Card | undefined;
  let pending: Card | undefined;
  let phase: Phase = 'sealed';
  let open = 0;
  let flash = 0;
  let revealed = 0;
  let from = 0;
  let started = 0;
  let dragStartY = 0;
  let dragMoved = false;
  let raf = 0;
  let last = performance.now();

  const setPhase = (next: Phase) => {
    if (phase === next) return;
    phase = next;
    hooks.onPhase?.(next);
  };

  const beginOpening = () => {
    if (!card || phase === 'opening' || phase === 'open') return;
    if (pending) { card = pending; pending = undefined; open = 0; revealed = 0; }
    from = open;
    started = performance.now();
    setPhase('opening');
  };

  const finish = () => {
    open = 1;
    flash = reduced.matches ? 0.25 : 1;
    setPhase('open');
    if (card) {
      chime(card.tier.rank);
      if (card.tier.rank >= 3) navigator.vibrate?.([30, 40, 60]);
      hooks.onReveal?.(card);
    }
  };

  const tick = (now: number) => {
    raf = requestAnimationFrame(tick);
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    if (pending && open < 0.02) { card = pending; pending = undefined; revealed = 0; }
    if (!card) return;
    const rank = card.tier.rank;
    let leak = 0;

    if (phase === 'opening') {
      const duration = reduced.matches ? 0.2 : DURATION[rank]!;
      const t = Math.min(1, (now - started) / 1000 / duration);
      if (rank < 2 || reduced.matches) {
        open = from + (1 - from) * easeInOut(t);
      } else {
        // Suspense: tear to a sliver, hold while the colour pulses, then rip.
        const hold = 0.58;
        const sliver = Math.max(from, 0.4);
        open = t < hold ? from + (sliver - from) * easeOut(t / hold) : sliver + (1 - sliver) * easeIn((t - hold) / (1 - hold));
      }
      leak = LEAK[rank]! * (rank >= 2 ? 0.65 + 0.35 * Math.sin(now / 1000 * (8 + rank * 3)) : 1);
      if (Math.random() < 0.35) crinkle(0.4 + open * 0.6);
      if (t >= 1) finish();
    } else if (phase === 'dragging') {
      leak = LEAK[rank]! * Math.min(1, open * 5);
    } else if (phase === 'sealed') {
      // Spring back (or re-wrap) towards fully sealed.
      open += (0 - open) * (1 - Math.exp(-12 * dt));
      if (open < 0.0005) open = 0;
      leak = LEAK[rank]! * Math.min(1, open * 5);
    }

    flash *= Math.exp(-3.2 * dt);
    revealed += ((phase === 'open' ? 1 : 0) - revealed) * (1 - Math.exp(-3 * dt));
    const { rim, orbit, ...look } = card.look;
    target.setLook({
      ...look,
      fx: [open, flash, rim * revealed, orbit * revealed],
      glow: [look.glow[0], look.glow[1], look.glow[2], leak],
    });
  };

  // --- Drag to tear ---------------------------------------------------------
  const down = (event: PointerEvent) => {
    if (!event.isPrimary || phase !== 'sealed' || !card) return;
    dragStartY = event.clientY;
    dragMoved = false;
    canvas.setPointerCapture?.(event.pointerId);
    setPhase('dragging');
  };
  const move = (event: PointerEvent) => {
    if (phase !== 'dragging') return;
    const rect = canvas.getBoundingClientRect();
    const pulled = Math.max(0, (event.clientY - dragStartY) / (rect.height * 0.42));
    const next = Math.min(0.6, pulled * 0.6);
    if (Math.abs(next - open) > 0.01) { crinkle(next * 2); dragMoved = true; }
    open = next;
  };
  const up = () => {
    if (phase !== 'dragging') return;
    if (open > 0.12) beginOpening();
    else {
      // A tap with no pull: nudge the tear as a hint, then let it spring back.
      if (!dragMoved) open = 0.07;
      setPhase('sealed');
    }
  };
  canvas.addEventListener('pointerdown', down);
  canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  raf = requestAnimationFrame(tick);

  return {
    get phase() { return phase; },
    /** Swap in a new card and wrap it up again. */
    setCard(next: Card) {
      const current = pending ?? card;
      if (current && current.seed === next.seed) return;
      flash = 0;
      if (!card || open < 0.02) card = next;
      // Keep showing the old card until the wrapper has closed over it,
      // so the next card's rarity never peeks out early.
      else pending = next;
      setPhase('sealed');
    },
    reseal() { if (phase === 'open') setPhase('sealed'); },
    open: beginOpening,
    dispose() {
      cancelAnimationFrame(raf);
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('pointercancel', up);
    },
  };
}
