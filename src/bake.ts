import { letteringSize } from './holographic-card/lettering';

export interface CardText {
  brand: string;
  title: string;
  tagline: string;
  edition: string;
  mark: string;
}

const SANS = '"Geist", "Pretendard Variable", Pretendard, sans-serif';
const MONO = '"Geist Mono", "Pretendard Variable", monospace';

let ctx: CanvasRenderingContext2D | null = null;

/** Fit `text` inside `maxWidth` by shrinking the font size from `size` down. */
function fit(c: CanvasRenderingContext2D, text: string, weight: number, size: number, family: string, maxWidth: number) {
  let s = size;
  c.font = `${weight} ${s}px ${family}`;
  while (s > 18 && c.measureText(text).width > maxWidth) {
    s -= 2;
    c.font = `${weight} ${s}px ${family}`;
  }
}

/**
 * Runtime version of the example's tools/bake-lettering.js: same canvas size,
 * same positions, same (red × alpha) coverage rule — but with the user's text.
 */
export function bakeLettering(text: CardText): Uint8Array<ArrayBuffer> {
  const [width, height] = letteringSize;
  if (!ctx) {
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  }
  const c = ctx;
  c.clearRect(0, 0, width, height);
  c.textAlign = 'left';
  c.letterSpacing = '0px';
  const max = width - 78 * 2;

  c.fillStyle = '#fff';
  fit(c, text.brand, 500, 64, SANS, 520); c.fillText(text.brand, 78, 132);
  fit(c, text.title, 400, 64, SANS, max); c.fillText(text.title, 78, 1170);
  c.fillStyle = '#999';
  fit(c, text.tagline, 400, 30, SANS, max); c.fillText(text.tagline, 80, 1224);
  c.fillStyle = '#bbb'; c.letterSpacing = '4px';
  fit(c, text.edition.toUpperCase(), 400, 22, MONO, 420); c.fillText(text.edition.toUpperCase(), 80, 1360);
  c.textAlign = 'right';
  fit(c, text.mark.toUpperCase(), 400, 22, MONO, 420); c.fillText(text.mark.toUpperCase(), 944, 1360);

  const rgba = c.getImageData(0, 0, width, height).data;
  const mask = new Uint8Array(width * height);
  for (let i = 0, j = 0; j < mask.length; i += 4, j++) mask[j] = Math.round(rgba[i]! * rgba[i + 3]! / 255);
  return mask;
}

export async function fontsReady() {
  await Promise.allSettled([
    document.fonts.load(`500 64px ${SANS}`, '가A'),
    document.fonts.load(`400 64px ${SANS}`, '가A'),
    document.fonts.load(`400 24px ${MONO}`, 'A'),
  ]);
}
