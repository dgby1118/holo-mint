import { effect, sampler, texture, type Gpu, type Target } from 'vgpu';
import { letteringPixels, letteringSize } from './lettering';
import fragment from './shader.wgsl';

export type Vec4 = [number, number, number, number];

/** [holo-mint] Per-card look uniforms (see Params in shader.wgsl). */
export interface Look {
  base: Vec4; ink: Vec4; foil: Vec4; palette: Vec4; pattern: Vec4; fx: Vec4; glow: Vec4;
}

/** These defaults reproduce the original example exactly: open wrapper, graphite, one triangle. */
export const DEFAULT_LOOK: Look & { time: number; output: Vec4 } = {
  time: 0,
  base: [0.062, 0.068, 0.078, 1],
  ink: [0.77, 0.79, 0.82, 1],
  foil: [1, 1, 1, 1],
  palette: [0.05, 0.38, 0.63, 1],
  pattern: [142, 0, 6, 1],
  fx: [1, 0, 0, 0],
  glow: [0, 0, 0, 0],
  output: [0, 0, 0, 0],
};

/**
 * Shared by the live canvas and deterministic gallery thumbnails.
 * [holo-mint] Returns the lettering upload alongside the shader so the app can
 * re-bake the card text at runtime. The texture keeps the original format/size.
 */
export function createScene(gpu: Gpu, output: Target, initialMask: Uint8Array<ArrayBuffer> = letteringPixels()) {
  const lettering = texture(gpu, {
    kind: '2d', size: letteringSize, format: 'r8unorm',
    usage: ['texture_binding', 'copy_dst'], label: 'geist-lettering',
  });
  const setLettering = (mask: Uint8Array<ArrayBuffer>) => {
    gpu.gpu.queue.writeTexture(
      { texture: lettering.gpu }, mask,
      { bytesPerRow: letteringSize[0] }, [...letteringSize, 1],
    );
  };
  setLettering(initialMask);
  const shader = effect(gpu, fragment, {
    label: 'holographic-card',
    set: {
      params: { resolution: output.size, tilt: [0, 0], pointer: [0.2, -0.25], hover: 0, ...DEFAULT_LOOK },
      lettering,
      linear: sampler(gpu, { minFilter: 'linear', magFilter: 'linear' }),
    },
  });
  // [holo-mint] Export scenes are short-lived, so they release their own resources.
  const dispose = () => { shader.dispose(); lettering.destroy(); };
  return { shader, setLettering, dispose };
}
