// Data-driven drop rolls. Deterministic for a given Rng stream.
// The existing creature drops in src/sim/simulation.ts (damageCreature) are unchanged;
// this is the shared roller for new drop sources (Phase 2 monsters, chests, events).

import type { Rng } from '../core/rng';

export interface DropEntry {
  id: string;
  /** 0..1 */
  chance: number;
  min: number;
  max: number;
}
export type DropTable = readonly DropEntry[];

/**
 * Rolls a table. Every entry always consumes exactly two numbers from the stream
 * (chance, then amount), in table order, so one entry's outcome never shifts the next.
 * `luck` scales chances (0 = none, 0.5 = +50%).
 */
export function rollDrops(table: DropTable, rng: Rng, luck = 0): Record<string, number> {
  const out: Record<string, number> = {};
  for (const e of table) {
    const hit = rng.next() < Math.min(1, e.chance * (1 + luck));
    const n = e.min + Math.floor(rng.next() * (e.max - e.min + 1));
    if (hit && n > 0) out[e.id] = (out[e.id] ?? 0) + n;
  }
  return out;
}
