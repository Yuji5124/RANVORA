// Small procedural models for materials and crafted items (pickups, icons).

import * as THREE from 'three';
import { MATERIALS, type MaterialId } from '../items/materials';
import type { CraftedItem } from '../items/synthesis';
import { getMaterial } from './models';

function mesh(geo: THREE.BufferGeometry, color: string | THREE.Color, emissive = false) {
  const m = new THREE.Mesh(geo, getMaterial(color, { emissive }));
  m.castShadow = true;
  return m;
}

const cache = new Map<string, THREE.Object3D>();

export function materialModel(id: MaterialId): THREE.Object3D {
  const key = `mat:${id}`;
  if (cache.has(key)) return cache.get(key)!.clone();
  const def = MATERIALS[id];
  const g = new THREE.Group();
  switch (def.shape) {
    case 'log': {
      const log = mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.36, 6), def.color);
      log.rotation.z = Math.PI / 2;
      const end = mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.37, 6), '#e3c088');
      end.rotation.z = Math.PI / 2;
      g.add(log, end);
      break;
    }
    case 'chunk':
      g.add(mesh(new THREE.IcosahedronGeometry(0.15, 0), def.color));
      break;
    case 'ingot': {
      const ing = mesh(new THREE.CylinderGeometry(0.12, 0.17, 0.1, 4), def.color);
      ing.rotation.y = Math.PI / 4;
      ing.scale.set(1.4, 1, 0.8);
      g.add(ing);
      break;
    }
    case 'leaf': {
      const l1 = mesh(new THREE.ConeGeometry(0.06, 0.32, 4), def.color);
      const l2 = mesh(new THREE.ConeGeometry(0.05, 0.26, 4), '#8fd86a');
      l2.position.x = 0.07;
      l2.rotation.z = -0.3;
      const l3 = mesh(new THREE.ConeGeometry(0.05, 0.26, 4), '#4fae3d');
      l3.position.x = -0.07;
      l3.rotation.z = 0.3;
      g.add(l1, l2, l3);
      break;
    }
    case 'mushroom': {
      const stem = mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.16, 6), '#f3e9d2');
      const cap = mesh(new THREE.SphereGeometry(0.13, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2), def.color);
      cap.position.y = 0.07;
      const dot = mesh(new THREE.IcosahedronGeometry(0.025, 0), '#ffffff');
      dot.position.set(0.05, 0.17, 0.05);
      g.add(stem, cap, dot);
      break;
    }
    case 'gem': {
      const gem = mesh(new THREE.OctahedronGeometry(0.16, 0), def.color, true);
      gem.scale.y = 1.5;
      g.add(gem);
      break;
    }
    case 'orb':
      g.add(mesh(new THREE.IcosahedronGeometry(0.14, 1), def.color, true));
      break;
    case 'feather': {
      const f = mesh(new THREE.SphereGeometry(0.1, 6, 4), def.color);
      f.scale.set(0.45, 0.25, 1.8);
      f.rotation.y = 0.6;
      const quill = mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.4, 4), '#9fc9a8');
      quill.rotation.x = Math.PI / 2;
      quill.rotation.z = 0.6;
      g.add(f, quill);
      break;
    }
    case 'core': {
      const outer = mesh(new THREE.IcosahedronGeometry(0.15, 1), def.color);
      const inner = mesh(new THREE.IcosahedronGeometry(0.07, 0), '#ffffff', true);
      g.add(outer, inner);
      break;
    }
  }
  cache.set(key, g);
  return g.clone();
}

export function craftedModel(item: CraftedItem): THREE.Object3D {
  const g = new THREE.Group();
  const c = item.color;
  switch (item.category) {
    case 'weapon': {
      const blade = mesh(new THREE.BoxGeometry(0.06, 0.5, 0.02), c);
      blade.position.y = 0.2;
      const guard = mesh(new THREE.BoxGeometry(0.2, 0.04, 0.05), '#d9a43a');
      guard.position.y = -0.06;
      const grip = mesh(new THREE.BoxGeometry(0.04, 0.14, 0.04), '#5a3a1e');
      grip.position.y = -0.15;
      g.add(blade, guard, grip);
      g.rotation.z = -0.6;
      break;
    }
    case 'spell': {
      const staff = mesh(new THREE.CylinderGeometry(0.02, 0.025, 0.55, 5), '#8a5a2b');
      const orb = mesh(new THREE.IcosahedronGeometry(0.1, 1), c, true);
      orb.position.y = 0.32;
      g.add(staff, orb);
      g.rotation.z = -0.4;
      break;
    }
    case 'potion': {
      const body = mesh(new THREE.IcosahedronGeometry(0.13, 1), c, true);
      const neck = mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.1, 6), '#dfefff');
      neck.position.y = 0.15;
      const cork = mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.05, 6), '#a0703c');
      cork.position.y = 0.22;
      g.add(body, neck, cork);
      break;
    }
    case 'charm': {
      const ring = mesh(new THREE.TorusGeometry(0.12, 0.025, 4, 10), '#e2b13c');
      const gem = mesh(new THREE.OctahedronGeometry(0.07, 0), c, true);
      gem.position.y = -0.12;
      g.add(ring, gem);
      break;
    }
    default:
      g.add(mesh(new THREE.DodecahedronGeometry(0.15, 0), c));
  }
  return g;
}
