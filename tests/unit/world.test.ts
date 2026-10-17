import { describe, expect, it } from 'vitest';
import { Rng, normalizeSeed } from '../../src/core/rng';
import { generateWorld, worldFingerprint } from '../../src/world/generator';
import { Tile, isTileWalkable, tileIndex } from '../../src/world/types';

describe('rng', () => {
  it('is deterministic per seed and stream', () => {
    const a = Rng.stream(42, 'x');
    const b = Rng.stream(42, 'x');
    const c = Rng.stream(42, 'y');
    const sa = Array.from({ length: 5 }, () => a.next());
    expect(Array.from({ length: 5 }, () => b.next())).toEqual(sa);
    expect(Array.from({ length: 5 }, () => c.next())).not.toEqual(sa);
  });

  it('normalises text and numeric seeds', () => {
    expect(normalizeSeed('123')).toBe(123);
    expect(normalizeSeed('ranvora')).toBe(normalizeSeed('ranvora'));
    expect(normalizeSeed('ranvora')).not.toBe(normalizeSeed('RANVORA'));
  });
});

describe('world generation', () => {
  it('produces the same world for the same seed', () => {
    expect(worldFingerprint(generateWorld(1234))).toBe(worldFingerprint(generateWorld(1234)));
  });

  it('produces different worlds for different seeds', () => {
    const prints = new Set([1, 2, 3, 4, 5].map((s) => worldFingerprint(generateWorld(s))));
    expect(prints.size).toBe(5);
  });

  it.each([1, 7, 42, 999, 12345, 20261018])('contains every required feature and keeps landmarks reachable (seed %i)', (seed) => {
    const w = generateWorld(seed);
    const kinds = new Set(w.objects.filter((o) => !o.removed).map((o) => o.kind));
    for (const k of ['tree', 'rock', 'house', 'chest', 'flower', 'cave'] as const) expect(kinds.has(k), k).toBe(true);
    const tiles = new Set(w.tiles);
    for (const t of [Tile.GRASS, Tile.WATER, Tile.PATH, Tile.CAVE]) expect(tiles.has(t)).toBe(true);
    // Spawn is walkable and every landmark is reachable from it.
    expect(isTileWalkable(w, Math.floor(w.spawn.x), Math.floor(w.spawn.z))).toBe(true);
    for (const lm of w.landmarks) expect(w.reachable[tileIndex(w, lm.tx, lm.tz)], `${lm.kind} ${lm.id}`).toBe(1);
    // A reasonable share of the map is explorable.
    const reachable = w.reachable.reduce((a, b) => a + b, 0);
    expect(reachable).toBeGreaterThan(w.width * w.height * 0.25);
  });
});
