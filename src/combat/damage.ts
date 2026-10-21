// Shared damage formula. Deterministic: all randomness comes from the Rng passed in
// (use Rng.stream(seed, 'combat'), never Math.random).

import type { Rng } from '../core/rng';

export interface DamageInput {
  attack: number;
  /** Product of affinity multipliers (lineage x element). */
  multiplier?: number;
  defense?: number;
  /** Critical chance 0..1. */
  crit?: number;
  /** +/- spread around the base, e.g. 0.08 = 92%..108%. */
  spread?: number;
}

export interface DamageResult {
  damage: number;
  crit: boolean;
}

export const CRIT_MULTIPLIER = 1.6;
/** Damage never goes below this, so every hit counts. Tiles-scale HP (slime 3, wolf 10). */
export const MIN_DAMAGE = 0.5;

export function computeDamage(input: DamageInput, rng: Rng): DamageResult {
  const spread = input.spread ?? 0.08;
  // Two draws in a fixed order, always both: the stream position never depends on the outcome.
  const critRoll = rng.next();
  const spreadRoll = rng.next();
  const crit = critRoll < (input.crit ?? 0);
  const base = input.attack * (input.multiplier ?? 1) - (input.defense ?? 0) * 0.5;
  const value = base * (crit ? CRIT_MULTIPLIER : 1) * (1 - spread + spreadRoll * spread * 2);
  return { damage: Math.max(MIN_DAMAGE, Math.round(value * 10) / 10), crit };
}
