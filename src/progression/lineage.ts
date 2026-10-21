// Lineage: the creature/material "family" axis (plant, mineral, aquatic, beast).
// This is a separate axis from the magic elements (fire/water/wind/thunder/earth)
// in src/items/synthesis.ts. Weapon evolution follows lineage; spells follow element.

import { MATERIALS, PROP_KEYS, type MaterialId, type Props } from '../items/materials';
import type { CraftedItem } from '../items/synthesis';

export const LINEAGES = ['flora', 'mineral', 'aqua', 'beast'] as const;
export type Lineage = (typeof LINEAGES)[number];

export const LINEAGE_LABELS: Record<Lineage, string> = {
  flora: '植物',
  mineral: '鉱物',
  aqua: '水生',
  beast: '獣',
};

export const LINEAGE_COLORS: Record<Lineage, string> = {
  flora: '#7fd36a',
  mineral: '#c9a46a',
  aqua: '#5ff2e2',
  beast: '#e0705a',
};

export type LineagePoints = Record<Lineage, number>;
export const emptyPoints = (): LineagePoints => ({ flora: 0, mineral: 0, aqua: 0, beast: 0 });

/** Lineage of each base material. Provisional: tune together with materials.ts. */
export const MATERIAL_LINEAGE: Record<MaterialId, Lineage> = {
  wood: 'flora',
  grass: 'flora',
  mushroom: 'flora',
  stone: 'mineral',
  iron: 'mineral',
  crystal: 'mineral',
  fire_stone: 'mineral',
  water_stone: 'aqua',
  slime_core: 'aqua',
  wind_feather: 'beast',
};

/**
 * Lineage leaning of anything described by the 6 synthesis properties.
 * This is the bridge between property-based synthesis and weapon growth:
 * a crafted item can be fed to a weapon and pushes it toward a lineage.
 * Provisional weights; returns the scores so callers can blend rather than pick.
 */
export function lineageScores(p: Props): LineagePoints {
  return {
    flora: p.elasticity * 0.45 + p.water * 0.25 + p.magic * 0.15 + Math.max(0, 5 - p.hardness) * 0.3,
    mineral: p.hardness * 0.55 + p.weight * 0.35 + p.heat * 0.1,
    aqua: p.water * 0.7 + p.magic * 0.2 + p.elasticity * 0.1,
    beast: p.elasticity * 0.3 + p.heat * 0.3 + p.weight * 0.2 + Math.max(0, 6 - p.water) * 0.2,
  };
}

export function lineageFromProps(p: Props): Lineage {
  const s = lineageScores(p);
  let best: Lineage = LINEAGES[0];
  for (const l of LINEAGES) if (s[l] > s[best]) best = l;
  return best;
}

/** Something that can be fed to a weapon: how much EXP it gives and which lineage it carries. */
export interface FeedSource {
  id: string;
  name: string;
  exp: number;
  lineage: Lineage | null;
  /** Lineage points absorbed by the weapon (drives evolution). */
  points: number;
}

/** EXP of a property set: richer, harder-to-get material gives more. */
export function propsExp(p: Props): number {
  let sum = 0;
  for (const k of PROP_KEYS) sum += p[k];
  return Math.round(10 + sum * 1.5);
}

export function feedSourceOfMaterial(id: MaterialId): FeedSource {
  const m = MATERIALS[id];
  return { id, name: m.name, exp: propsExp(m.props), lineage: MATERIAL_LINEAGE[id], points: 2 };
}

export function feedSourceOfItem(item: CraftedItem): FeedSource {
  // Crafted items are worth more than raw materials and carry more lineage.
  return { id: item.id, name: item.name, exp: Math.round(propsExp(item.props) * 1.6), lineage: lineageFromProps(item.props), points: 4 };
}
