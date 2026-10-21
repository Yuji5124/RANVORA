import './styles.css';
import { normalizeSeed } from './core/rng';
import { Game } from './game/game';
import { ModelLibrary } from './render/models';
import { worldFingerprint } from './world/generator';
import { DebugPanel } from './ui/debug';
import { UI } from './ui/ui';

async function boot() {
  const params = new URLSearchParams(window.location.search);
  const seedParam = params.get('seed');
  const seed = seedParam ? normalizeSeed(seedParam) : Math.floor(Math.random() * 1e9);
  const debug = params.get('debug') === '1';
  const loading = document.getElementById('loading');

  // ?models=primitive: no GLBs. ?missingModels=hornfang,mossling: act as if those GLBs failed to load.
  const missing = (params.get('missingModels') ?? '').split(',').filter(Boolean);
  const lib = await ModelLibrary.load({ forcePrimitive: params.get('models') === 'primitive', missing });
  const app = document.getElementById('app')!;
  const game = new Game(app, lib);
  if (params.get('ecosystem') === 'classic') game.ecosystem = 'classic';
  game.start(seed);
  const ui = new UI(game, app);
  game.ui = ui;
  if (!seedParam) {
    const url = new URL(window.location.href);
    url.searchParams.set('seed', String(seed));
    window.history.replaceState(null, '', url);
  }
  if (debug) new DebugPanel(game, app);
  game.run();
  loading?.remove();
  ui.toast('ようこそ、RANVORAへ。世界はもう動き始めている。', 'good');
  if (game.loadResult.status === 'ok') ui.toast(`前回の続きから（${game.arsenal.current().name} Lv${game.arsenal.current().growth.level}）`, 'info');
  if (game.loadResult.status === 'corrupt') ui.toast('保存データが壊れていたため、新しく始めました（元のデータは別に残しています）', 'warn');

  // Handle for automated tests and research in the console.
  (window as unknown as { __RANVORA: unknown }).__RANVORA = {
    game,
    get sim() {
      return game.sim;
    },
    get player() {
      return game.player;
    },
    inventory: game.inventory,
    arsenal: game.arsenal,
    codex: game.codex,
    worldFingerprint: () => worldFingerprint(game.world),
    models: lib.summary(),
    modelReport: () => lib.report(),
    clipOf: (id: string) => game.creatureView.clipOf(id),
    rigStats: () => game.creatureView.rigStats(),
  };
}

boot().catch((err) => {
  console.error(err);
  const el = document.getElementById('loading');
  if (el) el.textContent = `起動に失敗しました: ${err?.message ?? err}`;
});
