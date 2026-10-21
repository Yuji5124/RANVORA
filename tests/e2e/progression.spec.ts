import { expect, test, type Page } from '@playwright/test';

/* eslint-disable @typescript-eslint/no-explicit-any */

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

/** Freezes the ecosystem, then swings at one creature until it dies. Waits on state, never on time. */
async function killOne(page: Page, species: string): Promise<string> {
  const id = await page.evaluate((sp) => {
    const r = (window as any).__RANVORA;
    r.game.paused = true; // the sim stops; the hero still moves and attacks
    const c = r.sim.creatures.find((x: any) => x.alive && x.species === sp);
    return c.id as string;
  }, species);
  for (let swing = 0; swing < 20; swing++) {
    const alive = await page.evaluate((cid) => {
      const r = (window as any).__RANVORA;
      const c = r.sim.getCreature(cid);
      if (!c?.alive) return false;
      r.player.teleport(c.x - 0.6, c.z);
      r.player.dir = 0; // face +X, toward the creature
      r.player.startAttack();
      return true;
    }, id);
    if (!alive) return id;
    await page.waitForFunction(() => (window as any).__RANVORA.player.attackTime < 0, null, { timeout: 15_000 });
  }
  throw new Error(`${species} ${id} did not die`);
}

test('kill -> weapon EXP -> feed -> save -> reload keeps the growth', async ({ page }) => {
  const errors = await open(page, 'seed=12345');
  await page.evaluate(() => localStorage.removeItem('ranvora.save.v1'));

  // 1. Battle: one slime, EXP exactly once.
  const slime = await killOne(page, 'slime');
  await page.waitForFunction(() => (window as any).__RANVORA.arsenal.current().growth.totalExp > 0, null, { timeout: 15_000 });
  const afterKill = await page.evaluate((cid) => {
    const a = (window as any).__RANVORA.arsenal;
    const again = a.rewardKill(cid, 'slime'); // the same creature cannot pay twice
    const v = a.current();
    return { exp: v.growth.totalExp, again, name: v.item.name };
  }, slime);
  expect(afterKill).toEqual({ exp: 6, again: null, name: '旅人の小剣' });

  // 2. Growth through the UI: open the bag and feed feathers with the real button.
  await page.evaluate(() => {
    const g = (window as any).__RANVORA.game;
    for (let i = 0; i < 4; i++) g.giveMaterial('wind_feather', true);
  });
  await page.keyboard.press('KeyI');
  await expect(page.locator('.panel .weapon')).toBeVisible();
  await expect(page.locator('.panel .weapon-head b')).toHaveText('旅人の小剣');
  const feedBtn = page.locator('.panel button[data-act=feed][data-id=wind_feather]');
  for (let i = 0; i < 3; i++) {
    const before = await page.evaluate(() => (window as any).__RANVORA.inventory.count('wind_feather'));
    await feedBtn.click();
    await page.waitForFunction((n) => (window as any).__RANVORA.inventory.count('wind_feather') === n - 1, before, { timeout: 10_000 });
  }
  const grown = await page.evaluate(() => {
    const r = (window as any).__RANVORA;
    const v = r.arsenal.current();
    return { level: v.growth.level, exp: v.growth.exp, total: v.growth.totalExp, beast: v.growth.points.beast, attack: v.stats.attack, feathers: r.inventory.count('wind_feather') };
  });
  expect(grown.feathers).toBe(1);
  expect(grown.beast).toBe(6);
  expect(grown.total).toBe(6 + 3 * 37);
  expect(grown.level).toBeGreaterThan(1);
  expect(grown.attack).toBeGreaterThan(1.5);
  await expect(page.locator('.panel .weapon .lineage .prop').filter({ hasText: '獣' }).locator('b')).toHaveText('100%');
  await expect(page.locator('.equip .lv')).toHaveText(`Lv${grown.level}`);

  // 3. Save, reload the same world, and resume.
  await page.waitForFunction(() => {
    const raw = localStorage.getItem('ranvora.save.v1');
    return !!raw && JSON.parse(raw).growth.weapons.some((w: any) => w.points.beast === 6);
  }, null, { timeout: 15_000 });
  await page.reload();
  await page.waitForFunction(() => (window as any).__RANVORA?.game, null, { timeout: 30_000 });
  const resumed = await page.evaluate(() => {
    const r = (window as any).__RANVORA;
    const v = r.arsenal.current();
    return { level: v.growth.level, exp: v.growth.exp, total: v.growth.totalExp, beast: v.growth.points.beast, attack: v.stats.attack, feathers: r.inventory.count('wind_feather'), status: r.game.loadResult.status };
  });
  expect(resumed).toEqual({ ...grown, status: 'ok' });
  expect(errors).toEqual([]);
});

test('a broken save does not stop the game and is kept aside', async ({ page }) => {
  // Put the broken save in place before the game boots (a running page saves on exit and would overwrite it).
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('rv-corrupted')) {
      sessionStorage.setItem('rv-corrupted', '1');
      localStorage.setItem('ranvora.save.v1', '{broken');
    }
  });
  await page.goto('/?seed=12345');
  await page.waitForFunction(() => (window as any).__RANVORA?.game, null, { timeout: 30_000 });
  const r = await page.evaluate(() => ({
    status: (window as any).__RANVORA.game.loadResult.status,
    kept: localStorage.getItem('ranvora.save.v1.corrupt'),
    level: (window as any).__RANVORA.arsenal.current().growth.level,
    canvas: !!document.querySelector('#app canvas'),
  }));
  expect(r).toEqual({ status: 'corrupt', kept: '{broken', level: 1, canvas: true });
});
