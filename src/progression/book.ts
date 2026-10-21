// Growth records for all weapons the player owns, keyed by CraftedItem id.
// Plain JSON with a version so a future save system can store and migrate it.

import type { CraftedItem } from '../items/synthesis';
import { newGrowth, type WeaponGrowth } from './weapon';

export interface GrowthBookData {
  version: 1;
  weapons: WeaponGrowth[];
}

export class GrowthBook {
  private map = new Map<string, WeaponGrowth>();

  /** Growth for a weapon item, created on first use. */
  of(item: CraftedItem): WeaponGrowth {
    let g = this.map.get(item.id);
    if (!g) {
      g = newGrowth(item);
      this.map.set(item.id, g);
    }
    return g;
  }

  get(itemId: string): WeaponGrowth | undefined {
    return this.map.get(itemId);
  }

  /** Forget a weapon (after it was used as merge fodder). */
  remove(itemId: string): void {
    this.map.delete(itemId);
  }

  toJSON(): GrowthBookData {
    // Sorted by id so the same state always serializes to the same text.
    const weapons = [...this.map.values()].sort((a, b) => (a.itemId < b.itemId ? -1 : a.itemId > b.itemId ? 1 : 0));
    return { version: 1, weapons: weapons.map((g) => ({ ...g, points: { ...g.points }, form: g.form ? { ...g.form } : null })) };
  }

  static fromJSON(data: GrowthBookData): GrowthBook {
    if (data.version !== 1) throw new Error(`未対応の成長データ version: ${data.version}`);
    const b = new GrowthBook();
    for (const g of data.weapons) b.map.set(g.itemId, { ...g, points: { ...g.points }, form: g.form ? { ...g.form } : null });
    return b;
  }
}
