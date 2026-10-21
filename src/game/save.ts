// Progress save: inventory (materials, crafted items, equipment) and weapon growth.
// Separate key from the codex (ranvora.codex.v1), which is left untouched.
// The ecosystem is not saved (it regenerates from the seed).
//
// Safety:
//  - versioned; unknown versions and broken data are rejected without throwing
//  - a rejected save is copied aside (…corrupt) before anything overwrites it
//  - the new text is built completely before it is written; if the write fails
//    (quota, private mode) the previous save stays as it was
//  - nothing here touches the simulation or any Rng stream

import { isMaterialId, MATERIAL_IDS, PROP_KEYS, type MaterialId } from '../items/materials';
import type { CraftedItem } from '../items/synthesis';
import type { Inventory } from '../items/inventory';
import { GrowthBook, LINEAGES, type GrowthBookData, type WeaponGrowth } from '../progression';

export const SAVE_KEY = 'ranvora.save.v1';
export const SAVE_VERSION = 1;
const MAX_COUNT = 99999;

export interface SaveData {
  version: 1;
  materials: Partial<Record<MaterialId, number>>;
  items: { item: CraftedItem; count: number }[];
  equipped: { weapon: string | null; spell: string | null; charm: string | null };
  growth: GrowthBookData;
}

export function snapshot(inv: Inventory, book: GrowthBook): SaveData {
  const materials: Partial<Record<MaterialId, number>> = {};
  for (const id of MATERIAL_IDS) {
    const n = inv.count(id);
    if (n > 0) materials[id] = n;
  }
  const items = [...inv.items.values()]
    .map(({ item, count }) => ({ item, count }))
    .sort((a, b) => (a.item.id < b.item.id ? -1 : a.item.id > b.item.id ? 1 : 0));
  return {
    version: SAVE_VERSION,
    materials,
    items,
    equipped: { weapon: inv.equippedWeapon, spell: inv.equippedSpell, charm: inv.equippedCharm },
    growth: book.toJSON(),
  };
}

/** Restores a validated save into a fresh inventory and growth book. */
export function restore(data: SaveData, inv: Inventory): GrowthBook {
  for (const [id, n] of Object.entries(data.materials)) if (n) inv.addMaterial(id as MaterialId, n);
  for (const { item, count } of data.items) for (let i = 0; i < count; i++) inv.addItem(item);
  const has = (id: string | null) => (id && inv.items.has(id) ? id : null);
  inv.equippedWeapon = has(data.equipped.weapon);
  inv.equippedSpell = has(data.equipped.spell);
  inv.equippedCharm = has(data.equipped.charm);
  return GrowthBook.fromJSON(data.growth);
}

// ---------------------------------------------------------------- validation

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isCount = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= MAX_COUNT;
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isIdOrNull = (v: unknown) => v === null || typeof v === 'string';

function validItem(v: unknown): v is CraftedItem {
  if (!isObj(v)) return false;
  if (typeof v.id !== 'string' || !/^ITM-[0-9A-F]{6}$/.test(v.id) || typeof v.name !== 'string') return false;
  if (!['weapon', 'spell', 'potion', 'charm', 'junk'].includes(v.category as string)) return false;
  if (!['fire', 'water', 'wind', 'thunder', 'earth', 'none'].includes(v.element as string)) return false;
  if (!isObj(v.props) || !PROP_KEYS.every((k) => isNum((v.props as Record<string, unknown>)[k]))) return false;
  if (!isObj(v.stats) || !Object.values(v.stats).every(isNum)) return false;
  if (!Array.isArray(v.reactions) || !Array.isArray(v.ingredients) || v.ingredients.length !== 2) return false;
  return typeof v.color === 'string' && isNum(v.seed);
}

function validGrowth(v: unknown): v is WeaponGrowth {
  if (!isObj(v) || typeof v.itemId !== 'string') return false;
  if (!LINEAGES.includes(v.innate as never)) return false;
  if (!Number.isInteger(v.level) || (v.level as number) < 1 || (v.level as number) > 40) return false;
  if (!Number.isInteger(v.limitBreak) || (v.limitBreak as number) < 0 || (v.limitBreak as number) > 3) return false;
  if (!isCount(v.exp) || !isNum(v.totalExp) || (v.totalExp as number) < 0) return false;
  if (!isObj(v.points) || !LINEAGES.every((l) => isNum((v.points as Record<string, unknown>)[l]) && ((v.points as Record<string, number>)[l]) >= 0)) return false;
  if (v.form !== null && !(isObj(v.form) && LINEAGES.includes(v.form.lineage as never) && Number.isInteger(v.form.stage))) return false;
  return true;
}

/** Returns the data if it is a complete, valid save; null otherwise (never throws). */
export function validate(raw: unknown): SaveData | null {
  if (!isObj(raw) || raw.version !== SAVE_VERSION) return null;
  if (!isObj(raw.materials) || !Object.entries(raw.materials).every(([k, n]) => isMaterialId(k) && isCount(n))) return null;
  if (!Array.isArray(raw.items) || !raw.items.every((s) => isObj(s) && validItem(s.item) && isCount(s.count) && (s.count as number) > 0)) return null;
  const ids = new Set((raw.items as { item: CraftedItem }[]).map((s) => s.item.id));
  if (ids.size !== raw.items.length) return null;
  if (!isObj(raw.equipped) || !['weapon', 'spell', 'charm'].every((k) => isIdOrNull((raw.equipped as Record<string, unknown>)[k]))) return null;
  if (!isObj(raw.growth) || raw.growth.version !== 1 || !Array.isArray(raw.growth.weapons) || !raw.growth.weapons.every(validGrowth)) return null;
  return raw as unknown as SaveData;
}

// ---------------------------------------------------------------- storage

export interface LoadResult {
  data: SaveData | null;
  /** 'none' = no save yet, 'ok', 'corrupt' = something was there but unusable (kept aside). */
  status: 'none' | 'ok' | 'corrupt' | 'unavailable';
}

export class SaveStore {
  constructor(
    private storage: Storage | null = safeStorage(),
    private key = SAVE_KEY,
  ) {}

  load(): LoadResult {
    if (!this.storage) return { data: null, status: 'unavailable' };
    let raw: string | null;
    try {
      raw = this.storage.getItem(this.key);
    } catch {
      return { data: null, status: 'unavailable' };
    }
    if (raw === null) return { data: null, status: 'none' };
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = undefined;
    }
    const data = validate(parsed);
    if (data) return { data, status: 'ok' };
    try {
      // Keep the unusable save aside so the next write cannot destroy it.
      this.storage.setItem(`${this.key}.corrupt`, raw);
    } catch {
      /* nothing more we can do */
    }
    return { data: null, status: 'corrupt' };
  }

  /** Writes a save. Returns false (and leaves the previous save as it was) on failure. */
  save(data: SaveData): boolean {
    if (!this.storage) return false;
    let text: string;
    try {
      text = JSON.stringify(data);
      if (!validate(JSON.parse(text))) return false;
    } catch {
      return false;
    }
    try {
      this.storage.setItem(this.key, text);
      return true;
    } catch {
      return false;
    }
  }
}

function safeStorage(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}
