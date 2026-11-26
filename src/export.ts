import { frame, target, type Gpu } from 'vgpu';
import { Muxer, ArrayBufferTarget } from 'mp4-muxer';
import { createScene, type Look, type Vec4 } from './holographic-card/scene';
import type { Card } from './rarity';

/** Offscreen renders of a revealed card, sharing the live renderer's GPU device. */

interface Pose { tilt: [number, number]; pointer: [number, number]; hover: number; time: number }

/** Common period of every time-driven term in shader.wgsl (frequencies are multiples of 0.55). */
const LOOP_PERIOD = (Math.PI * 2) / 0.55;

const STILL_POSE: Pose = { tilt: [0.05, -0.04], pointer: [0.3, -0.3], hover: 0.9, time: 1.2 };

function revealedLook(card: Card): Look {
  const { rim, orbit, ...look } = card.look;
  return { ...look, fx: [1, 0, rim, orbit], glow: [look.glow[0], look.glow[1], look.glow[2], 0] };
}

/** One offscreen scene + target; call `render` as often as needed, then `dispose`. */
function offscreen(gpu: Gpu, mask: Uint8Array<ArrayBuffer>, card: Card, size: [number, number], transparent: boolean) {
  // target() returns an OffscreenTarget, which owns destroy() (not on the Target interface).
  const out = target(gpu, { size, format: 'rgba8unorm', label: 'holo-export' }) as ReturnType<typeof target> & { destroy(): void };
  const scene = createScene(gpu, out, mask);
  const look = revealedLook(card);
  const output: Vec4 = [transparent ? 1 : 0, 0, 0, 0];
  return {
    async render(pose: Pose): Promise<Uint8Array> {
      scene.shader.set({ params: { resolution: size, ...pose, ...look, output } });
      frame(gpu, (f) => f.pass(out, scene.shader));
      return out.color.read({ mipLevel: 0, region: 'all' });
    },
    async compile() { await scene.shader.compile(out); },
    dispose() { scene.dispose(); out.destroy(); },
  };
}

/** Transparent PNG of the card, cropped to the card with a small margin. */
export async function exportPng(gpu: Gpu, mask: Uint8Array<ArrayBuffer>, card: Card): Promise<Blob> {
  const size: [number, number] = [1400, 1900];
  const scene = offscreen(gpu, mask, card, size, true);
  try {
    await scene.compile();
    const pixels = await scene.render(STILL_POSE);
    return await cropToPng(pixels, size[0], size[1], 28);
  } finally {
    scene.dispose();
  }
}

/** Render a still with background as an image URL (used by the duel screen). */
export async function renderStillUrl(gpu: Gpu, mask: Uint8Array<ArrayBuffer>, card: Card): Promise<string> {
  const size: [number, number] = [560, 760];
  const scene = offscreen(gpu, mask, card, size, true);
  try {
    await scene.compile();
    const pixels = await scene.render(STILL_POSE);
    return URL.createObjectURL(await cropToPng(pixels, size[0], size[1], 12));
  } finally {
    scene.dispose();
  }
}

async function cropToPng(pixels: Uint8Array, width: number, height: number, pad: number): Promise<Blob> {
  let x0 = width, y0 = height, x1 = 0, y1 = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (pixels[(y * width + x) * 4 + 3]! > 2) {
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < x0) { x0 = 0; y0 = 0; x1 = width - 1; y1 = height - 1; }
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad);
  x1 = Math.min(width - 1, x1 + pad); y1 = Math.min(height - 1, y1 + pad);
  const full = new ImageData(new Uint8ClampedArray(pixels), width, height);
  const canvas = document.createElement('canvas');
  canvas.width = x1 - x0 + 1;
  canvas.height = y1 - y0 + 1;
  canvas.getContext('2d')!.putImageData(full, -x0, -y0);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG encoding failed'))), 'image/png'));
}

export const videoSupported = () => typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined';

/**
 * Seamless 4-second loop: the light circles the card once while it rocks in 3D.
 * Encoded frame-by-frame with WebCodecs (exact timing, no screen recording) into MP4/H.264.
 */
export async function exportVideo(
  gpu: Gpu, mask: Uint8Array<ArrayBuffer>, card: Card,
  onProgress: (fraction: number) => void,
): Promise<Blob> {
  const size: [number, number] = [720, 960];
  const fps = 30;
  const seconds = 4;
  const total = fps * seconds;

  const config: VideoEncoderConfig = {
    codec: 'avc1.4d0028', width: size[0], height: size[1], bitrate: 8_000_000, framerate: fps,
  };
  if (!(await VideoEncoder.isConfigSupported(config)).supported) config.codec = 'avc1.42001f';
  if (!(await VideoEncoder.isConfigSupported(config)).supported) throw new Error('H.264 encoding is not supported here');

  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: 'avc', width: size[0], height: size[1], frameRate: fps },
    fastStart: 'in-memory',
  });
  let failure: unknown;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => { failure = e; },
  });
  encoder.configure(config);

  const scene = offscreen(gpu, mask, card, size, false);
  try {
    await scene.compile();
    for (let i = 0; i < total; i++) {
      if (failure) throw failure;
      const a = (i / total) * Math.PI * 2;
      const pixels = await scene.render({
        tilt: [Math.sin(a) * 0.17, Math.cos(a) * 0.12],
        pointer: [Math.sin(a) * 0.95, -Math.cos(a) * 0.7],
        hover: 0.9,
        // Shader animation shares a 2π/0.55 period, so the rim light and orbit line up at the seam.
        time: (i / total) * LOOP_PERIOD,
      });
      const videoFrame = new VideoFrame(pixels, {
        format: 'RGBA', codedWidth: size[0], codedHeight: size[1],
        timestamp: Math.round((i * 1_000_000) / fps), duration: Math.round(1_000_000 / fps),
      });
      encoder.encode(videoFrame, { keyFrame: i % fps === 0 });
      videoFrame.close();
      // Keep the encoder queue short so memory stays flat.
      while (encoder.encodeQueueSize > 4) await new Promise((r) => setTimeout(r, 4));
      onProgress((i + 1) / total);
    }
    await encoder.flush();
    if (failure) throw failure;
    muxer.finalize();
    return new Blob([muxer.target.buffer], { type: 'video/mp4' });
  } finally {
    if (encoder.state !== 'closed') encoder.close();
    scene.dispose();
  }
}

export function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
