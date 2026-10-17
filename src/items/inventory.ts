import { MATERIAL_IDS, type MaterialId } from './materials';
import type { CraftedItem } from './synthesis';

export interface ItemStack {
  item: CraftedItem;
  count: number;
}

export class Inventory {
  readonly materials = new Map<MaterialId, number>(MATERIAL_IDS.map((id) => [id, 0]));
  readonly items = new Map<string, ItemStack>();
  equippedWeapon: string | null = null;
  equippedSpell: string | null = null;
  equippedCharm: string | null = null;
  private listeners: (() => void)[] = [];

  onChange(fn: () => void) {
    this.listeners.push(fn);
  }

  private emit() {
    for (const l of this.listeners) l();
  }

  addMaterial(id: MaterialId, n = 1) {
    this.materials.set(id, (this.materials.get(id) ?? 0) + n);
    this.emit();
  }

  count(id: string): number {
    if (this.materials.has(id as MaterialId)) return this.materials.get(id as MaterialId) ?? 0;
    return this.items.get(id)?.count ?? 0;
  }

  addItem(item: CraftedItem) {
    const s = this.items.get(item.id);
    if (s) s.count++;
    else this.items.set(item.id, { item, count: 1 });
    this.emit();
  }

  /** Removes one of a material or crafted item. Returns false if none. */
  take(id: string): boolean {
    const m = this.materials.get(id as MaterialId);
    if (m !== undefined) {
      if (m <= 0) return false;
      this.materials.set(id as MaterialId, m - 1);
      this.emit();
      return true;
    }
    const s = this.items.get(id);
    if (!s || s.count <= 0) return false;
    s.count--;
    if (s.count === 0) {
      this.items.delete(id);
      if (this.equippedWeapon === id) this.equippedWeapon = null;
      if (this.equippedSpell === id) this.equippedSpell = null;
      if (this.equippedCharm === id) this.equippedCharm = null;
    }
    this.emit();
    return true;
  }

  get(id: string | null): CraftedItem | null {
    return id ? (this.items.get(id)?.item ?? null) : null;
  }

  equip(id: string) {
    const it = this.get(id);
    if (!it) return;
    if (it.category === 'weapon') this.equippedWeapon = this.equippedWeapon === id ? null : id;
    else if (it.category === 'spell') this.equippedSpell = this.equippedSpell === id ? null : id;
    else if (it.category === 'charm') this.equippedCharm = this.equippedCharm === id ? null : id;
    this.emit();
  }

  totalMaterials(): number {
    let n = 0;
    for (const v of this.materials.values()) n += v;
    return n;
  }
}
