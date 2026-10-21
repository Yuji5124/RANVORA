import { expect, test, type Page } from '@playwright/test';

/* eslint-disable @typescript-eslint/no-explicit-any */

// Phase 2B: the four new species in the browser. Every wait is on game state, never on time.

const NEW = ['mossling', 'shardgolem', 'driftjelly', 'hornfang'];

async function open(page: Page, query: string) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto(`/?${query}`);
  await page.waitForFunction(() => (window as any).__RANVORA?.game, null, { timeout: 30_000 });
  return errors;
}

/** Brings the camera to a creature so its view is created and animated. */
async function follow(page: Page, id: string) {
  await page.evaluate((cid) => {
    const r = (window as any).__RANVORA;
    const c = r.sim.getCreature(cid);
    r.player.teleport(c.x - 2.5, c.z);
  }, id);
}

/** Freezes the ecosystem, then swings at one creature until it dies. */
async function killOne(page: Page, species: string): Promise<string> {
  const id = await page.evaluate((sp) => {
    const r = (window as any).__RANVORA;
    r.game.paused = true;
    return r.sim.creatures.find((x: any) => x.alive && x.species === sp).id as string;
  }, species);
  for (let swing = 0; swing < 60; swing++) {
    const alive = await page.evaluate((cid) => {
      const r = (window as any).__RANVORA;
      const c = r.sim.getCreature(cid);
      if (!c?.alive) return false;
      r.player.teleport(c.x - 0.6, c.z);
      r.player.dir = 0;
      r.player.startAttack();
      return true;
    }, id);
    if (!alive) return id;
    await page.waitForFunction(() => (window as any).__RANVORA.player.attackTime < 0, null, { timeout: 15_000 });
  }
  throw new Error(`${species} ${id} did not die`);
}

test('new species live in the world and are drawn as rigged GLBs with clips', async ({ page }) => {
  const errors = await open(page, 'seed=4242');
  const info = await page.evaluate((keys) => {
    const r = (window as any).__RANVORA;
    const rep = r.modelReport();
    return {
      roster: r.sim.roster,
      counts: Object.fromEntries(keys.map((k: string) => [k, r.sim.count(k)])),
      models: Object.fromEntries(keys.map((k: string) => [k, rep[k]])),
      classicSource: rep.wolf.source,
    };
  }, NEW);
  expect(info.roster).toEqual(['slime', 'deer', 'wolf', ...NEW]);
  for (const k of NEW) {
    expect(info.counts[k], k).toBeGreaterThan(0);
    expect(info.models[k].source, k).toBe('glb');
    expect([...info.models[k].clips].sort(), k).toEqual(['Attack', 'Die', 'Hit', 'Idle', 'Move']);
  }
  expect(info.classicSource).toBe('glb');

  // Views exist for every creature; the new ones are rigged.
  await page.waitForFunction(() => (window as any).__RANVORA.rigStats().rigged > 0, null, { timeout: 15_000 });

  // Clips follow the sim state: a moving creature shows Move.
  await page.waitForFunction(
    () => {
      const r = (window as any).__RANVORA;
      return r.sim.creatures.some((c: any) => c.alive && c.moving && r.clipOf(c.id) === 'Move');
    },
    null,
    { timeout: 20_000 },
  );

  // A hit shows Hit (the sim is paused, so the state holds still while we look).
  const golem = await page.evaluate(() => {
    const r = (window as any).__RANVORA;
    r.game.paused = true;
    const c = r.sim.creatures.find((x: any) => x.alive && x.species === 'shardgolem');
    r.sim.damageCreature(c.id, 1);
    return c.id as string;
  });
  await follow(page, golem);
  await page.waitForFunction((cid) => (window as any).__RANVORA.clipOf(cid) === 'Hit', golem, { timeout: 10_000 });
  expect(errors).toEqual([]);
});

test('a missing creature GLB falls back to primitives without breaking the game', async ({ page }) => {
  const errors = await open(page, 'seed=4242&missingModels=hornfang,driftjelly');
  const rep = await page.evaluate(() => (window as any).__RANVORA.modelReport());
  expect(rep.hornfang).toEqual({ source: 'primitive', clips: [] });
  expect(rep.driftjelly).toEqual({ source: 'primitive', clips: [] });
  expect(rep.mossling.source).toBe('glb');
  await page.waitForFunction(() => {
    const s = (window as any).__RANVORA.rigStats();
    return s.rigged > 0 && s.procedural > 0;
  }, null, { timeout: 15_000 });
  const hornfang = await page.evaluate(() => (window as any).__RANVORA.sim.creatures.find((c: any) => c.alive && c.species === 'hornfang').id);
  await follow(page, hornfang);
  expect(await page.evaluate((cid) => (window as any).__RANVORA.clipOf(cid), hornfang)).toBeNull();
  expect(errors).toEqual([]);
});

test('?models=primitive draws every species from the primitive specs', async ({ page }) => {
  const errors = await open(page, 'seed=4242&models=primitive');
  const rep = await page.evaluate(() => (window as any).__RANVORA.modelReport());
  for (const k of NEW) expect(rep[k].source, k).toBe('primitive');
  await page.waitForFunction(() => (window as any).__RANVORA.rigStats().procedural > 20, null, { timeout: 15_000 });
  expect(await page.evaluate(() => (window as any).__RANVORA.rigStats().rigged)).toBe(0);
  expect(errors).toEqual([]);
});

test('?ecosystem=classic keeps only slime, deer and wolf', async ({ page }) => {
  const errors = await open(page, 'seed=12345&ecosystem=classic');
  const r = await page.evaluate(() => {
    const x = (window as any).__RANVORA;
    return { roster: x.sim.roster, species: [...new Set(x.sim.creatures.map((c: any) => c.species))].sort() };
  });
  expect(r).toEqual({ roster: ['slime', 'deer', 'wolf'], species: ['deer', 'slime', 'wolf'] });
  expect(errors).toEqual([]);
});

test('defeat new species -> pick up their materials -> synthesize -> feed the weapon', async ({ page }) => {
  test.setTimeout(240_000); // the golem is tough: many sword swings, each waited on by state
  const errors = await open(page, 'seed=4242');
  await page.evaluate(() => localStorage.removeItem('ranvora.save.v1'));

  // 1. Battle: a golem (mineral) and a jelly (aqua). Kill EXP comes from the species data.
  await killOne(page, 'shardgolem');
  await page.waitForFunction(() => (window as any).__RANVORA.arsenal.current().growth.totalExp === 32, null, { timeout: 15_000 });
  await killOne(page, 'driftjelly');
  await page.waitForFunction(() => (window as any).__RANVORA.arsenal.current().growth.totalExp === 39, null, { timeout: 15_000 });

  // 2. Pick up their drops with the real key (E).
  const wanted = ['ore_core', 'aqua_gel'];
  for (let i = 0; i < 12; i++) {
    const target = await page.evaluate((mats) => {
      const r = (window as any).__RANVORA;
      const k = r.sim.pickups.find((x: any) => x.alive && mats.includes(x.material));
      if (!k) return null;
      r.player.teleport(k.x, k.z);
      return k.id as string;
    }, wanted);
    if (!target) break;
    await page.keyboard.press('KeyE');
    await page.waitForFunction((id) => !(window as any).__RANVORA.sim.pickups.some((k: any) => k.id === id && k.alive), target, { timeout: 10_000 });
  }
  const got = await page.evaluate(() => {
    const inv = (window as any).__RANVORA.inventory;
    return { ore: inv.count('ore_core'), gel: inv.count('aqua_gel') };
  });
  expect(got.ore).toBe(1);
  expect(got.gel).toBeGreaterThan(0);

  // 3. Synthesis through the UI (no recipe: the result comes from the properties).
  await page.keyboard.press('KeyC');
  await page.locator('.panel button[data-act=slot][data-id=ore_core]').click();
  await page.locator('.panel button[data-act=slot][data-id=aqua_gel]').click();
  await page.locator('.panel button[data-act=craft]').click();
  await page.waitForFunction(() => (window as any).__RANVORA.inventory.items.size > 0, null, { timeout: 10_000 });
  const item = await page.evaluate(() => {
    const r = (window as any).__RANVORA;
    const it = [...r.inventory.items.values()].map((x: any) => x.item).find((x: any) => x.ingredients.includes('ore_core'));
    return { id: it.id as string, category: it.category as string };
  });
  expect(item.id).toMatch(/^ITM-[0-9A-F]{6}$/);
  expect(item.category).not.toBe('weapon'); // weapons merge instead of being fed
  await page.keyboard.press('Escape');

  // 4. Feed it to the weapon through the bag.
  const before = await page.evaluate(() => (window as any).__RANVORA.arsenal.current().growth.totalExp);
  await page.keyboard.press('KeyI');
  await page.locator(`.panel button[data-act=feed][data-id="${item.id}"]`).click();
  await page.waitForFunction((n) => (window as any).__RANVORA.arsenal.current().growth.totalExp > n, before, { timeout: 10_000 });
  const after = await page.evaluate(() => (window as any).__RANVORA.arsenal.current().growth);
  expect(after.points.mineral + after.points.flora + after.points.aqua + after.points.beast).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});
