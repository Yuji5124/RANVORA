// Guards for the research base: values captured from main at 685c4e4 before Phase 1.
// If one of these fails, an existing system changed behaviour. Update the golden
// values only for an intended change, and record why in the commit message.

import { describe, expect, it } from 'vitest';
import { Rng } from '../../src/core/rng';
import { materialIngredient, synthesize, type CraftedItem } from '../../src/items/synthesis';
import { Inventory } from '../../src/items/inventory';
import { Simulation } from '../../src/sim/simulation';
import { generateWorld } from '../../src/world/generator';
import { ATTACK_ARCS, computeDamage, inArc, lineageMultiplier, rollDrops, SPECIES_LINEAGE } from '../../src/combat';
import { addExp, feed, GrowthBook, growthStats, KILL_EXP, limitBreak, weaponLineage } from '../../src/progression';

describe('existing systems are unchanged (golden values from main 685c4e4)', () => {
  it('ecosystem fingerprints after 1800 ticks', () => {
    const fp = (seed: number) => {
      const sim = new Simulation(generateWorld(seed));
      for (let i = 0; i < 1800; i++) sim.step();
      return sim.fingerprint();
    };
    expect(fp(12345)).toBe(368528957);
    expect(fp(4242)).toBe(1833800583);
    expect(fp(777)).toBe(125874590);
  });

  it('property-based synthesis results', () => {
    const a = synthesize(materialIngredient('wood'), materialIngredient('iron'), 12345);
    expect({ id: a.id, name: a.name, category: a.category, element: a.element, stats: a.stats, reactions: a.reactions }).toEqual({
      id: 'ITM-BF7EAD', name: '堅牢な岩槌', category: 'weapon', element: 'earth', stats: { attack: 3.7, range: 1.2 }, reactions: [],
    });
    const b = synthesize(materialIngredient('fire_stone'), materialIngredient('water_stone'), 4242);
    expect({ id: b.id, name: b.name, category: b.category, element: b.element, stats: b.stats, reactions: b.reactions }).toEqual({
      id: 'ITM-3835A0', name: '神秘のオーブ', category: 'spell', element: 'none', stats: { power: 5.3 }, reactions: ['蒸気', '共鳴'],
    });
  });
});

/**
 * A scripted play session: the same seed and the same operation list must give
 * the same final state, byte for byte. Combat uses its own stream ('combat'),
 * so it never shifts the ecosystem's streams.
 */
function playScript(seed: number) {
  const weapon: CraftedItem = synthesize(materialIngredient('wood'), materialIngredient('iron'), seed);
  const book = new GrowthBook();
  const g = book.of(weapon);
  const inv = new Inventory();
  inv.addMaterial('wind_feather', 50);
  inv.addMaterial('crystal', 2);
  const rng = Rng.stream(seed, 'combat');
  const log: unknown[] = [];
  const targets = [
    { species: 'slime' as const, x: 1, z: 0.2, hp: 3 },
    { species: 'wolf' as const, x: 0.8, z: -0.5, hp: 10 },
    { species: 'deer' as const, x: -1, z: 0, hp: 6 },
  ];
  for (let swing = 0; swing < 12; swing++) {
    const dir = swing % 2 ? 0 : -0.4;
    for (const t of targets) {
      if (t.hp <= 0 || !inArc(0, 0, dir, t.x, t.z, ATTACK_ARCS.sword, 0.3)) continue;
      const s = growthStats(weapon, g);
      const hit = computeDamage({ attack: s.attack, crit: s.crit, multiplier: lineageMultiplier(weaponLineage(g), SPECIES_LINEAGE[t.species]) }, rng);
      t.hp -= hit.damage;
      log.push([swing, t.species, hit]);
      if (t.hp <= 0) {
        addExp(g, KILL_EXP[t.species]);
        log.push(rollDrops([{ id: 'slime_core', chance: 0.7, min: 1, max: 2 }], rng));
      }
    }
  }
  feed(g, inv, { wind_feather: 40 });
  log.push(limitBreak(g, inv));
  return JSON.stringify({ log, book: book.toJSON(), stock: [inv.count('wind_feather'), inv.count('crystal')] });
}

describe('same seed + same operations = same result', () => {
  it('replays a combat and growth session identically', () => {
    expect(playScript(12345)).toBe(playScript(12345));
    expect(playScript(12345)).not.toBe(playScript(999));
  });

  it('combat and growth do not disturb the ecosystem streams', () => {
    const sim = new Simulation(generateWorld(12345));
    playScript(12345);
    for (let i = 0; i < 1800; i++) sim.step();
    expect(sim.fingerprint()).toBe(368528957);
  });
});
