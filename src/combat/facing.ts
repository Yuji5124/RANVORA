// Direction conventions. RANVORA uses 0 = +X, PI/2 = +Z (same as Player.dir);
// forward vector = (cos dir, sin dir). Code from other conventions is converted
// here, once, at the boundary.
//
// ranvora-kit (and its Blender exports) uses "0 = +Z, angle = atan2(dx, dz)",
// i.e. forward = (sin f, cos f). Both describe the same direction when
// dir = PI/2 - f.

const TAU = Math.PI * 2;

/** Wraps an angle to (-PI, PI]. */
export function wrapAngle(a: number): number {
  const w = a - TAU * Math.floor((a + Math.PI) / TAU);
  return w === -Math.PI ? Math.PI : w;
}

/** ranvora-kit facing (0 = +Z) -> RANVORA dir (0 = +X). */
export function fromKitFacing(kitFacing: number): number {
  return wrapAngle(Math.PI / 2 - kitFacing);
}

/** RANVORA dir (0 = +X) -> ranvora-kit facing (0 = +Z). */
export function toKitFacing(dir: number): number {
  return wrapAngle(Math.PI / 2 - dir);
}

/** Unit forward vector for a RANVORA dir. */
export function forwardOf(dir: number): { x: number; z: number } {
  return { x: Math.cos(dir), z: Math.sin(dir) };
}

/** RANVORA dir pointing from (ax, az) to (bx, bz). */
export function dirTo(ax: number, az: number, bx: number, bz: number): number {
  return Math.atan2(bz - az, bx - ax);
}
