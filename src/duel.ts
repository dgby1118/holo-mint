import { compareCards, rollCard, type Card } from './rarity';
import { chime, crinkle } from './audio';

interface Deps {
  /** Renders a revealed card for `name` and resolves to an image URL. */
  still(name: string, card: Card): Promise<string>;
  onShare(a: string, b: string): void;
  onClose(): void;
}

const pct = (odds: number) => `${(odds * 100).toLocaleString('ko-KR', { maximumFractionDigits: 1 })}%`;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const edition = (card: Card) => (card.tier.id === 'mythic' ? '1 / 1' : `No. ${String(card.edition).padStart(3, '0')}`);

/** Two names, two sealed packs, one winner. Shown in a <dialog>. */
export function createDuel(dialog: HTMLDialogElement, deps: Deps) {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const slots = [dialog.querySelector<HTMLElement>('#slotA')!, dialog.querySelector<HTMLElement>('#slotB')!];
  const verdict = dialog.querySelector<HTMLElement>('#verdict')!;
  let names: [string, string] = ['', ''];
  let run = 0;
  let urls: string[] = [];

  const reset = () => {
    urls.forEach((u) => URL.revokeObjectURL(u));
    urls = [];
    verdict.textContent = '';
    verdict.className = 'verdict';
    for (const slot of slots) {
      slot.className = 'slot';
      slot.querySelector('img')!.removeAttribute('src');
      slot.querySelector('b')!.textContent = '';
      slot.querySelector('.tier')!.textContent = '';
      slot.querySelector('.ed')!.textContent = '';
    }
  };

  const fill = (slot: HTMLElement, name: string, card: Card, url: string) => {
    slot.style.setProperty('--tier', card.tier.color);
    slot.querySelector('img')!.src = url;
    slot.querySelector('img')!.alt = `${name}: ${card.tier.label}`;
    slot.querySelector('b')!.textContent = name;
    slot.querySelector('.tier')!.textContent = `${card.tier.label} · ${pct(card.tier.odds)}`;
    slot.querySelector('.ed')!.textContent = edition(card);
  };

  async function show(a: string, b: string) {
    const id = ++run;
    names = [a, b];
    reset();
    if (!dialog.open) dialog.showModal();
    const cards = [rollCard(a), rollCard(b)] as const;
    slots.forEach((s, i) => { s.querySelector('b')!.textContent = names[i]!; });
    verdict.textContent = '포장을 뜯는 중…';

    // Render both stills first (they share the GPU), then stage the reveal.
    const rendered: string[] = [];
    for (let i = 0; i < 2; i++) rendered.push(await deps.still(names[i]!, cards[i]!));
    if (id !== run) { rendered.forEach((u) => URL.revokeObjectURL(u)); return; }
    urls = rendered;
    slots.forEach((s, i) => fill(s, names[i]!, cards[i]!, rendered[i]!));

    const step = reduced.matches ? 0 : 1;
    for (let i = 0; i < 2; i++) {
      const slot = slots[i]!;
      slot.classList.add('shaking');
      crinkle(0.6);
      await wait(step * (500 + cards[i]!.tier.rank * 320));
      if (id !== run) return;
      slot.classList.remove('shaking');
      slot.classList.add('revealed');
      chime(cards[i]!.tier.rank);
      await wait(step * 700);
      if (id !== run) return;
    }

    const result = compareCards(cards[0], cards[1]);
    if (result === 0) {
      verdict.textContent = '무승부 — 같은 이름은 같은 카드예요';
      verdict.classList.add('draw');
    } else {
      const winner = result === 1 ? 0 : 1;
      slots[winner]!.classList.add('win');
      slots[1 - winner]!.classList.add('lose');
      const why = cards[0].tier.rank === cards[1].tier.rank ? '같은 등급, 더 앞선 에디션 번호' : '더 높은 등급';
      verdict.textContent = `${names[winner]} 승리! (${why})`;
      verdict.style.setProperty('--tier', cards[winner]!.tier.color);
      verdict.classList.add('done');
    }
  }

  dialog.querySelector('#duelShare')!.addEventListener('click', () => deps.onShare(names[0], names[1]));
  dialog.querySelector('#duelClose')!.addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => {
    // `close` fires asynchronously; if a new duel already reopened the dialog, leave it running.
    if (dialog.open) return;
    run++;
    reset();
    deps.onClose();
  });
  // Clicking the backdrop closes the dialog.
  dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });

  return { show };
}
