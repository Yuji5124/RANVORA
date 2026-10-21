import type { Game } from '../game/game';
import { SPECIES } from '../sim/species';
import { Tile } from '../world/types';

const COLORS: Record<number, string> = {
  [Tile.GRASS]: '#7fd05a',
  [Tile.FOREST]: '#3f8a3a',
  [Tile.PATH]: '#e0c48a',
  [Tile.WATER]: '#3a8ae0',
  [Tile.BRIDGE]: '#a8743f',
  [Tile.SAND]: '#efdca0',
  [Tile.PLAZA]: '#d8ccb0',
  [Tile.CAVE]: '#201820',
  [Tile.CLIFF]: '#77716b',
};

export class Minimap {
  readonly canvas = document.createElement('canvas');
  private base: HTMLCanvasElement | null = null;
  private builtFor = -1;

  constructor(private game: Game) {
    this.canvas.className = 'minimap';
    this.canvas.width = 168;
    this.canvas.height = 168;
  }

  private buildBase() {
    const w = this.game.world;
    const c = document.createElement('canvas');
    c.width = w.width;
    c.height = w.height;
    const g = c.getContext('2d')!;
    for (let z = 0; z < w.height; z++)
      for (let x = 0; x < w.width; x++) {
        const i = z * w.width + x;
        let col = COLORS[w.tiles[i]];
        const s = w.solidAt[i];
        if (s >= 0) {
          const k = w.objects[s].kind;
          col = k === 'house' ? '#d9573b' : k === 'tree' || k === 'pine' ? '#2d6b30' : k === 'rock' || k === 'ore' ? '#9a9a96' : col;
        }
        g.fillStyle = col;
        g.fillRect(x, z, 1, 1);
      }
    this.base = c;
    this.builtFor = w.seed;
  }

  draw() {
    const game = this.game;
    if (this.builtFor !== game.world.seed || !this.base) this.buildBase();
    const g = this.canvas.getContext('2d')!;
    const W = this.canvas.width;
    const w = game.world;
    const s = W / w.width;
    g.imageSmoothingEnabled = false;
    g.clearRect(0, 0, W, W);
    g.save();
    g.beginPath();
    g.arc(W / 2, W / 2, W / 2 - 2, 0, Math.PI * 2);
    g.clip();
    g.drawImage(this.base!, 0, 0, W, W);
    g.fillStyle = 'rgba(0,0,40,' + (0.45 * (1 - game.sim.daylight)).toFixed(2) + ')';
    g.fillRect(0, 0, W, W);
    for (const c of game.sim.creatures) {
      if (!c.alive) continue;
      g.fillStyle = SPECIES[c.species].model.minimapColor;
      g.fillRect(c.x * s - 1.5, c.z * s - 1.5, 3, 3);
    }
    for (const o of w.objects) {
      if (o.kind === 'chest' && !o.data.opened) {
        g.fillStyle = '#ffd23f';
        g.fillRect(o.x * s - 2, o.z * s - 2, 4, 4);
      }
    }
    g.fillStyle = '#000';
    g.fillRect((w.cave.tx + 0.5) * s - 3, (w.cave.tz + 0.5) * s - 3, 6, 6);
    const p = game.player;
    g.fillStyle = '#ffffff';
    g.strokeStyle = '#e0322b';
    g.lineWidth = 2;
    g.beginPath();
    g.arc(p.x * s, p.z * s, 3.5, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    g.restore();
    g.strokeStyle = 'rgba(255,240,200,0.9)';
    g.lineWidth = 3;
    g.beginPath();
    g.arc(W / 2, W / 2, W / 2 - 2, 0, Math.PI * 2);
    g.stroke();
  }
}
