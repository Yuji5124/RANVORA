// Affinities. Two independent tables:
//  - lineage vs lineage (weapon's evolved lineage vs the target's lineage), from ranvora-kit
//  - magic element vs lineage (spells), provisional
// The final multiplier is the product, so the two axes combine without replacing each other.

import type { Element } from '../items/synthesis';
import type { Species } from '../sim/species';
import type { Lineage } from '../progression/lineage';

export const ADVANTAGE = 1.5;
export const DISADVANTAGE = 0.75;

/** Plants drink water -> water erodes stone -> stone breaks fangs -> beasts eat plants. */
export const LINEAGE_BEATS: Record<Lineage, Lineage> = {
  flora: 'aqua',
  aqua: 'mineral',
  mineral: 'beast',
  beast: 'flora',
};

export function lineageMultiplier(attacker: Lineage | null, defender: Lineage | null): number {
  if (!attacker || !defender) return 1;
  if (LINEAGE_BEATS[attacker] === defender) return ADVANTAGE;
  if (LINEAGE_BEATS[defender] === attacker) return DISADVANTAGE;
  return 1;
}

/** Magic element vs lineage. Provisional: only clear cases, everything else 1. */
export const ELEMENT_VS_LINEAGE: Partial<Record<Element, Partial<Record<Lineage, number>>>> = {
  fire: { flora: 1.5, aqua: 0.75 },
  thunder: { aqua: 1.5, mineral: 0.75 },
  water: { mineral: 1.25 },
};

export function elementMultiplier(element: Element | null, defender: Lineage | null): number {
  if (!element || !defender) return 1;
  return ELEMENT_VS_LINEAGE[element]?.[defender] ?? 1;
}

/** Lineage of the existing species. Read-only mapping: src/sim is not changed. */
export const SPECIES_LINEAGE: Record<Species, Lineage> = {
  slime: 'aqua',
  deer: 'beast',
  wolf: 'beast',
};
