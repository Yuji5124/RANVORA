// Weapon growth: EXP, levels, limit breaks (caps 10/20/30/40), lineage absorption,
// evolution when one lineage passes 50% at a limit break, and weapon merging.
// Ported from ranvora-kit src/game/weapon.ts and adapted to RANVORA:
//  - a weapon is an existing CraftedItem (category 'weapon'); growth is a separate record keyed by its id
//  - no new ids, no randomness: growth is a pure function of what the player feeds it
//  - lineage (plant/mineral/aquatic/beast) replaces the kit's element; magic elements are untouched

import { isMaterialId } from '../items/materials';
import type { CraftedItem } from '../items/synthesis';
import { EVOLVED_PREFIX, GROWTH, LIMIT_BREAK, POINT_BONUS, STAGE_SUFFIX } from './config';
import {
  emptyPoints,
  feedSourceOfItem,
  feedSourceOfMaterial,
  lineageFromProps,
  LINEAGES,
  type FeedSource,
  type Lineage,
  type LineagePoints,
} from './lineage';

/** What growth needs from an inventory. The existing Inventory class fits as is. */
export interface ItemSource {
  count(id: string): number;
  take(id: string): boolean;
  get(id: string | null): CraftedItem | null;
}

export interface WeaponGrowth {
  /** The CraftedItem id this growth belongs to (e.g. ITM-BF7EAD). */
  itemId: string;
  /** Lineage the weapon was born with, from its synthesis properties. */
  innate: Lineage;
  level: number;
  /** EXP inside the current level. */
  exp: number;
  /** All EXP ever gained (used for merging). */
  totalExp: number;
  /** Limit-break stage 0..3. */
  limitBreak: number;
  points: LineagePoints;
  /** Evolved lineage and stage, or null while unevolved. */
  form: { lineage: Lineage; stage: number } | null;
}

export interface GrowthStats {
  attack: number;
  range: number;
  crit: number;
}

export function newGrowth(item: CraftedItem): WeaponGrowth {
  if (item.category !== 'weapon') throw new Error(`${item.name} は武器ではありません`);
  return { itemId: item.id, innate: lineageFromProps(item.props), level: 1, exp: 0, totalExp: 0, limitBreak: 0, points: emptyPoints(), form: null };
}

export const levelCap = (g: WeaponGrowth): number => GROWTH.caps[g.limitBreak];
export const expToNext = (level: number): number => Math.floor(GROWTH.expBase * level ** GROWTH.expPower);
/** The lineage that counts for bonuses: the evolved one, else the innate one. */
export const weaponLineage = (g: WeaponGrowth): Lineage => g.form?.lineage ?? g.innate;

/** Most absorbed lineage and its share. Ties go to the earlier one in LINEAGES (deterministic). */
export function dominant(g: WeaponGrowth): { lineage: Lineage | null; share: number } {
  let total = 0;
  for (const l of LINEAGES) total += g.points[l];
  if (total === 0) return { lineage: null, share: 0 };
  let best: Lineage = LINEAGES[0];
  for (const l of LINEAGES) if (g.points[l] > g.points[best]) best = l;
  return { lineage: best, share: g.points[best] / total };
}

/** Adds EXP up to the current cap. Returns what was gained and what overflowed. */
export function addExp(g: WeaponGrowth, amount: number): { gained: number; levels: number; wasted: number } {
  const start = g.level;
  let left = Math.max(0, Math.floor(amount));
  let gained = 0;
  while (left > 0 && g.level < levelCap(g)) {
    const take = Math.min(expToNext(g.level) - g.exp, left);
    g.exp += take;
    left -= take;
    gained += take;
    if (g.exp >= expToNext(g.level)) {
      g.exp = 0;
      g.level++;
    }
  }
  g.totalExp += gained;
  return { gained, levels: g.level - start, wasted: left };
}

/** Feed source for an inventory id: a base material or a non-weapon crafted item. */
export function feedSourceOf(id: string, inv: ItemSource): FeedSource {
  if (isMaterialId(id)) return feedSourceOfMaterial(id);
  const item = inv.get(id);
  if (!item) throw new Error(`見つかりません: ${id}`);
  if (item.category === 'weapon') throw new Error(`${item.name} は武器です。武器どうしは mergeWeapons で合成してください`);
  return feedSourceOfItem(item);
}

/** Feeds materials/items to a weapon. Same-lineage sources give 1.5x EXP. All or nothing. */
export function feed(g: WeaponGrowth, inv: ItemSource, amounts: Record<string, number>) {
  const sources: [FeedSource, number][] = [];
  for (const [id, qty] of Object.entries(amounts)) {
    if (qty <= 0) continue;
    const src = feedSourceOf(id, inv);
    if (inv.count(id) < qty) throw new Error(`${src.name} が足りません（${inv.count(id)}/${qty}）`);
    sources.push([src, qty]);
  }
  const lineage = weaponLineage(g);
  let exp = 0;
  for (const [src, qty] of sources) {
    exp += src.exp * qty * (src.lineage === lineage ? GROWTH.sameLineageBonus : 1);
    if (src.lineage) g.points[src.lineage] += src.points * qty;
    for (let i = 0; i < qty; i++) inv.take(src.id);
  }
  const r = addExp(g, exp);
  refreshForm(g);
  return { exp: Math.floor(exp), ...r };
}

/** Cost of the next limit break, or null at the last stage. */
export function limitBreakCost(g: WeaponGrowth): { id: string; qty: number }[] | null {
  if (g.limitBreak >= GROWTH.caps.length - 1) return null;
  const k = g.limitBreak + 1;
  const l = dominant(g).lineage ?? weaponLineage(g);
  return [
    { id: LIMIT_BREAK.catalyst, qty: k },
    { id: LIMIT_BREAK.lineageMaterial[l], qty: 2 * k },
  ];
}

export function canLimitBreak(g: WeaponGrowth, inv: ItemSource): { ok: boolean; reason?: string } {
  const cost = limitBreakCost(g);
  if (!cost) return { ok: false, reason: 'これ以上は突破できません' };
  if (g.level < levelCap(g)) return { ok: false, reason: `Lv${levelCap(g)} で突破できます` };
  for (const c of cost) if (inv.count(c.id) < c.qty) return { ok: false, reason: `${c.id} が足りません（${inv.count(c.id)}/${c.qty}）` };
  return { ok: true };
}

/** Limit break: raises the cap, and evolves when one lineage passes the share threshold. */
export function limitBreak(g: WeaponGrowth, inv: ItemSource) {
  const chk = canLimitBreak(g, inv);
  if (!chk.ok) throw new Error(chk.reason);
  for (const c of limitBreakCost(g)!) for (let i = 0; i < c.qty; i++) inv.take(c.id);
  const before = g.form ? { ...g.form } : null;
  g.limitBreak++;
  refreshForm(g);
  const evolved = !!g.form && (!before || before.lineage !== g.form.lineage || before.stage !== g.form.stage);
  return { cap: levelCap(g), evolved };
}

/** Evolution is decided only at limit breaks: stage = number of limit breaks. */
function refreshForm(g: WeaponGrowth) {
  if (g.limitBreak === 0) return;
  const d = dominant(g);
  if (d.lineage && d.share > GROWTH.evolveShare) g.form = { lineage: d.lineage, stage: g.limitBreak };
  else if (g.form) g.form = { lineage: g.form.lineage, stage: g.limitBreak };
}

export function evolvedName(itemName: string, g: WeaponGrowth): string {
  if (!g.form || g.form.stage === 0) return itemName;
  return `${EVOLVED_PREFIX[g.form.lineage]}${itemName}${STAGE_SUFFIX[g.form.stage]}`;
}

/** Final stats: the item's synthesized stats scaled by level, lineage points and evolution. */
export function growthStats(item: CraftedItem, g: WeaponGrowth): GrowthStats {
  const baseAttack = item.stats.attack ?? 1.5;
  const baseRange = item.stats.range ?? 1.15;
  let attackMul = 1 + GROWTH.growthPerLevel * (g.level - 1);
  let range = baseRange;
  let crit = GROWTH.baseCrit;
  for (const l of LINEAGES) {
    const b = POINT_BONUS[l];
    attackMul += (b.attackMul ?? 0) * g.points[l];
    range += (b.range ?? 0) * g.points[l];
    crit += (b.crit ?? 0) * g.points[l];
  }
  if (g.form && g.form.stage > 0) attackMul *= 1 + GROWTH.evolveBonus * g.form.stage;
  const r1 = (v: number) => Math.round(v * 10) / 10;
  return { attack: r1(baseAttack * attackMul), range: Math.round(range * 100) / 100, crit: Math.min(GROWTH.maxCrit, Math.round(crit * 1000) / 1000) };
}

/** Weapon merge: the fodder weapon's EXP (70%) and half its lineage points move into main. */
export function mergeWeapons(main: WeaponGrowth, fodder: WeaponGrowth, fodderItem: CraftedItem) {
  if (main.itemId === fodder.itemId) throw new Error('同じ武器どうしは合成できません');
  if (fodderItem.id !== fodder.itemId) throw new Error('素材の武器とその成長記録が一致しません');
  for (const l of LINEAGES) main.points[l] += Math.floor(fodder.points[l] * GROWTH.mergePointRate);
  const worth = fodder.totalExp + (fodderItem.stats.attack ?? 0) * GROWTH.mergeAttackValue;
  const r = addExp(main, worth * GROWTH.mergeExpRate);
  refreshForm(main);
  return r;
}
