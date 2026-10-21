import { describe, expect, it } from 'vitest';
import { Rng } from '../../src/core/rng';
import {
  ADVANTAGE,
  ATTACK_ARCS,
  computeDamage,
  DISADVANTAGE,
  elementMultiplier,
  forwardOf,
  fromKitFacing,
  inArc,
  lineageMultiplier,
  rollDrops,
  SPECIES_LINEAGE,
  toKitFacing,
  wrapAngle,
  type DropTable,
} from '../../src/combat';
import { SPECIES_IDS } from '../../src/sim/species';

describe('direction conversion (kit 0 = +Z  <->  RANVORA 0 = +X)', () => {
  it('maps the axes', () => {
    expect(fromKitFacing(0)).toBeCloseTo(Math.PI / 2); // kit +Z
    expect(fromKitFacing(Math.PI / 2)).toBeCloseTo(0); // kit +X
    expect(fromKitFacing(Math.PI)).toBeCloseTo(-Math.PI / 2); // kit -Z
    expect(toKitFacing(0)).toBeCloseTo(Math.PI / 2);
  });

  it('keeps the same forward vector and round-trips', () => {
    for (let i = 0; i < 64; i++) {
      const f = -Math.PI + (i / 64) * Math.PI * 2;
      const v = forwardOf(fromKitFacing(f));
      expect(v.x).toBeCloseTo(Math.sin(f)); // kit forward = (sin f, cos f)
      expect(v.z).toBeCloseTo(Math.cos(f));
      expect(wrapAngle(toKitFacing(fromKitFacing(f)) - f)).toBeCloseTo(0);
    }
  });
});

describe('sector hit test (0 = +X)', () => {
  const sword = ATTACK_ARCS.sword;
  it('hits in front, misses behind and out of reach', () => {
    expect(inArc(0, 0, 0, 1, 0, sword)).toBe(true); // +X in front
    expect(inArc(0, 0, 0, -1, 0, sword)).toBe(false); // behind
    expect(inArc(0, 0, Math.PI / 2, 0, 1, sword)).toBe(true); // facing +Z
    expect(inArc(0, 0, 0, 2, 0, sword)).toBe(false);
  });
  it('respects the 120 degree opening and the target radius', () => {
    const at = (deg: number) => [Math.cos((deg * Math.PI) / 180), Math.sin((deg * Math.PI) / 180)] as const;
    expect(inArc(0, 0, 0, ...at(55), sword)).toBe(true);
    expect(inArc(0, 0, 0, ...at(70), sword)).toBe(false);
    expect(inArc(0, 0, 0, ...at(70), sword, 0.3)).toBe(true);
    expect(inArc(0, 0, 0, 0.1, 0.05, sword, 0.3)).toBe(true); // overlapping
  });
  it('agrees with a kit-convention attacker converted at the boundary', () => {
    const kitFacing = Math.PI / 2; // kit: facing +X
    expect(inArc(0, 0, fromKitFacing(kitFacing), 1, 0, sword)).toBe(true);
    expect(inArc(0, 0, fromKitFacing(kitFacing), 0, 1, sword)).toBe(false);
  });
});

describe('affinity', () => {
  it('lineage wheel', () => {
    expect(lineageMultiplier('aqua', 'mineral')).toBe(ADVANTAGE);
    expect(lineageMultiplier('mineral', 'aqua')).toBe(DISADVANTAGE);
    expect(lineageMultiplier('flora', 'mineral')).toBe(1);
    expect(lineageMultiplier(null, 'beast')).toBe(1);
  });
  it('magic element vs lineage, and every species has a lineage', () => {
    expect(elementMultiplier('fire', 'flora')).toBe(1.5);
    expect(elementMultiplier('wind', 'flora')).toBe(1);
    expect(elementMultiplier('none', 'aqua')).toBe(1);
    for (const s of SPECIES_IDS) expect(SPECIES_LINEAGE[s]).toBeDefined();
  });
});

describe('damage and drops are reproducible', () => {
  it('same stream, same damage sequence; always two draws per hit', () => {
    const roll = (seed: number) => {
      const r = Rng.stream(seed, 'combat');
      return Array.from({ length: 50 }, () => computeDamage({ attack: 3.7, multiplier: 1.5, defense: 1, crit: 0.2 }, r));
    };
    expect(roll(12345)).toEqual(roll(12345));
    expect(roll(12345)).not.toEqual(roll(54321));
    const a = Rng.stream(1, 'combat');
    const b = Rng.stream(1, 'combat');
    computeDamage({ attack: 1, crit: 1 }, a);
    computeDamage({ attack: 99, crit: 0 }, b);
    expect(a.getState()).toBe(b.getState());
    expect(computeDamage({ attack: 0.1, defense: 50 }, a).damage).toBe(0.5);
  });

  it('drop rolls repeat for the same stream and consume a fixed amount', () => {
    const table: DropTable = [
      { id: 'slime_core', chance: 1, min: 1, max: 2 },
      { id: 'crystal', chance: 0.15, min: 1, max: 1 },
    ];
    const run = (seed: number) => {
      const r = Rng.stream(seed, 'combat-drops');
      return Array.from({ length: 40 }, () => rollDrops(table, r));
    };
    expect(run(7)).toEqual(run(7));
    const all = run(7);
    expect(all.every((d) => d.slime_core >= 1 && d.slime_core <= 2)).toBe(true);
    const rare = all.filter((d) => d.crystal).length;
    expect(rare).toBeGreaterThan(0);
    expect(rare).toBeLessThan(20);
    const a = Rng.stream(3, 'x');
    const b = Rng.stream(3, 'x');
    rollDrops(table, a, 0);
    rollDrops(table, b, 10);
    expect(a.getState()).toBe(b.getState());
  });
});
