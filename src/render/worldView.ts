// Renders the static world (terrain + objects) and the living layers
// (plants, pickups, chests) from simulation state.

import * as THREE from 'three';
import { hashInts } from '../core/rng';
import type { Simulation } from '../sim/simulation';
import { Tile, type World, type WorldObject, type ObjectKind } from '../world/types';
import { InstancedModel, getMaterial, type ModelKey, type ModelLibrary } from './models';
import { materialModel } from './itemModels';

const TILE_STYLE: Record<number, { color: string; top: number; jitter: number }> = {
  [Tile.GRASS]: { color: '#7fd05a', top: 0, jitter: 0.06 },
  [Tile.FOREST]: { color: '#5aa846', top: 0, jitter: 0.06 },
  [Tile.PATH]: { color: '#dcb979', top: -0.02, jitter: 0.05 },
  [Tile.WATER]: { color: '#2a6fc4', top: -0.35, jitter: 0.04 },
  [Tile.BRIDGE]: { color: '#a8743f', top: 0.05, jitter: 0.04 },
  [Tile.SAND]: { color: '#efdca0', top: -0.03, jitter: 0.04 },
  [Tile.PLAZA]: { color: '#cfc2a2', top: 0.02, jitter: 0.07 },
  [Tile.CAVE]: { color: '#3b3240', top: 0, jitter: 0 },
  [Tile.CLIFF]: { color: '#7d7873', top: 1.4, jitter: 0.06 },
};

const STATIC_KINDS: ObjectKind[] = ['tree', 'pine', 'rock', 'ore', 'house', 'well', 'fence', 'lamp', 'flower', 'cave'];

export class WorldView {
  readonly root = new THREE.Group();
  private staticGroup = new THREE.Group();
  private waterSurface: THREE.InstancedMesh | null = null;
  private grass: InstancedModel;
  private bush: InstancedModel;
  private berries: InstancedModel;
  private pickupMeshes = new Map<string, THREE.Object3D>();
  private chestMeshes = new Map<string, THREE.Object3D>();
  private plantTimer = 0;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly v = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);

  constructor(private lib: ModelLibrary) {
    this.grass = new InstancedModel(lib.template('grass'), 1400, 'grass');
    this.bush = new InstancedModel(lib.template('berry'), 1400, 'berry');
    this.berries = new InstancedModel(lib.template('berries'), 1400, 'berries');
    this.root.add(this.staticGroup, this.grass.group, this.bush.group, this.berries.group);
  }

  build(world: World) {
    this.clear();
    this.buildTerrain(world);
    this.buildObjects(world);
  }

  private clear() {
    this.staticGroup.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && m.geometry) m.geometry.dispose();
    });
    this.staticGroup.clear();
    for (const o of this.pickupMeshes.values()) this.root.remove(o);
    this.pickupMeshes.clear();
    for (const o of this.chestMeshes.values()) this.root.remove(o);
    this.chestMeshes.clear();
  }

  private buildTerrain(w: World) {
    const n = w.width * w.height;
    const geo = new THREE.BoxGeometry(1, 1, 1);
    geo.translate(0, -0.5, 0); // top face at y = 0
    const mat = getMaterial('#ffffff');
    const tiles = new THREE.InstancedMesh(geo, mat, n);
    tiles.receiveShadow = true;
    const color = new THREE.Color();
    let water = 0;
    for (let tz = 0; tz < w.height; tz++) {
      for (let tx = 0; tx < w.width; tx++) {
        const i = tz * w.width + tx;
        const t = w.tiles[i];
        const style = TILE_STYLE[t];
        const h = hashInts(w.seed, tx, tz);
        const j = ((h & 255) / 255 - 0.5) * style.jitter;
        const checker = (tx + tz) % 2 === 0 ? 0.025 : -0.015;
        let top = style.top;
        if (t === Tile.CLIFF) top += ((h >> 8) & 255) / 255 * 0.9;
        const depth = 1.2 + top;
        this.m.compose(this.v.set(tx + 0.5, top, tz + 0.5), this.q.identity(), this.s.set(1, depth, 1));
        tiles.setMatrixAt(i, this.m);
        color.set(style.color);
        color.offsetHSL(0, 0, j + (t === Tile.GRASS || t === Tile.FOREST || t === Tile.PLAZA ? checker : 0));
        tiles.setColorAt(i, color);
        if (t === Tile.WATER) water++;
      }
    }
    tiles.instanceMatrix.needsUpdate = true;
    this.staticGroup.add(tiles);

    // Translucent water surface.
    const wgeo = new THREE.BoxGeometry(1, 0.05, 1);
    const wmat = new THREE.MeshLambertMaterial({ color: '#5fb6ff', transparent: true, opacity: 0.72 });
    const surf = new THREE.InstancedMesh(wgeo, wmat, Math.max(1, water));
    let k = 0;
    for (let tz = 0; tz < w.height; tz++)
      for (let tx = 0; tx < w.width; tx++) {
        if (w.tiles[tz * w.width + tx] !== Tile.WATER) continue;
        this.m.makeTranslation(tx + 0.5, -0.1, tz + 0.5);
        surf.setMatrixAt(k++, this.m);
      }
    surf.count = k;
    this.waterSurface = surf;
    this.staticGroup.add(surf);

    // Diorama base slab under the map.
    const base = new THREE.Mesh(new THREE.BoxGeometry(w.width + 1, 2, w.height + 1), getMaterial('#6b4a2b'));
    base.position.set(w.width / 2, -2.2, w.height / 2);
    this.staticGroup.add(base);
  }

  private buildObjects(w: World) {
    const byKind = new Map<ObjectKind, WorldObject[]>();
    for (const o of w.objects) {
      if (o.removed) continue;
      if (o.kind === 'chest') {
        this.addChest(o);
        continue;
      }
      if (!STATIC_KINDS.includes(o.kind)) continue;
      if (!byKind.has(o.kind)) byKind.set(o.kind, []);
      byKind.get(o.kind)!.push(o);
    }
    const tint = new THREE.Color();
    for (const [kind, list] of byKind) {
      const im = new InstancedModel(this.lib.template(kind as ModelKey), list.length, kind);
      list.forEach((o, i) => {
        this.q.setFromAxisAngle(this.up, o.rot);
        this.m.compose(this.v.set(o.x, 0, o.z), this.q, this.s.setScalar(o.scale));
        im.setMatrixAt(i, this.m);
        const c = (o.data.roof ?? o.data.color) as string | undefined;
        if (c) im.setTintAt(i, tint.set(c));
      });
      im.setCount(list.length);
      im.commit();
      this.staticGroup.add(im.group);
    }
  }

  private addChest(o: WorldObject) {
    const obj = this.lib.create('chest');
    obj.position.set(o.x, 0, o.z);
    obj.rotation.y = o.rot;
    obj.userData.objectId = o.id;
    this.root.add(obj);
    this.chestMeshes.set(o.id, obj);
    if (o.data.opened) this.openChest(o.id, true);
  }

  openChest(id: string, instant = false) {
    const obj = this.chestMeshes.get(id);
    const lid = obj?.getObjectByName('Lid');
    if (!lid) return;
    lid.userData.targetRot = -1.9;
    if (instant) lid.rotation.x = -1.9;
  }

  update(sim: Simulation, dt: number, time: number) {
    // Plants are updated a few times per second.
    this.plantTimer -= dt;
    if (this.plantTimer <= 0) {
      this.plantTimer = 0.25;
      this.syncPlants(sim);
    }
    this.syncPickups(sim, time);
    for (const obj of this.chestMeshes.values()) {
      const lid = obj.getObjectByName('Lid');
      if (lid && lid.userData.targetRot !== undefined) lid.rotation.x += (lid.userData.targetRot - lid.rotation.x) * Math.min(1, dt * 8);
    }
    if (this.waterSurface) {
      const mat = this.waterSurface.material as THREE.MeshLambertMaterial;
      mat.opacity = 0.68 + Math.sin(time * 1.5) * 0.05;
    }
  }

  private syncPlants(sim: Simulation) {
    let g = 0;
    let b = 0;
    let br = 0;
    for (const p of sim.plants) {
      if (!p.alive) continue;
      const h = hashInts(p.tx, p.tz);
      const rot = (h % 628) / 100;
      const jx = ((h >> 10) % 100) / 400 - 0.125;
      const jz = ((h >> 17) % 100) / 400 - 0.125;
      this.q.setFromAxisAngle(this.up, rot);
      const sc = 0.25 + 0.85 * p.biomass;
      this.m.compose(this.v.set(p.tx + 0.5 + jx, 0, p.tz + 0.5 + jz), this.q, this.s.set(sc, sc, sc));
      if (p.kind === 'grass') {
        if (g < this.grass.capacity) this.grass.setMatrixAt(g++, this.m);
      } else {
        const bs = 0.55 + 0.45 * p.biomass;
        this.m.compose(this.v, this.q, this.s.set(bs, bs, bs));
        if (b < this.bush.capacity) this.bush.setMatrixAt(b++, this.m);
        if (p.biomass > 0.55 && br < this.berries.capacity) this.berries.setMatrixAt(br++, this.m);
      }
    }
    this.grass.setCount(g);
    this.bush.setCount(b);
    this.berries.setCount(br);
    this.grass.commit();
    this.bush.commit();
    this.berries.commit();
  }

  private syncPickups(sim: Simulation, time: number) {
    const seen = new Set<string>();
    for (const p of sim.pickups) {
      if (!p.alive) continue;
      seen.add(p.id);
      let obj = this.pickupMeshes.get(p.id);
      if (!obj) {
        obj = materialModel(p.material);
        obj.userData.phase = (hashInts(p.x * 100, p.z * 100) % 100) / 16;
        this.root.add(obj);
        this.pickupMeshes.set(p.id, obj);
      }
      const ph = obj.userData.phase as number;
      obj.position.set(p.x, 0.28 + Math.sin(time * 2.5 + ph) * 0.06, p.z);
      obj.rotation.y = time * 1.2 + ph;
    }
    for (const [id, obj] of this.pickupMeshes) {
      if (!seen.has(id)) {
        this.root.remove(obj);
        this.pickupMeshes.delete(id);
      }
    }
  }
}
