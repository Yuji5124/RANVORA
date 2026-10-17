import { describe, expect, it } from 'vitest';
import { Codex } from '../../src/codex/codex';
import { MATERIAL_IDS, PROP_KEYS } from '../../src/items/materials';
import { itemIngredient, materialIngredient, synthesize } from '../../src/items/synthesis';

describe('unknown synthesis', () => {
  it('is reproducible and order independent', () => {
    const a = materialIngredient('fire_stone');
    const b = materialIngredient('water_stone');
    const r1 = synthesize(a, b, 42);
    const r2 = synthesize(b, a, 42);
    expect(r2).toEqual(r1);
    expect(r1.id).toMatch(/^ITM-[0-9A-F]{6}$/);
    expect(r1.reactions).toContain('蒸気');
  });

  it('world seed changes the outcome', () => {
    const a = materialIngredient('iron');
    const b = materialIngredient('fire_stone');
    const ids = new Set([1, 2, 3, 4].map((s) => synthesize(a, b, s).id));
    expect(ids.size).toBe(4);
  });

  it('every pair produces a valid item and the categories vary', () => {
    const categories = new Set<string>();
    const reactions = new Set<string>();
    for (const x of MATERIAL_IDS)
      for (const y of MATERIAL_IDS) {
        const it = synthesize(materialIngredient(x), materialIngredient(y), 2026);
        for (const k of PROP_KEYS) {
          expect(it.props[k]).toBeGreaterThanOrEqual(0);
          expect(it.props[k]).toBeLessThanOrEqual(12);
        }
        expect(it.name.length).toBeGreaterThan(1);
        categories.add(it.category);
        it.reactions.forEach((r) => reactions.add(r));
      }
    expect(categories.size).toBeGreaterThanOrEqual(4);
    expect(reactions.size).toBeGreaterThanOrEqual(5);
  });

  it('crafted items can be used as ingredients again', () => {
    const sword = synthesize(materialIngredient('iron'), materialIngredient('fire_stone'), 7);
    const next = synthesize(itemIngredient(sword), materialIngredient('crystal'), 7);
    expect(next.ingredients).toContain(sword.id);
    expect(next.id).not.toBe(sword.id);
  });
});

describe('codex', () => {
  it('persists entries to storage', () => {
    const mem = new Map<string, string>();
    const storage = {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => void mem.set(k, v),
    } as unknown as Storage;
    const c1 = new Codex(storage);
    expect(c1.record('material', 'wood', '木', 1)).toBe(true);
    expect(c1.record('material', 'wood', '木', 1)).toBe(false);
    const c2 = new Codex(storage);
    expect(c2.has('material:wood')).toBe(true);
    expect(c2.entries['material:wood'].count).toBe(2);
    expect(c2.entries['material:wood'].discoveredAt).toMatch(/^\d{4}-/);
  });
});
