// Guards the committed GLBs in public/models (see tools/blender/validate.ts).
import { describe, expect, it } from 'vitest';
import { loadConfig, validateModels } from '../../tools/blender/validate';
import { NEW_SPECIES, SPECIES } from '../../src/sim/species';

describe('creature models', () => {
  it('every new species has a creature entry whose key is its model key', () => {
    const keys = loadConfig().creatures.map((c) => c.key);
    for (const s of NEW_SPECIES) expect(keys).toContain(SPECIES[s].model.key);
  });

  it('all GLBs pass validation (scale, origin, facing, clips, skin)', async () => {
    const rep = await validateModels();
    const failed = rep.results.filter((r) => !r.ok).map((r) => `${r.key}: ${r.errors.join('; ')}`);
    expect(failed).toEqual([]);
    const creatures = rep.results.filter((r) => r.kind === 'creature');
    expect(creatures.length).toBe(4);
    for (const c of creatures) for (const clip of loadConfig().clips) expect((c.stats.clips as string[]).some((x) => x.startsWith(clip + ' '))).toBe(true);
  }, 60000);
});

describe('clip selection (display only)', () => {
  it('maps sim state to Idle / Move / Attack / Hit', async () => {
    const { clipFor } = await import('../../src/render/creatureView');
    const base = { moving: false, hitTime: -10, attackTime: -10 };
    expect(clipFor(base, 5, 0.8)).toBe('Idle');
    expect(clipFor({ ...base, moving: true }, 5, 0.8)).toBe('Move');
    expect(clipFor({ ...base, moving: true, attackTime: 4.5 }, 5, 0.8)).toBe('Attack');
    expect(clipFor({ ...base, moving: true, attackTime: 4 }, 5, 0.8)).toBe('Move');
    expect(clipFor({ ...base, attackTime: 4.9, hitTime: 4.9 }, 5, 0.8)).toBe('Hit');
  });
});
