// Connects weapon growth (src/progression) to play: which weapon is in hand,
// its grown stats, EXP on kills (exactly once per creature), and feeding
// materials / crafted items to it as one all-or-nothing transaction.
// No Three.js, no DOM, no randomness: the same actions give the same growth.

import { hashString, shortId } from '../core/rng';
import { isMaterialId, MATERIALS, type MaterialId } from '../items/materials';
import type { CraftedItem } from '../items/synthesis';
import type { Inventory } from '../items/inventory';
import type { Species } from '../sim/species';
import {
  addExp,
  canLimitBreak,
  evolvedName,
  feed,
  feedSourceOf,
  GrowthBook,
  growthStats,
  KILL_EXP,
  levelCap,
  limitBreak,
  limitBreakCost,
  weaponLineage,
  type GrowthStats,
  type ItemSource,
  type Lineage,
  type WeaponGrowth,
} from '../progression';

/**
 * The small sword the hero always carries. Used when no crafted weapon is equipped.
 * Its stats equal the old bare-hand defaults (attack 1.5, range 1.15), so at Lv1
 * combat is unchanged. It is not an inventory item: it cannot be crafted, fed or merged away.
 */
export const STARTER_WEAPON: CraftedItem = {
  id: shortId('ITM', hashString('ranvora:starter-sword')),
  name: '旅人の小剣',
  category: 'weapon',
  element: 'none',
  props: { hardness: 6, weight: 3, heat: 1, water: 0, magic: 1, elasticity: 2 },
  reactions: [],
  trait: null,
  stats: { attack: 1.5, range: 1.15 },
  color: '#b9c4cc',
  ingredients: ['iron', 'wood'],
  seed: 0,
};

export interface WeaponView {
  item: CraftedItem;
  growth: WeaponGrowth;
  name: string;
  stats: GrowthStats;
  lineage: Lineage;
  cap: number;
}

export interface KillReward {
  creatureId: string;
  exp: number;
  levels: number;
  view: WeaponView;
  /** Reached the cap with this kill (a limit break is now possible if materials are in hand). */
  reachedCap: boolean;
}

export class Arsenal {
  book = new GrowthBook();
  /** Creature ids already rewarded in the current world (the guard against double EXP). */
  private rewarded = new Set<string>();
  private listeners: (() => void)[] = [];

  constructor(private inventory: Inventory) {}

  onChange(fn: () => void) {
    this.listeners.push(fn);
  }
  private emit() {
    for (const l of this.listeners) l();
  }

  /** Called when a new world starts: creature ids restart, so the kill guard restarts too. */
  resetWorld() {
    this.rewarded.clear();
  }

  /** The weapon in hand: the equipped crafted weapon, else the starter sword. */
  current(): WeaponView {
    const equipped = this.inventory.get(this.inventory.equippedWeapon);
    const item = equipped && equipped.category === 'weapon' ? equipped : STARTER_WEAPON;
    return this.view(item);
  }

  view(item: CraftedItem): WeaponView {
    const growth = this.book.of(item);
    return { item, growth, name: evolvedName(item.name, growth), stats: growthStats(item, growth), lineage: weaponLineage(growth), cap: levelCap(growth) };
  }

  /** EXP for defeating a creature with the weapon in hand. Returns null if this creature was already rewarded. */
  rewardKill(creatureId: string, species: Species): KillReward | null {
    if (this.rewarded.has(creatureId)) return null;
    this.rewarded.add(creatureId);
    const v = this.current();
    const wasBelowCap = v.growth.level < v.cap;
    const r = addExp(v.growth, KILL_EXP[species]);
    this.emit();
    const view = this.current();
    return { creatureId, exp: r.gained, levels: r.levels, view, reachedCap: wasBelowCap && view.growth.level >= view.cap };
  }

  /**
   * Feeds `qty` of a material or a non-weapon crafted item to the weapon in hand.
   * All or nothing: growth is computed on a copy against a staged inventory; the real
   * inventory and growth change only if every step succeeds, and taken units are
   * restored if the inventory refuses one half-way.
   */
  feed(id: string, qty = 1): { ok: true; exp: number; levels: number; view: WeaponView } | { ok: false; reason: string } {
    const v = this.current();
    let source;
    try {
      source = feedSourceOf(id, this.inventory);
    } catch (e) {
      return { ok: false, reason: (e as Error).message };
    }
    if (!Number.isInteger(qty) || qty <= 0) return { ok: false, reason: '数が正しくありません' };
    if (this.inventory.count(id) < qty) return { ok: false, reason: `${source.name} が足りません（${this.inventory.count(id)}/${qty}）` };
    const draft = structuredClone(v.growth);
    let result;
    try {
      result = feed(draft, staged(this.inventory), { [id]: qty });
    } catch (e) {
      return { ok: false, reason: (e as Error).message };
    }
    const commit = this.takeAll([{ id, qty }]);
    if (!commit.ok) return commit;
    Object.assign(v.growth, draft);
    this.emit();
    return { ok: true, exp: result.exp, levels: result.levels, view: this.current() };
  }

  limitBreakCheck() {
    const v = this.current();
    return { cost: limitBreakCost(v.growth), ...canLimitBreak(v.growth, this.inventory) };
  }

  /** Limit break for the weapon in hand, all or nothing like feed(). */
  limitBreak(): { ok: true; cap: number; evolved: boolean; view: WeaponView } | { ok: false; reason: string } {
    const v = this.current();
    const chk = canLimitBreak(v.growth, this.inventory);
    if (!chk.ok) return { ok: false, reason: chk.reason ?? '突破できません' };
    const cost = limitBreakCost(v.growth)!;
    const draft = structuredClone(v.growth);
    const r = limitBreak(draft, staged(this.inventory));
    const commit = this.takeAll(cost);
    if (!commit.ok) return commit;
    Object.assign(v.growth, draft);
    this.emit();
    return { ok: true, cap: r.cap, evolved: r.evolved, view: this.current() };
  }

  /** Takes every unit or none: on a refusal, everything taken so far is given back. */
  private takeAll(list: { id: string; qty: number }[]): { ok: true } | { ok: false; reason: string } {
    const taken: string[] = [];
    const items = new Map<string, CraftedItem>();
    for (const { id } of list) {
      const it = this.inventory.get(id);
      if (it) items.set(id, it);
    }
    for (const { id, qty } of list) {
      for (let i = 0; i < qty; i++) {
        if (this.inventory.take(id)) {
          taken.push(id);
          continue;
        }
        for (const t of taken) {
          if (isMaterialId(t)) this.inventory.addMaterial(t as MaterialId);
          else if (items.has(t)) this.inventory.addItem(items.get(t)!);
        }
        return { ok: false, reason: `${isMaterialId(id) ? MATERIALS[id as MaterialId].name : (items.get(id)?.name ?? id)} を取り出せませんでした` };
      }
    }
    return { ok: true };
  }
}

/** An ItemSource that only counts takes; the real inventory is untouched. */
function staged(inv: Inventory): ItemSource {
  const used = new Map<string, number>();
  return {
    count: (id) => inv.count(id) - (used.get(id) ?? 0),
    take: (id) => {
      if (inv.count(id) - (used.get(id) ?? 0) <= 0) return false;
      used.set(id, (used.get(id) ?? 0) + 1);
      return true;
    },
    get: (id) => inv.get(id),
  };
}
