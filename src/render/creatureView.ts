// Renders creatures from simulation state with procedural animation,
// state emotes, variant colours and a death animation.
//
// Rigged models (GLBs with clips) play Idle / Move / Attack / Hit / Die picked
// from the creature's sim state each frame. This is display only: the sim
// decides what happens, and nothing here (clip ends, mixer events) feeds back
// into it. Models without clips (classic species, primitive fallbacks) keep
// the procedural animation.

import * as THREE from 'three';
import type { Creature, Simulation } from '../sim/simulation';
import { CLASSIC_SPECIES, SPECIES, type CreatureState, type Species } from '../sim/species';
import { getMaterial, type ModelKey, type ModelLibrary } from './models';

/** Clip names every rigged creature provides (tools/blender/creatures/creatures.json). */
export type ClipName = 'Idle' | 'Move' | 'Attack' | 'Hit' | 'Die';

interface Rig {
  mixer: THREE.AnimationMixer;
  actions: Partial<Record<ClipName, THREE.AnimationAction>>;
  current: ClipName | null;
  lastHit: number;
  lastAttack: number;
  /** Seconds the Die clip lasts (the view is removed after it). */
  dieTime: number;
}

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
  rig: Rig | null;
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

const VARIANT_TINT = Object.fromEntries(Object.values(SPECIES).map((d) => [d.id, new THREE.Color(d.model.variantTint)])) as Record<Species, THREE.Color>;
const CLASSIC = new Set<Species>(CLASSIC_SPECIES);

/** Which clip shows the creature's current sim state (pure; exported for tests). */
export function clipFor(c: Pick<Creature, 'moving' | 'hitTime' | 'attackTime'>, time: number, attackLen: number): ClipName {
  if (time - c.hitTime < 0.35) return 'Hit';
  if (time - c.attackTime < attackLen) return 'Attack';
  return c.moving ? 'Move' : 'Idle';
}

function makeRig(obj: THREE.Object3D, clips: THREE.AnimationClip[]): Rig | null {
  if (!clips.length) return null;
  const mixer = new THREE.AnimationMixer(obj);
  const actions: Rig['actions'] = {};
  for (const name of ['Idle', 'Move', 'Attack', 'Hit', 'Die'] as ClipName[]) {
    const clip = clips.find((c) => c.name === name);
    if (!clip) continue;
    const a = mixer.clipAction(clip);
    if (name === 'Attack' || name === 'Hit' || name === 'Die') {
      a.setLoop(THREE.LoopOnce, 1);
      a.clampWhenFinished = true;
    }
    actions[name] = a;
  }
  if (!actions.Idle) return null;
  return { mixer, actions, current: null, lastHit: -10, lastAttack: -10, dieTime: actions.Die?.getClip().duration ?? 0 };
}

function play(rig: Rig, name: ClipName, restart = false) {
  const next = rig.actions[name] ?? rig.actions.Idle!;
  const prev = rig.current ? rig.actions[rig.current] : undefined;
  if (rig.current === name && !restart) return;
  next.reset().play();
  if (prev && prev !== next) next.crossFadeFrom(prev, name === 'Hit' ? 0.06 : 0.15, false);
  rig.current = name;
}

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
    const key = SPECIES[c.species].model.key as ModelKey;
    const obj = this.lib.create(key);
    const parts: View['parts'] = {};
    const originals = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
    obj.traverse((o) => {
      if (o.name) parts[o.name] = o;
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        if (c.variant) {
          const src = m.material as THREE.MeshLambertMaterial;
          if (CLASSIC.has(c.species)) {
            const col = src.color.clone().lerp(VARIANT_TINT[c.species], 0.7);
            m.material = getMaterial(col, { emissive: c.species === 'slime' });
          } else {
            // Keep the model's glow, transparency and see-through-near-the-hero flags.
            const col = src.color.clone().lerp(VARIANT_TINT[c.species], 0.5);
            const glows = src.emissive.r + src.emissive.g + src.emissive.b > 0.02;
            m.material = getMaterial(col, {
              emissive: glows ? src.emissiveIntensity : undefined,
              opacity: src.opacity,
              cutout: src.customProgramCacheKey() === 'ranvora-cutout',
            });
          }
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
    const rig = makeRig(obj, this.lib.clips(key));
    if (rig) {
      play(rig, 'Idle');
      // Desynchronise idles so a herd does not breathe in lockstep (display only).
      rig.mixer.update((c.num * 0.37) % 1.3);
    }
    return { obj, parts, emote, emoteKey: '', yaw: Math.PI / 2 - c.dir, phase: c.num * 1.7, dying: 0, flashing: false, originals, variant: c.variant, rig };
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
      v.emote.visible = false;
      if (v.rig?.actions.Die) {
        // Play the Die clip, hold the last pose briefly, then sink away.
        if (v.rig.current !== 'Die') {
          this.setFlash(v, false);
          play(v.rig, 'Die');
        }
        v.rig.mixer.update(dt);
        const sink = v.dying - (v.rig.dieTime + 0.35);
        if (sink > 0) v.obj.scale.multiplyScalar(0.9);
        if (sink > 0.4) {
          this.root.remove(v.obj);
          this.views.delete(id);
        }
        continue;
      }
      v.obj.rotation.z = Math.min(Math.PI / 2, v.dying * 5);
      v.obj.scale.multiplyScalar(0.96);
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
      const vision = SPECIES[sel.species].vision * sel.visionTrait;
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

    if (v.rig) {
      const rig = v.rig;
      const attackLen = Math.max(0.5, rig.actions.Attack?.getClip().duration ?? 0.6);
      const want = clipFor(c, sim.time, attackLen);
      // A new hit / attack restarts its clip even if the previous one is still showing.
      const fresh = (want === 'Hit' && c.hitTime !== rig.lastHit) || (want === 'Attack' && c.attackTime !== rig.lastAttack);
      if (want === 'Hit') rig.lastHit = c.hitTime;
      if (want === 'Attack') rig.lastAttack = c.attackTime;
      play(rig, want, fresh);
      const move = rig.actions.Move;
      if (move) move.timeScale = c.running ? 1.7 : 1;
      if (rig.actions.Idle) rig.actions.Idle.timeScale = c.state === 'rest' ? 0.5 : 1;
      rig.mixer.update(dt);
    } else if (c.species === 'slime') {
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
      // (classic models sink when resting; fallback primitives of new species just bob)
      v.obj.position.y = resting && CLASSIC.has(c.species) ? -0.26 : c.moving ? Math.abs(sw) * 0.04 : 0;
      if (c.species === 'driftjelly' && p.Body) p.Body.position.y = Math.sin(sim.time * 2.5 + v.phase) * 0.05;
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
    this.setFlash(v, sim.time - c.hitTime < 0.18);

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
      const h = SPECIES[c.species].model.emoteHeight;
      v.emote.position.set(0, h + Math.sin(sim.time * 4 + v.phase) * 0.04, 0);
    }
  }

  private setFlash(v: View, flash: boolean) {
    if (flash === v.flashing) return;
    v.flashing = flash;
    for (const [m, mat] of v.originals) m.material = flash ? flashMat : mat;
  }

  /** Clip currently shown for a creature (null = procedural). For tests / debug. */
  clipOf(id: string): ClipName | null {
    return this.views.get(id)?.rig?.current ?? null;
  }

  /** Number of creature views drawn with a rigged model / with procedural animation. */
  rigStats(): { rigged: number; procedural: number } {
    let rigged = 0;
    let procedural = 0;
    for (const v of this.views.values()) (v.rig ? rigged++ : procedural++);
    return { rigged, procedural };
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
