// DOM overlay: HUD, toasts, world-event ticker, minimap and the
// inventory / crafting / codex panels.

import type { CodexEntry } from '../codex/codex';
import { formatSimTime, type WorldEvent, type EventType } from '../core/events';
import type { Game, GameUI } from '../game/game';
import { MATERIALS, MATERIAL_IDS, PROP_KEYS, PROP_LABELS, type MaterialId, type Props } from '../items/materials';
import { ELEMENT_LABEL, categoryLabel, itemIngredient, materialIngredient, type CraftedItem, type Ingredient } from '../items/synthesis';
import { craftedModel, materialModel } from '../render/itemModels';
import { Thumbnailer } from '../render/thumbnails';
import { SPECIES, SPECIES_IDS, type Species } from '../sim/species';
import { Minimap } from './minimap';
import { expToNext, feedSourceOfItem, feedSourceOfMaterial, LINEAGE_COLORS, LINEAGE_LABELS, LINEAGES } from '../progression';

type PanelName = 'inventory' | 'codex' | 'craft';

const TICKER_HIDDEN: EventType[] = ['spawn_pickup', 'hunt_start', 'split', 'player_discovery', 'plant_withered', 'hunt_fail'];

export function esc(s: unknown): string {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export function propBars(p: Props): string {
  return `<div class="props">${PROP_KEYS.map(
    (k) =>
      `<div class="prop"><span>${PROP_LABELS[k]}</span><div class="bar"><i style="width:${Math.min(100, (p[k] / 12) * 100)}%"></i></div><b>${p[k].toFixed(1)}</b></div>`,
  ).join('')}</div>`;
}

export class UI implements GameUI {
  readonly root: HTMLElement;
  private hud: HTMLElement;
  private hearts: HTMLElement;
  private info: HTMLElement;
  private equip: HTMLElement;
  private ticker: HTMLElement;
  private toasts: HTMLElement;
  private panel: HTMLElement;
  private minimap: Minimap;
  private thumbs = new Thumbnailer(96);
  private open: PanelName | null = null;
  private codexTab: 'creature' | 'material' | 'item' | 'event' = 'creature';
  private craftSlots: [Ingredient | null, Ingredient | null] = [null, null];
  private lastCraft: CraftedItem | null = null;

  constructor(private game: Game, parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'ui';
    this.root.innerHTML = `
      <div class="hud">
        <div class="hud-left">
          <div class="hearts"></div>
          <div class="info"></div>
        </div>
        <div class="ticker"></div>
        <div class="hud-right"></div>
      </div>
      <div class="equip"></div>
      <div class="keys">
        <span><b>WASD</b>移動</span><span><b>Shift</b>ダッシュ</span><span><b>Space</b>攻撃</span><span><b>E</b>調べる</span>
        <span><b>Q</b>魔法</span><span><b>I</b>持ち物</span><span><b>C</b>合成</span><span><b>B</b>図鑑</span>
      </div>
      <div class="toasts"></div>
      <div class="panel hidden"></div>`;
    parent.appendChild(this.root);
    this.hud = this.root.querySelector('.hud')!;
    this.hearts = this.root.querySelector('.hearts')!;
    this.info = this.root.querySelector('.info')!;
    this.equip = this.root.querySelector('.equip')!;
    this.ticker = this.root.querySelector('.ticker')!;
    this.toasts = this.root.querySelector('.toasts')!;
    this.panel = this.root.querySelector('.panel')!;
    this.minimap = new Minimap(game);
    this.hud.querySelector('.hud-right')!.appendChild(this.minimap.canvas);
    this.panel.addEventListener('click', (e) => this.onPanelClick(e));
    game.inventory.onChange(() => {
      this.renderEquip();
      if (this.open === 'inventory' || this.open === 'craft') this.renderPanel();
    });
    game.arsenal.onChange(() => {
      this.renderEquip();
      if (this.open === 'inventory') this.renderPanel();
    });
    game.codex.onChange(() => {
      if (this.open === 'codex') this.renderPanel();
    });
    setInterval(() => this.updateHud(), 200);
    const draw = () => {
      this.minimap.draw();
      setTimeout(draw, 250);
    };
    draw();
  }

  // ---------------------------------------------------------------- GameUI

  toast(msg: string, kind: 'info' | 'good' | 'warn' | 'rare' = 'info') {
    const el = document.createElement('div');
    el.className = `toast ${kind}`;
    el.textContent = msg;
    this.toasts.appendChild(el);
    while (this.toasts.children.length > 4) this.toasts.firstChild!.remove();
    setTimeout(() => el.classList.add('out'), 2600);
    setTimeout(() => el.remove(), 3200);
  }

  worldEvent(e: WorldEvent) {
    if (TICKER_HIDDEN.includes(e.type)) return;
    const el = document.createElement('div');
    el.className = `tick ${e.rare ? 'rare' : ''}`;
    el.innerHTML = `<time>${formatSimTime(e.t)}</time>${e.rare ? '<em>★</em>' : ''}${esc(e.message)}`;
    this.ticker.appendChild(el);
    while (this.ticker.children.length > 5) this.ticker.firstChild!.remove();
    setTimeout(() => el.classList.add('out'), 9000);
    setTimeout(() => el.remove(), 9800);
  }

  refresh() {
    this.ticker.innerHTML = '';
    this.renderEquip();
    this.updateHud();
    if (this.open) this.renderPanel();
  }

  isPanelOpen() {
    return this.open !== null;
  }

  togglePanel(name: PanelName) {
    this.open = this.open === name ? null : name;
    this.panel.classList.toggle('hidden', !this.open);
    if (this.open) this.renderPanel();
  }

  closePanels() {
    this.open = null;
    this.panel.classList.add('hidden');
  }

  // ---------------------------------------------------------------- HUD

  private updateHud() {
    const g = this.game;
    const p = g.player;
    let h = '';
    for (let i = 0; i < p.maxHp / 2; i++) {
      const v = p.hp - i * 2;
      h += `<span class="heart ${v >= 2 ? 'full' : v === 1 ? 'half' : 'empty'}">♥</span>`;
    }
    this.hearts.innerHTML = h;
    const tod = g.sim.timeOfDay;
    const icon = g.sim.isNight ? '🌙' : tod < 0.3 ? '🌅' : '☀️';
    this.info.innerHTML = `${icon} ${formatSimTime(g.sim.time)}　シード <b>${g.seed}</b>　<span class="pop">${g.sim.roster.map((s) => `${SPECIES[s].name} ${g.sim.count(s)}`).join(' ・ ')}</span>`;
  }

  private renderEquip() {
    const inv = this.game.inventory;
    const slot = (label: string, id: string | null) => {
      const it = inv.get(id);
      return `<div class="slot ${it ? 'on' : ''}" title="${esc(it?.name ?? label)}">${it ? `<img src="${this.itemThumb(it)}">` : `<span>${label}</span>`}</div>`;
    };
    const w = this.game.arsenal.current();
    const weaponSlot = slot('武器', inv.equippedWeapon).replace('</div>', `<i class="lv" title="${esc(w.name)}">Lv${w.growth.level}</i></div>`);
    this.equip.innerHTML = `${weaponSlot}${slot('魔法', inv.equippedSpell)}${slot('お守り', inv.equippedCharm)}<div class="slot mats"><span>素材</span><b>${inv.totalMaterials()}</b></div>`;
  }

  // ---------------------------------------------------------------- thumbnails

  private matThumb(id: MaterialId) {
    return this.thumbs.get(`mat:${id}`, () => materialModel(id));
  }

  private itemThumb(it: CraftedItem) {
    return this.thumbs.get(`item:${it.id}`, () => craftedModel(it));
  }

  private creatureThumb(species: Species, variant = '') {
    return this.thumbs.get(`cr:${species}:${variant}`, () => {
      const o = this.game.lib.create(species);
      if (variant === 'giant') o.scale.setScalar(1.6);
      return o;
    });
  }

  // ---------------------------------------------------------------- panels

  private renderPanel() {
    if (!this.open) return;
    const title = { inventory: '持ち物 (I)', craft: '未知の合成 (C)', codex: '図鑑 (B)' }[this.open];
    let body = '';
    if (this.open === 'inventory') body = this.inventoryHtml();
    if (this.open === 'craft') body = this.craftHtml();
    if (this.open === 'codex') body = this.codexHtml();
    this.panel.innerHTML = `<div class="panel-head"><h2>${title}</h2><button data-act="close" aria-label="閉じる">✕</button></div><div class="panel-body">${body}</div>`;
  }

  private inventoryHtml(): string {
    const inv = this.game.inventory;
    const mats = MATERIAL_IDS.map((id) => {
      const n = inv.count(id);
      const m = MATERIALS[id];
      const src = feedSourceOfMaterial(id);
      return `<div class="card mat ${n ? '' : 'dim'}" title="${esc(m.description)}"><img src="${this.matThumb(id)}"><div><b>${m.name}</b><small>× ${n}</small><small class="feedinfo">+${src.exp} EXP・${src.lineage ? LINEAGE_LABELS[src.lineage] : '無'}</small>${n ? `<button class="feed" data-act="feed" data-id="${id}" title="手に持った武器に取り込む">取り込む</button>` : ''}</div></div>`;
    }).join('');
    const items = [...inv.items.values()]
      .map(({ item, count }) => {
        const equipped = [inv.equippedWeapon, inv.equippedSpell, inv.equippedCharm].includes(item.id);
        const action =
          item.category === 'potion'
            ? `<button data-act="use" data-id="${item.id}">使う</button>`
            : item.category === 'junk'
              ? ''
              : `<button data-act="use" data-id="${item.id}">${equipped ? '外す' : '装備'}</button>`;
        const src = item.category === 'weapon' ? null : feedSourceOfItem(item);
        const feedBtn = src ? `<button class="feed" data-act="feed" data-id="${item.id}" title="手に持った武器に取り込む（+${src.exp} EXP・${src.lineage ? LINEAGE_LABELS[src.lineage] : '無'}）">取り込む</button>` : '';
        return `<div class="card item ${equipped ? 'equipped' : ''}"><img src="${this.itemThumb(item)}"><div><b>${esc(item.name)}</b><small>${categoryLabel(item.category)}・${ELEMENT_LABEL[item.element]} × ${count}</small><small>${statText(item)}</small></div>${action}${feedBtn}</div>`;
      })
      .join('');
    return `${this.weaponHtml()}<h3>素材</h3><div class="grid">${mats}</div><h3>合成したアイテム</h3><div class="list">${items || '<p class="muted">まだ何も合成していない。Cキーで合成してみよう。</p>'}</div>
      <p class="muted">武器は攻撃力が、魔法は Q キーで発動、お守りは移動速度が上がる。素材や合成アイテムを「取り込む」と、手に持った武器が経験値と系統を得る。</p>`;
  }

  /** The weapon in hand: level, EXP, stats, lineage shares and the next limit break. */
  private weaponHtml(): string {
    const g = this.game;
    const w = g.arsenal.current();
    const gr = w.growth;
    const atCap = gr.level >= w.cap;
    const need = expToNext(gr.level);
    const pct = atCap ? 100 : Math.round((gr.exp / need) * 100);
    const total = LINEAGES.reduce((t, l) => t + gr.points[l], 0);
    const bars = LINEAGES.map((l) => {
      const share = total ? (gr.points[l] / total) * 100 : 0;
      return `<div class="prop"><span>${LINEAGE_LABELS[l]}</span><div class="bar"><i style="width:${share}%;background:${LINEAGE_COLORS[l]}"></i></div><b>${Math.round(share)}%</b></div>`;
    }).join('');
    const chk = g.arsenal.limitBreakCheck();
    const cost = chk.cost
      ? chk.cost
          .map(({ id, qty }) => {
            const have = g.inventory.count(id);
            return `<span class="tag ${have < qty ? 'short' : ''}">${esc(MATERIALS[id as MaterialId]?.name ?? id)} ${have}/${qty}</span>`;
          })
          .join('')
      : '';
    const formText = gr.form ? `${LINEAGE_LABELS[gr.form.lineage]}に進化（段階 ${gr.form.stage}）` : `未進化（生まれは${LINEAGE_LABELS[gr.innate]}）`;
    return `<h3>手に持った武器</h3><div class="weapon">
      <div class="weapon-head"><b>${esc(w.name)}</b><span class="lvl">Lv ${gr.level}<small> / ${w.cap}</small></span></div>
      <div class="xp"><div class="bar"><i style="width:${pct}%"></i></div><small>${atCap ? 'レベル上限。限界突破で上限が上がる' : `次のレベルまで ${need - gr.exp} EXP`}</small></div>
      <p class="kv">攻撃 <b>${w.stats.attack}</b>　射程 ${w.stats.range}　会心 ${Math.round(w.stats.crit * 100)}%　${formText}</p>
      <div class="props lineage">${bars}</div>
      <div class="limit">${chk.cost ? `<span>次の限界突破</span>${cost}` : '<span>これ以上は限界突破できない</span>'}<button data-act="break" ${chk.ok ? '' : 'disabled'}>限界突破</button></div>
      ${chk.ok || !chk.cost ? '' : `<p class="muted">${esc(chk.reason ?? '')}。取り込んだ系統のうち1つが50%を超えていると、突破のときに進化する。</p>`}
    </div>`;
  }

  private craftHtml(): string {
    const inv = this.game.inventory;
    const slot = (i: 0 | 1) => {
      const s = this.craftSlots[i];
      return `<div class="craft-slot ${s ? 'filled' : ''}" data-act="unslot" data-slot="${i}">${s ? `<b>${esc(s.name)}</b>` : '<span>素材を選ぶ</span>'}</div>`;
    };
    const avail = (id: string) => inv.count(id) - this.craftSlots.filter((s) => s?.id === id).length;
    const mats = MATERIAL_IDS.filter((id) => inv.count(id) > 0)
      .map(
        (id) =>
          `<button class="chip" data-act="slot" data-id="${id}" ${avail(id) <= 0 ? 'disabled' : ''}><img src="${this.matThumb(id)}">${MATERIALS[id].name} ×${inv.count(id)}</button>`,
      )
      .join('');
    const items = [...inv.items.values()]
      .map(
        ({ item, count }) =>
          `<button class="chip" data-act="slot" data-id="${item.id}" ${avail(item.id) <= 0 ? 'disabled' : ''}><img src="${this.itemThumb(item)}">${esc(item.name)} ×${count}</button>`,
      )
      .join('');
    const ready = this.craftSlots[0] && this.craftSlots[1];
    const res = this.lastCraft;
    const result = res
      ? `<div class="result"><img src="${this.itemThumb(res)}"><div>
          <h3>${esc(res.name)}</h3>
          <p>${categoryLabel(res.category)}・属性 ${ELEMENT_LABEL[res.element]}　<code>${res.id}</code></p>
          <p>反応：${res.reactions.length ? res.reactions.map((r) => `<span class="tag">${r}</span>`).join('') : 'なし'} ${res.trait ? `<span class="tag rare">${res.trait}</span>` : ''}</p>
          <p>${statText(res)}</p>${propBars(res.props)}</div></div>`
      : '<p class="muted">2つの素材の「性質」が反応しあって、何が生まれるかが決まる。同じ世界で同じ組み合わせなら、結果は同じになる。</p>';
    return `<div class="craft-row">${slot(0)}<span class="plus">＋</span>${slot(1)}<button class="primary" data-act="craft" ${ready ? '' : 'disabled'}>合成する</button></div>
      <h3>素材</h3><div class="chips">${mats || '<p class="muted">素材を持っていない。E で拾い、Space で木や岩を叩こう。</p>'}</div>
      ${items ? `<h3>合成アイテムも素材にできる</h3><div class="chips">${items}</div>` : ''}
      ${result}`;
  }

  private codexHtml(): string {
    const cx = this.game.codex;
    const tabs = (
      [
        ['creature', '生き物'],
        ['material', '素材'],
        ['item', '合成アイテム'],
        ['event', '珍しい出来事'],
      ] as const
    )
      .map(([k, l]) => `<button class="tab ${this.codexTab === k ? 'on' : ''}" data-act="tab" data-tab="${k}">${l} <small>${cx.list(k).length}</small></button>`)
      .join('');
    const date = (e: CodexEntry) => new Date(e.discoveredAt).toLocaleString('ja-JP');
    let body = '';
    if (this.codexTab === 'creature') {
      const known = cx.list('creature');
      body = known
        .map((e) => {
          const d = e.data as { species: Species; variant: boolean; giant: boolean; speed: number; vision: number; hp: number; description: string; firstId: string };
          return `<div class="entry"><img src="${this.creatureThumb(d.species, d.giant ? 'giant' : d.variant ? 'variant' : '')}"><div><h3>${esc(e.name)}${d.variant || d.giant ? ' <span class="tag rare">珍種</span>' : ''}</h3>
            <p>${esc(d.description)}</p><p class="kv">HP ${d.hp}　速度 ${d.speed}　視界 ${d.vision}　最初の個体 <code>${esc(d.firstId)}</code></p>
            <p class="muted">発見：${date(e)}（シード ${e.seed}）</p></div></div>`;
        })
        .join('');
      const missing = SPECIES_IDS.filter((s) => this.game.sim.roster.includes(s) && !cx.has(`creature:${s}`));
      body += missing.map(() => `<div class="entry unknown"><div class="q">？</div><div><h3>？？？</h3><p class="muted">まだ見つけていない生き物</p></div></div>`).join('');
    } else if (this.codexTab === 'material') {
      body = MATERIAL_IDS.map((id) => {
        const e = cx.entries[`material:${id}`];
        const m = MATERIALS[id];
        if (!e) return `<div class="entry unknown"><div class="q">？</div><div><h3>？？？</h3><p class="muted">まだ手に入れていない素材</p></div></div>`;
        return `<div class="entry"><img src="${this.matThumb(id)}"><div><h3>${m.name} <small>× ${e.count}回入手</small></h3><p>${esc(m.description)}</p>${propBars(m.props)}<p class="muted">発見：${date(e)}</p></div></div>`;
      }).join('');
    } else if (this.codexTab === 'item') {
      const list = cx.list('item');
      body = list.length
        ? list
            .map((e) => {
              const it = (e.data as { item: CraftedItem }).item;
              const ing = it.ingredients.map((i) => MATERIALS[i as MaterialId]?.name ?? i).join(' ＋ ');
              return `<div class="entry"><img src="${this.itemThumb(it)}"><div><h3>${esc(it.name)} <code>${it.id}</code></h3>
                <p>${categoryLabel(it.category)}・属性 ${ELEMENT_LABEL[it.element]}　${it.reactions.map((r) => `<span class="tag">${r}</span>`).join('')}${it.trait ? `<span class="tag rare">${it.trait}</span>` : ''}</p>
                <p class="kv">材料：${esc(ing)}　${statText(it)}</p>${propBars(it.props)}<p class="muted">発見：${date(e)}（シード ${e.seed}）</p></div></div>`;
            })
            .join('')
        : '<p class="muted">まだ何も合成していない。</p>';
    } else {
      const list = cx.list('event').reverse();
      body = list.length
        ? list
            .map((e) => {
              const d = e.data as { t?: number; actor?: string; target?: string; type?: string };
              return `<div class="entry event"><div class="q star">★</div><div><h3>${esc(e.name)}</h3><p class="kv">${d.type ? `種類 ${esc(d.type)}　` : ''}${d.actor ? `原因 <code>${esc(d.actor)}</code>　` : ''}${d.target ? `対象 <code>${esc(d.target)}</code>　` : ''}${d.t !== undefined ? `世界時間 ${formatSimTime(d.t)}` : ''}</p><p class="muted">記録：${date(e)}（シード ${e.seed}）</p></div></div>`;
            })
            .join('')
        : '<p class="muted">世界で珍しい出来事が起きると、ここに記録される。放置して待ってみよう。</p>';
    }
    return `<div class="tabs">${tabs}</div><div class="entries">${body}</div>`;
  }

  private onPanelClick(e: MouseEvent) {
    const el = (e.target as HTMLElement).closest('[data-act]') as HTMLElement | null;
    if (!el) return;
    const act = el.dataset.act;
    const g = this.game;
    switch (act) {
      case 'close':
        this.closePanels();
        return;
      case 'tab':
        this.codexTab = el.dataset.tab as typeof this.codexTab;
        break;
      case 'use':
        g.useItem(el.dataset.id!);
        break;
      case 'feed':
        g.feedWeapon(el.dataset.id!);
        break;
      case 'break':
        g.limitBreakWeapon();
        break;
      case 'slot': {
        const id = el.dataset.id!;
        const ing = id in MATERIALS ? materialIngredient(id as MaterialId) : g.inventory.get(id) ? itemIngredient(g.inventory.get(id)!) : null;
        if (!ing) break;
        if (!this.craftSlots[0]) this.craftSlots[0] = ing;
        else if (!this.craftSlots[1]) this.craftSlots[1] = ing;
        else this.craftSlots = [this.craftSlots[1], ing];
        break;
      }
      case 'unslot':
        this.craftSlots[Number(el.dataset.slot)] = null;
        break;
      case 'craft': {
        const [a, b] = this.craftSlots;
        if (a && b) {
          this.lastCraft = g.craft(a, b);
          this.craftSlots = [null, null];
        }
        break;
      }
    }
    this.renderPanel();
  }
}

function statText(it: CraftedItem): string {
  const s = it.stats;
  const out: string[] = [];
  if (s.attack !== undefined) out.push(`攻撃 ${s.attack}`);
  if (s.range !== undefined) out.push(`射程 ${s.range}`);
  if (s.power !== undefined) out.push(`威力 ${s.power}`);
  if (s.heal !== undefined) out.push(`回復 ${s.heal}`);
  if (s.speed !== undefined) out.push(`速度 +${Math.round(s.speed * 100)}%`);
  return out.join('　') || '効果不明';
}

export function speciesName(s: Species) {
  return SPECIES[s].name;
}
