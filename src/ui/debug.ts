// Research panel (?debug=1): watch the simulation, pause / speed it up,
// inspect individual creatures and trace the causes of events.

import { formatSimTime, type EventType } from '../core/events';
import { normalizeSeed } from '../core/rng';
import type { Game } from '../game/game';
import { SPECIES, SPECIES_IDS, STATE_LABELS, type CreatureState } from '../sim/species';
import { esc } from './ui';

const SPEEDS = [0.5, 1, 2, 4, 8, 16];
const SPECIES_COLOR = { slime: '#5fd0ff', deer: '#ffb35c', wolf: '#ff5a5a' } as const;

export class DebugPanel {
  readonly el = document.createElement('div');
  private typeFilter: EventType | '' = '';
  private idFilter = '';
  private rareOnly = false;
  private chart: HTMLCanvasElement;
  private lastEventCount = -1;

  constructor(private game: Game, parent: HTMLElement) {
    this.el.className = 'debug';
    this.el.innerHTML = `
      <div class="dbg-head"><b>RANVORA 研究パネル</b><button data-act="collapse">_</button></div>
      <div class="dbg-body">
        <section class="dbg-stats"></section>
        <section>
          <div class="row">
            <button data-act="pause" class="pause">⏸ 一時停止</button>
            ${SPEEDS.map((s) => `<button data-act="speed" data-speed="${s}">${s}x</button>`).join('')}
          </div>
          <div class="row">
            <input class="seed" placeholder="シード (数字/文字)" />
            <button data-act="regen">再生成</button>
            <button data-act="random">ランダム</button>
          </div>
          <div class="row">
            <label>カメラ角度 <input type="range" min="0" max="50" value="30" class="tilt"></label>
            <label><input type="checkbox" class="emotes" checked> 感情表示</label>
          </div>
        </section>
        <section><h4>個体数の推移</h4><canvas class="chart" width="300" height="80"></canvas></section>
        <section class="dbg-states"></section>
        <section><h4>個体一覧 <small>（クリックで追跡）</small></h4><div class="dbg-creatures"></div></section>
        <section class="dbg-selected"></section>
        <section>
          <h4>イベントログ</h4>
          <div class="row">
            <select class="type"><option value="">すべての種類</option></select>
            <input class="idf" placeholder="個体IDで絞り込み" />
            <label><input type="checkbox" class="rare"> ★のみ</label>
            <button data-act="export">JSON出力</button>
          </div>
          <div class="dbg-events"></div>
        </section>
      </div>`;
    parent.appendChild(this.el);
    this.chart = this.el.querySelector('.chart')!;
    this.el.addEventListener('click', (e) => this.onClick(e));
    const q = <T extends HTMLElement>(s: string) => this.el.querySelector(s) as T;
    q<HTMLInputElement>('.seed').value = String(game.seed);
    q<HTMLInputElement>('.tilt').addEventListener('input', (e) => {
      game.tilt = ((e.target as HTMLInputElement).valueAsNumber * Math.PI) / 180;
    });
    q<HTMLInputElement>('.emotes').addEventListener('change', (e) => {
      game.creatureView.showEmotes = (e.target as HTMLInputElement).checked;
    });
    q<HTMLSelectElement>('.type').addEventListener('change', (e) => {
      this.typeFilter = (e.target as HTMLSelectElement).value as EventType | '';
      this.lastEventCount = -1;
    });
    q<HTMLInputElement>('.idf').addEventListener('input', (e) => {
      this.idFilter = (e.target as HTMLInputElement).value.trim().toUpperCase();
      this.lastEventCount = -1;
    });
    q<HTMLInputElement>('.rare').addEventListener('change', (e) => {
      this.rareOnly = (e.target as HTMLInputElement).checked;
      this.lastEventCount = -1;
    });
    q<HTMLInputElement>('.seed').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.regen();
    });
    // Click on the map to select a creature.
    game.renderer.domElement.addEventListener('pointerdown', (e) => this.pickAt(e));
    setInterval(() => this.update(), 300);
  }

  private regen(seedText?: string) {
    const input = this.el.querySelector('.seed') as HTMLInputElement;
    const seed = normalizeSeed(seedText ?? (input.value || String(Date.now())));
    input.value = String(seed);
    this.game.regenerate(seed);
    this.lastEventCount = -1;
  }

  private pickAt(e: PointerEvent) {
    const g = this.game;
    const rect = g.renderer.domElement.getBoundingClientRect();
    const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const ny = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    // Intersect the camera ray with the ground plane y = 0.
    const origin = g.camera.position.clone();
    const ndc = { x: nx, y: ny };
    const near = g.camera.position.clone().set(ndc.x, ndc.y, -1).unproject(g.camera);
    const far = origin.set(ndc.x, ndc.y, 1).unproject(g.camera);
    const dir = far.sub(near).normalize();
    if (Math.abs(dir.y) < 1e-6) return;
    const t = -near.y / dir.y;
    const hit = near.add(dir.multiplyScalar(t));
    const c = g.creatureView.pick(g.sim, hit.x, hit.z);
    if (c) this.select(c.id);
  }

  private select(id: string) {
    this.game.creatureView.selectedId = id;
    this.game.followId = id;
    this.idFilter = id;
    (this.el.querySelector('.idf') as HTMLInputElement).value = id;
    this.lastEventCount = -1;
    this.update();
  }

  private onClick(e: MouseEvent) {
    const el = (e.target as HTMLElement).closest('[data-act]') as HTMLElement | null;
    if (!el) return;
    const g = this.game;
    switch (el.dataset.act) {
      case 'collapse':
        this.el.classList.toggle('collapsed');
        break;
      case 'pause':
        g.paused = !g.paused;
        break;
      case 'speed':
        g.speed = Number(el.dataset.speed);
        g.paused = false;
        break;
      case 'regen':
        this.regen();
        break;
      case 'random':
        this.regen(String(Math.floor(Math.random() * 1e9)));
        break;
      case 'select':
        this.select(el.dataset.id!);
        break;
      case 'unselect':
        g.creatureView.selectedId = null;
        g.followId = null;
        break;
      case 'export':
        this.exportJson();
        break;
    }
    this.update();
  }

  private exportJson() {
    const g = this.game;
    const data = {
      seed: g.seed,
      simTime: g.sim.time,
      tick: g.sim.tick,
      fingerprint: g.sim.fingerprint(),
      population: g.sim.popHistory,
      events: g.sim.events.events,
      creatures: g.sim.creatures.filter((c) => c.alive).map((c) => ({
        id: c.id,
        species: c.species,
        state: c.state,
        x: +c.x.toFixed(2),
        z: +c.z.toFixed(2),
        hp: +c.hp.toFixed(2),
        hunger: +c.hunger.toFixed(1),
        fear: +c.fear.toFixed(1),
        speedTrait: +c.speedTrait.toFixed(3),
        visionTrait: +c.visionTrait.toFixed(3),
        generation: c.generation,
        parent: c.parent,
        kills: c.kills,
      })),
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `ranvora-seed${g.seed}-t${Math.round(g.sim.time)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  update() {
    if (this.el.classList.contains('collapsed')) return;
    const g = this.game;
    const sim = g.sim;
    const q = (s: string) => this.el.querySelector(s) as HTMLElement;

    // Speed buttons.
    this.el.querySelectorAll<HTMLButtonElement>('[data-act=speed]').forEach((b) => b.classList.toggle('on', Number(b.dataset.speed) === g.speed && !g.paused));
    q('.pause').textContent = g.paused ? '▶ 再開' : '⏸ 一時停止';
    q('.pause').classList.toggle('on', g.paused);

    q('.dbg-stats').innerHTML = `
      <div class="kv"><span>FPS</span><b>${g.fps.toFixed(0)}</b><span>シード</span><b>${g.seed}</b></div>
      <div class="kv"><span>経過</span><b>${formatSimTime(sim.time)}</b><span>tick</span><b>${sim.tick}</b></div>
      <div class="kv"><span>速度</span><b>${g.paused ? '停止' : g.speed + 'x'}</b><span>昼夜</span><b>${sim.isNight ? '夜' : '昼'} (${(sim.daylight * 100).toFixed(0)}%)</b></div>
      <div class="kv"><span>植物</span><b>${sim.aliveplants()}</b><span>アイテム</span><b>${sim.pickups.filter((p) => p.alive).length}</b></div>
      <div class="kv"><span>イベント</span><b>${sim.events.events.length}</b><span>モデル</span><b>${g.lib.summary()}</b></div>
      <div class="kv"><span>指紋</span><b>${sim.fingerprint().toString(16)}</b></div>`;

    // States table.
    const states = sim.stateCounts();
    const rows = SPECIES_IDS.map((s) => {
      const alive = sim.creatures.filter((c) => c.alive && c.species === s);
      const avg = (f: (c: (typeof alive)[number]) => number) => (alive.length ? alive.reduce((a, c) => a + f(c), 0) / alive.length : 0);
      const st = Object.entries(states)
        .filter(([k]) => k.startsWith(s + ':'))
        .map(([k, n]) => `${STATE_LABELS[k.split(':')[1] as CreatureState]} ${n}`)
        .join(' / ');
      return `<tr><td style="color:${SPECIES_COLOR[s]}">${SPECIES[s].name}</td><td>${alive.length}</td><td>${avg((c) => c.hunger).toFixed(0)}</td><td>${avg((c) => c.speedTrait).toFixed(2)}</td><td>${avg((c) => c.generation).toFixed(1)}</td><td class="st">${st || '-'}</td></tr>`;
    }).join('');
    q('.dbg-states').innerHTML = `<h4>種ごとの状態</h4><table><tr><th>種</th><th>数</th><th>空腹</th><th>速度</th><th>世代</th><th>行動状態</th></tr>${rows}</table>`;

    // Creature list.
    const list = sim.creatures
      .filter((c) => c.alive)
      .slice(0, 80)
      .map(
        (c) =>
          `<button class="cr ${g.creatureView.selectedId === c.id ? 'on' : ''}" data-act="select" data-id="${c.id}" style="border-color:${SPECIES_COLOR[c.species]}">${c.id}${c.variant ? '★' : ''}${c.giant ? '◎' : ''}<small>${STATE_LABELS[c.state]}</small></button>`,
      )
      .join('');
    q('.dbg-creatures').innerHTML = list;

    // Selected creature.
    const sel = g.creatureView.selectedId ? sim.getCreature(g.creatureView.selectedId) : undefined;
    q('.dbg-selected').innerHTML = sel
      ? `<h4>個体 ${sel.id} ${sel.alive ? '' : '（死亡）'} <button data-act="unselect">解除</button></h4>
        <div class="kv"><span>種</span><b>${SPECIES[sel.species].name}${sel.variant ? '（変異）' : ''}</b><span>状態</span><b>${STATE_LABELS[sel.state]}</b></div>
        <div class="kv"><span>HP</span><b>${sel.hp.toFixed(1)}/${sel.maxHp}</b><span>空腹</span><b>${sel.hunger.toFixed(0)}</b></div>
        <div class="kv"><span>恐怖</span><b>${sel.fear.toFixed(0)}</b><span>体力</span><b>${sel.stamina.toFixed(0)}</b></div>
        <div class="kv"><span>速度</span><b>${(SPECIES[sel.species].speed * sel.speedTrait).toFixed(2)}</b><span>視界</span><b>${(SPECIES[sel.species].vision * sel.visionTrait).toFixed(1)}</b></div>
        <div class="kv"><span>年齢</span><b>${sel.age.toFixed(0)}/${sel.lifespan.toFixed(0)}</b><span>世代</span><b>${sel.generation}</b></div>
        <div class="kv"><span>親</span><b>${sel.parent ?? '-'}</b><span>目標</span><b>${sel.targetId && isNaN(Number(sel.targetId)) ? sel.targetId : sel.targetId ? '植物#' + sel.targetId : '-'}</b></div>
        <div class="kv"><span>捕食</span><b>${sel.kills}</b><span>食事</span><b>${sel.meals}</b></div>`
      : '';

    this.drawChart();
    this.updateEvents();
  }

  private updateEvents() {
    const sim = this.game.sim;
    const sel = this.el.querySelector('.type') as HTMLSelectElement;
    const types = [...sim.events.counts.keys()].sort();
    if (sel.options.length - 1 !== types.length) {
      const cur = sel.value;
      sel.innerHTML = `<option value="">すべての種類</option>${types.map((t) => `<option value="${t}">${t} (${sim.events.count(t)})</option>`).join('')}`;
      sel.value = cur;
    }
    if (sim.events.events.length === this.lastEventCount) return;
    this.lastEventCount = sim.events.events.length;
    const list = sim.events.events
      .filter(
        (e) =>
          (!this.typeFilter || e.type === this.typeFilter) &&
          (!this.rareOnly || e.rare) &&
          (!this.idFilter || e.actor === this.idFilter || e.target === this.idFilter || e.message.includes(this.idFilter)),
      )
      .slice(-120)
      .reverse();
    (this.el.querySelector('.dbg-events') as HTMLElement).innerHTML = list
      .map(
        (e) =>
          `<div class="ev ${e.rare ? 'rare' : ''}"><time>${formatSimTime(e.t)}</time><code>${e.type}</code> ${esc(e.message)}${
            e.actor || e.target ? `<small> ${e.actor ? '原因:' + linkId(e.actor) : ''} ${e.target ? '対象:' + linkId(e.target) : ''}</small>` : ''
          }</div>`,
      )
      .join('');
  }

  private drawChart() {
    const hist = this.game.sim.popHistory;
    const g = this.chart.getContext('2d')!;
    const W = this.chart.width;
    const H = this.chart.height;
    g.clearRect(0, 0, W, H);
    g.fillStyle = 'rgba(255,255,255,0.05)';
    g.fillRect(0, 0, W, H);
    if (hist.length < 2) return;
    const data = hist.slice(-120);
    const max = Math.max(10, ...data.map((d) => Math.max(d.slime, d.deer, d.wolf * 3)));
    const line = (f: (d: (typeof data)[number]) => number, color: string) => {
      g.strokeStyle = color;
      g.lineWidth = 1.5;
      g.beginPath();
      data.forEach((d, i) => {
        const x = (i / (data.length - 1)) * W;
        const y = H - (f(d) / max) * (H - 6) - 3;
        if (i === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      });
      g.stroke();
    };
    line((d) => d.slime, SPECIES_COLOR.slime);
    line((d) => d.deer, SPECIES_COLOR.deer);
    line((d) => d.wolf * 3, SPECIES_COLOR.wolf);
    g.fillStyle = '#aaa';
    g.font = '10px sans-serif';
    g.fillText('オオカミは×3表示', W - 92, 11);
  }
}

function linkId(id: string): string {
  if (id === 'PLAYER' || id.startsWith('ITM') || id.startsWith('PK')) return `<code>${esc(id)}</code>`;
  return `<a data-act="select" data-id="${esc(id)}">${esc(id)}</a>`;
}
