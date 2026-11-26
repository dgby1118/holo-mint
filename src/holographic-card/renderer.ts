import { clock, frameLoop, init, surface, type Gpu } from 'vgpu';
import { createScene, type Look } from './scene';

export interface RendererOptions {
  /** [holo-mint] Initial lettering mask (1024 × 1456, r8). Defaults to the baked Geist labels. */
  initialMask?: Uint8Array<ArrayBuffer>;
  /** [holo-mint] Sweep the light across the card while nobody is pointing at it. */
  attract?: boolean;
}

/** [holo-mint] Seconds of pointer inactivity before the attract sweep resumes. */
const ATTRACT_IDLE = 3.5;

export function createRenderer(canvas: HTMLCanvasElement, options: RendererOptions = {}) {
  let disposed = false;
  let gpu: Gpu | undefined;
  let removeInput = () => {};
  // [holo-mint] Lettering requested before the scene exists is applied once it does.
  let pendingMask: Uint8Array<ArrayBuffer> | undefined = options.initialMask;
  let writeMask: ((mask: Uint8Array<ArrayBuffer>) => void) | undefined;
  // [holo-mint] Look uniforms are merged into every frame's params.
  let look: Partial<Look> = {};

  // Input state lives out here so external sources (device tilt) can drive it too.
  let targetHover = 0;
  let pointerX = 0;
  let pointerY = 0;
  let idle = options.attract ? ATTRACT_IDLE : 0;

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    writeMask = undefined;
    removeInput();
    gpu?.dispose();
  };

  const setLettering = (mask: Uint8Array<ArrayBuffer>) => {
    if (disposed) return;
    if (writeMask) writeMask(mask);
    else pendingMask = mask;
  };

  const setLook = (partial: Partial<Look>) => { look = { ...look, ...partial }; };

  /** [holo-mint] Drive the light from outside pointer events, in card units (-1..1). */
  const setPointer = (x: number, y: number, strength = 1) => {
    pointerX = x;
    pointerY = y;
    targetHover = strength;
    idle = 0;
  };

  const ready = (async () => {
    const context = await init();
    if (disposed) { context.dispose(); return; }
    gpu = context;
    const output = surface(context, canvas, { dpr: [1, 2] });
    const { shader, setLettering: upload } = createScene(context, output, pendingMask);
    pendingMask = undefined;
    await shader.compile({ colors: [output.format] });
    if (disposed) return;
    writeMask = upload;
    if (pendingMask) { upload(pendingMask); pendingMask = undefined; }

    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let tiltX = 0;
    let tiltY = 0;
    let hover = 0;
    let lightX = 0.2;
    let lightY = -0.25;
    let attractTime = 0;
    const move = (event: PointerEvent) => {
      if (!event.isPrimary) return;
      idle = 0;
      const rect = canvas.getBoundingClientRect();
      const scale = Math.min(rect.height, rect.width * 1.35);
      // Match the shader's card coordinates and reveal the foil as the pointer approaches.
      pointerX = ((event.clientX - rect.left) - rect.width / 2) / Math.max(1, scale) * 2.5 / 0.64;
      pointerY = ((event.clientY - rect.top) - rect.height / 2) / Math.max(1, scale) * 2.5 / 0.91;
      const distanceX = Math.max(0, Math.abs(pointerX) - 1) * scale * 0.64 / 2.5;
      const distanceY = Math.max(0, Math.abs(pointerY) - 1) * scale * 0.91 / 2.5;
      // Begin revealing one full rendered card width beyond its edges.
      const approachDistance = Math.max(1, scale) * 1.28 / 2.5;
      const proximity = Math.max(0, 1 - Math.hypot(distanceX, distanceY) / approachDistance);
      targetHover = proximity * proximity * (3 - 2 * proximity);
    };
    const leave = () => { targetHover = 0; idle = 0; };
    const up = (event: PointerEvent) => { if (event.pointerType !== 'mouse') leave(); };
    canvas.addEventListener('pointermove', move, { passive: true });
    canvas.addEventListener('pointerdown', move, { passive: true });
    canvas.addEventListener('pointerleave', leave);
    canvas.addEventListener('pointercancel', leave);
    canvas.addEventListener('pointerup', up);
    const unsubscribeResize = output.onResize(() => {
      shader.set({ params: { resolution: output.size } });
    });
    removeInput = () => {
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerdown', move);
      canvas.removeEventListener('pointerleave', leave);
      canvas.removeEventListener('pointercancel', leave);
      canvas.removeEventListener('pointerup', up);
      unsubscribeResize();
    };

    const time = clock(context);
    frameLoop(context, (currentFrame) => {
      const dt = Math.min(time.deltaTime, 0.1);
      // [holo-mint] Attract mode: a slow figure-eight light path when the card is left alone.
      const attracting = !!options.attract && !motion.matches && targetHover === 0 && (idle += dt) >= ATTRACT_IDLE;
      if (attracting) {
        attractTime += dt;
        const t = attractTime * 0.55;
        pointerX = Math.sin(t) * 0.85;
        pointerY = Math.sin(t * 2) * 0.55;
      }
      const goal = attracting ? 0.7 : targetHover;
      const targetX = motion.matches ? 0 : Math.max(-1, Math.min(1, pointerX)) * 0.16 * goal;
      const targetY = motion.matches ? 0 : -Math.max(-1, Math.min(1, pointerY)) * 0.12 * goal;
      const blend = motion.matches ? 1 : 1 - Math.exp(-10 * dt);
      const slow = attracting ? 1 - Math.exp(-2.5 * dt) : blend;
      tiltX += (targetX - tiltX) * blend;
      tiltY += (targetY - tiltY) * blend;
      hover += (goal - hover) * slow;
      if (goal > 0) {
        lightX += (pointerX - lightX) * blend;
        lightY += (pointerY - lightY) * blend;
      }
      shader.set({ params: { tilt: [tiltX, tiltY], pointer: [lightX, lightY], hover, time: time.time, ...look } });
      currentFrame.pass(output, shader);
    }, { fps: 60 });
  })().catch((error: unknown) => {
    if (disposed) return;
    dispose();
    throw error;
  });

  return {
    ready, dispose, setLettering, setLook, setPointer,
    /** [holo-mint] The live GPU context, for offscreen exports. Undefined until ready or after dispose. */
    get context() { return disposed ? undefined : gpu; },
  };
}
