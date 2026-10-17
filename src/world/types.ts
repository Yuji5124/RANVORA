// Shared world data types. Pure data, no rendering.

export const Tile = {
  GRASS: 0,
  FOREST: 1,
  PATH: 2,
  WATER: 3,
  BRIDGE: 4,
  SAND: 5,
  PLAZA: 6,
  CAVE: 7,
  CLIFF: 8,
} as const;
export type TileId = (typeof Tile)[keyof typeof Tile];

export const TILE_NAMES: Record<TileId, string> = {
  0: '草地',
  1: '森',
  2: '道',
  3: '小川',
  4: '橋',
  5: '砂地',
  6: '広場',
  7: '洞窟入口',
  8: '岩壁',
};

export type ObjectKind =
  | 'tree'
  | 'pine'
  | 'rock'
  | 'ore'
  | 'house'
  | 'chest'
  | 'well'
  | 'fence'
  | 'lamp'
  | 'flower'
  | 'cave';

export interface WorldObject {
  id: string;
  kind: ObjectKind;
  /** World position (tile centre for single-tile objects). */
  x: number;
  z: number;
  /** Rotation around Y in radians. */
  rot: number;
  scale: number;
  /** Blocks movement on the tiles it covers. */
  solid: boolean;
  removed?: boolean;
  /** Free-form per-object data (e.g. chest opened, flower colour). */
  data: Record<string, number | string | boolean>;
}

export interface Point {
  x: number;
  z: number;
}

export interface World {
  seed: number;
  width: number;
  height: number;
  tiles: Uint8Array;
  /** Index into objects[] of the solid object on that tile, or -1. */
  solidAt: Int32Array;
  objects: WorldObject[];
  /** Tiles reachable on foot from the spawn point (1 = reachable). */
  reachable: Uint8Array;
  spawn: Point;
  village: { cx: number; cz: number; radius: number };
  cave: { tx: number; tz: number };
  /** Important points guaranteed to be reachable (tile coords). */
  landmarks: { kind: string; id: string; tx: number; tz: number }[];
}

export function tileIndex(w: World, tx: number, tz: number): number {
  return tz * w.width + tx;
}

export function inBounds(w: World, tx: number, tz: number): boolean {
  return tx >= 0 && tz >= 0 && tx < w.width && tz < w.height;
}

export function tileAt(w: World, tx: number, tz: number): TileId {
  if (!inBounds(w, tx, tz)) return Tile.CLIFF;
  return w.tiles[tz * w.width + tx] as TileId;
}

export function isTileWalkable(w: World, tx: number, tz: number): boolean {
  if (!inBounds(w, tx, tz)) return false;
  const i = tz * w.width + tx;
  const t = w.tiles[i];
  if (t === Tile.WATER || t === Tile.CLIFF) return false;
  return w.solidAt[i] < 0;
}

/** Walkability at a world-space point. */
export function isWalkableAt(w: World, x: number, z: number): boolean {
  return isTileWalkable(w, Math.floor(x), Math.floor(z));
}

/** True when a circle of radius r centred at (x, z) touches no blocked tile. */
export function canStand(w: World, x: number, z: number, r: number): boolean {
  return (
    isWalkableAt(w, x - r, z - r) &&
    isWalkableAt(w, x + r, z - r) &&
    isWalkableAt(w, x - r, z + r) &&
    isWalkableAt(w, x + r, z + r) &&
    isWalkableAt(w, x, z)
  );
}

/** Moves a circle by (dx, dz) with axis-separated sliding collision. */
export function moveWithCollision(w: World, p: Point, dx: number, dz: number, r: number): Point {
  let x = p.x;
  let z = p.z;
  if (canStand(w, x + dx, z, r)) x += dx;
  if (canStand(w, x, z + dz, r)) z += dz;
  return { x, z };
}
