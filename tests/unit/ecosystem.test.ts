// Phase 2B: the four new species live in the same deterministic ecosystem.
import { describe, expect, it } from 'vitest';
import { MATERIALS } from '../../src/items/materials';
import { Inventory } from '../../src/items/inventory';
import { materialIngredient, synthesize } from '../../src/items/synthesis';
import { addExp, feed, GrowthBook, KILL_EXP, MATERIAL_LINEAGE } from '../../src/progression';
import { SPECIES_LINEAGE } from '../../src/combat';
import { MODEL_KEYS } from '../../src/render/models';
import { Simulation } from '../../src/sim/simulation';
import { CLASSIC_SPECIES, isPredatorOf, NEW_SPECIES, SPECIES, SPECIES_IDS, type Species } from '../../src/sim/species';
import { generateWorld } from '../../src/world/generator';

const NEW_MATERIALS = ['moss_fiber', 'ore_core', 'aqua_gel', 'horn_chip'] as const;

function run(seed: number, ticks: number, watch?: (sim: Simulation) => void) {
  const sim = new Simulation(generateWorld(seed));
  for (let i = 0; i < ticks; i++) {
    sim.step();
    watch?.(sim);
  }
  return sim;
}

describe('species data', () => {
  it('every species is complete and consistent', () => {
    const prefixes = new Set<string>();
    for (const s of SPECIES_IDS) {
      const d = SPECIES[s];
      expect(d.id).toBe(s);
      expect(prefixes.has(d.idPrefix), d.idPrefix).toBe(false);
      prefixes.add(d.idPrefix);
      for (const p of [...d.prey, ...d.preyDesperate]) expect(SPECIES_IDS).toContain(p);
      for (const drop of d.drops ?? []) expect(MATERIALS[drop.id], drop.id).toBeDefined();
      expect(KILL_EXP[s]).toBeGreaterThan(0);
      expect(SPECIES_LINEAGE[s]).toBe(d.lineage);
      expect(MODEL_KEYS as readonly string[]).toContain(d.model.key);
      expect(d.model.minimapColor).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it('the food web: hornfang hunts jelly and mosslings, wolves only turn to mosslings when starving', () => {
    expect(isPredatorOf('hornfang', 'driftjelly')).toBe(true);
    expect(isPredatorOf('hornfang', 'mossling')).toBe(true);
    expect(isPredatorOf('wolf', 'mossling')).toBe(true);
    expect(SPECIES.wolf.prey).not.toContain('mossling');
    // Nothing hunts the golem.
    for (const s of SPECIES_IDS) expect(isPredatorOf(s, 'shardgolem')).toBe(false);
  });
});

describe('extended ecosystem', () => {
  it('new species spawn in their habitats', () => {
    for (const seed of [12345, 4242, 777]) {
      const sim = new Simulation(generateWorld(seed));
      for (const s of NEW_SPECIES) {
        const d = SPECIES[s];
        const list = sim.creatures.filter((c) => c.species === s);
        expect(list.length, `${s} seed ${seed}`).toBeGreaterThan(0);
        if (!d.habitat) continue;
        for (const c of list) expect(sim.nearHabitat(d.habitat, Math.floor(c.x), Math.floor(c.z), d.habitatRange ?? 3), `${c.id} near ${d.habitat}`).toBe(true);
      }
    }
  });

  it('the classic roster has no new species', () => {
    const sim = new Simulation(generateWorld(12345), { roster: CLASSIC_SPECIES });
    expect(sim.roster).toEqual(['slime', 'deer', 'wolf']);
    for (let i = 0; i < 600; i++) sim.step();
    expect(sim.creatures.every((c) => CLASSIC_SPECIES.includes(c.species))).toBe(true);
  });

  it('predation, fleeing and breeding happen among the new species', () => {
    const states = new Set<string>();
    const kills = new Map<string, number>();
    const births = new Set<string>();
    for (const seed of [12345, 4242, 777]) {
      const sim = run(seed, 6000, (s) => {
        for (const c of s.creatures) if (c.alive) states.add(`${c.species}:${c.state}`);
      });
      for (const e of sim.events.events) {
        if (e.type === 'death_predation' && e.actor && e.target) {
          const k = `${e.actor.slice(0, 3)}>${e.target.slice(0, 3)}`;
          kills.set(k, (kills.get(k) ?? 0) + 1);
        }
        if (e.type === 'birth' && e.target) births.add(e.target.slice(0, 3));
      }
    }
    const hornKills = (kills.get('HRN>MOS') ?? 0) + (kills.get('HRN>JLY') ?? 0);
    expect(hornKills, JSON.stringify([...kills])).toBeGreaterThan(0);
    for (const s of ['mossling:flee', 'hornfang:chase', 'driftjelly:eat', 'mossling:eat', 'shardgolem:eat'] as const) expect(states.has(s), s).toBe(true);
    // The golem fears nothing.
    expect([...states].some((s) => s === 'shardgolem:flee')).toBe(false);
    for (const p of ['MOS', 'JLY']) expect(births.has(p), `births ${p}`).toBe(true);
  }, 120000);

  it('every species keeps a population (or comes back) over 30 minutes', () => {
    const seen = new Map<Species, number>();
    const sim = run(4242, 18000, (s) => {
      if (s.tick % 600 === 0) for (const sp of s.roster) seen.set(sp, Math.max(seen.get(sp) ?? 0, s.count(sp)));
    });
    for (const sp of sim.roster) expect(seen.get(sp), sp).toBeGreaterThan(0);
    const total = sim.roster.reduce((a, sp) => a + sim.count(sp), 0);
    expect(total).toBeGreaterThan(40);
  }, 120000);
});

describe('drops and materials', () => {
  it('defeating a new species drops its materials (deterministic)', () => {
    const dropsOf = (seed: number) => {
      const sim = new Simulation(generateWorld(seed));
      const out: Record<string, string[]> = {};
      for (const s of NEW_SPECIES) {
        const c = sim.creatures.find((x) => x.species === s && x.alive)!;
        out[s] = sim.damageCreature(c.id, 999);
        expect(c.alive).toBe(false);
      }
      return out;
    };
    const a = dropsOf(4242);
    expect(a).toEqual(dropsOf(4242));
    expect(a.shardgolem).toContain('ore_core');
    expect(a.mossling).toContain('moss_fiber');
    expect(a.driftjelly).toContain('aqua_gel');
    expect(a.hornfang).toContain('horn_chip');
  });

  it('new materials have a lineage and six properties, and work in recipe-less synthesis', () => {
    const lineages = new Set<string>();
    for (const id of NEW_MATERIALS) {
      const m = MATERIALS[id];
      expect(Object.keys(m.props).sort()).toEqual(['elasticity', 'hardness', 'heat', 'magic', 'water', 'weight']);
      lineages.add(MATERIAL_LINEAGE[id]);
    }
    expect(lineages).toEqual(new Set(['flora', 'mineral', 'aqua', 'beast']));
    const items = new Set<string>();
    for (const a of NEW_MATERIALS)
      for (const b of ['wood', 'iron', 'fire_stone', ...NEW_MATERIALS] as const) {
        const it = synthesize(materialIngredient(a), materialIngredient(b), 777);
        expect(it.id).toMatch(/^ITM-[0-9A-F]{6}$/);
        expect(synthesize(materialIngredient(b), materialIngredient(a), 777).id).toBe(it.id);
        items.add(it.name);
      }
    expect(items.size).toBeGreaterThan(8);
  });

  it('feeding new materials grows the weapon towards their lineage', () => {
    const weapon = synthesize(materialIngredient('wood'), materialIngredient('iron'), 12345);
    for (const id of NEW_MATERIALS) {
      const book = new GrowthBook();
      const g = book.of(weapon);
      addExp(g, 0);
      const inv = new Inventory();
      inv.addMaterial(id, 5);
      const before = g.totalExp;
      feed(g, inv, { [id]: 5 });
      expect(g.totalExp).toBeGreaterThan(before);
      expect(g.points[MATERIAL_LINEAGE[id]]).toBeGreaterThan(0);
      expect(inv.count(id)).toBe(0);
    }
  });
});
