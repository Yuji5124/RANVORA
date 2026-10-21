// Validates the GLBs in public/models.
//
//   npm run models:check   (tools/blender/check-models.ts; also run by `npm run creatures` and by the unit tests)
//
// Creatures (tools/blender/creatures/creatures.json) are measured the way the game sees them:
// loaded with Three.js's GLTFLoader and posed through the skeleton at rest. Checked:
//   - file loads; every mesh is skinned to one armature; joints <= maxJoints; triangles <= maxTriangles
//   - every vertex has skin weights summing to 1
//   - size: the top of the model within `top` (tiles); feet on the ground (unless `floats`)
//   - origin: centred on x / z
//   - facing: the 'facing' marker bone points to +Z (RANVORA models face +Z)
//   - clips: every required clip exists, has a duration and only targets nodes that exist
// Static models (trees, houses...) only need to load and contain meshes.
// Writes tools/blender/out/validate-report.json. Exit code 1 when anything fails.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');

export interface CreatureEntry {
  key: string;
  recipe: string;
  scale: number;
  top: [number, number];
  floats?: boolean;
  maxTriangles: number;
  maxJoints: number;
}
export interface CreatureConfig {
  clips: string[];
  creatures: CreatureEntry[];
}
export interface ModelReport {
  key: string;
  kind: 'creature' | 'static';
  ok: boolean;
  errors: string[];
  stats: Record<string, number | string | string[]>;
}

export function loadConfig(): CreatureConfig {
  return JSON.parse(readFileSync(path.join(HERE, 'creatures', 'creatures.json'), 'utf8'));
}

async function parse(file: string) {
  const buf = readFileSync(file);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  return new GLTFLoader().parseAsync(ab, '');
}

const r2 = (v: number) => Math.round(v * 100) / 100;

export async function checkCreature(entry: CreatureEntry, clips: string[], dir = path.join(ROOT, 'public', 'models')): Promise<ModelReport> {
  const errors: string[] = [];
  const stats: ModelReport['stats'] = {};
  const file = path.join(dir, `${entry.key}.glb`);
  const report = (): ModelReport => ({ key: entry.key, kind: 'creature', ok: errors.length === 0, errors, stats });
  if (!existsSync(file)) {
    errors.push(`file missing: public/models/${entry.key}.glb (run npm run creatures)`);
    return report();
  }
  let gltf;
  try {
    gltf = await parse(file);
  } catch (e) {
    errors.push(`cannot load: ${(e as Error).message}`);
    return report();
  }
  const scene = gltf.scene;
  scene.updateMatrixWorld(true);
  const skinned: THREE.SkinnedMesh[] = [];
  scene.traverse((o) => {
    if ((o as THREE.SkinnedMesh).isSkinnedMesh) skinned.push(o as THREE.SkinnedMesh);
  });
  // GLTFLoader splits a multi-material mesh into one SkinnedMesh per material (one per glTF primitive).
  // They must all be driven by the same skeleton.
  stats.primitives = skinned.length;
  if (!skinned.length) {
    errors.push('no skinned mesh (the model is not rigged)');
    return report();
  }
  const bones = skinned[0].skeleton.bones;
  if (skinned.some((m) => m.skeleton.bones.length !== bones.length || m.skeleton.bones.some((b, i) => b !== bones[i])))
    errors.push('skinned primitives use different skeletons (expected one armature)');
  let otherMeshes = 0;
  scene.traverse((o) => {
    if ((o as THREE.Mesh).isMesh && !(o as THREE.SkinnedMesh).isSkinnedMesh) otherMeshes++;
  });
  if (otherMeshes) errors.push(`${otherMeshes} unskinned meshes (every part must be weighted to the armature)`);

  // Joints, triangles, weights; size and origin posed through the skeleton at rest (what the game renders).
  stats.joints = bones.length;
  if (bones.length > entry.maxJoints) errors.push(`joints ${bones.length} > maxJoints ${entry.maxJoints}`);
  let tris = 0;
  let badWeights = 0;
  const box = new THREE.Box3();
  const v = new THREE.Vector3();
  for (const mesh of skinned) {
    const g = mesh.geometry;
    tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
    const w = g.attributes.skinWeight;
    if (!w || !g.attributes.skinIndex) {
      errors.push(`primitive ${mesh.name || '?'} has no skin weights (JOINTS_0 / WEIGHTS_0)`);
      continue;
    }
    for (let i = 0; i < w.count; i++) {
      const sum = w.getX(i) + w.getY(i) + w.getZ(i) + w.getW(i);
      if (Math.abs(sum - 1) > 0.01) badWeights++;
    }
    mesh.skeleton.update();
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      mesh.applyBoneTransform(i, v);
      v.applyMatrix4(mesh.matrixWorld);
      box.expandByPoint(v);
    }
  }
  stats.triangles = tris;
  if (tris > entry.maxTriangles) errors.push(`triangles ${tris} > maxTriangles ${entry.maxTriangles}`);
  if (badWeights) errors.push(`${badWeights} vertices whose skin weights do not sum to 1`);
  stats.top = r2(box.max.y);
  stats.bottom = r2(box.min.y);
  stats.size = [r2(box.max.x - box.min.x), r2(box.max.y - box.min.y), r2(box.max.z - box.min.z)].join(' x ');
  if (box.max.y < entry.top[0] || box.max.y > entry.top[1]) errors.push(`top ${r2(box.max.y)} outside ${entry.top[0]}..${entry.top[1]} tiles (check scale ${entry.scale})`);
  if (!entry.floats && Math.abs(box.min.y) > 0.05) errors.push(`feet at y=${r2(box.min.y)}, expected 0 (origin must be at the feet)`);
  if (entry.floats && box.min.y < -0.05) errors.push(`floating model goes below the ground (y=${r2(box.min.y)})`);
  const cx = (box.min.x + box.max.x) / 2;
  const cz = (box.min.z + box.max.z) / 2;
  if (Math.abs(cx) > 0.1) errors.push(`not centred on x (centre ${r2(cx)})`);
  if (Math.abs(cz) > 0.25) errors.push(`not centred on z (centre ${r2(cz)})`);

  // Facing: the marker bone's +Y axis must point to world +Z.
  const facing = bones.find((b) => b.name === 'facing');
  if (!facing) errors.push("no 'facing' marker bone (rigkit adds it under 'root')");
  else {
    const dir = new THREE.Vector3(0, 1, 0).applyQuaternion(facing.getWorldQuaternion(new THREE.Quaternion()));
    stats.facing = [r2(dir.x), r2(dir.y), r2(dir.z)].join(',');
    if (dir.z < 0.9) errors.push(`model faces (${stats.facing}), expected +Z`);
  }

  // Clips.
  const names = new Set<string>();
  scene.traverse((o) => names.add(o.name));
  stats.clips = gltf.animations.map((a) => `${a.name} ${r2(a.duration)}s`);
  for (const c of clips) {
    const clip = gltf.animations.find((a) => a.name === c);
    if (!clip) {
      errors.push(`missing clip ${c}`);
      continue;
    }
    if (!(clip.duration > 0)) errors.push(`clip ${c} has no duration`);
    const orphan = clip.tracks.map((t) => t.name.split('.')[0]).filter((n) => !names.has(n));
    if (orphan.length) errors.push(`clip ${c} animates missing nodes: ${[...new Set(orphan)].slice(0, 5).join(', ')}`);
  }
  return report();
}

export async function checkStatic(key: string, dir = path.join(ROOT, 'public', 'models')): Promise<ModelReport> {
  const errors: string[] = [];
  const stats: ModelReport['stats'] = {};
  try {
    const gltf = await parse(path.join(dir, `${key}.glb`));
    let meshes = 0;
    gltf.scene.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) meshes++;
    });
    stats.meshes = meshes;
    if (!meshes) errors.push('no meshes');
  } catch (e) {
    errors.push(`cannot load: ${(e as Error).message}`);
  }
  return { key, kind: 'static', ok: errors.length === 0, errors, stats };
}

export async function validateModels(dir = path.join(ROOT, 'public', 'models')) {
  const cfg = loadConfig();
  const creatureKeys = new Set(cfg.creatures.map((c) => c.key));
  const results: ModelReport[] = [];
  for (const c of cfg.creatures) results.push(await checkCreature(c, cfg.clips, dir));
  const statics = readdirSync(dir).filter((f) => f.endsWith('.glb')).map((f) => f.slice(0, -4)).filter((k) => !creatureKeys.has(k)).sort();
  for (const k of statics) results.push(await checkStatic(k, dir));
  return { ok: results.every((r) => r.ok), results };
}

/** CLI: prints a PASS/FAIL table, writes the JSON report, returns the exit code. */
export async function runCli(): Promise<number> {
  const rep = await validateModels();
  const out = path.join(HERE, 'out');
  mkdirSync(out, { recursive: true });
  writeFileSync(path.join(out, 'validate-report.json'), JSON.stringify(rep, null, 2));
  for (const r of rep.results) {
    const s = r.kind === 'creature' ? `top ${r.stats.top}  ${r.stats.size}  ${r.stats.triangles} tris  ${r.stats.joints} joints  facing ${r.stats.facing}` : `${r.stats.meshes ?? 0} meshes`;
    console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.kind.padEnd(8)} ${r.key.padEnd(12)} ${s}`);
    for (const e of r.errors) console.log(`        - ${e}`);
  }
  console.log(rep.ok ? 'All models valid.' : 'Some models failed (see above, and tools/blender/out/validate-report.json).');
  return rep.ok ? 0 : 1;
}

