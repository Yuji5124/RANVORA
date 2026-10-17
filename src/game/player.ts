// The hero: movement with tile collision, sword attack, damage and the
// procedural animation set (idle / walk / run / attack / hurt / pickup).

import * as THREE from 'three';
import { canStand, moveWithCollision, type World } from '../world/types';
import type { ModelLibrary } from '../render/models';

export type PlayerAnim = 'idle' | 'walk' | 'run' | 'attack' | 'hurt' | 'pickup';

export const PLAYER_RADIUS = 0.24;

export class Player {
  x = 0;
  z = 0;
  /** Heading angle on the XZ plane (0 = +X, PI/2 = +Z / south). */
  dir = Math.PI / 2;
  maxHp = 10;
  hp = 10;
  anim: PlayerAnim = 'idle';
  animTime = 0;
  attackTime = -1;
  hurtTime = -10;
  pickupTime = -10;
  invulnUntil = 0;
  moving = false;
  running = false;
  speedBonus = 0;

  readonly obj: THREE.Object3D;
  private parts: Record<string, THREE.Object3D | undefined> = {};
  private slash: THREE.Mesh;
  private marker: THREE.Mesh;
  private popIcon: THREE.Object3D | null = null;
  private phase = 0;
  private originals = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
  private flashOn = false;

  constructor(lib: ModelLibrary) {
    this.obj = new THREE.Group();
    const hero = lib.create('hero');
    this.obj.add(hero);
    hero.traverse((o) => {
      if (o.name) this.parts[o.name] = o;
      const m = o as THREE.Mesh;
      if (m.isMesh) this.originals.set(m, m.material);
    });
    // Slash arc effect.
    this.slash = new THREE.Mesh(
      new THREE.RingGeometry(0.55, 1.05, 20, 1, -Math.PI * 0.45, Math.PI * 0.9),
      new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }),
    );
    this.slash.rotation.x = -Math.PI / 2;
    this.slash.position.y = 0.4;
    this.obj.add(this.slash);
    // Ground marker showing the facing direction (readable from straight above).
    const shape = new THREE.Shape();
    shape.moveTo(0, 0.62);
    shape.lineTo(0.14, 0.44);
    shape.lineTo(-0.14, 0.44);
    shape.closePath();
    const ring = new THREE.Mesh(
      new THREE.ShapeGeometry(shape),
      new THREE.MeshBasicMaterial({ color: '#fff6c8', transparent: true, opacity: 0.85, depthWrite: false }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.rotation.z = Math.PI;
    ring.position.y = 0.02;
    this.marker = ring;
    this.obj.add(this.marker);
  }

  get facing(): { x: number; z: number } {
    return { x: Math.cos(this.dir), z: Math.sin(this.dir) };
  }

  /** Point slightly in front of the player, used for interaction. */
  front(dist = 0.8) {
    return { x: this.x + Math.cos(this.dir) * dist, z: this.z + Math.sin(this.dir) * dist };
  }

  teleport(x: number, z: number) {
    this.x = x;
    this.z = z;
  }

  move(world: World, ix: number, iz: number, run: boolean, dt: number, locked: boolean) {
    const len = Math.hypot(ix, iz);
    this.moving = len > 0.01 && !locked;
    this.running = this.moving && run;
    if (this.moving) {
      const nx = ix / len;
      const nz = iz / len;
      this.dir = Math.atan2(nz, nx);
      const speed = (run ? 5.0 : 3.0) * (1 + this.speedBonus) * (this.attackTime >= 0 ? 0.4 : 1);
      const p = moveWithCollision(world, { x: this.x, z: this.z }, nx * speed * dt, nz * speed * dt, PLAYER_RADIUS);
      this.x = p.x;
      this.z = p.z;
    }
  }

  startAttack(): boolean {
    if (this.attackTime >= 0) return false;
    this.attackTime = 0;
    return true;
  }

  hurt(world: World, dmg: number, from: { x: number; z: number } | null, now: number): boolean {
    if (now < this.invulnUntil) return false;
    this.hp = Math.max(0, this.hp - dmg);
    this.hurtTime = now;
    this.invulnUntil = now + 1.0;
    if (from) {
      const ax = this.x - from.x;
      const az = this.z - from.z;
      const l = Math.hypot(ax, az) || 1;
      for (let k = 6; k > 0; k--) {
        const nx = this.x + (ax / l) * 0.12 * k;
        const nz = this.z + (az / l) * 0.12 * k;
        if (canStand(world, nx, nz, PLAYER_RADIUS)) {
          this.x = nx;
          this.z = nz;
          break;
        }
      }
    }
    return true;
  }

  showPickup(icon: THREE.Object3D | null, now: number) {
    this.pickupTime = now;
    if (this.popIcon) this.obj.remove(this.popIcon);
    this.popIcon = icon;
    if (icon) {
      icon.scale.setScalar(1.4);
      this.obj.add(icon);
    }
  }

  /** Advances animation; returns true on the frame the sword hit lands. */
  update(dt: number, now: number): boolean {
    let hitFrame = false;
    if (this.attackTime >= 0) {
      const prev = this.attackTime;
      this.attackTime += dt;
      if (prev < 0.1 && this.attackTime >= 0.1) hitFrame = true;
      if (this.attackTime > 0.32) this.attackTime = -1;
    }
    const hurt = now - this.hurtTime < 0.35;
    const pickup = now - this.pickupTime < 0.6;
    this.anim = this.attackTime >= 0 ? 'attack' : hurt ? 'hurt' : pickup ? 'pickup' : this.running ? 'run' : this.moving ? 'walk' : 'idle';

    this.obj.position.set(this.x, 0, this.z);
    this.obj.rotation.y = Math.PI / 2 - this.dir;
    const p = this.parts;
    const body = p.Body;
    if (this.moving) this.phase += dt * (this.running ? 16 : 10);
    const sw = this.moving ? Math.sin(this.phase) : 0;
    const amp = this.running ? 0.9 : 0.55;
    const reset = (o?: THREE.Object3D) => o?.rotation.set(0, 0, 0);
    reset(p.ArmL);
    reset(p.ArmR);
    if (p.LegL) p.LegL.rotation.x = sw * amp;
    if (p.LegR) p.LegR.rotation.x = -sw * amp;
    if (p.ArmL) p.ArmL.rotation.x = -sw * amp * 0.8;
    if (p.ArmR) p.ArmR.rotation.x = sw * amp * 0.8;
    if (body) {
      body.position.y = 0.26 + (this.moving ? Math.abs(sw) * 0.035 : Math.sin(now * 2.2) * 0.008);
      body.rotation.x = this.running ? 0.18 : 0;
      body.rotation.z = 0;
      body.rotation.y = 0;
    }
    if (p.ScarfTail) p.ScarfTail.rotation.x = THREE.MathUtils.degToRad(-18) + (this.moving ? Math.sin(this.phase * 0.8) * 0.25 - (this.running ? 0.35 : 0.1) : Math.sin(now * 1.5) * 0.06);

    switch (this.anim) {
      case 'attack': {
        const t = this.attackTime / 0.32;
        if (p.ArmR) {
          p.ArmR.rotation.x = -1.45;
          p.ArmR.rotation.z = 0;
          p.ArmR.rotation.y = THREE.MathUtils.lerp(1.3, -1.4, easeOut(Math.min(1, t * 1.6)));
        }
        if (body) body.rotation.y = THREE.MathUtils.lerp(0.35, -0.4, easeOut(Math.min(1, t * 1.6)));
        (this.slash.material as THREE.MeshBasicMaterial).opacity = t > 0.15 && t < 0.8 ? 0.55 * (1 - t) : 0;
        break;
      }
      case 'hurt':
        if (body) body.rotation.x = -0.35;
        if (p.ArmL) p.ArmL.rotation.z = 0.6;
        if (p.ArmR) p.ArmR.rotation.z = -0.6;
        break;
      case 'pickup':
        if (p.ArmL) p.ArmL.rotation.x = -2.7;
        if (p.ArmR) p.ArmR.rotation.x = -2.7;
        break;
      default:
        (this.slash.material as THREE.MeshBasicMaterial).opacity = 0;
    }
    if (this.anim !== 'attack') (this.slash.material as THREE.MeshBasicMaterial).opacity = 0;

    // Pickup icon floats above the head.
    if (this.popIcon) {
      const t = now - this.pickupTime;
      this.popIcon.position.set(0, 1.25 + t * 0.4, 0);
      this.popIcon.rotation.y = t * 4;
      if (t > 0.8) {
        this.obj.remove(this.popIcon);
        this.popIcon = null;
      }
    }

    // Damage flash / invulnerability blink.
    const flash = hurt && Math.floor(now * 20) % 2 === 0;
    if (flash !== this.flashOn) {
      this.flashOn = flash;
      for (const [m, mat] of this.originals) m.material = flash ? hurtMat : mat;
    }
    this.obj.visible = now < this.invulnUntil && !hurt ? Math.floor(now * 12) % 2 === 0 : true;
    return hitFrame;
  }
}

const hurtMat = new THREE.MeshLambertMaterial({ color: '#ff6060', emissive: new THREE.Color('#ff2020'), emissiveIntensity: 0.5 });

function easeOut(t: number) {
  return 1 - (1 - t) * (1 - t);
}
