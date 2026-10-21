// Weapon growth. The first 8 tests are ranvora-kit's test/game.test.ts adapted to
// RANVORA (existing materials, crafted weapons, lineage instead of the kit's element).

import { describe, expect, it } from 'vitest';
import { Inventory } from '../../src/items/inventory';
import { MATERIALS, isMaterialId, type MaterialId } from '../../src/items/materials';
import { materialIngredient, synthesize, type CraftedItem } from '../../src/items/synthesis';
import { SPECIES_IDS } from '../../src/sim/species';
import {
  addExp,
  canLimitBreak,
  dominant,
  evolvedName,
  expToNext,
  feed,
  feedSourceOfMaterial,
  GROWTH,
  GrowthBook,
  growthStats,
  KILL_EXP,
  levelCap,
  limitBreak,
  LIMIT_BREAK,
  LINEAGES,
  MATERIAL_LINEAGE,
  mergeWeapons,
  newGrowth,
  weaponLineage,
} from '../../src/progression';

const SEED = 12345;
/** A mineral-leaning weapon from the existing property-based synthesis (堅牢な岩槌). */
const hammer = (): CraftedItem => synthesize(materialIngredient('wood'), materialIngredient('iron'), SEED);
function invWith(stock: Partial<Record<MaterialId, number>>, items: CraftedItem[] = []) {
  const inv = new Inventory();
  for (const [id, n] of Object.entries(stock)) inv.addMaterial(id as MaterialId, n);
  for (const it of items) inv.addItem(it);
  return inv;
}

describe('weapon growth (ported kit tests)', () => {
  it('1. every referenced id exists in RANVORA data', () => {
    for (const id of Object.keys(MATERIAL_LINEAGE)) expect(isMaterialId(id), id).toBe(true);
    expect(isMaterialId(LIMIT_BREAK.catalyst)).toBe(true);
    for (const l of LINEAGES) expect(isMaterialId(LIMIT_BREAK.lineageMaterial[l])).toBe(true);
    for (const s of SPECIES_IDS) expect(KILL_EXP[s]).toBeGreaterThan(0);
    expect(Object.keys(MATERIAL_LINEAGE).sort()).toEqual(Object.keys(MATERIALS).sort());
  });

  it('2. EXP curve and the Lv10 cap before any limit break', () => {
    expect(expToNext(1)).toBe(12);
    expect(expToNext(9)).toBe(Math.floor(12 * 9 ** 1.5));
    const g = newGrowth(hammer());
    const r = addExp(g, 1e9);
    expect(g.level).toBe(10);
    expect(levelCap(g)).toBe(10);
    expect(r.wasted).toBeGreaterThan(0);
    expect(g.totalExp).toBe(r.gained);
  });

  it('3. same-lineage sources give 1.5x EXP and lineage points are absorbed', () => {
    const w = hammer();
    const g = newGrowth(w);
    expect(weaponLineage(g)).toBe('mineral');
    const inv = invWith({ iron: 2, grass: 2 });
    const a = feed(g, inv, { iron: 2 });
    expect(a.exp).toBe(Math.floor(feedSourceOfMaterial('iron').exp * 2 * 1.5));
    const b = feed(g, inv, { grass: 2 });
    expect(b.exp).toBe(feedSourceOfMaterial('grass').exp * 2);
    expect(g.points.mineral).toBe(4);
    expect(g.points.flora).toBe(4);
    expect(inv.count('iron')).toBe(0);
    expect(() => feed(g, inv, { grass: 1 })).toThrow(/足りません/);
  });

  it('4. limit break raises the cap and evolves toward the dominant lineage', () => {
    const g = newGrowth(hammer());
    const inv = invWith({ wind_feather: 60, crystal: 3 });
    expect(canLimitBreak(g, inv).ok).toBe(false);
    feed(g, inv, { wind_feather: 40 }); // 37 EXP each, 1330 to reach Lv10
    expect(g.level).toBe(10);
    expect(dominant(g).lineage).toBe('beast');
    const before = growthStats(hammer(), g).attack;
    const r = limitBreak(g, inv);
    expect(r.cap).toBe(20);
    expect(r.evolved).toBe(true);
    expect(g.form).toEqual({ lineage: 'beast', stage: 1 });
    expect(evolvedName('堅牢な岩槌', g)).toBe('牙憑きの堅牢な岩槌');
    expect(growthStats(hammer(), g).attack).toBeGreaterThan(before);
    expect(inv.count('crystal')).toBe(2);
    expect(inv.count('wind_feather')).toBe(60 - 40 - 2);
  });

  it('5. (kit fixed recipes are not ported) crafted items from the existing synthesis can be fed', () => {
    const charm = synthesize(materialIngredient('grass'), materialIngredient('slime_core'), SEED);
    expect(charm.category).not.toBe('weapon');
    const g = newGrowth(hammer());
    const inv = invWith({}, [charm, hammer()]);
    const r = feed(g, inv, { [charm.id]: 1 });
    expect(r.exp).toBeGreaterThan(0);
    expect(Object.values(g.points).reduce((s, v) => s + v, 0)).toBe(4);
    expect(() => feed(g, inv, { [hammer().id]: 1 })).toThrow(/武器/);
  });

  it('6. weapon merge carries 70% of the fodder value and half its lineage', () => {
    const main = newGrowth(hammer());
    const fodderItem = synthesize(materialIngredient('stone'), materialIngredient('iron'), SEED);
    expect(fodderItem.category).toBe('weapon');
    const fodder = newGrowth(fodderItem);
    addExp(fodder, 200);
    fodder.points.mineral = 10;
    const r = mergeWeapons(main, fodder, fodderItem);
    expect(r.gained).toBe(Math.floor((fodder.totalExp + (fodderItem.stats.attack ?? 0) * 20) * 0.7));
    expect(main.points.mineral).toBe(5);
    expect(() => mergeWeapons(main, main, hammer())).toThrow();
  });

  it('7. evolution needs MORE than 50%: exactly half does not evolve', () => {
    const g = newGrowth(hammer());
    addExp(g, 1e9);
    g.points.beast = 10;
    g.points.flora = 10;
    const inv = invWith({ crystal: 1, mushroom: 2 });
    const r = limitBreak(g, inv);
    expect(r.evolved).toBe(false);
    expect(g.form).toBeNull();
    expect(GROWTH.evolveShare).toBe(0.5);
  });

  it('8. growth records save and load', () => {
    const book = new GrowthBook();
    const g = book.of(hammer());
    addExp(g, 150);
    g.points.aqua = 3;
    const text = JSON.stringify(book.toJSON());
    const copy = GrowthBook.fromJSON(JSON.parse(text));
    expect(copy.get(hammer().id)).toEqual(g);
    expect(JSON.stringify(copy.toJSON())).toBe(text);
    expect(() => GrowthBook.fromJSON({ version: 2 } as never)).toThrow(/version/);
  });

  it('caps run 10 -> 20 -> 30 -> 40 and stop', () => {
    const g = newGrowth(hammer());
    const inv = invWith({ crystal: 6, iron: 12 });
    g.points.mineral = 1;
    const caps = [levelCap(g)];
    for (let i = 0; i < 3; i++) {
      addExp(g, 1e9);
      caps.push(limitBreak(g, inv).cap);
    }
    expect(caps).toEqual([10, 20, 30, 40]);
    addExp(g, 1e9);
    expect(g.level).toBe(40);
    expect(canLimitBreak(g, inv)).toEqual({ ok: false, reason: 'これ以上は突破できません' });
    expect(g.form).toEqual({ lineage: 'mineral', stage: 3 });
    expect(evolvedName('堅牢な岩槌', g)).toBe('晶鍛えの堅牢な岩槌・真');
  });
});
