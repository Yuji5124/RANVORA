import { expect, test, type Page } from '@playwright/test';

/* eslint-disable @typescript-eslint/no-explicit-any */
type R = any;

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

test('game boots, renders and has no fatal console errors', async ({ page }) => {
  const errors = await open(page, 'seed=12345');
  await expect(page.locator('#app canvas').first()).toBeVisible();
  await expect(page.locator('.hearts .heart')).toHaveCount(5);
  const info = await page.evaluate(() => {
    const r = (window as any).__RANVORA as R;
    return { models: r.models, creatures: r.sim.count(), seed: r.game.seed };
  });
  expect(info.seed).toBe(12345);
  expect(info.creatures).toBeGreaterThan(10);
  expect(info.models).toMatch(/GLB \d+\/22/); // 18 models + 4 rigged creatures (Phase 2B)
  await page.waitForTimeout(1500);
  expect(errors).toEqual([]);
});

test('hero moves with the keyboard', async ({ page }) => {
  await open(page, 'seed=12345');
  const before = await page.evaluate(() => ({ x: (window as any).__RANVORA.player.x, z: (window as any).__RANVORA.player.z }));
  // Hold the keys until the hero has actually moved (state-based, not a fixed time):
  // slow software rendering advances fewer frames per second.
  const moved = (b: { x: number; z: number }) => {
    const p = (window as any).__RANVORA.player;
    return Math.hypot(p.x - b.x, p.z - b.z) > 0.5;
  };
  await page.keyboard.down('KeyS');
  await page.keyboard.down('KeyD');
  await page.waitForFunction(moved, before, { timeout: 30_000 });
  await page.keyboard.up('KeyS');
  await page.keyboard.up('KeyD');
  const after = await page.evaluate(() => ({ x: (window as any).__RANVORA.player.x, z: (window as any).__RANVORA.player.z }));
  expect(Math.hypot(after.x - before.x, after.z - before.z)).toBeGreaterThan(0.5);
});

test('creatures act autonomously without input', async ({ page }) => {
  await open(page, 'seed=4242');
  type Snap = { id: string; x: number; z: number }[];
  const snap = (): Promise<Snap> =>
    page.evaluate(() => {
      const r = (window as any).__RANVORA as R;
      r.game.speed = 8;
      return r.sim.creatures.filter((c: any) => c.alive).map((c: any) => ({ id: c.id, x: c.x, z: c.z }));
    });
  const a = await snap();
  await page.waitForTimeout(2500);
  const b = await snap();
  const moved = b.filter((c) => {
    const o = a.find((x) => x.id === c.id);
    return o && Math.hypot(o.x - c.x, o.z - c.z) > 0.5;
  });
  expect(moved.length).toBeGreaterThan(5);
});

test('pick up materials, synthesize, and register in the codex', async ({ page }) => {
  await open(page, 'seed=12345');
  await page.evaluate(() => (window as any).__RANVORA.codex.clear());
  for (let i = 0; i < 2; i++) {
    await page.evaluate(() => (window as any).__RANVORA.game.debugTeleportToPickup());
    await page.keyboard.press('KeyE');
    await page.waitForTimeout(150);
  }
  const mats = await page.evaluate(() => (window as any).__RANVORA.inventory.totalMaterials());
  expect(mats).toBe(2);
  await page.keyboard.press('KeyC');
  const chips = page.locator('.panel [data-act=slot]');
  await chips.first().click();
  // Second ingredient: another chip if available, otherwise the same material.
  const n = await chips.count();
  await chips.nth(n > 1 ? 1 : 0).click();
  await page.locator('.panel [data-act=craft]').click();
  await expect(page.locator('.panel .result h3')).toBeVisible();
  const codex = await page.evaluate(() => {
    const c = (window as any).__RANVORA.codex;
    return { materials: c.list('material').length, items: c.list('item').length, stored: !!localStorage.getItem('ranvora.codex.v1') };
  });
  expect(codex.materials).toBeGreaterThanOrEqual(1);
  expect(codex.items).toBe(1);
  expect(codex.stored).toBe(true);
  await page.keyboard.press('Escape');
  await page.keyboard.press('KeyB');
  await expect(page.locator('.panel .entry').first()).toBeVisible();
});

test('seed changes the world; same seed reproduces the simulation', async ({ page }) => {
  const runFor = async (seed: number) => {
    await open(page, `seed=${seed}`);
    return page.evaluate(() => {
      const r = (window as any).__RANVORA as R;
      r.game.paused = true;
      // Fresh simulation from the same seed, stepped headlessly.
      r.game.start(r.game.seed);
      r.game.paused = true;
      r.game.sim.player = null;
      const sim = r.game.sim;
      sim.player = null;
      for (let i = 0; i < 1500; i++) sim.step();
      return { world: r.worldFingerprint(), sim: sim.fingerprint() };
    });
  };
  const a1 = await runFor(777);
  const a2 = await runFor(777);
  const b = await runFor(778);
  expect(a2.world).toBe(a1.world);
  expect(a2.sim).toBe(a1.sim);
  expect(b.world).not.toBe(a1.world);
});

test('research panel shows with ?debug=1 and controls the simulation', async ({ page }) => {
  await open(page, 'seed=12345&debug=1');
  await expect(page.locator('.debug')).toBeVisible();
  await page.locator('.debug [data-act=speed][data-speed="16"]').click();
  // Wait for simulated time to pass 5 s instead of a fixed real-time delay.
  await page.waitForFunction(() => (window as any).__RANVORA.sim.time > 5, null, { timeout: 30_000 });
  const t1 = await page.evaluate(() => (window as any).__RANVORA.sim.time);
  expect(t1).toBeGreaterThan(5);
  await page.locator('.debug [data-act=pause]').click();
  const t2 = await page.evaluate(() => (window as any).__RANVORA.sim.time);
  // While paused, the clock must not move across several rendered frames.
  await page.evaluate(() => new Promise((r) => { let n = 0; const f = () => (++n >= 10 ? r(null) : requestAnimationFrame(f)); requestAnimationFrame(f); }));
  const t3 = await page.evaluate(() => (window as any).__RANVORA.sim.time);
  expect(t3).toBe(t2);
  await expect(page.locator('.debug .dbg-events .ev').first()).toBeVisible();
  await page.locator('.debug .seed').fill('99');
  await page.locator('.debug [data-act=regen]').click();
  expect(await page.evaluate(() => (window as any).__RANVORA.game.seed)).toBe(99);
});
