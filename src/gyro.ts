/** Device tilt → light position, for phones and tablets. */
type OrientationCtor = typeof DeviceOrientationEvent & { requestPermission?: () => Promise<'granted' | 'denied'> };

export const gyroSupported = () =>
  typeof window !== 'undefined' && 'DeviceOrientationEvent' in window && matchMedia('(pointer: coarse)').matches;

/** iOS needs an explicit permission tap; Android starts right away. */
export const gyroNeedsPermission = () =>
  typeof (window.DeviceOrientationEvent as OrientationCtor | undefined)?.requestPermission === 'function';

const clamp = (v: number) => Math.max(-1.2, Math.min(1.2, v));

/** Must be called from a user gesture on iOS. Resolves to a stop function. */
export async function startGyro(onTilt: (x: number, y: number) => void): Promise<() => void> {
  const ctor = window.DeviceOrientationEvent as OrientationCtor;
  if (typeof ctor.requestPermission === 'function') {
    const state = await ctor.requestPermission();
    if (state !== 'granted') throw new Error('Motion permission denied');
  }
  let restBeta: number | undefined;
  const handle = (event: DeviceOrientationEvent) => {
    if (event.beta == null || event.gamma == null) return;
    // Treat however the phone was held at first as "flat", then follow changes.
    restBeta ??= Math.max(20, Math.min(70, event.beta));
    onTilt(clamp(event.gamma / 22), clamp((event.beta - restBeta) / 22));
  };
  addEventListener('deviceorientation', handle);
  return () => removeEventListener('deviceorientation', handle);
}
