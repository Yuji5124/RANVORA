// Model library: loads GLB files exported from Blender (public/models/*.glb)
// and falls back to primitives built from the same spec when a GLB is
// missing. Both paths share names, origins, orientation and scale, so GLBs
// can be swapped in at any time without code changes.
//
// Rigged creatures (tools/blender/build_creatures.py) also bring animation
// clips (Idle / Move / Attack / Hit / Die). `clips(key)` is empty for
// primitive fallbacks, and CreatureView then animates procedurally.

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import specsJson from './modelSpecs.json';

export interface PartSpec {
  name: string;
  parent?: string;
  shape: 'box' | 'sphere' | 'cyl';
  size?: number[];
  radius?: number;
  detail?: number;
  radiusTop?: number;
  radiusBottom?: number;
  height?: number;
  segments?: number;
  scale?: number[];
  pos: number[];
  offset?: number[];
  rot?: number[];
  color: string;
  cutout?: boolean;
  tint?: boolean;
  emissive?: boolean;
}

const SPECS = specsJson as unknown as Record<string, { parts: PartSpec[] }>;

export const MODEL_KEYS = [
  'hero',
  'slime',
  'deer',
  'wolf',
  'mossling',
  'shardgolem',
  'driftjelly',
  'hornfang',
  'tree',
  'pine',
  'rock',
  'ore',
  'house',
  'chest',
  'well',
  'fence',
  'lamp',
  'cave',
  'flower',
  'grass',
  'berry',
  'berries',
] as const;
export type ModelKey = (typeof MODEL_KEYS)[number];

// ---------------------------------------------------------------------------
// Materials

/** Shared uniforms for the "see-through near the hero" effect. */
export const cutoutUniforms = {
  uPlayer: { value: new THREE.Vector3(-999, 0, -999) },
  uCutRadius: { value: 1.9 },
  uCutShift: { value: new THREE.Vector2(0, 0.7) },
};

const materialCache = new Map<string, THREE.MeshLambertMaterial>();

function applyCutout(mat: THREE.MeshLambertMaterial) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uPlayer = cutoutUniforms.uPlayer;
    shader.uniforms.uCutRadius = cutoutUniforms.uCutRadius;
    shader.uniforms.uCutShift = cutoutUniforms.uCutShift;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vCutWorld;')
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        vec4 cutW = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          cutW = instanceMatrix * cutW;
        #endif
        vCutWorld = (modelMatrix * cutW).xyz;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec3 vCutWorld;\nuniform vec3 uPlayer;\nuniform float uCutRadius;\nuniform vec2 uCutShift;',
      )
      .replace(
        '#include <clipping_planes_fragment>',
        `#include <clipping_planes_fragment>
        {
          vec2 c = uPlayer.xz + uCutShift;
          float d = distance(vCutWorld.xz, c);
          if (vCutWorld.y > uPlayer.y + 0.75 && d < uCutRadius) {
            float keep = smoothstep(uCutRadius * 0.45, uCutRadius, d);
            float n = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
            if (n > keep * 0.85 + 0.1) discard;
          }
        }`,
      );
  };
  mat.customProgramCacheKey = () => 'ranvora-cutout';
}

/** emissive: true = glow at 0.8, or a number = glow intensity. opacity < 1 = see-through. */
export function getMaterial(color: string | THREE.Color, opts: { cutout?: boolean; emissive?: boolean | number; opacity?: number } = {}) {
  const c = color instanceof THREE.Color ? color : new THREE.Color(color);
  const opacity = opts.opacity !== undefined && opts.opacity < 0.99 ? Math.round(opts.opacity * 100) / 100 : 1;
  const glow = opts.emissive === true ? 0.8 : typeof opts.emissive === 'number' ? Math.round(opts.emissive * 100) / 100 : 0;
  const key = `${c.getHexString()}|${opts.cutout ? 1 : 0}|${glow}|${opacity}`;
  let m = materialCache.get(key);
  if (!m) {
    m = new THREE.MeshLambertMaterial({ color: c, flatShading: true });
    if (opacity < 1) {
      m.transparent = true;
      m.opacity = opacity;
      m.depthWrite = false;
    }
    if (glow > 0) {
      m.emissive = c.clone();
      m.emissiveIntensity = glow;
    }
    if (opts.cutout) applyCutout(m);
    materialCache.set(key, m);
  }
  return m;
}

// ---------------------------------------------------------------------------
// Primitive builder

function partGeometry(p: PartSpec): THREE.BufferGeometry {
  let g: THREE.BufferGeometry;
  switch (p.shape) {
    case 'box': {
      const [w, h, d] = p.size ?? [1, 1, 1];
      g = new THREE.BoxGeometry(w, h, d);
      break;
    }
    case 'sphere':
      g = new THREE.IcosahedronGeometry(p.radius ?? 0.5, p.detail ?? 1);
      break;
    case 'cyl':
      g = new THREE.CylinderGeometry(p.radiusTop ?? 0.5, p.radiusBottom ?? 0.5, p.height ?? 1, p.segments ?? 8);
      break;
  }
  if (p.scale) g.scale(p.scale[0], p.scale[1], p.scale[2]);
  if (p.offset) g.translate(p.offset[0], p.offset[1], p.offset[2]);
  return g;
}

export function buildFromSpec(key: string): THREE.Group {
  const spec = SPECS[key];
  const root = new THREE.Group();
  root.name = key;
  const byName = new Map<string, THREE.Object3D>();
  for (const p of spec.parts) {
    const mesh = new THREE.Mesh(partGeometry(p), getMaterial(p.color, p));
    mesh.name = p.name;
    mesh.position.fromArray(p.pos);
    if (p.rot) mesh.rotation.set(THREE.MathUtils.degToRad(p.rot[0]), THREE.MathUtils.degToRad(p.rot[1]), THREE.MathUtils.degToRad(p.rot[2]));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    (p.parent ? byName.get(p.parent) : root)?.add(mesh);
    byName.set(p.name, mesh);
  }
  root.userData.source = 'primitive';
  return root;
}

export function partSpec(key: string, name: string): PartSpec | undefined {
  return SPECS[key]?.parts.find((p) => p.name === name);
}

// ---------------------------------------------------------------------------
// Library

export class ModelLibrary {
  readonly templates = new Map<ModelKey, THREE.Object3D>();
  readonly sources = new Map<ModelKey, 'glb' | 'primitive'>();
  private readonly animations = new Map<ModelKey, THREE.AnimationClip[]>();

  /** forcePrimitive: no GLBs at all. missing: keys treated as if their GLB failed to load (tests). */
  static async load(opts: { forcePrimitive?: boolean; missing?: string[] } = {}): Promise<ModelLibrary> {
    const lib = new ModelLibrary();
    const loader = new GLTFLoader();
    const base = import.meta.env.BASE_URL ?? './';
    await Promise.all(
      MODEL_KEYS.map(async (key) => {
        if (!opts.forcePrimitive && !opts.missing?.includes(key)) {
          try {
            const gltf = await loader.loadAsync(`${base}models/${key}.glb`);
            lib.templates.set(key, adoptGlb(key, gltf.scene));
            lib.sources.set(key, 'glb');
            if (gltf.animations.length) lib.animations.set(key, gltf.animations);
            return;
          } catch {
            // Missing or invalid GLB: fall back to primitives.
          }
        }
        lib.templates.set(key, buildFromSpec(key));
        lib.sources.set(key, 'primitive');
      }),
    );
    return lib;
  }

  /** A new instance sharing geometry and materials with the template. */
  create(key: ModelKey): THREE.Object3D {
    const t = this.templates.get(key)!;
    // Skinned meshes need their own skeleton: a plain clone would share the template's bones.
    return t.userData.skinned ? cloneSkinned(t) : t.clone(true);
  }

  /** Animation clips that came with the GLB (empty for primitives and static models). */
  clips(key: ModelKey): THREE.AnimationClip[] {
    return this.animations.get(key) ?? [];
  }

  template(key: ModelKey): THREE.Object3D {
    return this.templates.get(key)!;
  }

  summary(): string {
    const glb = [...this.sources.values()].filter((s) => s === 'glb').length;
    return `GLB ${glb}/${MODEL_KEYS.length}`;
  }

  /** Per-key source and clip names, for tests and the debug panel. */
  report(): Record<string, { source: 'glb' | 'primitive'; clips: string[] }> {
    const out: Record<string, { source: 'glb' | 'primitive'; clips: string[] }> = {};
    for (const k of MODEL_KEYS) out[k] = { source: this.sources.get(k) ?? 'primitive', clips: this.clips(k).map((c) => c.name) };
    return out;
  }
}

/**
 * Normalises a loaded GLB scene: flat Lambert materials and spec flags.
 * Glowing (emissive) and see-through materials authored in Blender are kept.
 */
function adoptGlb(key: string, scene: THREE.Object3D): THREE.Object3D {
  let skinned = false;
  scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    if ((mesh as THREE.SkinnedMesh).isSkinnedMesh) {
      skinned = true;
      // Animated bounds change every frame; the bind-pose sphere would cull creatures mid-attack.
      mesh.frustumCulled = false;
    }
    const spec = partSpec(key, mesh.name);
    const src = mesh.material as THREE.MeshStandardMaterial;
    const color = src?.color ? src.color.clone() : new THREE.Color(spec?.color ?? '#ffffff');
    // Blender emission -> glow intensity relative to the base colour (static models keep the spec flag).
    const e = src?.emissive ? Math.max(src.emissive.r, src.emissive.g, src.emissive.b) : 0;
    const glow = e > 0.02 ? Math.min(0.8, (0.8 * e) / Math.max(0.05, color.r, color.g, color.b)) : 0;
    mesh.material = getMaterial(color, { cutout: spec?.cutout, emissive: spec?.emissive || glow || undefined, opacity: src?.opacity });
    mesh.castShadow = true;
    mesh.receiveShadow = true;
  });
  scene.userData.skinned = skinned;
  scene.userData.source = 'glb';
  scene.name = key;
  return scene;
}

// ---------------------------------------------------------------------------
// Instancing

/**
 * Many copies of one model as a handful of InstancedMeshes (one per
 * material). Parts flagged `tint` get a per-instance colour.
 */
export class InstancedModel {
  readonly group = new THREE.Group();
  readonly meshes: { mesh: THREE.InstancedMesh; tint: boolean }[] = [];

  constructor(template: THREE.Object3D, readonly capacity: number, key?: string) {
    template.updateMatrixWorld(true);
    const buckets = new Map<string, { mat: THREE.Material; geos: THREE.BufferGeometry[]; tint: boolean }>();
    template.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const tint = key ? !!partSpec(key, mesh.name)?.tint : false;
      const mat = mesh.material as THREE.Material;
      let g = mesh.geometry.clone();
      g.applyMatrix4(mesh.matrixWorld);
      if (g.index) g = g.toNonIndexed();
      for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
      const k = `${mat.uuid}|${tint}`;
      if (!buckets.has(k)) buckets.set(k, { mat, geos: [], tint });
      buckets.get(k)!.geos.push(g);
    });
    for (const { mat, geos, tint } of buckets.values()) {
      const merged = mergeGeometries(geos, false);
      if (!merged) continue;
      const im = new THREE.InstancedMesh(merged, tint ? (mat as THREE.MeshLambertMaterial).clone() : mat, capacity);
      if (tint) {
        const tm = im.material as THREE.MeshLambertMaterial;
        tm.color.set('#ffffff');
        // Clones lose the onBeforeCompile hook only if not copied: reapply.
        if ((mat as THREE.MeshLambertMaterial).customProgramCacheKey() === 'ranvora-cutout') applyCutout(tm);
      }
      im.count = 0;
      im.castShadow = true;
      im.receiveShadow = true;
      im.frustumCulled = false;
      this.meshes.push({ mesh: im, tint });
      this.group.add(im);
    }
  }

  setCount(n: number) {
    for (const { mesh } of this.meshes) mesh.count = n;
  }

  setMatrixAt(i: number, m: THREE.Matrix4) {
    for (const { mesh } of this.meshes) mesh.setMatrixAt(i, m);
  }

  setTintAt(i: number, c: THREE.Color) {
    for (const { mesh, tint } of this.meshes) if (tint) mesh.setColorAt(i, c);
  }

  commit() {
    for (const { mesh } of this.meshes) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }

  dispose() {
    for (const { mesh } of this.meshes) {
      mesh.geometry.dispose();
      mesh.dispose();
    }
  }
}
