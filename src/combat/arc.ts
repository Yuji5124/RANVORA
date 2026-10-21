// Fan-shaped (sector) hit test on the XZ plane, in RANVORA's 0 = +X convention.

import { dirTo, wrapAngle } from './facing';

export interface ArcShape {
  /** Reach from the attacker's centre, in tiles. */
  range: number;
  /** Full opening angle in radians (e.g. 120 deg = 2.094). */
  arc: number;
}

/**
 * True when a target circle (tx, tz, targetRadius) is inside the attacker's sector.
 * The target's radius widens both the reach and the angle, so large creatures are
 * hit at the edge of the fan the same way a player would expect.
 */
export function inArc(ax: number, az: number, dir: number, tx: number, tz: number, shape: ArcShape, targetRadius = 0): boolean {
  const d = Math.hypot(tx - ax, tz - az);
  if (d > shape.range + targetRadius) return false;
  if (d <= targetRadius) return true;
  const off = Math.abs(wrapAngle(dirTo(ax, az, tx, tz) - dir));
  return off <= shape.arc / 2 + Math.atan2(targetRadius, d);
}

/** Shapes ported from ranvora-kit (sword 120 deg, staff 160 deg), reach scaled to tiles. */
export const ATTACK_ARCS = {
  sword: { range: 1.15, arc: (120 * Math.PI) / 180 },
  staff: { range: 1.4, arc: (160 * Math.PI) / 180 },
} satisfies Record<string, ArcShape>;
