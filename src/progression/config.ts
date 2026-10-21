// Tuning for weapon growth. All numbers live here; logic in weapon.ts has none.
// Ported from ranvora-kit (src/game/data.ts LEVEL) and rescaled to RANVORA's
// weapon stats (attack ~1.5-5, range in tiles).

import type { MaterialId } from '../items/materials';
import type { Species } from '../sim/species';
import type { Lineage } from './lineage';

export const GROWTH = {
  /** Level cap for each limit-break stage (0..3). */
  caps: [10, 20, 30, 40] as const,
  /** EXP to go from level L to L+1 = floor(expBase * L^expPower). */
  expBase: 12,
  expPower: 1.5,
  /** Base attack multiplier per level above 1. */
  growthPerLevel: 0.07,
  /** EXP multiplier when the fed source has the weapon's lineage. */
  sameLineageBonus: 1.5,
  /** Weapon merge: share of the fodder's total EXP / lineage points carried over. */
  mergeExpRate: 0.7,
  mergePointRate: 0.5,
  /** Fodder weapon's own worth: attack * this, added to its total EXP. */
  mergeAttackValue: 20,
  /** Evolution happens at a limit break when one lineage holds more than this share. */
  evolveShare: 0.5,
  /** Attack multiplier per evolution stage. */
  evolveBonus: 0.1,
  maxCrit: 0.5,
  baseCrit: 0.05,
};

/** Bonus per absorbed lineage point. Provisional. */
export const POINT_BONUS: Record<Lineage, { attackMul?: number; range?: number; crit?: number }> = {
  flora: { range: 0.003, attackMul: 0.001 },
  mineral: { attackMul: 0.004 },
  aqua: { attackMul: 0.002, range: 0.002 },
  beast: { attackMul: 0.0025, crit: 0.002 },
};

/**
 * Limit break k (1..3) costs `catalyst` x k and the lineage's material x 2k.
 * Provisional: uses existing materials until a tower-only catalyst exists (Phase 2).
 */
export const LIMIT_BREAK = {
  catalyst: 'crystal' as MaterialId,
  lineageMaterial: {
    flora: 'mushroom',
    mineral: 'iron',
    aqua: 'water_stone',
    beast: 'wind_feather',
  } as Record<Lineage, MaterialId>,
};

/** EXP the equipped weapon gains when the player defeats a creature. */
export const KILL_EXP: Record<Species, number> = {
  slime: 6,
  deer: 10,
  wolf: 24,
  mossling: 8,
  shardgolem: 32,
  driftjelly: 7,
  hornfang: 20,
};

/** Evolved name parts: "<prefix><item name><suffix>". */
export const EVOLVED_PREFIX: Record<Lineage, string> = {
  flora: '苔纏いの',
  mineral: '晶鍛えの',
  aqua: '水宿りの',
  beast: '牙憑きの',
};
export const STAGE_SUFFIX = ['', '', '・改', '・真'] as const;
