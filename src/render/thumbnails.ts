// Renders small 3D previews (data URLs) for the codex and inventory.

import * as THREE from 'three';

export class Thumbnailer {
  private renderer: THREE.WebGLRenderer | null = null;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
  private cache = new Map<string, string>();

  constructor(private size = 96) {
    this.scene.add(new THREE.HemisphereLight('#ffffff', '#6b7a5a', 2.2));
    const sun = new THREE.DirectionalLight('#ffffff', 2.2);
    sun.position.set(2, 4, 3);
    this.scene.add(sun);
  }

  private ensure(): THREE.WebGLRenderer | null {
    if (this.renderer) return this.renderer;
    try {
      const canvas = document.createElement('canvas');
      this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
      this.renderer.setSize(this.size, this.size, false);
      this.renderer.setPixelRatio(1);
      this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    } catch {
      this.renderer = null;
    }
    return this.renderer;
  }

  get(key: string, build: () => THREE.Object3D): string {
    const hit = this.cache.get(key);
    if (hit) return hit;
    const r = this.ensure();
    if (!r) return '';
    const obj = build();
    obj.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(obj);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3()).length() || 1;
    obj.position.sub(center);
    const pivot = new THREE.Group();
    pivot.add(obj);
    pivot.rotation.y = -0.6;
    this.scene.add(pivot);
    const dist = size / (2 * Math.tan(THREE.MathUtils.degToRad(15))) * 0.95;
    this.camera.position.set(0, dist * 0.55, dist * 0.85);
    this.camera.lookAt(0, 0, 0);
    r.setClearColor(0x000000, 0);
    r.render(this.scene, this.camera);
    const url = r.domElement.toDataURL('image/png');
    this.scene.remove(pivot);
    this.cache.set(key, url);
    return url;
  }
}
