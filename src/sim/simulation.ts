// Autonomous ecosystem + evolving world simulation.
// Pure TypeScript (no Three.js) so it can run headless in tests.
// Fixed time step; all randomness comes from seeded streams, so a world
// left alone replays identically for the same seed.

import { Path } from 'rot-js';
import { EventLog, type EventType } from '../core/events';
import { Rng, hashInts } from '../core/rng';
import type { MaterialId } from '../items/materials';
import { MATERIALS } from '../items/materials';
import { Tile, type World, canStand, isTileWalkable, tileIndex, inBounds, type Point } from '../world/types';
import { CLASSIC_SPECIES, isPredatorOf, SPECIES, SPECIES_IDS, STATE_LABELS, type CreatureState, type Habitat, type Species } from './species';

export interface SimulationOptions {
  /**
   * Species living in this world. Default: all species.
   * CLASSIC_SPECIES (slime, deer, wolf) replays the pre-Phase-2B history exactly.
   */
  roster?: Species[];
}

export const DT = 0.1;
export const DAY_LENGTH = 240;
const PLANT_CAP = 620;

export interface Creature {
  id: string;
  num: number;
  species: Species;
  x: number;
  z: number;
  /** Position at the previous tick (for render interpolation). */
  px: number;
  pz: number;
  /** Heading in radians on the XZ plane (0 = +X). */
  dir: number;
  moving: boolean;
  running: boolean;
  hp: number;
  maxHp: number;
  hunger: number;
  fear: number;
  stamina: number;
  state: CreatureState;
  stateTime: number;
  age: number;
  lifespan: number;
  /** Inheritable traits (multipliers around 1). */
  speedTrait: number;
  visionTrait: number;
  mass: number;
  scale: number;
  generation: number;
  parent: string | null;
  variant: boolean;
  giant: boolean;
  reproCooldown: number;
  targetId: string | null;
  tx: number;
  tz: number;
  path: Point[] | null;
  pathI: number;
  stuck: number;
  noFoodTime: number;
  restUntil: number;
  kills: number;
  meals: number;
  alive: boolean;
  /** Short-lived flash when hit (render only). */
  hitTime: number;
  /** Sim time of this creature's last strike (predation, bite). Read by the renderer only. */
  attackTime: number;
}

export interface Plant {
  idx: number;
  kind: 'grass' | 'berry';
  tx: number;
  tz: number;
  biomass: number;
  lowTime: number;
  alive: boolean;
}

export interface Pickup {
  id: string;
  material: MaterialId;
  x: number;
  z: number;
  alive: boolean;
}

export interface PopSample {
  t: number;
  slime: number;
  deer: number;
  wolf: number;
  plants: number;
  /** Every species in the roster (slime/deer/wolf above are kept for older readers). */
  bySpecies: Partial<Record<Species, number>>;
}

export class Simulation {
  readonly world: World;
  readonly seed: number;
  readonly events = new EventLog();
  time = 0;
  tick = 0;
  creatures: Creature[] = [];
  plants: Plant[] = [];
  readonly plantAt: Int32Array;
  pickups: Pickup[] = [];
  /** Player position, if a player is present (affects fear). */
  player: Point | null = null;
  /** Hits on the player produced this tick, consumed by the game. */
  playerHits: { by: string; dmg: number }[] = [];
  readonly popHistory: PopSample[] = [];
  /** Species living in this world, in spawn order. */
  readonly roster: Species[];

  private rng: Rng;
  private plantRng: Rng;
  private pickupRng: Rng;
  private dropRng: Rng;
  private seq = Object.fromEntries(SPECIES_IDS.map((s) => [s, 0])) as Record<Species, number>;
  private pickupSeq = 0;
  private lastPop = Object.fromEntries(SPECIES_IDS.map((s) => [s, 0])) as Record<Species, number>;
  private lastPopEvent = Object.fromEntries(SPECIES_IDS.map((s) => [s, -999])) as Record<Species, number>;
  /** Tiles near each habitat kind (computed once per world). */
  private habitatDist = new Map<Habitat, Uint8Array>();
  private plantStats = { spread: 0, withered: 0 };
  private wasNight = false;

  constructor(world: World, opts: SimulationOptions = {}) {
    this.world = world;
    // Keep the canonical order (slime, deer, wolf, then newer species): it is the spawn order.
    const want = opts.roster ?? SPECIES_IDS;
    this.roster = SPECIES_IDS.filter((s) => want.includes(s));
    this.seed = world.seed;
    this.rng = Rng.stream(world.seed, 'sim');
    this.plantRng = Rng.stream(world.seed, 'plants');
    this.pickupRng = Rng.stream(world.seed, 'pickups');
    this.dropRng = Rng.stream(world.seed, 'drops');
    this.plantAt = new Int32Array(world.width * world.height).fill(-1);
    this.initPlants();
    this.initCreatures();
    this.initPickups();
    for (const s of this.roster) this.lastPop[s] = this.count(s);
    const extra = this.roster.filter((s) => !CLASSIC_SPECIES.includes(s)).map((s) => `・${SPECIES[s].name}${this.count(s)}`).join('');
    this.events.push({
      t: 0,
      type: 'world_generated',
      message: `世界が生まれた（シード ${world.seed}）。スライム${this.count('slime')}・シカ${this.count('deer')}・オオカミ${this.count('wolf')}${extra}、植物${this.plants.length}株。`,
    });
  }

  // -------------------------------------------------------------------------
  // Setup

  private validPlantTile(tx: number, tz: number, kind: 'grass' | 'berry'): boolean {
    const w = this.world;
    if (!inBounds(w, tx, tz) || tx < 2 || tz < 2 || tx >= w.width - 2 || tz >= w.height - 2) return false;
    const i = tileIndex(w, tx, tz);
    if (w.solidAt[i] >= 0 || this.plantAt[i] >= 0) return false;
    const t = w.tiles[i];
    if (kind === 'berry') return t === Tile.FOREST || t === Tile.GRASS;
    return t === Tile.GRASS || t === Tile.FOREST;
  }

  private addPlant(kind: 'grass' | 'berry', tx: number, tz: number, biomass: number): Plant | null {
    if (!this.validPlantTile(tx, tz, kind)) return null;
    const p: Plant = { idx: this.plants.length, kind, tx, tz, biomass, lowTime: 0, alive: true };
    this.plants.push(p);
    this.plantAt[tileIndex(this.world, tx, tz)] = p.idx;
    return p;
  }

  private initPlants() {
    const w = this.world;
    const r = this.plantRng;
    for (let tz = 2; tz < w.height - 2; tz++) {
      for (let tx = 2; tx < w.width - 2; tx++) {
        const t = w.tiles[tileIndex(w, tx, tz)];
        const dv = Math.hypot(tx - w.village.cx, tz - w.village.cz);
        if (dv < 4) continue;
        if (t === Tile.GRASS && r.chance(0.1)) this.addPlant('grass', tx, tz, r.range(0.4, 1));
        else if (t === Tile.FOREST && r.chance(0.035)) this.addPlant(r.chance(0.6) ? 'berry' : 'grass', tx, tz, r.range(0.4, 1));
      }
    }
  }

  private randomReachableTile(rng: Rng, filter: (tx: number, tz: number) => boolean, tries = 300): Point | null {
    const w = this.world;
    for (let i = 0; i < tries; i++) {
      const tx = rng.int(2, w.width - 3);
      const tz = rng.int(2, w.height - 3);
      if (!w.reachable[tileIndex(w, tx, tz)]) continue;
      if (filter(tx, tz)) return { x: tx + 0.5, z: tz + 0.5 };
    }
    return null;
  }

  private initCreatures() {
    const w = this.world;
    const vc = w.village;
    for (const s of this.roster) {
      const def = SPECIES[s];
      // Groups from data: deer herds of 4, one wolf pack, slimes scattered...
      const groupSize = def.groupSize === 'all' ? def.initial : def.groupSize;
      const home = (tx: number, tz: number) => !def.habitat || this.nearHabitat(def.habitat, tx, tz, def.habitatRange ?? 3);
      let anchor: Point | null = null;
      for (let i = 0; i < def.initial; i++) {
        const minVillage = def.spawnMinVillageDist;
        if (i % groupSize === 0) anchor = null;
        const near = anchor as Point | null;
        const p: Point | null =
          (near && this.randomReachableTile(this.rng, (tx, tz) => Math.hypot(tx - near.x, tz - near.z) < 4 && home(tx, tz))) ||
          this.randomReachableTile(this.rng, (tx, tz) => Math.hypot(tx - vc.cx, tz - vc.cz) > minVillage && home(tx, tz));
        if (!p) continue;
        if (!anchor) anchor = p;
        const c = this.spawnCreature(s, p.x, p.z, null);
        c.age = this.rng.range(0, def.lifespan * 0.4);
        c.hunger = this.rng.range(10, 40);
      }
    }
  }

  private initPickups() {
    for (let i = 0; i < 4; i++) this.spawnPickupCycle(true);
  }

  // -------------------------------------------------------------------------
  // Queries

  count(s?: Species): number {
    let n = 0;
    for (const c of this.creatures) if (c.alive && (!s || c.species === s)) n++;
    return n;
  }

  get timeOfDay(): number {
    return ((this.time / DAY_LENGTH) + 0.3) % 1;
  }

  /** 0 = darkest night, 1 = full day. */
  get daylight(): number {
    const tod = this.timeOfDay;
    return Math.max(0, Math.min(1, 0.5 + Math.sin((tod - 0.25) * Math.PI * 2) * 1.6));
  }

  get isNight(): boolean {
    return this.daylight < 0.25;
  }

  getCreature(id: string): Creature | undefined {
    return this.creatures.find((c) => c.id === id);
  }

  stateCounts(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const c of this.creatures) {
      if (!c.alive) continue;
      const k = `${c.species}:${c.state}`;
      out[k] = (out[k] ?? 0) + 1;
    }
    return out;
  }

  aliveplants(): number {
    let n = 0;
    for (const p of this.plants) if (p.alive) n++;
    return n;
  }

  /** True when (tx, tz) is within `range` tiles of the habitat (forest / water / rocks). Read-only query. */
  nearHabitat(h: Habitat, tx: number, tz: number, range: number): boolean {
    let field = this.habitatDist.get(h);
    if (!field) {
      field = this.buildHabitatField(h);
      this.habitatDist.set(h, field);
    }
    if (!inBounds(this.world, tx, tz)) return false;
    return field[tileIndex(this.world, tx, tz)] <= range;
  }

  /** Chebyshev distance (capped at 255) from every tile to the nearest tile of the habitat. No randomness. */
  private buildHabitatField(h: Habitat): Uint8Array {
    const w = this.world;
    const n = w.width * w.height;
    const dist = new Uint8Array(n).fill(255);
    const queue: number[] = [];
    for (let i = 0; i < n; i++) {
      const t = w.tiles[i];
      const s = w.solidAt[i];
      const kind = s >= 0 ? w.objects[s].kind : null;
      const hit =
        h === 'forest' ? t === Tile.FOREST || kind === 'tree' || kind === 'pine'
        : h === 'water' ? t === Tile.WATER || t === Tile.BRIDGE
        : t === Tile.CLIFF || t === Tile.CAVE || kind === 'rock' || kind === 'ore';
      if (hit) {
        dist[i] = 0;
        queue.push(i);
      }
    }
    for (let q = 0; q < queue.length; q++) {
      const i = queue[q];
      const x = i % w.width;
      const z = (i - x) / w.width;
      for (let dz = -1; dz <= 1; dz++)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const nz = z + dz;
          if (!inBounds(w, nx, nz)) continue;
          const j = nz * w.width + nx;
          if (dist[j] > dist[i] + 1) {
            dist[j] = Math.min(254, dist[i] + 1);
            queue.push(j);
          }
        }
    }
    return dist;
  }

  private inVillage(x: number, z: number, extra = 0) {
    const v = this.world.village;
    return Math.hypot(x - v.cx - 0.5, z - v.cz - 0.5) < v.radius + extra;
  }

  // -------------------------------------------------------------------------
  // Creatures

  spawnCreature(species: Species, x: number, z: number, parents: [Creature, Creature?] | null): Creature {
    const def = SPECIES[species];
    const num = ++this.seq[species];
    let speedTrait = 1;
    let visionTrait = 1;
    let variant = false;
    let generation = 0;
    if (parents) {
      const [a, b] = parents;
      const ps = b ? (a.speedTrait + b.speedTrait) / 2 : a.speedTrait;
      const pv = b ? (a.visionTrait + b.visionTrait) / 2 : a.visionTrait;
      speedTrait = clamp(ps * (1 + this.rng.gauss(0, 0.06)), 0.6, 1.7);
      visionTrait = clamp(pv * (1 + this.rng.gauss(0, 0.06)), 0.6, 1.7);
      variant = a.variant || (b?.variant ?? false) ? this.rng.chance(0.5) : this.rng.chance(0.025);
      generation = Math.max(a.generation, b?.generation ?? 0) + 1;
    }
    const c: Creature = {
      id: `${def.idPrefix}-${num.toString().padStart(4, '0')}`,
      num,
      species,
      x,
      z,
      px: x,
      pz: z,
      dir: this.rng.range(0, Math.PI * 2),
      moving: false,
      running: false,
      hp: def.maxHp,
      maxHp: def.maxHp,
      hunger: 20,
      fear: 0,
      stamina: 100,
      state: 'wander',
      stateTime: 0,
      age: 0,
      lifespan: def.lifespan * this.rng.range(0.85, 1.15),
      speedTrait,
      visionTrait,
      mass: 1,
      scale: parents ? 0.7 : 1,
      generation,
      parent: parents ? parents[0].id : null,
      variant,
      giant: false,
      reproCooldown: parents ? 60 : this.rng.range(20, 80),
      targetId: null,
      tx: x,
      tz: z,
      path: null,
      pathI: 0,
      stuck: 0,
      noFoodTime: 0,
      restUntil: 0,
      kills: 0,
      meals: 0,
      alive: true,
      hitTime: -10,
      attackTime: -10,
    };
    this.creatures.push(c);
    if (parents && variant && !parents[0].variant) {
      this.log('mutation', `${c.id} は珍しい変異体「${def.variantName}」として生まれた！`, {
        actor: parents[0].id,
        target: c.id,
        x,
        z,
        rare: true,
        data: { species, variant: def.variantName },
      });
    }
    return c;
  }

  private setState(c: Creature, s: CreatureState) {
    if (c.state !== s) {
      c.state = s;
      c.stateTime = 0;
      if (s !== 'migrate') c.path = null;
    }
  }

  private kill(c: Creature, type: EventType, message: string, actor?: string, rare = false) {
    if (!c.alive) return;
    c.alive = false;
    c.state = 'dead';
    c.hp = 0;
    this.log(type, message, { actor, target: c.id, x: c.x, z: c.z, rare });
    if (this.count(c.species) === 0) {
      this.log('extinction', `${SPECIES[c.species].name}が世界から姿を消した…（最後の個体 ${c.id}）`, {
        target: c.id,
        rare: true,
        data: { species: c.species },
      });
    }
  }

  private log(type: EventType, message: string, extra: Partial<Omit<Parameters<EventLog['push']>[0], 'type' | 'message' | 't'>> = {}) {
    this.events.push({ t: Math.round(this.time * 10) / 10, type, message, ...extra });
  }

  /** Steps toward a point, sliding around obstacles. Returns true when arrived. */
  private steer(c: Creature, tx: number, tz: number, speed: number): boolean {
    const dx = tx - c.x;
    const dz = tz - c.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.08) return true;
    const step = Math.min(speed * DT, d);
    const base = Math.atan2(dz, dx);
    const r = SPECIES[c.species].radius * c.scale;
    for (const off of [0, 0.5, -0.5, 1.0, -1.0, 1.6, -1.6, 2.3, -2.3]) {
      const a = base + off;
      const nx = c.x + Math.cos(a) * step;
      const nz = c.z + Math.sin(a) * step;
      if (canStand(this.world, nx, nz, r)) {
        c.x = nx;
        c.z = nz;
        c.dir = a;
        c.moving = true;
        c.stuck = Math.max(0, c.stuck - DT);
        return d <= step + 0.02;
      }
    }
    c.stuck += DT;
    return false;
  }

  private pickWanderTarget(c: Creature, radius: number) {
    const w = this.world;
    // Herding species drift towards their own kind (herds / packs).
    const def = SPECIES[c.species];
    let bx = c.x;
    let bz = c.z;
    if (def.herds) {
      let best: Creature | null = null;
      let bestD = this.visionOf(c) * 2;
      for (const o of this.creatures) {
        if (o === c || !o.alive || o.species !== c.species) continue;
        const d = Math.hypot(o.x - c.x, o.z - c.z);
        if (d < bestD) {
          bestD = d;
          best = o;
        }
      }
      if (best && bestD > 3) {
        bx = c.x + (best.x - c.x) * 0.6;
        bz = c.z + (best.z - c.z) * 0.6;
      }
    }
    for (let i = 0; i < 10; i++) {
      const tx = Math.floor(bx + this.rng.range(-radius, radius));
      const tz = Math.floor(bz + this.rng.range(-radius, radius));
      if (!isTileWalkable(w, tx, tz)) continue;
      if (def.avoidsVillage && this.inVillage(tx, tz, 2)) continue;
      if (def.habitat && !this.nearHabitat(def.habitat, tx, tz, def.habitatRange ?? 3)) continue;
      c.tx = tx + 0.5;
      c.tz = tz + 0.5;
      return;
    }
    c.tx = c.x;
    c.tz = c.z;
  }

  private nearestPlant(c: Creature, minBiomass: number): Plant | null {
    const kinds = SPECIES[c.species].eats;
    const vision = this.visionOf(c);
    const r = Math.ceil(vision);
    const cx = Math.floor(c.x);
    const cz = Math.floor(c.z);
    let best: Plant | null = null;
    let bestD = Infinity;
    const w = this.world;
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        const tx = cx + dx;
        const tz = cz + dz;
        if (!inBounds(w, tx, tz)) continue;
        const pi = this.plantAt[tileIndex(w, tx, tz)];
        if (pi < 0) continue;
        const p = this.plants[pi];
        if (!p.alive || p.biomass < minBiomass || !kinds.includes(p.kind)) continue;
        const d = dx * dx + dz * dz;
        if (d < bestD && d <= vision * vision) {
          bestD = d;
          best = p;
        }
      }
    }
    return best;
  }

  private visionOf(c: Creature) {
    const night = this.isNight && !SPECIES[c.species].nocturnal ? 0.75 : 1;
    return SPECIES[c.species].vision * c.visionTrait * night;
  }

  private speedOf(c: Creature, run: boolean) {
    const def = SPECIES[c.species];
    const giant = c.giant ? 0.75 : 1;
    const young = c.age < 40 && c.parent ? 0.85 : 1;
    return def.speed * c.speedTrait * giant * young * (run ? def.runMul : 1);
  }

  /** Nearest threat to a creature (predator or player), with distance. */
  private nearestThreat(c: Creature): { x: number; z: number; d: number; id: string } | null {
    const def = SPECIES[c.species];
    const vision = this.visionOf(c);
    let best: { x: number; z: number; d: number; id: string } | null = null;
    if (this.hunted(c.species)) {
      for (const o of this.creatures) {
        if (!o.alive || !isPredatorOf(o.species, c.species)) continue;
        const d = Math.hypot(o.x - c.x, o.z - c.z);
        // A sprinting predator is noticed from afar, a stalking one only up close.
        const chasing = o.state === 'chase';
        const stalking = o.state === 'hunt';
        if (def.wariness === 'oblivious' && !(chasing && o.targetId === c.id) && d > 1.5) continue;
        if (def.wariness === 'alert' && !chasing && !(stalking && d < 3.5) && d > 2.5) continue;
        if (d < vision && (!best || d < best.d)) best = { x: o.x, z: o.z, d, id: o.id };
      }
    }
    if (this.player) {
      const range = def.playerFearVisionMul !== undefined ? vision * def.playerFearVisionMul : def.playerFearRange;
      const d = Math.hypot(this.player.x - c.x, this.player.z - c.z);
      if (d < range && (!best || d < best.d)) best = { x: this.player.x, z: this.player.z, d, id: 'PLAYER' };
    }
    return best;
  }

  /** Is anything in this world a predator of `s`? (Cached per roster.) */
  private hunted(s: Species): boolean {
    return this.roster.some((p) => isPredatorOf(p, s));
  }

  private findPrey(c: Creature, desperate: boolean): Creature | null {
    const def = SPECIES[c.species];
    const vision = this.visionOf(c);
    let best: Creature | null = null;
    let bestD = Infinity;
    for (const o of this.creatures) {
      if (!o.alive || o === c) continue;
      if (def.prey.includes(o.species) || (desperate && def.preyDesperate.includes(o.species))) {
        if (c.hunger < 90 && this.inVillage(o.x, o.z, 1)) continue;
        const d = Math.hypot(o.x - c.x, o.z - c.z);
        // Preferred prey first when several are visible.
        const score = d + (def.preyBias[o.species] ?? 0);
        if (d < vision && score < bestD) {
          bestD = score;
          best = o;
        }
      }
    }
    return best;
  }

  private startMigration(c: Creature): boolean {
    // Sample a few far-away spots, prefer the one with the most food.
    const w = this.world;
    let best = null as { x: number; z: number; food: number } | null;
    let scented = false;
    const def = SPECIES[c.species];
    const predator = def.role === 'predator';
    if (predator) {
      // Predators follow the scent of the nearest prey, even out of sight.
      let bestD = 40;
      for (const o of this.creatures) {
        if (!o.alive || !def.prey.includes(o.species) || this.inVillage(o.x, o.z, 2)) continue;
        const d = Math.hypot(o.x - c.x, o.z - c.z);
        if (d < bestD) {
          bestD = d;
          best = { x: Math.floor(o.x), z: Math.floor(o.z), food: 1 };
          scented = true;
        }
      }
    }
    for (let i = 0; i < 6 && !scented; i++) {
      const a = this.rng.range(0, Math.PI * 2);
      const d = this.rng.range(14, 26);
      const tx = Math.floor(c.x + Math.cos(a) * d);
      const tz = Math.floor(c.z + Math.sin(a) * d);
      if (!inBounds(w, tx, tz) || !isTileWalkable(w, tx, tz) || !w.reachable[tileIndex(w, tx, tz)]) continue;
      if (def.avoidsVillage && this.inVillage(tx, tz, 3)) continue;
      if (def.habitat && !this.nearHabitat(def.habitat, tx, tz, (def.habitatRange ?? 3) + 1)) continue;
      const food = predator ? this.preyNear(c, tx, tz, 8) : this.foodNear(c, tx, tz, 5);
      const cur = best as { food: number } | null;
      if (!cur || food > cur.food) best = { x: tx, z: tz, food };
    }
    if (!best) return false;
    const path: Point[] = [];
    const passable = (x: number, z: number) => isTileWalkable(w, x, z);
    new Path.AStar(best.x, best.z, passable, { topology: 8 }).compute(Math.floor(c.x), Math.floor(c.z), (x, z) =>
      path.push({ x: x + 0.5, z: z + 0.5 }),
    );
    if (path.length < 2) return false;
    this.setState(c, 'migrate');
    c.path = path;
    c.pathI = 1;
    c.noFoodTime = 0;
    this.log(
      'migration',
      `${c.id}（${SPECIES[c.species].name}）が${predator ? '獲物' : '食料'}不足のため移住を始めた（${path.length}歩先へ）`,
      { actor: c.id, x: c.x, z: c.z, data: { toX: best.x, toZ: best.z, food: best.food } },
    );
    return true;
  }

  private foodNear(c: Creature, tx: number, tz: number, r: number): number {
    const kinds = SPECIES[c.species].eats;
    let n = 0;
    const w = this.world;
    for (let dz = -r; dz <= r; dz++)
      for (let dx = -r; dx <= r; dx++) {
        if (!inBounds(w, tx + dx, tz + dz)) continue;
        const pi = this.plantAt[tileIndex(w, tx + dx, tz + dz)];
        if (pi >= 0 && this.plants[pi].alive && kinds.includes(this.plants[pi].kind)) n += this.plants[pi].biomass;
      }
    return n;
  }

  private preyNear(c: Creature, tx: number, tz: number, r: number): number {
    const prey = SPECIES[c.species].prey;
    let n = 0;
    for (const o of this.creatures) if (o.alive && prey.includes(o.species) && Math.hypot(o.x - tx, o.z - tz) < r) n++;
    return n;
  }

  private followPath(c: Creature, speed: number): boolean {
    if (!c.path || c.pathI >= c.path.length) return true;
    const p = c.path[c.pathI];
    if (this.steer(c, p.x, p.z, speed)) c.pathI++;
    return c.pathI >= c.path.length;
  }

  private tryReproduce(c: Creature) {
    const def = SPECIES[c.species];
    if (c.reproCooldown > 0 || this.count(c.species) >= def.popCap) return;
    if (def.splits) {
      if (c.mass >= 2) this.splitSlime(c);
      return;
    }
    const { minAge, maxHunger } = def.breed;
    if (c.age < minAge || c.hunger > maxHunger || c.fear > 10) return;
    const mate = this.creatures.find(
      (o) =>
        o !== c &&
        o.alive &&
        o.species === c.species &&
        o.age >= minAge &&
        o.reproCooldown <= 0 &&
        o.hunger <= maxHunger + 10 &&
        Math.hypot(o.x - c.x, o.z - c.z) < 6,
    );
    if (!mate) return;
    const child = this.spawnCreature(c.species, (c.x + mate.x) / 2, (c.z + mate.z) / 2, [c, mate]);
    if (!canStand(this.world, child.x, child.z, def.radius)) {
      child.x = c.x;
      child.z = c.z;
      child.px = c.x;
      child.pz = c.z;
    }
    const cd = def.breed.cooldown;
    c.reproCooldown = cd;
    mate.reproCooldown = cd;
    c.hunger += 20;
    mate.hunger += 20;
    this.log('birth', `${c.id} と ${mate.id} の子 ${child.id} が生まれた（第${child.generation}世代）`, {
      actor: c.id,
      target: child.id,
      x: child.x,
      z: child.z,
      data: { mate: mate.id, speed: round2(child.speedTrait), vision: round2(child.visionTrait) },
    });
  }

  private splitSlime(c: Creature) {
    const a = this.rng.range(0, Math.PI * 2);
    const nx = c.x + Math.cos(a) * 0.4;
    const nz = c.z + Math.sin(a) * 0.4;
    const pos = canStand(this.world, nx, nz, 0.22) ? { x: nx, z: nz } : { x: c.x, z: c.z };
    const child = this.spawnCreature('slime', pos.x, pos.z, [c]);
    child.scale = 0.8;
    c.mass = 1;
    c.scale = 1;
    c.giant = false;
    c.maxHp = SPECIES.slime.maxHp;
    c.hp = Math.min(c.hp, c.maxHp);
    c.reproCooldown = 25;
    child.reproCooldown = 40;
    child.hunger = c.hunger;
    this.log('split', `${c.id} が分裂して ${child.id} が生まれた`, { actor: c.id, target: child.id, x: c.x, z: c.z });
  }

  private updateCreature(c: Creature) {
    const def = SPECIES[c.species];
    c.px = c.x;
    c.pz = c.z;
    const wasRunning = c.running;
    c.moving = false;
    c.running = false;
    c.age += DT;
    c.stateTime += DT;
    c.reproCooldown -= DT;
    const nightMul = def.nocturnal && this.isNight ? 1.3 : 1;
    const restMul = c.state === 'rest' ? 0.5 : 1;
    c.hunger = Math.min(100, c.hunger + def.hungerRate * nightMul * restMul * DT * (c.giant ? 1.3 : 1));
    if (c.scale < 1 && !c.giant && c.mass < 1.5) c.scale = Math.min(1, c.scale + DT * 0.004);

    // Old age & starvation.
    if (c.age > c.lifespan) {
      this.kill(c, 'death_old_age', `${c.id}（${def.name}）が寿命を迎えた（${Math.round(c.age)}秒）`);
      return;
    }
    if (c.hunger >= 100) {
      c.hp -= def.starveDamage * DT;
      if (c.hp <= 0) {
        this.kill(c, 'death_starvation', `${c.id}（${def.name}）が飢えで倒れた`);
        return;
      }
    } else if (c.hunger < 50 && c.hp < c.maxHp) {
      c.hp = Math.min(c.maxHp, c.hp + (c.state === 'rest' ? 0.3 : 0.05) * DT);
    }
    if (!wasRunning) c.stamina = Math.min(100, c.stamina + 10 * DT);

    // Fear.
    const threat = this.nearestThreat(c);
    if (threat) c.fear = Math.min(100, c.fear + 80 * DT * (1 - threat.d / (this.visionOf(c) + 0.01)) + 10 * DT);
    else c.fear = Math.max(0, c.fear - 12 * DT);

    if (def.role !== 'predator' && threat && c.fear > 30) {
      this.doFlee(c, threat);
    } else if (def.role === 'predator') {
      this.thinkPredator(c);
    } else {
      this.thinkGrazer(c);
    }

    // Reproduction check about once per second per creature.
    if ((this.tick + c.num) % 10 === 0) this.tryReproduce(c);
  }

  private doFlee(c: Creature, threat: { x: number; z: number; d: number; id: string }) {
    if (c.state !== 'flee') this.setState(c, 'flee');
    c.targetId = threat.id;
    let ax = c.x - threat.x;
    let az = c.z - threat.z;
    const l = Math.hypot(ax, az) || 1;
    ax /= l;
    az /= l;
    // Some grazers (deer) run towards the village when it is close: predators avoid it.
    if (SPECIES[c.species].fleesToVillage) {
      const v = this.world.village;
      const vx = v.cx + 0.5 - c.x;
      const vz = v.cz + 0.5 - c.z;
      const vd = Math.hypot(vx, vz);
      if (vd < 20 && threat.id !== 'PLAYER') {
        ax = ax * 0.6 + (vx / vd) * 0.4;
        az = az * 0.6 + (vz / vd) * 0.4;
      }
    }
    const canRun = c.stamina > 5;
    this.steer(c, c.x + ax * 3, c.z + az * 3, this.speedOf(c, canRun));
    if (canRun) {
      c.running = true;
      c.stamina = Math.max(0, c.stamina - 12 * DT);
    }
    if (c.stuck > 0.6) {
      this.pickWanderTarget(c, 4);
      this.steer(c, c.tx, c.tz, this.speedOf(c, canRun));
    }
  }

  private thinkGrazer(c: Creature) {
    const def = SPECIES[c.species];
    if (c.state === 'flee') {
      this.setState(c, 'wander');
      this.pickWanderTarget(c, 4);
    }
    // Resting deer.
    if (c.state === 'rest') {
      if (c.stateTime > c.restUntil || c.hunger > 55) this.setState(c, 'wander');
      return;
    }
    if (c.state === 'migrate') {
      const done = this.followPath(c, this.speedOf(c, false));
      if (done || c.stuck > 1.5 || c.stateTime > 60) this.setState(c, 'wander');
      else if (c.hunger > 55 && c.stateTime > 5 && this.nearestPlant(c, 0.35)) this.setState(c, 'seek_food');
      return;
    }
    if (c.state === 'eat') {
      const pi = c.targetId ? Number(c.targetId) : -1;
      const p = pi >= 0 ? this.plants[pi] : null;
      if (!p || !p.alive || p.biomass < 0.04 || Math.hypot(p.tx + 0.5 - c.x, p.tz + 0.5 - c.z) > 0.9) {
        this.setState(c, c.hunger > 25 ? 'seek_food' : 'wander');
        c.targetId = null;
        return;
      }
      const bite = Math.min(p.biomass, 0.22 * DT);
      p.biomass -= bite;
      c.hunger = Math.max(0, c.hunger - bite * def.biteFill);
      if (def.splits) {
        const giants = this.creatures.filter((o) => o.alive && o.giant).length;
        c.mass = Math.min(giants >= 2 && !c.giant ? 2.9 : 4, c.mass + bite * 0.75);
        if (c.mass > 1) c.scale = Math.min(c.giant ? 1.9 : 1.35, 0.8 + c.mass * 0.25);
        if (c.mass >= 3.5 && !c.giant) {
          c.giant = true;
          c.maxHp = 9;
          c.hp = 9;
          c.scale = 1.7;
          this.log('giant_slime', `${c.id} は食べ続けて巨大スライムになった！（仲間が多すぎて分裂できない）`, {
            actor: c.id,
            x: c.x,
            z: c.z,
            rare: true,
          });
        }
      }
      if (c.hunger < 6) {
        c.meals++;
        this.setState(c, 'wander');
        c.targetId = null;
      }
      return;
    }
    if (c.hunger > 45 || c.state === 'seek_food') {
      if (c.state !== 'seek_food') this.setState(c, 'seek_food');
      let p = c.targetId ? this.plants[Number(c.targetId)] : null;
      if (!p || !p.alive || p.biomass < 0.2 || c.stateTime % 2 < DT) {
        p = this.nearestPlant(c, 0.3);
        c.targetId = p ? String(p.idx) : null;
      }
      if (p) {
        c.noFoodTime = 0;
        if (this.steer(c, p.tx + 0.5, p.tz + 0.5, this.speedOf(c, false)) || Math.hypot(p.tx + 0.5 - c.x, p.tz + 0.5 - c.z) < 0.5) {
          this.setState(c, 'eat');
          c.targetId = String(p.idx);
        } else if (c.stuck > 1.2) {
          c.targetId = null;
          c.stuck = 0;
          this.pickWanderTarget(c, 4);
        }
      } else {
        c.noFoodTime += DT;
        if (c.noFoodTime > def.migrateAfter && this.startMigration(c)) return;
        if (this.steer(c, c.tx, c.tz, this.speedOf(c, false)) || c.stuck > 1) this.pickWanderTarget(c, 6);
      }
      if (c.hunger < 30 && c.state === 'seek_food') this.setState(c, 'wander');
      return;
    }
    // Some grazers (deer) look for a safe spot to rest when fed and calm.
    if (def.restsWhenFed && c.hunger < 35 && c.fear < 3 && c.state === 'wander' && c.stateTime > 12 && this.rng.chance(0.02)) {
      this.setState(c, 'rest');
      c.restUntil = this.rng.range(10, 22);
      return;
    }
    // Wander / idle.
    if (c.state === 'idle') {
      if (c.stateTime > 2) this.setState(c, 'wander');
      return;
    }
    if (c.state !== 'wander') this.setState(c, 'wander');
    if (this.steer(c, c.tx, c.tz, this.speedOf(c, false) * 0.7) || c.stuck > 1) {
      if (this.rng.chance(0.35)) this.setState(c, 'idle');
      this.pickWanderTarget(c, def.wanderRadius);
    }
  }

  /** Predators (wolf, hornfang): rest, eat, hunt, chase, migrate. Prey lists come from species data. */
  private thinkPredator(c: Creature) {
    const def = SPECIES[c.species];
    if (c.state === 'rest') {
      if (c.stateTime > c.restUntil || c.hunger > 70) this.setState(c, 'wander');
      return;
    }
    if (c.state === 'eat') {
      if (c.stateTime > 5) {
        this.setState(c, 'rest');
        c.restUntil = this.rng.range(18, 30);
      }
      return;
    }
    // Predators avoid the village unless starving.
    if (def.avoidsVillage && c.hunger < 90 && this.inVillage(c.x, c.z, 1)) {
      const v = this.world.village;
      const ax = c.x - (v.cx + 0.5);
      const az = c.z - (v.cz + 0.5);
      const l = Math.hypot(ax, az) || 1;
      this.steer(c, c.x + (ax / l) * 3, c.z + (az / l) * 3, this.speedOf(c, false));
      if (c.state === 'chase' && c.targetId) {
        this.log('hunt_fail', `${c.targetId} は村に逃げ込み、${c.id}（${def.name}）は狩りを諦めた`, {
          actor: c.id,
          target: c.targetId,
          x: c.x,
          z: c.z,
          rare: this.events.count('hunt_fail') < 50,
          data: { reason: 'village' },
        });
        this.setState(c, 'wander');
        c.targetId = null;
      }
      return;
    }
    if (c.state === 'migrate') {
      const done = this.followPath(c, this.speedOf(c, false));
      if (done || c.stuck > 1.5 || c.stateTime > 70) this.setState(c, 'wander');
      else if (c.hunger > 50 && this.findPrey(c, c.hunger > 80)) this.setState(c, 'hunt');
      return;
    }
    const desperate = c.hunger > 70;
    if (c.hunger > 50 || c.state === 'hunt' || c.state === 'chase') {
      let prey = c.targetId ? this.getCreature(c.targetId) : undefined;
      if (!prey || !prey.alive) {
        prey = this.findPrey(c, desperate) ?? undefined;
        if (prey) {
          c.targetId = prey.id;
          this.log(
            'hunt_start',
            `${c.id}（${def.name}）が ${prey.id}（${SPECIES[prey.species].name}）に狙いを定めた`,
            { actor: c.id, target: prey.id, x: c.x, z: c.z },
          );
        }
      }
      if (prey) {
        const d = Math.hypot(prey.x - c.x, prey.z - c.z);
        if (d > this.visionOf(c) * 1.3) {
          this.log('hunt_fail', `${prey.id} は ${c.id} の視界から逃げ切った`, { actor: c.id, target: prey.id, x: c.x, z: c.z });
          c.targetId = null;
          this.setState(c, 'hunt');
          return;
        }
        // Stalk at walking pace, sprint once close enough.
        if (c.state !== 'chase') {
          if (d > 5) {
            if (c.state !== 'hunt') this.setState(c, 'hunt');
            this.steer(c, prey.x, prey.z, this.speedOf(c, false) * 0.8);
            return;
          }
          this.setState(c, 'chase');
        }
        const canRun = c.stamina > 3;
        this.steer(c, prey.x, prey.z, this.speedOf(c, canRun));
        if (canRun) {
          c.running = true;
          c.stamina = Math.max(0, c.stamina - 14 * DT);
        } else if (c.stateTime > 4) {
          this.log('hunt_fail', `${c.id}（${def.name}）は息切れし、${prey.id} を取り逃がした`, {
            actor: c.id,
            target: prey.id,
            x: c.x,
            z: c.z,
            data: { reason: 'stamina' },
          });
          c.targetId = null;
          this.setState(c, 'rest');
          c.restUntil = 6;
          return;
        }
        if (d < 0.6 * c.scale + 0.2) {
          // A meal outside the normal prey list (e.g. a starving wolf eating a slime).
          const isDesperate = !def.prey.includes(prey.species);
          c.attackTime = this.time;
          this.kill(
            prey,
            'death_predation',
            `${c.id}（${def.name}）が ${prey.id}（${SPECIES[prey.species].name}）を捕食した`,
            c.id,
          );
          if (isDesperate) {
            this.log('desperate_hunt', `飢えた ${c.id} が本来は食べない${SPECIES[prey.species].name} ${prey.id} を食べた`, {
              actor: c.id,
              target: prey.id,
              x: c.x,
              z: c.z,
              rare: true,
            });
          }
          c.hunger = Math.max(0, c.hunger - (isDesperate ? def.desperateFill : def.preyFill));
          c.kills++;
          c.meals++;
          c.targetId = null;
          this.setState(c, 'eat');
        }
        return;
      }
      // No prey in sight.
      if (c.state !== 'hunt') this.setState(c, 'hunt');
      c.noFoodTime += DT;
      if (c.noFoodTime > 8 && this.startMigration(c)) return;
      if (this.steer(c, c.tx, c.tz, this.speedOf(c, false)) || c.stuck > 1) this.pickWanderTarget(c, 8);
      // Starving predators may approach the player.
      if (def.bitesPlayerWhenStarving && desperate && this.player && Math.hypot(this.player.x - c.x, this.player.z - c.z) < 6) {
        this.steer(c, this.player.x, this.player.z, this.speedOf(c, false));
        if (Math.hypot(this.player.x - c.x, this.player.z - c.z) < 0.8 && c.stateTime % 1.2 < DT) {
          this.playerHits.push({ by: c.id, dmg: 1 });
          c.attackTime = this.time;
          this.log('player_attacked', `飢えた ${c.id} が主人公に噛みついた！`, { actor: c.id, target: 'PLAYER', x: c.x, z: c.z });
        }
      }
      return;
    }
    if (c.state !== 'wander') this.setState(c, 'wander');
    c.noFoodTime = 0;
    if (this.steer(c, c.tx, c.tz, this.speedOf(c, false) * 0.6) || c.stuck > 1) this.pickWanderTarget(c, 8);
  }

  // -------------------------------------------------------------------------
  // Plants & pickups

  private updatePlants() {
    const growth = 0.25 + 0.75 * this.daylight;
    const everySecond = this.tick % 10 === 0;
    let alive = 0;
    for (const p of this.plants) {
      if (!p.alive) continue;
      alive++;
      const rate = p.kind === 'grass' ? 0.05 : 0.025;
      p.biomass = Math.min(1, p.biomass + rate * growth * (p.biomass + 0.06) * (1 - p.biomass) * DT);
      if (p.biomass < 0.06) p.lowTime += DT;
      else p.lowTime = 0;
      if (p.lowTime > 45) {
        p.alive = false;
        this.plantAt[tileIndex(this.world, p.tx, p.tz)] = -1;
        this.plantStats.withered++;
      }
    }
    if (everySecond) {
      const n = this.plants.length;
      for (let i = 0; i < n; i++) {
        const p = this.plants[i];
        if (!p.alive || p.biomass < 0.92 || alive >= PLANT_CAP) continue;
        if (!this.plantRng.chance(p.kind === 'grass' ? 0.012 : 0.006)) continue;
        const tx = p.tx + this.plantRng.int(-2, 2);
        const tz = p.tz + this.plantRng.int(-2, 2);
        if (this.addPlant(p.kind, tx, tz, 0.1)) {
          alive++;
          this.plantStats.spread++;
        }
      }
    }
    // Keep the array from growing forever.
    if (this.tick % 600 === 0 && this.plants.length > PLANT_CAP * 2) this.compactPlants();
  }

  private compactPlants() {
    const keep = this.plants.filter((p) => p.alive);
    this.plantAt.fill(-1);
    // Creatures may hold plant indices as targets: remap them.
    const remap = new Map<number, number>();
    keep.forEach((p, i) => {
      remap.set(p.idx, i);
      p.idx = i;
      this.plantAt[tileIndex(this.world, p.tx, p.tz)] = i;
    });
    for (const c of this.creatures) {
      if ((c.state === 'eat' || c.state === 'seek_food') && c.targetId !== null) {
        const ni = remap.get(Number(c.targetId));
        c.targetId = ni === undefined ? null : String(ni);
      }
    }
    this.plants = keep;
  }

  private spawnPickupCycle(initial = false) {
    const w = this.world;
    const r = this.pickupRng;
    const have = (m: MaterialId) => this.pickups.filter((p) => p.alive && p.material === m).length;
    const tryAdd = (m: MaterialId, filter: (tx: number, tz: number) => boolean) => {
      const pos = this.randomReachableTile(r, (tx, tz) => filter(tx, tz) && isTileWalkable(w, tx, tz), 200);
      if (!pos) return;
      const id = `PK-${(++this.pickupSeq).toString().padStart(4, '0')}`;
      const pk = { id, material: m, x: pos.x + r.range(-0.2, 0.2), z: pos.z + r.range(-0.2, 0.2), alive: true };
      this.pickups.push(pk);
      if (!initial)
        this.log('spawn_pickup', `${MATERIALS[m].name}が現れた`, { target: id, x: pk.x, z: pk.z, data: { material: m } });
    };
    const tile = (tx: number, tz: number) => w.tiles[tileIndex(w, tx, tz)];
    const nearCave = (tx: number, tz: number, d: number) => Math.hypot(tx - w.cave.tx, tz - w.cave.tz) < d;
    if (have('mushroom') < 9) tryAdd('mushroom', (tx, tz) => tile(tx, tz) === Tile.FOREST);
    if (have('wind_feather') < 5) tryAdd('wind_feather', (tx, tz) => tile(tx, tz) === Tile.GRASS);
    if (have('water_stone') < 4) tryAdd('water_stone', (tx, tz) => tile(tx, tz) === Tile.SAND);
    if (have('crystal') < 4) tryAdd('crystal', (tx, tz) => nearCave(tx, tz, 7) && tile(tx, tz) !== Tile.CAVE);
    if (have('fire_stone') < 2 && (initial || r.chance(0.3)))
      tryAdd('fire_stone', (tx, tz) => {
        for (let dz = -1; dz <= 1; dz++)
          for (let dx = -1; dx <= 1; dx++) {
            const s = inBounds(w, tx + dx, tz + dz) ? w.solidAt[tileIndex(w, tx + dx, tz + dz)] : -1;
            if (s >= 0 && (w.objects[s].kind === 'rock' || w.objects[s].kind === 'ore')) return true;
          }
        return false;
      });
    if (this.pickups.length > 200) this.pickups = this.pickups.filter((p) => p.alive);
  }

  // -------------------------------------------------------------------------
  // World-level monitors

  private monitor() {
    // Day / night.
    const night = this.isNight;
    if (night !== this.wasNight) {
      this.wasNight = night;
      this.log(night ? 'nightfall' : 'daybreak', night ? '夜になった。オオカミの動きが活発になる。' : '朝が来た。植物がよく育つ。');
    }
    // Every 10 s: population sample & boom / crash detection.
    if (this.tick % 100 === 0) {
      const bySpecies: Partial<Record<Species, number>> = {};
      for (const s of this.roster) bySpecies[s] = this.count(s);
      const sample: PopSample = {
        t: Math.round(this.time),
        slime: this.count('slime'),
        deer: this.count('deer'),
        wolf: this.count('wolf'),
        plants: this.aliveplants(),
        bySpecies,
      };
      this.popHistory.push(sample);
      if (this.popHistory.length > 720) this.popHistory.shift();
      for (const s of this.roster) {
        const now = bySpecies[s] ?? 0;
        const prev = this.lastPop[s];
        const cooldownOk = this.time - this.lastPopEvent[s] > 120;
        if (cooldownOk && now >= 6 && now >= prev * 1.5) {
          this.log('population_boom', `${SPECIES[s].name}が急増している（${prev}→${now}）`, { rare: true, data: { species: s, from: prev, to: now } });
          this.lastPopEvent[s] = this.time;
          this.lastPop[s] = now;
        } else if (cooldownOk && prev >= 6 && now <= prev * 0.5) {
          this.log('population_crash', `${SPECIES[s].name}が激減している（${prev}→${now}）`, { rare: true, data: { species: s, from: prev, to: now } });
          this.lastPopEvent[s] = this.time;
          this.lastPop[s] = now;
        } else if (this.tick % 600 === 0) {
          this.lastPop[s] = now;
        }
      }
    }
    // Every 60 s: plant report.
    if (this.tick % 600 === 0 && this.tick > 0) {
      const { spread, withered } = this.plantStats;
      if (spread > 0)
        this.log('plant_bloom', `この1分で植物が${spread}株広がった（現在${this.aliveplants()}株）`, { data: { spread, withered } });
      if (withered > 0) this.log('plant_withered', `この1分で植物が${withered}株枯れた`, { data: { spread, withered } });
      this.plantStats = { spread: 0, withered: 0 };
    }
    if (this.tick % 150 === 0 && this.tick > 0) this.spawnPickupCycle();
    // Immigration: a species that vanished may return from the edge of the map.
    if (this.tick % 300 === 0 && this.tick > 0) {
      for (const s of this.roster) {
        if (this.count(s) > 0) continue;
        const ext = [...this.events.events].reverse().find((e) => e.type === 'extinction' && e.data?.species === s);
        if (!ext || this.time - ext.t < 150 || !this.rng.chance(0.5)) continue;
        this.immigrate(s);
      }
    }
  }

  private immigrate(s: Species) {
    const w = this.world;
    const def = SPECIES[s];
    const home = (tx: number, tz: number) => !def.habitat || this.nearHabitat(def.habitat, tx, tz, (def.habitatRange ?? 3) + 3);
    const edge = this.randomReachableTile(this.rng, (tx, tz) => (tx < 5 || tz < 5 || tx > w.width - 6 || tz > w.height - 6) && home(tx, tz));
    if (!edge) return;
    const n = def.immigrantGroup;
    const ids: string[] = [];
    for (let i = 0; i < n; i++) {
      const c = this.spawnCreature(s, edge.x, edge.z, null);
      c.age = SPECIES[s].lifespan * 0.2;
      ids.push(c.id);
    }
    this.log('migration', ids.length > 1 ? `${SPECIES[s].name}の群れ（${ids.join(', ')}）が森の外からやってきた` : `はぐれた${SPECIES[s].name}（${ids[0]}）が森の外からやってきた`, {
      actor: ids[0],
      x: edge.x,
      z: edge.z,
      rare: true,
      data: { species: s, count: n, immigration: true },
    });
  }

  // -------------------------------------------------------------------------
  // Main step

  step() {
    this.tick++;
    this.time = this.tick * DT;
    this.updatePlants();
    for (let i = 0; i < this.creatures.length; i++) {
      const c = this.creatures[i];
      if (c.alive) this.updateCreature(c);
    }
    if (this.tick % 50 === 0) this.creatures = this.creatures.filter((c) => c.alive);
    this.monitor();
  }

  // -------------------------------------------------------------------------
  // Player interactions

  /** Damages a creature; returns materials dropped if it died. */
  damageCreature(id: string, dmg: number, knockFrom?: Point): MaterialId[] {
    const c = this.getCreature(id);
    if (!c || !c.alive) return [];
    c.hp -= dmg;
    c.hitTime = this.time;
    c.fear = 100;
    if (knockFrom) {
      const ax = c.x - knockFrom.x;
      const az = c.z - knockFrom.z;
      const l = Math.hypot(ax, az) || 1;
      const nx = c.x + (ax / l) * 0.5;
      const nz = c.z + (az / l) * 0.5;
      if (canStand(this.world, nx, nz, SPECIES[c.species].radius)) {
        c.x = nx;
        c.z = nz;
      }
    }
    if (c.hp > 0) return [];
    this.kill(c, 'death_player', `主人公が ${c.id}（${SPECIES[c.species].name}）を倒した`, 'PLAYER');
    const drops: MaterialId[] = [];
    if (c.species === 'slime') drops.push('slime_core');
    if (c.species === 'slime' && c.giant) drops.push('slime_core', 'crystal');
    if (c.species === 'deer' && this.dropRng.chance(0.6)) drops.push('wind_feather');
    if (c.species === 'wolf') drops.push(this.dropRng.chance(0.5) ? 'fire_stone' : 'crystal');
    // Newer species: data-driven drops (two draws per entry, in table order).
    for (const e of SPECIES[c.species].drops ?? []) {
      const hit = this.dropRng.next() < e.chance;
      const n = e.min + Math.floor(this.dropRng.next() * (e.max - e.min + 1));
      if (hit) for (let i = 0; i < n; i++) drops.push(e.id);
    }
    return drops;
  }

  addPickup(material: MaterialId, x: number, z: number): Pickup {
    const pk = { id: `PK-${(++this.pickupSeq).toString().padStart(4, '0')}`, material, x, z, alive: true };
    this.pickups.push(pk);
    return pk;
  }

  /** Harvests the plant on/next to a tile. Returns the plant kind harvested. */
  harvestPlant(x: number, z: number): 'grass' | 'berry' | null {
    let best: Plant | null = null;
    let bestD = 1.3;
    for (let dz = -1; dz <= 1; dz++)
      for (let dx = -1; dx <= 1; dx++) {
        const tx = Math.floor(x) + dx;
        const tz = Math.floor(z) + dz;
        if (!inBounds(this.world, tx, tz)) continue;
        const pi = this.plantAt[tileIndex(this.world, tx, tz)];
        if (pi < 0) continue;
        const p = this.plants[pi];
        const d = Math.hypot(tx + 0.5 - x, tz + 0.5 - z);
        if (p.alive && p.biomass > 0.3 && d < bestD) {
          best = p;
          bestD = d;
        }
      }
    if (!best) return null;
    best.biomass = Math.max(0, best.biomass - 0.5);
    return best.kind;
  }

  /** Fire magic: burns plants in a radius. */
  burnPlants(x: number, z: number, r: number, cause: string): number {
    let n = 0;
    for (const p of this.plants) {
      if (!p.alive || Math.hypot(p.tx + 0.5 - x, p.tz + 0.5 - z) > r) continue;
      p.alive = false;
      this.plantAt[tileIndex(this.world, p.tx, p.tz)] = -1;
      n++;
    }
    if (n > 0)
      this.log('plant_burned', `${cause}の炎で植物が${n}株焼けた${n >= 4 ? '（小さな野火）' : ''}`, {
        actor: 'PLAYER',
        x,
        z,
        rare: n >= 4,
        data: { burned: n },
      });
    return n;
  }

  /** Water magic: plants nearby flourish and new grass sprouts. */
  waterPlants(x: number, z: number, r: number): number {
    let sprouted = 0;
    for (const p of this.plants) if (p.alive && Math.hypot(p.tx + 0.5 - x, p.tz + 0.5 - z) <= r) p.biomass = Math.min(1, p.biomass + 0.5);
    const ri = Math.ceil(r);
    for (let dz = -ri; dz <= ri; dz++)
      for (let dx = -ri; dx <= ri; dx++) {
        const tx = Math.floor(x) + dx;
        const tz = Math.floor(z) + dz;
        // Deterministic per tile and time, independent of the sim streams.
        if (hashInts(this.seed, tx, tz, this.tick) % 100 < 30 && this.addPlant('grass', tx, tz, 0.3)) sprouted++;
      }
    return sprouted;
  }

  /** Wind magic: pushes creatures away. */
  pushCreatures(x: number, z: number, r: number, force: number): number {
    let n = 0;
    for (const c of this.creatures) {
      if (!c.alive) continue;
      const d = Math.hypot(c.x - x, c.z - z);
      if (d > r) continue;
      const ax = (c.x - x) / (d || 1);
      const az = (c.z - z) / (d || 1);
      for (let k = 10; k > 0; k--) {
        const nx = c.x + ax * force * (k / 10);
        const nz = c.z + az * force * (k / 10);
        if (canStand(this.world, nx, nz, SPECIES[c.species].radius)) {
          c.x = nx;
          c.z = nz;
          break;
        }
      }
      c.fear = 100;
      n++;
    }
    return n;
  }

  takePickup(id: string): Pickup | null {
    const p = this.pickups.find((k) => k.id === id && k.alive);
    if (!p) return null;
    p.alive = false;
    return p;
  }

  // -------------------------------------------------------------------------
  // Research helpers

  describeCreature(c: Creature): string {
    return `${c.id} ${SPECIES[c.species].name} [${STATE_LABELS[c.state]}] HP${c.hp.toFixed(1)}/${c.maxHp} 空腹${c.hunger.toFixed(0)} 恐怖${c.fear.toFixed(0)}`;
  }

  /** Hash of the whole simulation state, for reproducibility tests. */
  fingerprint(): number {
    let h = hashInts(this.tick, this.creatures.length, this.plants.length);
    for (const c of this.creatures) {
      if (!c.alive) continue;
      h = hashInts(h, c.num, Math.round(c.x * 100), Math.round(c.z * 100), Math.round(c.hunger * 10), c.state.length);
    }
    for (const p of this.plants) if (p.alive) h = hashInts(h, p.tx, p.tz, Math.round(p.biomass * 1000));
    h = hashInts(h, this.events.events.length);
    return h;
  }
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

function round2(v: number) {
  return Math.round(v * 100) / 100;
}
