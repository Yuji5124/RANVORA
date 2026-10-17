import { describe, expect, it } from 'vitest';
import { Simulation } from '../../src/sim/simulation';
import { generateWorld } from '../../src/world/generator';

function run(seed: number, ticks: number) {
  const sim = new Simulation(generateWorld(seed));
  for (let i = 0; i < ticks; i++) sim.step();
  return sim;
}

describe('ecosystem simulation', () => {
  it('replays identically for the same seed (no player input)', () => {
    const a = run(777, 3000);
    const b = run(777, 3000);
    expect(a.fingerprint()).toBe(b.fingerprint());
    expect(a.events.events.map((e) => e.message)).toEqual(b.events.events.map((e) => e.message));
  });

  it('diverges for different seeds', () => {
    expect(run(1, 1200).fingerprint()).not.toBe(run(2, 1200).fingerprint());
  });

  it('creatures act on their own and have the required state', () => {
    const sim = new Simulation(generateWorld(4242));
    const start = new Map(sim.creatures.map((c) => [c.id, { x: c.x, z: c.z }]));
    const seenStates = new Set<string>();
    for (let i = 0; i < 1800; i++) {
      sim.step();
      for (const c of sim.creatures) if (c.alive) seenStates.add(`${c.species}:${c.state}`);
    }
    const moved = sim.creatures.filter((c) => c.alive && start.has(c.id)).filter((c) => {
      const s = start.get(c.id)!;
      return Math.hypot(c.x - s.x, c.z - s.z) > 1;
    });
    expect(moved.length).toBeGreaterThan(5);
    for (const s of ['slime:seek_food', 'slime:eat', 'deer:seek_food', 'deer:eat', 'wolf:wander']) expect(seenStates.has(s), s).toBe(true);
    const c = sim.creatures[0];
    for (const k of ['id', 'hp', 'hunger', 'speedTrait', 'visionTrait', 'fear', 'state'] as const) expect(c[k]).toBeDefined();
  });

  it('the world changes when left alone', () => {
    const sim = run(12345, 6000); // 10 simulated minutes
    const types = new Set(sim.events.events.map((e) => e.type));
    expect(types.has('plant_bloom')).toBe(true);
    expect(types.has('migration') || types.has('birth') || types.has('split')).toBe(true);
    expect(sim.popHistory.length).toBeGreaterThan(50);
    // Events carry the ids that caused them.
    const withActor = sim.events.events.filter((e) => e.actor);
    expect(withActor.length).toBeGreaterThan(10);
  });

  it('player interactions: damage, harvest, burn, water', () => {
    const sim = new Simulation(generateWorld(99));
    const slime = sim.creatures.find((c) => c.species === 'slime')!;
    const drops = sim.damageCreature(slime.id, 99);
    expect(slime.alive).toBe(false);
    expect(drops).toContain('slime_core');
    const plant = sim.plants.find((p) => p.alive && p.biomass > 0.5)!;
    expect(sim.harvestPlant(plant.tx + 0.5, plant.tz + 0.5)).toBe(plant.kind);
    expect(sim.burnPlants(plant.tx + 0.5, plant.tz + 0.5, 1, 'test')).toBeGreaterThan(0);
  });
});
