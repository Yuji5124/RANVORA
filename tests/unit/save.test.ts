import { describe, expect, it } from 'vitest';
import { Arsenal } from '../../src/game/arsenal';
import { restore, SAVE_KEY, SaveStore, snapshot, validate } from '../../src/game/save';
import { Inventory } from '../../src/items/inventory';
import { materialIngredient, synthesize } from '../../src/items/synthesis';

/** In-memory Storage; `failWrites` makes setItem throw like a full quota. */
class MemStorage implements Storage {
  map = new Map<string, string>();
  failWrites = false;
  get length() {
    return this.map.size;
  }
  clear() {
    this.map.clear();
  }
  getItem(k: string) {
    return this.map.has(k) ? this.map.get(k)! : null;
  }
  key(i: number) {
    return [...this.map.keys()][i] ?? null;
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
  setItem(k: string, v: string) {
    if (this.failWrites) throw new DOMException('quota', 'QuotaExceededError');
    this.map.set(k, v);
  }
}

const SEED = 12345;
function progressed() {
  const inv = new Inventory();
  const weapon = synthesize(materialIngredient('wood'), materialIngredient('iron'), SEED);
  const spell = synthesize(materialIngredient('fire_stone'), materialIngredient('water_stone'), SEED);
  inv.addItem(weapon);
  inv.addItem(spell);
  inv.equip(weapon.id);
  inv.equip(spell.id);
  inv.addMaterial('wind_feather', 7);
  inv.addMaterial('iron', 2);
  const a = new Arsenal(inv);
  a.rewardKill('WLF-0001', 'wolf');
  a.feed('wind_feather', 4);
  return { inv, a, weapon };
}

describe('progress save', () => {
  it('round-trips level, EXP, lineage, inventory and equipment', () => {
    const { inv, a, weapon } = progressed();
    const st = new MemStorage();
    expect(new SaveStore(st).save(snapshot(inv, a.book))).toBe(true);

    const loaded = new SaveStore(st).load();
    expect(loaded.status).toBe('ok');
    const inv2 = new Inventory();
    const a2 = new Arsenal(inv2);
    a2.book = restore(loaded.data!, inv2);
    expect(inv2.equippedWeapon).toBe(weapon.id);
    expect(inv2.count('wind_feather')).toBe(3);
    expect(inv2.count('iron')).toBe(2);
    expect(a2.current().growth).toEqual(a.current().growth);
    expect(a2.current().stats).toEqual(a.current().stats);
    expect(JSON.stringify(snapshot(inv2, a2.book))).toBe(JSON.stringify(snapshot(inv, a.book)));
  });

  it('does not touch the codex key', () => {
    const st = new MemStorage();
    st.setItem('ranvora.codex.v1', '{"material:wood":{}}');
    const { inv, a } = progressed();
    new SaveStore(st).save(snapshot(inv, a.book));
    expect(st.getItem('ranvora.codex.v1')).toBe('{"material:wood":{}}');
    expect(st.getItem(SAVE_KEY)).not.toBeNull();
  });

  it('a failed write leaves the previous save as it was', () => {
    const st = new MemStorage();
    const { inv, a } = progressed();
    const store = new SaveStore(st);
    store.save(snapshot(inv, a.book));
    const before = st.getItem(SAVE_KEY);
    a.feed('wind_feather', 3);
    st.failWrites = true;
    expect(store.save(snapshot(inv, a.book))).toBe(false);
    expect(st.getItem(SAVE_KEY)).toBe(before);
  });

  it('broken or foreign data never throws, starts fresh and is kept aside', () => {
    for (const raw of ['{not json', '[]', '{"version":2}', JSON.stringify({ version: 1, materials: { gold: 1 }, items: [], equipped: {}, growth: { version: 1, weapons: [] } })]) {
      const st = new MemStorage();
      st.setItem(SAVE_KEY, raw);
      const r = new SaveStore(st).load();
      expect(r).toEqual({ data: null, status: 'corrupt' });
      expect(st.getItem(`${SAVE_KEY}.corrupt`)).toBe(raw);
    }
    expect(new SaveStore(new MemStorage()).load().status).toBe('none');
    expect(new SaveStore(null).load().status).toBe('unavailable');
  });

  it('rejects out-of-range growth and duplicate items', () => {
    const { inv, a } = progressed();
    const good = snapshot(inv, a.book);
    expect(validate(JSON.parse(JSON.stringify(good)))).not.toBeNull();
    const bad1 = JSON.parse(JSON.stringify(good));
    bad1.growth.weapons[0].level = 99;
    expect(validate(bad1)).toBeNull();
    const bad2 = JSON.parse(JSON.stringify(good));
    bad2.items.push(bad2.items[0]);
    expect(validate(bad2)).toBeNull();
    const bad3 = JSON.parse(JSON.stringify(good));
    bad3.growth.weapons[0].points.beast = -1;
    expect(validate(bad3)).toBeNull();
  });

  it('an equipped id that is no longer in the bag is dropped on restore', () => {
    const { inv, a } = progressed();
    const data = snapshot(inv, a.book);
    data.equipped.charm = 'ITM-ABCDEF';
    const inv2 = new Inventory();
    restore(data, inv2);
    expect(inv2.equippedCharm).toBeNull();
  });
});
