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

  const lib = await ModelLibrary.load({ forcePrimitive: params.get('models') === 'primitive' });
  const app = document.getElementById('app')!;
  const game = new Game(app, lib);
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
    codex: game.codex,
    worldFingerprint: () => worldFingerprint(game.world),
    models: lib.summary(),
  };
}

boot().catch((err) => {
  console.error(err);
  const el = document.getElementById('loading');
  if (el) el.textContent = `起動に失敗しました: ${err?.message ?? err}`;
});
