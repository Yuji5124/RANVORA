import { describe, expect, it } from 'vitest';
import { Arsenal, STARTER_WEAPON } from '../../src/game/arsenal';
import { Inventory } from '../../src/items/inventory';
import { materialIngredient, synthesize } from '../../src/items/synthesis';
import { feedSourceOfMaterial, KILL_EXP, LINEAGES } from '../../src/progression';

const SEED = 12345;
const hammer = () => synthesize(materialIngredient('wood'), materialIngredient('iron'), SEED); // weapon ITM-BF7EAD

describe('arsenal: kills, levels, feeding', () => {
  it('uses the starter sword with the old defaults when nothing is equipped', () => {
    const a = new Arsenal(new Inventory());
    const v = a.current();
    expect(v.item.id).toBe(STARTER_WEAPON.id);
    expect(v.item.id).toMatch(/^ITM-[0-9A-F]{6}$/);
    expect(v.stats.attack).toBe(1.5);
    expect(v.stats.range).toBe(1.15);
    expect(v.growth.level).toBe(1);
  });

  it('a kill gives EXP to the weapon in hand, exactly once per creature', () => {
    const a = new Arsenal(new Inventory());
    const r1 = a.rewardKill('WLF-0001', 'wolf');
    expect(r1?.exp).toBe(KILL_EXP.wolf);
    expect(a.rewardKill('WLF-0001', 'wolf')).toBeNull(); // same creature again
    expect(a.current().growth.totalExp).toBe(KILL_EXP.wolf);
    a.rewardKill('SLM-0003', 'slime');
    expect(a.current().growth.totalExp).toBe(KILL_EXP.wolf + KILL_EXP.slime);
    a.resetWorld(); // a new world reuses ids
    expect(a.rewardKill('WLF-0001', 'wolf')).not.toBeNull();
  });

  it('levelling up raises attack', () => {
    const a = new Arsenal(new Inventory());
    const before = a.current().stats.attack;
    let levels = 0;
    for (let i = 1; i <= 6; i++) levels += a.rewardKill(`WLF-${i}`, 'wolf')!.levels;
    expect(levels).toBeGreaterThan(0);
    expect(a.current().growth.level).toBe(1 + levels);
    expect(a.current().stats.attack).toBeGreaterThan(before);
  });

  it('EXP goes to the equipped crafted weapon, not the starter', () => {
    const inv = new Inventory();
    inv.addItem(hammer());
    inv.equip(hammer().id);
    const a = new Arsenal(inv);
    a.rewardKill('DER-0001', 'deer');
    expect(a.book.get(hammer().id)?.totalExp).toBe(KILL_EXP.deer);
    expect(a.book.get(STARTER_WEAPON.id)).toBeUndefined();
    expect(a.current().stats.attack).toBe(hammer().stats.attack); // Lv1 = synthesized stats
  });

  it('feeding consumes exactly the units, adds EXP and shifts lineage shares', () => {
    const inv = new Inventory();
    inv.addMaterial('wind_feather', 3);
    inv.addMaterial('mushroom', 1);
    const a = new Arsenal(inv);
    const r = a.feed('wind_feather', 2);
    expect(r.ok).toBe(true);
    expect(inv.count('wind_feather')).toBe(1);
    const g = a.current().growth;
    expect(g.points.beast).toBe(4);
    expect(g.totalExp).toBe(feedSourceOfMaterial('wind_feather').exp * 2);
    a.feed('mushroom', 1);
    expect(g.points.flora).toBe(2);
    const total = LINEAGES.reduce((t, l) => t + g.points[l], 0);
    expect(g.points.beast / total).toBeCloseTo(4 / 6);
  });

  it('nothing changes when the stock is short or the id is a weapon', () => {
    const inv = new Inventory();
    inv.addMaterial('iron', 1);
    inv.addItem(hammer());
    const a = new Arsenal(inv);
    a.current(); // viewing the weapon creates its empty Lv1 record
    const before = JSON.stringify(a.book.toJSON());
    expect(a.feed('iron', 2)).toEqual({ ok: false, reason: '鉄 が足りません（1/2）' });
    expect(a.feed(hammer().id, 1).ok).toBe(false);
    expect(a.feed('nothing', 1).ok).toBe(false);
    expect(a.feed('iron', 0).ok).toBe(false);
    expect(inv.count('iron')).toBe(1);
    expect(inv.count(hammer().id)).toBe(1);
    expect(JSON.stringify(a.book.toJSON())).toBe(before);
  });

  it('a refused take half-way gives back what was taken and keeps the growth unchanged', () => {
    const inv = new Inventory();
    inv.addMaterial('stone', 3);
    const a = new Arsenal(inv);
    a.current(); // create the record
    const before = JSON.stringify(a.book.toJSON());
    const realTake = inv.take.bind(inv);
    let calls = 0;
    inv.take = (id: string) => (++calls === 3 ? false : realTake(id)); // the 3rd unit fails
    const r = a.feed('stone', 3);
    expect(r.ok).toBe(false);
    expect(inv.count('stone')).toBe(3);
    expect(JSON.stringify(a.book.toJSON())).toBe(before);
  });

  it('a crafted item from the property-based synthesis can be fed and is consumed', () => {
    const inv = new Inventory();
    const charm = synthesize(materialIngredient('grass'), materialIngredient('slime_core'), SEED);
    inv.addItem(charm);
    inv.equippedCharm = charm.id;
    const a = new Arsenal(inv);
    expect(a.feed(charm.id, 1).ok).toBe(true);
    expect(inv.count(charm.id)).toBe(0);
    expect(inv.equippedCharm).toBeNull();
  });

  it('limit break and evolution through the arsenal, all or nothing', () => {
    const inv = new Inventory();
    inv.addMaterial('wind_feather', 40);
    const a = new Arsenal(inv);
    a.feed('wind_feather', 38); // 37 EXP each -> Lv10 cap
    expect(a.current().growth.level).toBe(10);
    expect(a.limitBreak()).toEqual({ ok: false, reason: 'crystal が足りません（0/1）' });
    expect(inv.count('wind_feather')).toBe(2);
    inv.addMaterial('crystal', 1);
    const r = a.limitBreak();
    expect(r.ok && r.evolved).toBe(true);
    expect(a.current().name).toBe('牙憑きの旅人の小剣');
    expect(a.current().cap).toBe(20);
    expect(inv.count('crystal')).toBe(0);
    expect(inv.count('wind_feather')).toBe(0);
  });

  it('the same actions give the same growth', () => {
    const run = () => {
      const inv = new Inventory();
      inv.addMaterial('iron', 5);
      inv.addMaterial('grass', 5);
      const a = new Arsenal(inv);
      ['SLM-1', 'WLF-2', 'SLM-1', 'DER-3'].forEach((id, i) => a.rewardKill(id, (['slime', 'wolf', 'slime', 'deer'] as const)[i]));
      a.feed('iron', 3);
      a.feed('grass', 2);
      return JSON.stringify(a.book.toJSON());
    };
    expect(run()).toBe(run());
  });
});
