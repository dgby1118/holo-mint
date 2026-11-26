import { createRenderer } from './holographic-card/renderer';
import { bakeLettering, fontsReady, type CardText } from './bake';
import { rollCard, normalizeName, TIERS, type Card, type TierId } from './rarity';
import { createOpening, type Phase } from './opening';
import { isMuted, setMuted } from './audio';
import { gyroNeedsPermission, gyroSupported, startGyro } from './gyro';
import { download, exportPng, exportVideo, renderStillUrl, videoSupported } from './export';
import { createDuel } from './duel';

interface CardState { brand: string; title: string; tagline: string; mark: string }

const DEFAULTS: CardState = { brand: 'holo', title: 'Holographic', tagline: 'Light, computed.', mark: 'WebGPU' };
const RANDOM_NAMES = [
  '오로라', '은하수', 'Nova', '고양이 대장', 'Lumen', '새벽 세시', 'Prism', '반짝이', 'Orbit', '첫눈',
  'Mirage', '민트초코', 'Nebula', '달토끼', 'Halo', '파도', 'Zenith', '유성우', 'Echo', '봄날',
  'Comet', '무지개', 'Vega', '불꽃놀이', 'Iris', '별똥별', 'Polaris', '여름밤', 'Aurora', '솜사탕',
];
const MATERIAL_KO: Record<string, string> = {
  graphite: '그라파이트', midnight: '미드나잇', moss: '모스', oxblood: '옥스블러드',
  pearl: '펄 실버', 'obsidian gold': '옵시디언 골드', prismatic: '프리즈매틱',
};
const SHAPE_KO = { triangle: '삼각 프랙탈', inverted: '역삼각 프랙탈', hexagram: '헥사그램' } as const;

const pad = (n: number) => String(n).padStart(3, '0');
const $ = <T extends Element>(sel: string) => document.querySelector<T>(sel)!;
const canvas = $<HTMLCanvasElement>('#card');
const form = $<HTMLFormElement>('#form');
const status = $<HTMLSpanElement>('#status');
const serial = $<HTMLDivElement>('#serial');
const hint = $<HTMLParagraphElement>('#hint');
const badge = $<HTMLDivElement>('#badge');
const openBtn = $<HTMLButtonElement>('#open');
const result = $<HTMLElement>('#result');

const tierStyle = (el: HTMLElement, id: TierId) => {
  const tier = TIERS.find((t) => t.id === id)!;
  el.style.setProperty('--tier', tier.color);
  el.dataset.tier = id;
};
const serialText = (card: Card) => (card.tier.id === 'mythic' ? 'NO. 1 / 1' : `NO. ${pad(card.edition)} / 999`);

/** Card text lives in the URL hash, so a card can be shared as a link. */
function readHash(): CardState {
  const p = new URLSearchParams(location.hash.slice(1));
  return {
    brand: p.get('b') ?? DEFAULTS.brand,
    title: p.get('t') ?? DEFAULTS.title,
    tagline: p.get('l') ?? DEFAULTS.tagline,
    mark: p.get('m') ?? DEFAULTS.mark,
  };
}
function writeHash(s: CardState) {
  const p = new URLSearchParams({ b: s.brand, t: s.title, l: s.tagline, m: s.mark });
  history.replaceState(null, '', `#${p}`);
}
function readForm(): CardState {
  const d = new FormData(form);
  return {
    brand: String(d.get('brand') ?? ''), title: String(d.get('title') ?? ''),
    tagline: String(d.get('tagline') ?? ''), mark: String(d.get('mark') ?? ''),
  };
}
function fillForm(s: CardState) {
  for (const [key, value] of Object.entries(s)) (form.elements.namedItem(key) as HTMLInputElement).value = value;
}
const toText = (s: CardState, card: Card): CardText => ({
  brand: s.brand, title: s.title, tagline: s.tagline,
  edition: card.tier.id === 'mythic' ? 'One of one' : `Edition ${pad(card.edition)}`,
  mark: s.mark,
});

// --- Collection (per browser) ---------------------------------------------------
interface Pull { name: string; tier: TierId }
const DEX_KEY = 'holo-mint:dex';
function loadDex(): Pull[] {
  try { return JSON.parse(localStorage.getItem(DEX_KEY) ?? '[]') as Pull[]; } catch { return []; }
}
let dex = loadDex();
function saveDex() { try { localStorage.setItem(DEX_KEY, JSON.stringify(dex.slice(0, 60))); } catch { /* unavailable */ } }
function renderDex() {
  const list = $<HTMLUListElement>('#dexList');
  list.replaceChildren(...dex.slice(0, 24).map((pull) => {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    const label = document.createElement('span');
    label.textContent = pull.name || '(이름 없음)';
    btn.append(label);
    btn.title = `${TIERS.find((t) => t.id === pull.tier)!.label} — 다시 보기`;
    tierStyle(btn, pull.tier);
    btn.addEventListener('click', () => { state = { ...state, title: pull.name }; fillForm(state); apply(); });
    li.append(btn);
    return li;
  }));
  const best = dex.reduce((top, p) => Math.max(top, TIERS.findIndex((t) => t.id === p.tier)), -1);
  $('#dexStats').textContent = dex.length
    ? `${dex.length}장 · 최고 ${TIERS[best]!.ko}`
    : '아직 개봉한 카드가 없어요';
}
function record(name: string, card: Card) {
  const key = normalizeName(name);
  dex = [{ name: name.trim(), tier: card.tier.id }, ...dex.filter((p) => normalizeName(p.name) !== key)];
  saveDex();
  renderDex();
}

$('#oddsList').replaceChildren(...[...TIERS].reverse().map((tier) => {
  const li = document.createElement('li');
  li.style.setProperty('--tier', tier.color);
  li.innerHTML = `<span></span><span>${(tier.odds * 100).toLocaleString('ko-KR', { maximumFractionDigits: 1 })}%</span>`;
  li.firstElementChild!.textContent = `${tier.label} · ${tier.ko}`;
  return li;
}));

// --- WebGPU card: the vgpu example renderer -------------------------------------
let state = readHash();
let card = rollCard(state.title);
fillForm(state);

const renderer = createRenderer(canvas, { attract: true });
renderer.ready
  .then(() => { status.textContent = 'WebGPU · live'; })
  .catch((cause: unknown) => {
    console.error('Holographic card initialization failed:', cause);
    status.textContent = 'WebGPU 미지원 브라우저';
    status.classList.add('err');
    hint.textContent = '이 페이지는 WebGPU를 지원하는 브라우저(최신 Chrome·Edge·Safari)가 필요합니다.';
  });

const HINTS: Record<Phase, string> = {
  sealed: 'DRAG DOWN TO TEAR ↓',
  dragging: 'KEEP PULLING…',
  opening: '',
  open: 'MOVE TO REVEAL',
};
const opening = createOpening(canvas, renderer, {
  onPhase(phase) {
    if (!status.classList.contains('err')) hint.textContent = HINTS[phase];
    const isOpen = phase === 'open';
    openBtn.textContent = isOpen ? '다시 포장하기' : '개봉하기';
    openBtn.dataset.state = isOpen ? 'open' : 'sealed';
    openBtn.disabled = phase === 'opening';
    if (!isOpen) {
      badge.classList.remove('show');
      serial.textContent = 'NO. ??? / 999';
      result.hidden = true;
    }
  },
  onReveal(revealed) {
    const tier = revealed.tier;
    tierStyle(badge, tier.id);
    badge.innerHTML = '<span></span><i></i>';
    badge.querySelector('span')!.textContent = tier.label;
    badge.querySelector('i')!.textContent = `${(tier.odds * 100).toLocaleString('ko-KR', { maximumFractionDigits: 1 })}%`;
    badge.classList.add('show');
    serial.textContent = serialText(revealed);
    tierStyle(result, tier.id);
    $('#resultTier').innerHTML = '';
    $('#resultTier').append(tier.label, Object.assign(document.createElement('small'), { textContent: tier.ko }));
    $('#resultMaterial').textContent = MATERIAL_KO[revealed.material] ?? revealed.material;
    $('#resultShape').textContent = SHAPE_KO[revealed.shape];
    $('#resultEdition').textContent = serialText(revealed).replace('NO. ', '');
    result.hidden = false;
    record(state.title, revealed);
  },
});
opening.setCard(card);

// Same role as the example's React effect cleanup: release everything when the page goes away.
const teardown = () => { opening.dispose(); renderer.dispose(); stopGyro?.(); };
addEventListener('pagehide', teardown, { once: true });
if (import.meta.hot) import.meta.hot.dispose(teardown);

// Bake once fonts are in, then re-bake on every edit (coalesced to one per frame).
let queued = 0;
let mask: Uint8Array<ArrayBuffer> | undefined;
function apply() {
  card = rollCard(state.title);
  opening.setCard(card);
  cancelAnimationFrame(queued);
  queued = requestAnimationFrame(() => {
    mask = bakeLettering(toText(state, card));
    renderer.setLettering(mask);
    writeHash(state);
  });
}
const fontsLoaded = fontsReady().then(apply);

form.addEventListener('input', () => { state = readForm(); apply(); });
form.addEventListener('submit', (e) => { e.preventDefault(); opening.open(); });

$('#chips').addEventListener('click', (e) => {
  const btn = (e.target as Element).closest('button');
  if (!btn) return;
  state = { ...state, tagline: btn.textContent ?? '' };
  fillForm(state);
  apply();
});

openBtn.addEventListener('click', () => {
  if (opening.phase === 'open') opening.reseal();
  else opening.open();
});
canvas.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); opening.open(); }
});

$('#random').addEventListener('click', () => {
  let name = state.title;
  while (normalizeName(name) === normalizeName(state.title)) name = RANDOM_NAMES[Math.floor(Math.random() * RANDOM_NAMES.length)]!;
  state = { ...state, title: name };
  fillForm(state);
  apply();
});

// --- Toast + share ----------------------------------------------------------------
const toast = Object.assign(document.createElement('div'), { className: 'toast', role: 'status' });
document.body.append(toast);
let toastTimer = 0;
function say(msg: string) {
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove('show'), 2000);
}
$('#share').addEventListener('click', async () => {
  writeHash(state);
  try {
    await navigator.clipboard.writeText(location.href);
    say('링크를 복사했어요 — 받는 사람도 같은 카드를 개봉하게 됩니다');
  } catch {
    say('주소창의 링크를 복사해 공유하세요');
  }
});

// --- Sound + device tilt ------------------------------------------------------------
const soundBtn = $<HTMLButtonElement>('#sound');
const syncSound = () => {
  soundBtn.textContent = isMuted() ? '소리 꺼짐' : '소리 켜짐';
  soundBtn.setAttribute('aria-pressed', String(!isMuted()));
};
syncSound();
soundBtn.addEventListener('click', () => { setMuted(!isMuted()); syncSound(); });

let stopGyro: (() => void) | undefined;
const gyroBtn = $<HTMLButtonElement>('#gyro');
const enableGyro = async () => {
  try {
    stopGyro = await startGyro((x, y) => renderer.setPointer(x, y, 1));
    gyroBtn.hidden = true;
  } catch {
    say('기기 움직임 권한이 없어 기울이기를 쓸 수 없어요');
  }
};
if (gyroSupported()) {
  if (gyroNeedsPermission()) {
    gyroBtn.hidden = false;
    gyroBtn.addEventListener('click', () => void enableGyro());
  } else {
    void enableGyro();
  }
}

// --- Export: PNG + MP4 --------------------------------------------------------------
const fileBase = () => `holo-mint-${(state.title.trim() || 'card').replace(/[\\/:*?"<>|\s]+/g, '-')}-${card.tier.id}`;
const savePng = $<HTMLButtonElement>('#savePng');
const saveVideo = $<HTMLButtonElement>('#saveVideo');
let exporting = false;
async function runExport(button: HTMLButtonElement, label: string, job: () => Promise<void>) {
  const gpu = renderer.context;
  if (exporting || !gpu || !mask) return;
  exporting = true;
  savePng.disabled = saveVideo.disabled = true;
  try {
    await job();
  } catch (error) {
    console.error('Export failed:', error);
    say('저장하지 못했어요. 다른 브라우저에서 다시 시도해 주세요');
  } finally {
    exporting = false;
    savePng.disabled = false;
    saveVideo.disabled = !videoSupported();
    button.textContent = label;
  }
}
savePng.addEventListener('click', () => void runExport(savePng, 'PNG 저장', async () => {
  savePng.textContent = '만드는 중…';
  download(await exportPng(renderer.context!, mask!, card), `${fileBase()}.png`);
  say('투명 배경 PNG를 저장했어요');
}));
if (!videoSupported()) { saveVideo.disabled = true; saveVideo.title = '이 브라우저는 영상 인코딩(WebCodecs)을 지원하지 않아요'; }
saveVideo.addEventListener('click', () => void runExport(saveVideo, '영상 저장 · MP4', async () => {
  const blob = await exportVideo(renderer.context!, mask!, card, (f) => {
    saveVideo.textContent = `만드는 중 ${Math.round(f * 100)}%`;
  });
  download(blob, `${fileBase()}.mp4`);
  say('4초 루프 영상을 저장했어요');
}));

// --- Duel ---------------------------------------------------------------------------
const duelLink = (a: string, b: string) => {
  const p = new URLSearchParams({ b: state.brand, t: a, l: state.tagline, m: state.mark, vs: b });
  return `${location.origin}${location.pathname}#${p}`;
};
const duel = createDuel($<HTMLDialogElement>('#duel'), {
  async still(name, rolled) {
    const gpu = renderer.context;
    if (!gpu) throw new Error('WebGPU is not ready');
    return renderStillUrl(gpu, bakeLettering(toText({ ...state, title: name }, rolled)), rolled);
  },
  async onShare(a, b) {
    try {
      await navigator.clipboard.writeText(duelLink(a, b));
      say('듀얼 링크를 복사했어요 — 친구도 같은 결과를 보게 됩니다');
    } catch {
      say('링크를 복사하지 못했어요');
    }
  },
  onClose() { writeHash(state); },
});
const startDuel = async (rival: string) => {
  await renderer.ready;
  await fontsLoaded;
  void duel.show(state.title, rival).catch((error: unknown) => console.error('Duel failed:', error));
};
$<HTMLFormElement>('#duelForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = (e.currentTarget as HTMLFormElement).elements.namedItem('rival') as HTMLInputElement;
  let rival = input.value.trim();
  while (!rival || normalizeName(rival) === normalizeName(state.title)) {
    rival = RANDOM_NAMES[Math.floor(Math.random() * RANDOM_NAMES.length)]!;
    if (input.value.trim() && normalizeName(input.value) === normalizeName(state.title)) { say('같은 이름끼리는 무승부예요 — 랜덤 상대를 골랐어요'); }
  }
  input.value = rival;
  void startDuel(rival);
});
// A shared duel link (#…&vs=name) opens straight into the duel.
const sharedRival = new URLSearchParams(location.hash.slice(1)).get('vs');
if (sharedRival) void startDuel(sharedRival);

addEventListener('hashchange', () => {
  const rival = new URLSearchParams(location.hash.slice(1)).get('vs');
  state = readHash();
  fillForm(state);
  apply();
  if (rival) void startDuel(rival);
});
renderDex();
