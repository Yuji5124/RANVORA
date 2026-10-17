// Procedural field generator: village + forest + stream + cave.
// Same seed => identical world. Every landmark is guaranteed reachable.

import { RNG as RotRNG, Noise, Path } from 'rot-js';
import { Rng, shortId, hashInts } from '../core/rng';
import { Tile, type World, type WorldObject, type ObjectKind, tileIndex, inBounds, isTileWalkable } from './types';

export const WORLD_SIZE = 72;

interface Ctx {
  w: World;
  rng: Rng;
  objSeq: number;
}

export function generateWorld(seed: number, size = WORLD_SIZE): World {
  const W = size;
  const H = size;
  const w: World = {
    seed,
    width: W,
    height: H,
    tiles: new Uint8Array(W * H).fill(Tile.GRASS),
    solidAt: new Int32Array(W * H).fill(-1),
    objects: [],
    reachable: new Uint8Array(W * H),
    spawn: { x: 0, z: 0 },
    village: { cx: 0, cz: 0, radius: 8 },
    cave: { tx: 0, tz: 0 },
    landmarks: [],
  };
  const ctx: Ctx = { w, rng: Rng.stream(seed, 'world'), objSeq: 0 };

  // rot.js keeps a global RNG: seed it right before building the noise
  // fields so generation stays deterministic.
  RotRNG.setSeed(seed || 1);
  const forestNoise = new Noise.Simplex();
  const detailNoise = new Noise.Simplex();
  const riverNoise = new Noise.Simplex();

  const forestField = (x: number, z: number) =>
    forestNoise.get(x / 15, z / 15) * 0.75 + detailNoise.get(x / 5, z / 5) * 0.25;

  // 1. Forest vs meadow.
  for (let z = 0; z < H; z++) {
    for (let x = 0; x < W; x++) {
      if (forestField(x, z) > 0.12) w.tiles[z * W + x] = Tile.FOREST;
    }
  }

  // 2. Village: the most open spot near the middle of the map.
  const village = pickVillageSite(ctx, forestField);
  w.village = { cx: village.x, cz: village.z, radius: 8 };
  forEachInRadius(w, village.x, village.z, 9, (x, z, d) => {
    w.tiles[z * W + x] = d <= 3.2 ? Tile.PLAZA : Tile.GRASS;
  });

  // 3. Stream from the north edge to the south edge, avoiding the village.
  carveRiver(ctx, riverNoise);

  // 4. Cave entrance in a cliff far from the village.
  placeCave(ctx);

  // 5. Village buildings.
  placeVillage(ctx);

  // 6. Treasure chests in the wilds.
  const chests = placeChests(ctx);

  // 7. Roads (A*) from the village to the cave and to the south edge.
  const plazaExit = { x: village.x, z: village.z + 4 };
  carveRoad(ctx, plazaExit, { x: w.cave.tx, z: w.cave.tz + 1 });
  carveRoad(ctx, { x: village.x, z: village.z - 4 }, { x: clamp(village.x + ctx.rng.int(-8, 8), 3, W - 4), z: 2 });
  if (chests.length > 0) carveRoad(ctx, { x: village.x + 4, z: village.z }, { x: chests[0].tx, z: chests[0].tz + 1 });

  // 8. Vegetation and rocks.
  placeNature(ctx, forestField);

  // 9. Spawn point on the plaza, just south of the well.
  w.spawn = { x: village.x + 0.5, z: village.z + 2.5 };

  // 10. Guarantee reachability of every landmark.
  ensureReachable(ctx);

  return w;
}

// ---------------------------------------------------------------------------

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

function forEachInRadius(w: World, cx: number, cz: number, r: number, fn: (x: number, z: number, d: number) => void) {
  const ri = Math.ceil(r);
  for (let z = cz - ri; z <= cz + ri; z++) {
    for (let x = cx - ri; x <= cx + ri; x++) {
      if (!inBounds(w, x, z)) continue;
      const d = Math.hypot(x - cx, z - cz);
      if (d <= r) fn(x, z, d);
    }
  }
}

function addObject(
  ctx: Ctx,
  kind: ObjectKind,
  x: number,
  z: number,
  opts: { rot?: number; scale?: number; solid?: boolean; footprint?: number; data?: WorldObject['data'] } = {},
): WorldObject {
  const { w } = ctx;
  const obj: WorldObject = {
    id: shortId(kind.toUpperCase().slice(0, 3), hashInts(w.seed, ctx.objSeq++)),
    kind,
    x,
    z,
    rot: opts.rot ?? 0,
    scale: opts.scale ?? 1,
    solid: opts.solid ?? true,
    data: opts.data ?? {},
  };
  const idx = w.objects.length;
  w.objects.push(obj);
  if (obj.solid) {
    const fp = opts.footprint ?? 1;
    const half = Math.floor(fp / 2);
    const tx = Math.floor(x);
    const tz = Math.floor(z);
    for (let dz = -half; dz <= half; dz++)
      for (let dx = -half; dx <= half; dx++)
        if (inBounds(w, tx + dx, tz + dz)) w.solidAt[tileIndex(w, tx + dx, tz + dz)] = idx;
  }
  return obj;
}

function isFree(w: World, x: number, z: number) {
  if (!inBounds(w, x, z)) return false;
  const i = tileIndex(w, x, z);
  const t = w.tiles[i];
  return w.solidAt[i] < 0 && (t === Tile.GRASS || t === Tile.FOREST);
}

function pickVillageSite(ctx: Ctx, forestField: (x: number, z: number) => number) {
  const { w, rng } = ctx;
  let best = { x: w.width >> 1, z: w.height >> 1, score: Infinity };
  for (let i = 0; i < 60; i++) {
    const x = rng.int(Math.floor(w.width * 0.32), Math.floor(w.width * 0.68));
    const z = rng.int(Math.floor(w.height * 0.32), Math.floor(w.height * 0.68));
    let score = 0;
    forEachInRadius(w, x, z, 8, (px, pz) => {
      score += Math.max(0, forestField(px, pz) + 0.2);
    });
    if (score < best.score) best = { x, z, score };
  }
  return best;
}

function carveRiver(ctx: Ctx, noise: InstanceType<typeof Noise.Simplex>) {
  const { w, rng } = ctx;
  const { cx, cz } = w.village;
  const side = rng.chance(0.5) ? 1 : -1;
  const x0 = clamp(cx + side * rng.int(13, 20), 6, w.width - 8);
  const amp = rng.range(5, 9);
  for (let z = 0; z < w.height; z++) {
    let x = Math.round(x0 + noise.get(z / 16, 3.7) * amp);
    // Keep the stream outside the village.
    if (Math.abs(x - cx) < 12 && Math.abs(z - cz) < 12) x = cx + side * 12;
    x = clamp(x, 3, w.width - 5);
    for (let dx = -1; dx <= 3; dx++) {
      const tx = x + dx;
      if (!inBounds(w, tx, z)) continue;
      const i = tileIndex(w, tx, z);
      if (dx >= 0 && dx <= 1) w.tiles[i] = Tile.WATER;
      else if (w.tiles[i] !== Tile.WATER) w.tiles[i] = Tile.SAND;
    }
  }
}

function placeCave(ctx: Ctx) {
  const { w, rng } = ctx;
  const { cx, cz } = w.village;
  let best: { x: number; z: number } | null = null;
  for (let i = 0; i < 200; i++) {
    const x = rng.int(6, w.width - 7);
    const z = rng.int(6, w.height - 8);
    const d = Math.hypot(x - cx, z - cz);
    if (d < 24) continue;
    let ok = true;
    forEachInRadius(w, x, z, 4, (px, pz) => {
      const t = w.tiles[tileIndex(w, px, pz)];
      if (t === Tile.WATER || t === Tile.SAND || t === Tile.PLAZA) ok = false;
    });
    if (!ok) continue;
    best = { x, z };
    break;
  }
  if (!best) best = { x: cx < w.width / 2 ? w.width - 9 : 8, z: cz < w.height / 2 ? w.height - 10 : 8 };
  // Cliff blob north of the entrance.
  forEachInRadius(w, best.x, best.z - 2, 3.2, (x, z) => {
    if (z <= best!.z) w.tiles[tileIndex(w, x, z)] = Tile.CLIFF;
  });
  w.tiles[tileIndex(w, best.x, best.z)] = Tile.CAVE;
  // Clear the approach.
  for (let dz = 1; dz <= 2; dz++)
    for (let dx = -1; dx <= 1; dx++)
      if (inBounds(w, best.x + dx, best.z + dz)) w.tiles[tileIndex(w, best.x + dx, best.z + dz)] = Tile.GRASS;
  w.cave = { tx: best.x, tz: best.z };
  const cave = addObject(ctx, 'cave', best.x + 0.5, best.z + 0.5, { solid: false });
  w.landmarks.push({ kind: 'cave', id: cave.id, tx: best.x, tz: best.z });
}

function placeVillage(ctx: Ctx) {
  const { w, rng } = ctx;
  const { cx, cz } = w.village;
  addObject(ctx, 'well', cx + 0.5, cz + 0.5);
  // Houses on a ring, doors facing the plaza.
  const count = rng.int(4, 6);
  const start = rng.range(0, Math.PI * 2);
  for (let i = 0; i < count; i++) {
    const a = start + (i / count) * Math.PI * 2 + rng.range(-0.15, 0.15);
    // Snap house centres to tiles, 5.5 tiles from the well.
    const hx = Math.round(cx + Math.cos(a) * 5.6);
    const hz = Math.round(cz + Math.sin(a) * 5.6);
    // Door direction: towards the plaza, snapped to 4 directions.
    const toX = cx - hx;
    const toZ = cz - hz;
    let rot: number;
    let door: { x: number; z: number };
    if (Math.abs(toX) > Math.abs(toZ)) {
      rot = toX > 0 ? Math.PI / 2 : -Math.PI / 2;
      door = { x: hx + Math.sign(toX) * 2, z: hz };
    } else {
      rot = toZ > 0 ? 0 : Math.PI;
      door = { x: hx, z: hz + Math.sign(toZ) * 2 };
    }
    // Skip houses that would overlap other solids or leave the map.
    let clear = true;
    for (let dz = -1; dz <= 1; dz++)
      for (let dx = -1; dx <= 1; dx++) {
        const tx = hx + dx;
        const tz = hz + dz;
        if (!inBounds(w, tx, tz) || w.solidAt[tileIndex(w, tx, tz)] >= 0 || w.tiles[tileIndex(w, tx, tz)] === Tile.WATER)
          clear = false;
      }
    if (!clear) continue;
    const roofHue = rng.pick(['#d9573b', '#c94f3a', '#3f7fbf', '#d98a3a', '#8b5bb5']);
    const house = addObject(ctx, 'house', hx + 0.5, hz + 0.5, { rot, footprint: 3, data: { roof: roofHue } });
    if (inBounds(w, door.x, door.z)) {
      w.tiles[tileIndex(w, door.x, door.z)] = Tile.PATH;
      w.landmarks.push({ kind: 'house', id: house.id, tx: door.x, tz: door.z });
    }
  }
  // Lamps on the plaza edge.
  for (let i = 0; i < 4; i++) {
    const a = start + Math.PI / 4 + (i * Math.PI) / 2;
    const lx = Math.round(cx + Math.cos(a) * 3);
    const lz = Math.round(cz + Math.sin(a) * 3);
    if (isFreeAny(w, lx, lz)) addObject(ctx, 'lamp', lx + 0.5, lz + 0.5);
  }
  // Fence ring with gaps (gaps on the four axes become exits).
  const r = 8.6;
  for (let i = 0; i < 64; i++) {
    const a = (i / 64) * Math.PI * 2;
    const deg = (a * 180) / Math.PI;
    const nearAxis = [0, 90, 180, 270, 360].some((d) => Math.abs(deg - d) < 14);
    if (nearAxis || rng.chance(0.25)) continue;
    const fx = Math.round(cx + Math.cos(a) * r);
    const fz = Math.round(cz + Math.sin(a) * r);
    if (isFreeAny(w, fx, fz) && w.tiles[tileIndex(w, fx, fz)] !== Tile.WATER)
      addObject(ctx, 'fence', fx + 0.5, fz + 0.5, { rot: Math.PI / 2 - a });
  }
}

function isFreeAny(w: World, x: number, z: number) {
  return inBounds(w, x, z) && w.solidAt[tileIndex(w, x, z)] < 0 && w.tiles[tileIndex(w, x, z)] !== Tile.CLIFF;
}

function placeChests(ctx: Ctx) {
  const { w, rng } = ctx;
  const { cx, cz } = w.village;
  const out: { tx: number; tz: number }[] = [];
  for (let tries = 0; tries < 400 && out.length < 5; tries++) {
    const x = rng.int(4, w.width - 5);
    const z = rng.int(4, w.height - 5);
    if (!isFree(w, x, z)) continue;
    const front = w.tiles[tileIndex(w, x, z + 1)];
    if (front === Tile.CLIFF || front === Tile.CAVE) continue;
    if (Math.hypot(x - cx, z - cz) < 12) continue;
    if (out.some((c) => Math.hypot(c.tx - x, c.tz - z) < 12)) continue;
    const chest = addObject(ctx, 'chest', x + 0.5, z + 0.5, { rot: 0, data: { opened: false } });
    out.push({ tx: x, tz: z });
    // The tile south of the chest is where the player opens it.
    w.landmarks.push({ kind: 'chest', id: chest.id, tx: x, tz: z + 1 });
    if (inBounds(w, x, z + 1) && w.tiles[tileIndex(w, x, z + 1)] === Tile.WATER) w.tiles[tileIndex(w, x, z + 1)] = Tile.BRIDGE;
  }
  return out;
}

function carveRoad(ctx: Ctx, from: { x: number; z: number }, to: { x: number; z: number }) {
  const { w } = ctx;
  const passable = (x: number, z: number) => {
    if (!inBounds(w, x, z) || x < 1 || z < 1 || x > w.width - 2 || z > w.height - 2) return false;
    const i = tileIndex(w, x, z);
    if (w.tiles[i] === Tile.CLIFF) return false;
    const s = w.solidAt[i];
    return s < 0 || (x === to.x && z === to.z);
  };
  const path: { x: number; z: number }[] = [];
  new Path.AStar(to.x, to.z, passable, { topology: 4 }).compute(from.x, from.z, (x, z) => path.push({ x, z }));
  for (const p of path) {
    const i = tileIndex(w, p.x, p.z);
    const t = w.tiles[i];
    if (t === Tile.WATER) w.tiles[i] = Tile.BRIDGE;
    else if (t !== Tile.PLAZA && t !== Tile.CAVE && t !== Tile.BRIDGE) w.tiles[i] = Tile.PATH;
  }
}

function placeNature(ctx: Ctx, forestField: (x: number, z: number) => number) {
  const { w, rng } = ctx;
  const { cx, cz } = w.village;
  const nearLandmark = (x: number, z: number) =>
    w.landmarks.some((l) => Math.abs(l.tx - x) <= 1 && Math.abs(l.tz - z) <= 1) ||
    (Math.abs(x - Math.floor(w.spawn.x)) <= 1 && Math.abs(z - Math.floor(w.spawn.z)) <= 1);
  const flowerColors = ['#ffffff', '#ffd23f', '#ff7aa8', '#9b7bff', '#ff8c42', '#7fd1ff'];
  for (let z = 0; z < w.height; z++) {
    for (let x = 0; x < w.width; x++) {
      const i = tileIndex(w, x, z);
      const t = w.tiles[i];
      const border = x < 2 || z < 2 || x >= w.width - 2 || z >= w.height - 2;
      if (border) {
        if (t !== Tile.WATER && t !== Tile.BRIDGE && w.solidAt[i] < 0) {
          if (t === Tile.PATH || t === Tile.SAND) w.tiles[i] = Tile.FOREST;
          addObject(ctx, rng.chance(0.5) ? 'pine' : 'tree', x + 0.5 + rng.range(-0.1, 0.1), z + 0.5, {
            rot: rng.range(0, Math.PI * 2),
            scale: rng.range(0.95, 1.25),
          });
        }
        continue;
      }
      if (!isFree(w, x, z) || nearLandmark(x, z)) continue;
      const dVillage = Math.hypot(x - cx, z - cz);
      if (dVillage < 9.5) {
        if (t === Tile.GRASS && dVillage > 4 && rng.chance(0.07))
          addObject(ctx, 'flower', x + 0.5 + rng.range(-0.25, 0.25), z + 0.5 + rng.range(-0.25, 0.25), {
            solid: false,
            data: { color: rng.pick(flowerColors) },
          });
        continue;
      }
      const f = forestField(x, z);
      const dCave = Math.hypot(x - w.cave.tx, z - w.cave.tz);
      const treeP = t === Tile.FOREST ? 0.34 + Math.min(0.25, f) : 0.035;
      const rockP = dCave < 8 ? 0.12 : 0.018;
      const r = rng.next();
      if (r < treeP) {
        const kind: ObjectKind = t === Tile.FOREST && rng.chance(0.45) ? 'pine' : 'tree';
        addObject(ctx, kind, x + 0.5 + rng.range(-0.15, 0.15), z + 0.5 + rng.range(-0.15, 0.15), {
          rot: rng.range(0, Math.PI * 2),
          scale: rng.range(0.85, 1.2),
        });
      } else if (r < treeP + rockP) {
        const ore = rng.chance(dCave < 8 ? 0.5 : 0.22);
        addObject(ctx, ore ? 'ore' : 'rock', x + 0.5, z + 0.5, { rot: rng.range(0, Math.PI * 2), scale: rng.range(0.8, 1.15) });
      } else if (t === Tile.GRASS && rng.chance(0.09)) {
        addObject(ctx, 'flower', x + 0.5 + rng.range(-0.3, 0.3), z + 0.5 + rng.range(-0.3, 0.3), {
          solid: false,
          data: { color: rng.pick(flowerColors) },
        });
      }
    }
  }
}

/** Flood fill from spawn; carve a path to any landmark that is cut off. */
function ensureReachable(ctx: Ctx) {
  const { w } = ctx;
  const sx = Math.floor(w.spawn.x);
  const sz = Math.floor(w.spawn.z);
  floodReachable(w, sx, sz);
  for (const lm of w.landmarks) {
    if (w.reachable[tileIndex(w, lm.tx, lm.tz)]) continue;
    const passable = (x: number, z: number) => {
      if (!inBounds(w, x, z) || x < 1 || z < 1 || x > w.width - 2 || z > w.height - 2) return false;
      const i = tileIndex(w, x, z);
      if (w.tiles[i] === Tile.CLIFF) return false;
      const s = w.solidAt[i];
      if (s >= 0) {
        const k = w.objects[s].kind;
        if (k === 'house' || k === 'well' || k === 'chest') return false;
      }
      return true;
    };
    const path: { x: number; z: number }[] = [];
    new Path.AStar(lm.tx, lm.tz, passable, { topology: 4 }).compute(sx, sz, (x, z) => path.push({ x, z }));
    for (const p of path) {
      const i = tileIndex(w, p.x, p.z);
      if (w.tiles[i] === Tile.WATER) w.tiles[i] = Tile.BRIDGE;
      const s = w.solidAt[i];
      if (s >= 0) removeObject(w, s);
    }
    floodReachable(w, sx, sz);
  }
}

export function removeObject(w: World, index: number) {
  const obj = w.objects[index];
  obj.removed = true;
  for (let i = 0; i < w.solidAt.length; i++) if (w.solidAt[i] === index) w.solidAt[i] = -1;
}

export function floodReachable(w: World, sx: number, sz: number) {
  w.reachable.fill(0);
  if (!isTileWalkable(w, sx, sz)) return;
  const queue = [tileIndex(w, sx, sz)];
  w.reachable[queue[0]] = 1;
  while (queue.length) {
    const i = queue.pop()!;
    const x = i % w.width;
    const z = (i / w.width) | 0;
    const nbs = [
      [x + 1, z],
      [x - 1, z],
      [x, z + 1],
      [x, z - 1],
    ];
    for (const [nx, nz] of nbs) {
      if (!isTileWalkable(w, nx, nz)) continue;
      const ni = tileIndex(w, nx, nz);
      if (w.reachable[ni]) continue;
      w.reachable[ni] = 1;
      queue.push(ni);
    }
  }
}

/** Short fingerprint of a world for determinism checks. */
export function worldFingerprint(w: World): number {
  let h = hashInts(w.width, w.height);
  for (let i = 0; i < w.tiles.length; i++) h = hashInts(h, w.tiles[i], w.solidAt[i] >= 0 ? 1 : 0);
  for (const o of w.objects) h = hashInts(h, Math.round(o.x * 100), Math.round(o.z * 100), o.removed ? 1 : 0);
  return h;
}
