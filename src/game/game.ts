// Game orchestration: owns the renderer, the simulation, the player and
// wires input, interactions and UI together.

import * as THREE from 'three';
import { Codex } from '../codex/codex';
import type { WorldEvent } from '../core/events';
import { Rng, hashInts, hashString } from '../core/rng';
import { Inventory } from '../items/inventory';
import { MATERIALS, type MaterialId } from '../items/materials';
import { synthesize, type CraftedItem, type Ingredient } from '../items/synthesis';
import { CreatureView } from '../render/creatureView';
import { craftedModel, materialModel } from '../render/itemModels';
import { cutoutUniforms, type ModelLibrary } from '../render/models';
import { WorldView } from '../render/worldView';
import { DT, Simulation } from '../sim/simulation';
import { SPECIES, type Species } from '../sim/species';
import { generateWorld } from '../world/generator';
import { Tile, tileIndex, inBounds, type World } from '../world/types';
import { Player } from './player';

export interface GameUI {
  toast(msg: string, kind?: 'info' | 'good' | 'warn' | 'rare'): void;
  worldEvent(e: WorldEvent): void;
  refresh(): void;
  isPanelOpen(): boolean;
  togglePanel(name: 'inventory' | 'codex' | 'craft'): void;
  closePanels(): void;
}

interface Effect {
  mesh: THREE.Mesh;
  t: number;
  life: number;
  grow: number;
}

export class Game {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.OrthographicCamera;
  readonly worldView: WorldView;
  readonly creatureView: CreatureView;
  readonly player: Player;
  readonly inventory = new Inventory();
  readonly codex = new Codex();
  world!: World;
  sim!: Simulation;
  ui: GameUI | null = null;

  seed = 0;
  speed = 1;
  paused = false;
  zoom = 13;
  tilt = THREE.MathUtils.degToRad(30);
  fps = 0;
  followId: string | null = null;

  private sun: THREE.DirectionalLight;
  private hemi: THREE.HemisphereLight;
  private keys = new Set<string>();
  private acc = 0;
  private clock = 0;
  private lastFrame = 0;
  private fpsAcc = { frames: 0, time: 0 };
  private camTarget = new THREE.Vector3();
  private effects: Effect[] = [];
  private gatherCooldown = new Map<string, number>();
  private spellCooldown = 0;
  private discoveryTimer = 0;
  private playerRng = new Rng(1);
  private unsubscribe: (() => void) | null = null;

  constructor(
    readonly container: HTMLElement,
    readonly lib: ModelLibrary,
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 200);
    this.scene.background = new THREE.Color('#1b2a33');

    this.hemi = new THREE.HemisphereLight('#dff4ff', '#5a7a3a', 1.6);
    this.sun = new THREE.DirectionalLight('#fff3d6', 2.4);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -20;
    sc.right = 20;
    sc.top = 20;
    sc.bottom = -20;
    sc.near = 1;
    sc.far = 80;
    this.sun.shadow.bias = -0.0008;
    this.sun.shadow.normalBias = 0.02;
    this.scene.add(this.hemi, this.sun, this.sun.target);

    this.worldView = new WorldView(lib);
    this.creatureView = new CreatureView(lib);
    this.player = new Player(lib);
    this.scene.add(this.worldView.root, this.creatureView.root, this.player.obj);

    window.addEventListener('resize', () => this.resize());
    window.addEventListener('keydown', (e) => this.onKeyDown(e));
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    this.renderer.domElement.addEventListener('wheel', (e) => {
      this.zoom = THREE.MathUtils.clamp(this.zoom + Math.sign(e.deltaY) * 1.2, 8, 30);
      this.resize();
    });
    this.resize();
  }

  // -------------------------------------------------------------------------
  // World lifecycle

  start(seed: number) {
    this.seed = seed;
    this.unsubscribe?.();
    this.world = generateWorld(seed);
    this.sim = new Simulation(this.world);
    this.playerRng = Rng.stream(seed, 'player');
    this.worldView.build(this.world);
    this.creatureView.clear();
    this.creatureView.selectedId = null;
    this.followId = null;
    this.player.teleport(this.world.spawn.x, this.world.spawn.z);
    this.player.dir = Math.PI / 2;
    this.player.hp = this.player.maxHp;
    this.camTarget.set(this.player.x, 0, this.player.z);
    this.acc = 0;
    this.gatherCooldown.clear();
    this.unsubscribe = this.sim.events.on((e) => this.onWorldEvent(e));
    this.ui?.refresh();
  }

  regenerate(seed: number) {
    const url = new URL(window.location.href);
    url.searchParams.set('seed', String(seed));
    window.history.replaceState(null, '', url);
    this.start(seed);
    this.ui?.toast(`新しい世界を生成しました（シード ${seed}）`, 'info');
  }

  // -------------------------------------------------------------------------
  // Loop

  run() {
    const frame = (t: number) => {
      requestAnimationFrame(frame);
      const dt = Math.min(0.1, (t - (this.lastFrame || t)) / 1000);
      this.lastFrame = t;
      this.tick(dt);
    };
    requestAnimationFrame(frame);
  }

  tick(dt: number) {
    this.clock += dt;
    this.fpsAcc.frames++;
    this.fpsAcc.time += dt;
    if (this.fpsAcc.time >= 0.5) {
      this.fps = this.fpsAcc.frames / this.fpsAcc.time;
      this.fpsAcc = { frames: 0, time: 0 };
    }

    // Simulation (fixed step, speed-scaled).
    this.sim.player = { x: this.player.x, z: this.player.z };
    if (!this.paused) {
      this.acc += dt * this.speed;
      let steps = 0;
      while (this.acc >= DT && steps < 240) {
        this.sim.step();
        this.acc -= DT;
        steps++;
      }
      if (steps >= 240) this.acc = 0;
    }
    const alpha = this.paused ? 1 : Math.min(1, this.acc / DT);

    this.updatePlayer(dt);
    this.creatureView.update(this.sim, alpha, dt);
    this.worldView.update(this.sim, dt, this.clock);
    this.updateEffects(dt);
    this.updateCamera(dt);
    this.updateLighting();
    this.renderer.render(this.scene, this.camera);
  }

  private updatePlayer(dt: number) {
    const p = this.player;
    const locked = this.ui?.isPanelOpen() ?? false;
    let ix = 0;
    let iz = 0;
    if (!locked) {
      if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) iz -= 1;
      if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) iz += 1;
      if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) ix -= 1;
      if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) ix += 1;
    }
    const charm = this.inventory.get(this.inventory.equippedCharm);
    p.speedBonus = charm?.stats.speed ?? 0;
    p.move(this.world, ix, iz, this.keys.has('ShiftLeft') || this.keys.has('ShiftRight'), dt, locked);
    if (p.moving) this.followId = null;
    const hit = p.update(dt, this.clock);
    if (hit) this.resolveAttack();
    this.spellCooldown -= dt;

    // Damage from the world.
    for (const h of this.sim.playerHits) {
      const c = this.sim.getCreature(h.by);
      if (p.hurt(this.world, h.dmg, c ? { x: c.x, z: c.z } : null, this.clock)) {
        this.ui?.toast(`${c ? SPECIES[c.species].name : '何か'}に噛まれた！`, 'warn');
      }
    }
    this.sim.playerHits.length = 0;
    if (p.hp <= 0) {
      p.hp = p.maxHp;
      p.teleport(this.world.spawn.x, this.world.spawn.z);
      this.ui?.toast('力尽きた…村の広場で目を覚ました', 'warn');
    }

    // Discover nearby creatures.
    this.discoveryTimer -= dt;
    if (this.discoveryTimer <= 0) {
      this.discoveryTimer = 0.5;
      for (const c of this.sim.creatures) {
        if (!c.alive || Math.hypot(c.x - p.x, c.z - p.z) > 7) continue;
        const key = c.variant ? `${c.species}:variant` : c.giant ? `${c.species}:giant` : c.species;
        if (this.codex.has(`creature:${key}`)) continue;
        const def = SPECIES[c.species];
        const name = c.variant ? def.variantName : c.giant ? '巨大スライム' : def.name;
        this.codex.record('creature', key, name, this.seed, {
          species: c.species,
          variant: c.variant,
          giant: c.giant,
          firstId: c.id,
          hp: c.maxHp,
          speed: +(def.speed * c.speedTrait).toFixed(2),
          vision: +(def.vision * c.visionTrait).toFixed(1),
          description: def.description,
        });
        this.sim.events.push({ t: this.sim.time, type: 'player_discovery', message: `主人公が${name}（${c.id}）を発見した`, actor: 'PLAYER', target: c.id });
        this.ui?.toast(`図鑑に登録：${name}`, 'good');
      }
    }
  }

  private updateCamera(dt: number) {
    let tx = this.player.x;
    let tz = this.player.z;
    if (this.followId) {
      const c = this.sim.getCreature(this.followId);
      if (c?.alive) {
        tx = c.x;
        tz = c.z;
      } else this.followId = null;
    }
    this.camTarget.x += (tx - this.camTarget.x) * Math.min(1, dt * 6);
    this.camTarget.z += (tz - this.camTarget.z) * Math.min(1, dt * 6);
    const dist = 60;
    this.camera.position.set(this.camTarget.x, Math.cos(this.tilt) * dist, this.camTarget.z + Math.sin(this.tilt) * dist);
    this.camera.lookAt(this.camTarget);
    cutoutUniforms.uPlayer.value.set(this.followId ? this.camTarget.x : this.player.x, 0, this.followId ? this.camTarget.z : this.player.z);
    cutoutUniforms.uCutShift.value.set(0, 0.25 + Math.sin(this.tilt) * 1.2);
    this.sun.position.set(this.camTarget.x + 9, 22, this.camTarget.z + 6);
    this.sun.target.position.copy(this.camTarget);
  }

  private updateLighting() {
    const d = this.sim.daylight;
    this.sun.intensity = 0.35 + 2.2 * d;
    this.sun.color.setRGB(1, 0.85 + 0.12 * d, 0.7 + 0.25 * d);
    this.hemi.intensity = 0.75 + 1.0 * d;
    this.hemi.color.setRGB(0.6 + 0.35 * d, 0.68 + 0.28 * d, 1);
    (this.scene.background as THREE.Color).setRGB(0.06 + 0.05 * d, 0.09 + 0.08 * d, 0.14 + 0.06 * d);
  }

  resize() {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h);
    const aspect = w / h;
    const half = this.zoom / 2;
    this.camera.left = -half * aspect;
    this.camera.right = half * aspect;
    this.camera.top = half;
    this.camera.bottom = -half;
    this.camera.updateProjectionMatrix();
  }

  // -------------------------------------------------------------------------
  // Input

  private onKeyDown(e: KeyboardEvent) {
    if ((e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'SELECT') return;
    this.keys.add(e.code);
    if (e.repeat) return;
    const panel = this.ui?.isPanelOpen() ?? false;
    switch (e.code) {
      case 'Space':
        e.preventDefault();
        if (!panel && this.player.startAttack()) {
          /* hit is resolved on the hit frame */
        }
        break;
      case 'KeyE':
        if (!panel) this.interact();
        break;
      case 'KeyQ':
        if (!panel) this.castSpell();
        break;
      case 'KeyI':
        this.ui?.togglePanel('inventory');
        break;
      case 'KeyB':
        this.ui?.togglePanel('codex');
        break;
      case 'KeyC':
        this.ui?.togglePanel('craft');
        break;
      case 'Escape':
        this.ui?.closePanels();
        break;
      case 'ArrowUp':
      case 'ArrowDown':
      case 'ArrowLeft':
      case 'ArrowRight':
        e.preventDefault();
        break;
    }
  }

  // -------------------------------------------------------------------------
  // Actions

  private weaponStats() {
    const w = this.inventory.get(this.inventory.equippedWeapon);
    return { dmg: w?.stats.attack ?? 1.5, range: w?.stats.range ?? 1.15 };
  }

  private resolveAttack() {
    const p = this.player;
    const { dmg, range } = this.weaponStats();
    const f = p.facing;
    let hitSomething = false;
    for (const c of this.sim.creatures) {
      if (!c.alive) continue;
      const dx = c.x - p.x;
      const dz = c.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d > range + 0.25 * c.scale || (d > 0.35 && (dx * f.x + dz * f.z) / d < 0.25)) continue;
      hitSomething = true;
      const drops = this.sim.damageCreature(c.id, dmg, { x: p.x, z: p.z });
      for (const m of drops) {
        const a = this.playerRng.range(0, Math.PI * 2);
        this.sim.addPickup(m, c.x + Math.cos(a) * 0.3, c.z + Math.sin(a) * 0.3);
      }
      if (drops.length) this.ui?.toast(`${SPECIES[c.species].name}を倒した`, 'info');
    }
    if (hitSomething) return;
    // Gather from a tree / rock in front.
    const fp = p.front(0.75);
    const tx = Math.floor(fp.x);
    const tz = Math.floor(fp.z);
    if (!inBounds(this.world, tx, tz)) return;
    const si = this.world.solidAt[tileIndex(this.world, tx, tz)];
    if (si < 0) return;
    const obj = this.world.objects[si];
    const last = this.gatherCooldown.get(obj.id) ?? -10;
    if (this.clock - last < 0.6) return;
    this.gatherCooldown.set(obj.id, this.clock);
    let mat: MaterialId | null = null;
    if (obj.kind === 'tree' || obj.kind === 'pine') mat = this.playerRng.chance(0.7) ? 'wood' : null;
    else if (obj.kind === 'rock') mat = this.playerRng.chance(0.8) ? 'stone' : null;
    else if (obj.kind === 'ore') mat = this.playerRng.chance(0.6) ? 'iron' : 'stone';
    if (mat) this.giveMaterial(mat);
    this.spawnEffect(fp.x, 0.5, fp.z, '#ffffff', 0.25, 0.25);
  }

  giveMaterial(id: MaterialId, silent = false) {
    this.inventory.addMaterial(id);
    const isNew = this.codex.record('material', id, MATERIALS[id].name, this.seed, { props: MATERIALS[id].props });
    this.player.showPickup(materialModel(id), this.clock);
    if (!silent) this.ui?.toast(`${MATERIALS[id].name}を手に入れた${isNew ? '（図鑑に登録）' : ''}`, isNew ? 'good' : 'info');
  }

  interact() {
    const p = this.player;
    const fp = p.front(0.6);
    // 1. Pickups.
    let best: { id: string; d: number } | null = null;
    for (const k of this.sim.pickups) {
      if (!k.alive) continue;
      const d = Math.min(Math.hypot(k.x - p.x, k.z - p.z), Math.hypot(k.x - fp.x, k.z - fp.z));
      if (d < 1.1 && (!best || d < best.d)) best = { id: k.id, d };
    }
    if (best) {
      const k = this.sim.takePickup(best.id);
      if (k) this.giveMaterial(k.material);
      return;
    }
    // 2. Chests.
    for (const o of this.world.objects) {
      if (o.kind !== 'chest' || o.removed) continue;
      if (Math.hypot(o.x - p.x, o.z - p.z) > 1.4) continue;
      if (o.data.opened) {
        this.ui?.toast('宝箱は空っぽだ', 'info');
        return;
      }
      o.data.opened = true;
      this.worldView.openChest(o.id);
      const r = new Rng(hashInts(this.seed, hashString(o.id)));
      const pool: MaterialId[] = ['fire_stone', 'water_stone', 'crystal', 'iron', 'wind_feather', 'mushroom', 'slime_core'];
      const n = r.int(2, 3);
      const got: string[] = [];
      for (let i = 0; i < n; i++) {
        const m = r.pick(pool);
        this.giveMaterial(m, true);
        got.push(MATERIALS[m].name);
      }
      this.ui?.toast(`宝箱を開けた！ ${got.join('・')}`, 'good');
      return;
    }
    // 3. Cave entrance.
    const cave = this.world.cave;
    if (Math.hypot(cave.tx + 0.5 - p.x, cave.tz + 0.5 - p.z) < 1.6) {
      const isNew = this.codex.record('event', `cave-${this.seed}`, '洞窟の入口を見つけた', this.seed, {
        message: '冷たい風が吹き出す洞窟の入口。奥へ進むのは次のPhaseで。',
        t: this.sim.time,
      });
      this.ui?.toast(isNew ? '洞窟の入口を発見した！（奥は次のPhaseで探検できる）' : '洞窟の奥から冷たい風が吹いてくる…', 'good');
      return;
    }
    // 4. Plants.
    const kind = this.sim.harvestPlant(fp.x, fp.z);
    if (kind) {
      this.giveMaterial(kind === 'berry' && this.playerRng.chance(0.3) ? 'mushroom' : 'grass');
      return;
    }
    // 5. Houses / well.
    const tx = Math.floor(fp.x);
    const tz = Math.floor(fp.z);
    if (inBounds(this.world, tx, tz)) {
      const si = this.world.solidAt[tileIndex(this.world, tx, tz)];
      if (si >= 0) {
        const k = this.world.objects[si].kind;
        if (k === 'house') return this.ui?.toast('家の中は静かだ。村人たちは次のPhaseでやってくる。', 'info');
        if (k === 'well') return this.ui?.toast('澄んだ水が湧いている。', 'info');
        if (k === 'tree' || k === 'pine') return this.ui?.toast('Spaceで木を叩くと木材が採れる', 'info');
        if (k === 'rock' || k === 'ore') return this.ui?.toast('Spaceで岩を叩くと石や鉄が採れる', 'info');
      }
      if (this.world.tiles[tileIndex(this.world, tx, tz)] === Tile.WATER) return this.ui?.toast('小川の水が冷たい。', 'info');
    }
  }

  craft(a: Ingredient, b: Ingredient): CraftedItem | null {
    if (!this.inventory.take(a.id)) return null;
    if (!this.inventory.take(b.id)) {
      // Give back the first one.
      if (MATERIALS[a.id as MaterialId]) this.inventory.addMaterial(a.id as MaterialId);
      return null;
    }
    const item = synthesize(a, b, this.seed);
    this.inventory.addItem(item);
    const isNew = this.codex.record('item', item.id, item.name, this.seed, { item });
    this.sim.events.push({
      t: this.sim.time,
      type: 'synthesis',
      message: `主人公が ${a.name} と ${b.name} から「${item.name}」(${item.id}) を生み出した`,
      actor: 'PLAYER',
      target: item.id,
      data: { reactions: item.reactions.join(','), trait: item.trait ?? '' },
    });
    this.player.showPickup(craftedModel(item), this.clock);
    this.ui?.toast(`「${item.name}」が生まれた！${isNew ? '（新発見）' : ''}`, isNew ? 'rare' : 'good');
    return item;
  }

  useItem(id: string) {
    const item = this.inventory.get(id);
    if (!item) return;
    if (item.category === 'potion') {
      if (!this.inventory.take(id)) return;
      const heal = item.stats.heal ?? 1;
      this.player.hp = Math.min(this.player.maxHp, this.player.hp + heal);
      this.spawnEffect(this.player.x, 0.5, this.player.z, item.color, 1.2, 0.5);
      this.ui?.toast(`${item.name}を飲んだ（HP +${heal}）`, 'good');
    } else {
      this.inventory.equip(id);
    }
  }

  castSpell() {
    const spell = this.inventory.get(this.inventory.equippedSpell);
    if (!spell) {
      this.ui?.toast('魔法を装備していない（合成で魔法を作ろう）', 'info');
      return;
    }
    if (this.spellCooldown > 0) return;
    this.spellCooldown = 1.2;
    const p = this.player;
    const power = spell.stats.power ?? 1;
    const fp = p.front(1.4);
    switch (spell.element) {
      case 'fire': {
        this.damageArea(fp.x, fp.z, 1.8, power);
        this.sim.burnPlants(fp.x, fp.z, 1.4, spell.name);
        this.spawnEffect(fp.x, 0.4, fp.z, '#ff7a2b', 1.8, 0.5);
        break;
      }
      case 'water': {
        const n = this.sim.waterPlants(p.x, p.z, 2.6);
        p.hp = Math.min(p.maxHp, p.hp + 1);
        this.spawnEffect(p.x, 0.3, p.z, '#4fa8ff', 2.6, 0.6);
        if (n > 0) this.ui?.toast(`草が${n}株芽吹いた`, 'good');
        break;
      }
      case 'wind': {
        this.sim.pushCreatures(p.x, p.z, 3.2, 2.6);
        this.spawnEffect(p.x, 0.4, p.z, '#9dffc0', 3.2, 0.45);
        break;
      }
      case 'thunder': {
        this.damageArea(p.x, p.z, 3.2, power * 0.8);
        this.spawnEffect(p.x, 0.6, p.z, '#ffe94a', 3.2, 0.35);
        break;
      }
      default: {
        this.damageArea(fp.x, fp.z, 1.4, power * 0.7);
        this.sim.pushCreatures(fp.x, fp.z, 1.6, 1);
        this.spawnEffect(fp.x, 0.3, fp.z, spell.color, 1.5, 0.4);
      }
    }
  }

  private damageArea(x: number, z: number, r: number, dmg: number) {
    for (const c of this.sim.creatures) {
      if (!c.alive || Math.hypot(c.x - x, c.z - z) > r) continue;
      const drops = this.sim.damageCreature(c.id, dmg, { x, z });
      for (const m of drops) this.sim.addPickup(m, c.x, c.z);
    }
  }

  private spawnEffect(x: number, y: number, z: number, color: string, radius: number, life: number) {
    const mesh = new THREE.Mesh(
      new THREE.IcosahedronGeometry(1, 1),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55, depthWrite: false }),
    );
    mesh.position.set(x, y, z);
    mesh.scale.setScalar(0.1);
    this.scene.add(mesh);
    this.effects.push({ mesh, t: 0, life, grow: radius });
  }

  private updateEffects(dt: number) {
    for (const e of this.effects) {
      e.t += dt;
      const k = e.t / e.life;
      e.mesh.scale.setScalar(0.1 + e.grow * Math.min(1, k * 1.4));
      e.mesh.scale.y *= 0.35;
      (e.mesh.material as THREE.MeshBasicMaterial).opacity = 0.55 * (1 - k);
    }
    const dead = this.effects.filter((e) => e.t >= e.life);
    for (const e of dead) {
      this.scene.remove(e.mesh);
      e.mesh.geometry.dispose();
      (e.mesh.material as THREE.Material).dispose();
    }
    this.effects = this.effects.filter((e) => e.t < e.life);
  }

  private onWorldEvent(e: WorldEvent) {
    this.ui?.worldEvent(e);
    if (e.rare) {
      this.codex.record('event', `${this.seed}-${e.id}`, e.message, this.seed, {
        type: e.type,
        t: e.t,
        actor: e.actor ?? '',
        target: e.target ?? '',
        message: e.message,
      });
    }
  }

  /** Teleport next to the nearest pickup (used by tests / debug). */
  debugTeleportToPickup(): string | null {
    let best: { x: number; z: number; id: string; d: number } | null = null;
    for (const k of this.sim.pickups) {
      if (!k.alive) continue;
      const d = Math.hypot(k.x - this.player.x, k.z - this.player.z);
      if (!best || d < best.d) best = { x: k.x, z: k.z, id: k.id, d };
    }
    if (!best) return null;
    this.player.teleport(best.x, best.z);
    return best.id;
  }

  speciesCount(s: Species) {
    return this.sim.count(s);
  }
}
