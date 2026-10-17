// Renders creatures from simulation state with procedural animation,
// state emotes, variant colours and a death animation.

import * as THREE from 'three';
import type { Creature, Simulation } from '../sim/simulation';
import type { CreatureState } from '../sim/species';
import { getMaterial, type ModelLibrary } from './models';

interface View {
  obj: THREE.Object3D;
  parts: Record<string, THREE.Object3D | undefined>;
  emote: THREE.Sprite;
  emoteKey: string;
  yaw: number;
  phase: number;
  dying: number;
  flashing: boolean;
  originals: Map<THREE.Mesh, THREE.Material | THREE.Material[]>;
  variant: boolean;
}

const EMOTES: Partial<Record<CreatureState, { text: string; color: string }>> = {
  flee: { text: '!', color: '#ffdd33' },
  chase: { text: '!!', color: '#ff4a4a' },
  hunt: { text: '…', color: '#ffb0b0' },
  rest: { text: 'Zz', color: '#bcd7ff' },
  eat: { text: '♪', color: '#a6ff8f' },
  migrate: { text: '→', color: '#ffffff' },
};

const emoteTextures = new Map<string, THREE.Texture>();
function emoteTexture(key: string): THREE.Texture | null {
  if (key === '') return null;
  if (emoteTextures.has(key)) return emoteTextures.get(key)!;
  const [text, color] = key.split('|');
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = 'rgba(20,24,36,0.78)';
  g.beginPath();
  g.arc(32, 30, 24, 0, Math.PI * 2);
  g.fill();
  g.font = 'bold 28px sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = color;
  g.fillText(text, 32, 31);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  emoteTextures.set(key, tex);
  return tex;
}

const VARIANT_TINT: Record<string, THREE.Color> = {
  slime: new THREE.Color('#ffd23f'),
  deer: new THREE.Color('#f4f4f4'),
  wolf: new THREE.Color('#d8e4ff'),
};

const flashMat = new THREE.MeshLambertMaterial({ color: '#ff5050', emissive: new THREE.Color('#ff2020'), emissiveIntensity: 0.6 });

export class CreatureView {
  readonly root = new THREE.Group();
  private views = new Map<string, View>();
  showEmotes = true;
  selectedId: string | null = null;
  private selectRing: THREE.Mesh;
  private visionRing: THREE.Mesh;

  constructor(private lib: ModelLibrary) {
    this.selectRing = new THREE.Mesh(
      new THREE.RingGeometry(0.45, 0.55, 24),
      new THREE.MeshBasicMaterial({ color: '#ffe14a', transparent: true, opacity: 0.9, depthWrite: false }),
    );
    this.selectRing.rotation.x = -Math.PI / 2;
    this.selectRing.visible = false;
    this.visionRing = new THREE.Mesh(
      new THREE.RingGeometry(0.97, 1, 48),
      new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.35, depthWrite: false }),
    );
    this.visionRing.rotation.x = -Math.PI / 2;
    this.visionRing.visible = false;
    this.root.add(this.selectRing, this.visionRing);
  }

  clear() {
    for (const v of this.views.values()) this.root.remove(v.obj);
    this.views.clear();
  }

  private create(c: Creature): View {
    const obj = this.lib.create(c.species);
    const parts: View['parts'] = {};
    const originals = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
    obj.traverse((o) => {
      if (o.name) parts[o.name] = o;
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        if (c.variant) {
          const src = m.material as THREE.MeshLambertMaterial;
          const col = src.color.clone().lerp(VARIANT_TINT[c.species], 0.7);
          m.material = getMaterial(col, { emissive: c.species === 'slime' });
        }
        originals.set(m, m.material);
      }
    });
    const emote = new THREE.Sprite(new THREE.SpriteMaterial({ depthTest: false, transparent: true }));
    emote.scale.set(0.5, 0.5, 0.5);
    emote.visible = false;
    emote.renderOrder = 10;
    obj.add(emote);
    this.root.add(obj);
    return { obj, parts, emote, emoteKey: '', yaw: Math.PI / 2 - c.dir, phase: c.num * 1.7, dying: 0, flashing: false, originals, variant: c.variant };
  }

  /** alpha: interpolation factor between the previous and current tick. */
  update(sim: Simulation, alpha: number, dt: number) {
    const seen = new Set<string>();
    for (const c of sim.creatures) {
      let v = this.views.get(c.id);
      if (!c.alive) {
        if (v && v.dying === 0) v.dying = 0.001;
        continue;
      }
      seen.add(c.id);
      if (!v) {
        v = this.create(c);
        this.views.set(c.id, v);
      }
      this.animate(v, c, sim, alpha, dt);
    }
    for (const [id, v] of this.views) {
      if (seen.has(id)) continue;
      if (v.dying === 0) v.dying = 0.001;
      v.dying += dt;
      v.obj.rotation.z = Math.min(Math.PI / 2, v.dying * 5);
      v.obj.scale.multiplyScalar(0.96);
      v.emote.visible = false;
      if (v.dying > 0.8) {
        this.root.remove(v.obj);
        this.views.delete(id);
      }
    }
    // Selection highlight.
    const sel = this.selectedId ? sim.getCreature(this.selectedId) : undefined;
    this.selectRing.visible = !!sel?.alive;
    this.visionRing.visible = !!sel?.alive;
    if (sel?.alive) {
      const x = sel.px + (sel.x - sel.px) * alpha;
      const z = sel.pz + (sel.z - sel.pz) * alpha;
      this.selectRing.position.set(x, 0.03, z);
      const vision = (sel.species === 'slime' ? 5 : sel.species === 'deer' ? 7 : 9) * sel.visionTrait;
      this.visionRing.position.set(x, 0.03, z);
      this.visionRing.scale.setScalar(vision);
    }
  }

  private animate(v: View, c: Creature, sim: Simulation, alpha: number, dt: number) {
    const x = c.px + (c.x - c.px) * alpha;
    const z = c.pz + (c.z - c.pz) * alpha;
    const p = v.parts;
    v.obj.position.set(x, 0, z);
    // Smooth turning.
    const target = Math.PI / 2 - c.dir;
    let d = target - v.yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    v.yaw += d * Math.min(1, dt * 10);
    v.obj.rotation.y = v.yaw;
    v.obj.scale.setScalar(c.scale);

    const speed = c.running ? 2.2 : 1;
    if (c.moving) v.phase += dt * 9 * speed;
    const sw = c.moving ? Math.sin(v.phase) : 0;

    if (c.species === 'slime') {
      const body = p.Body;
      if (body) {
        const hop = c.moving ? Math.abs(Math.sin(v.phase * 0.7)) : 0;
        const squash = c.moving ? 1 - Math.cos(v.phase * 1.4) * 0.12 : 1 + Math.sin(sim.time * 3 + v.phase) * 0.04;
        body.position.y = hop * 0.18;
        body.scale.set(1 / Math.sqrt(squash), squash, 1 / Math.sqrt(squash));
        if (c.state === 'eat') body.scale.y = 0.8 + Math.sin(sim.time * 12) * 0.06;
      }
    } else {
      const amp = c.running ? 0.9 : 0.5;
      const resting = c.state === 'rest';
      if (p.LegFL) p.LegFL.rotation.x = resting ? -1.4 : sw * amp;
      if (p.LegBR) p.LegBR.rotation.x = resting ? 1.4 : sw * amp;
      if (p.LegFR) p.LegFR.rotation.x = resting ? -1.4 : -sw * amp;
      if (p.LegBL) p.LegBL.rotation.x = resting ? 1.4 : -sw * amp;
      v.obj.position.y = resting ? -0.26 : c.moving ? Math.abs(sw) * 0.04 : 0;
      const eating = c.state === 'eat';
      if (c.species === 'deer' && p.Neck) {
        const targetRot = eating ? 1.2 + Math.sin(sim.time * 6) * 0.1 : c.state === 'flee' ? -0.2 : 0;
        p.Neck.rotation.x += (THREE.MathUtils.degToRad(20) + targetRot - p.Neck.rotation.x) * Math.min(1, dt * 6);
      }
      if (c.species === 'wolf') {
        if (p.Head) {
          const targetRot = eating ? 0.6 + Math.sin(sim.time * 8) * 0.15 : c.state === 'hunt' ? 0.25 : 0;
          p.Head.rotation.x += (targetRot - p.Head.rotation.x) * Math.min(1, dt * 6);
        }
        if (p.Tail) p.Tail.rotation.y = Math.sin(sim.time * (c.state === 'chase' ? 14 : 3) + v.phase) * 0.35;
        if (p.Body) p.Body.rotation.x = c.state === 'hunt' ? 0.08 : 0;
      }
    }

    // Hit flash.
    const flash = sim.time - c.hitTime < 0.18;
    if (flash !== v.flashing) {
      v.flashing = flash;
      for (const [m, mat] of v.originals) m.material = flash ? flashMat : mat;
    }

    // Emote.
    const e = this.showEmotes ? EMOTES[c.state] : undefined;
    const key = e ? `${e.text}|${e.color}` : '';
    if (key !== v.emoteKey) {
      v.emoteKey = key;
      const tex = emoteTexture(key);
      (v.emote.material as THREE.SpriteMaterial).map = tex;
      (v.emote.material as THREE.SpriteMaterial).needsUpdate = true;
      v.emote.visible = !!tex;
    }
    if (v.emote.visible) {
      const h = c.species === 'slime' ? 0.75 : c.species === 'deer' ? 1.45 : 1.15;
      v.emote.position.set(0, h + Math.sin(sim.time * 4 + v.phase) * 0.04, 0);
    }
  }

  /** Pick the creature closest to a world point (for debug selection). */
  pick(sim: Simulation, x: number, z: number, maxD = 1.2): Creature | null {
    let best: Creature | null = null;
    let bd = maxD;
    for (const c of sim.creatures) {
      if (!c.alive) continue;
      const d = Math.hypot(c.x - x, c.z - z);
      if (d < bd) {
        bd = d;
        best = c;
      }
    }
    return best;
  }
}
