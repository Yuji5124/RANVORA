// "Unknown synthesis": two ingredients -> a new item.
// No recipe table: the result comes from how the ingredients' properties
// interact (steam, forging, resonance...), plus a small seeded variation.
// Same world seed + same ingredients => same item, same id.

import { hashInts, hashString, shortId } from '../core/rng';
import { MATERIALS, PROP_KEYS, type MaterialId, type Props, type PropKey } from './materials';

export type ItemCategory = 'weapon' | 'spell' | 'potion' | 'charm' | 'junk';
export type Element = 'fire' | 'water' | 'wind' | 'thunder' | 'earth' | 'none';

export interface CraftedItem {
  id: string;
  name: string;
  category: ItemCategory;
  element: Element;
  props: Props;
  /** Reactions that happened during synthesis (e.g. 蒸気, 鍛造). */
  reactions: string[];
  trait: string | null;
  /** Derived gameplay stats. */
  stats: { attack?: number; range?: number; power?: number; heal?: number; speed?: number };
  color: string;
  /** Ingredient ids (material ids or item ids). */
  ingredients: [string, string];
  seed: number;
}

export interface Ingredient {
  id: string;
  name: string;
  props: Props;
}

export function materialIngredient(id: MaterialId): Ingredient {
  const m = MATERIALS[id];
  return { id: m.id, name: m.name, props: { ...m.props } };
}

export function itemIngredient(item: CraftedItem): Ingredient {
  return { id: item.id, name: item.name, props: { ...item.props } };
}

const CATEGORY_LABEL: Record<ItemCategory, string> = {
  weapon: '武器',
  spell: '魔法',
  potion: '薬',
  charm: 'お守り',
  junk: '謎の物体',
};
export const ELEMENT_LABEL: Record<Element, string> = {
  fire: '火',
  water: '水',
  wind: '風',
  thunder: '雷',
  earth: '土',
  none: '無',
};
export function categoryLabel(c: ItemCategory) {
  return CATEGORY_LABEL[c];
}

/** Deterministic pseudo-random float in [0,1) from a hash and a salt. */
function hrand(h: number, salt: number) {
  return hashInts(h, salt) / 4294967296;
}

function clampProps(p: Props): Props {
  const out = { ...p };
  for (const k of PROP_KEYS) out[k] = Math.round(Math.max(0, Math.min(12, out[k])) * 10) / 10;
  return out;
}

export function synthesize(a: Ingredient, b: Ingredient, worldSeed: number): CraftedItem {
  // Order-independent: A+B == B+A.
  const [x, y] = a.id <= b.id ? [a, b] : [b, a];
  const h = hashInts(worldSeed, hashString(x.id), hashString(y.id));
  const pa = x.props;
  const pb = y.props;
  const reactions: string[] = [];

  // Base: average of both.
  const p = {} as Props;
  for (const k of PROP_KEYS) p[k] = (pa[k] + pb[k]) / 2;

  // --- Property interactions -------------------------------------------
  // Steam: heat meets water. Both cancel, energy turns into magic.
  const steam = Math.min(pa.heat, pb.water) + Math.min(pb.heat, pa.water);
  if (steam >= 5) {
    p.heat -= steam * 0.35;
    p.water -= steam * 0.35;
    p.magic += steam * 0.3;
    p.elasticity += 1;
    reactions.push('蒸気');
  }
  // Forging: something hard meets something hot.
  const forge = Math.min(Math.max(pa.hardness, pb.hardness), Math.max(pa.heat, pb.heat));
  if (forge >= 7 && steam < 5) {
    p.hardness += 2.5;
    p.weight -= 1;
    p.heat -= 2;
    reactions.push('鍛造');
  }
  // Resonance: two magical things amplify each other.
  if (pa.magic >= 5 && pb.magic >= 5) {
    p.magic *= 1.35;
    reactions.push('共鳴');
  }
  // Combustion: fire meets something soft and dry -> it burns away.
  const flammableA = pa.hardness < 4 && pa.water < 6 && pb.heat >= 7;
  const flammableB = pb.hardness < 4 && pb.water < 6 && pa.heat >= 7;
  if (flammableA || flammableB) {
    p.heat += 2;
    p.weight -= 1.5;
    p.hardness -= 1;
    reactions.push('燃焼');
  }
  // Crystallisation: cold, wet magic hardens.
  if (p.water >= 4 && p.magic >= 5 && p.heat <= 2) {
    p.hardness += 2;
    p.elasticity -= 1.5;
    reactions.push('結晶化');
  }
  // Spring: heavy + elastic store energy.
  if (Math.max(pa.elasticity, pb.elasticity) >= 7 && Math.max(pa.weight, pb.weight) >= 6) {
    p.elasticity += 2;
    p.hardness += 0.5;
    reactions.push('反発');
  }
  // Same thing twice concentrates it.
  if (x.id === y.id) {
    const dom = dominant(pa);
    p[dom] += 2.5;
    reactions.push('凝縮');
  }

  // --- Seeded variation (reproducible "luck") ---------------------------
  PROP_KEYS.forEach((k, i) => {
    p[k] += (hrand(h, i + 1) - 0.5) * 1.4;
  });

  // Rare traits.
  let trait: string | null = null;
  const roll = hrand(h, 99);
  if (roll < 0.05) {
    trait = '雷を帯びた';
    p.magic += 3;
  } else if (roll < 0.09) {
    trait = '生きている';
    p.elasticity += 3;
  } else if (roll < 0.12) {
    trait = '古代の';
    for (const k of PROP_KEYS) p[k] += 1;
  } else if (roll < 0.15) {
    trait = 'ねじれた';
    const k1 = PROP_KEYS[Math.floor(hrand(h, 7) * 6)];
    const k2 = PROP_KEYS[Math.floor(hrand(h, 8) * 6)];
    [p[k1], p[k2]] = [p[k2], p[k1]];
  }

  const props = clampProps(p);
  const element = pickElement(props, trait);
  const category = pickCategory(props);
  const stats = deriveStats(category, element, props);
  const name = makeName(category, element, props, reactions, trait, h);

  return {
    id: shortId('ITM', h),
    name,
    category,
    element,
    props,
    reactions,
    trait,
    stats,
    color: itemColor(element, props),
    ingredients: [x.id, y.id],
    seed: worldSeed,
  };
}

function dominant(p: Props): PropKey {
  let best: PropKey = 'hardness';
  for (const k of PROP_KEYS) if (p[k] > p[best]) best = k;
  return best;
}

function pickElement(p: Props, trait: string | null): Element {
  if (trait === '雷を帯びた') return 'thunder';
  const scores: [Element, number][] = [
    ['fire', p.heat],
    ['water', p.water],
    ['wind', p.elasticity * 0.6 + (10 - p.weight) * 0.4 - 2],
    ['earth', (p.hardness + p.weight) / 2 - 1],
  ];
  scores.sort((a, b) => b[1] - a[1]);
  return scores[0][1] >= 4 ? scores[0][0] : 'none';
}

function pickCategory(p: Props): ItemCategory {
  if (p.magic >= 6) return 'spell';
  if (p.hardness >= 6 && p.weight >= 3.5) return 'weapon';
  if (p.water >= 5) return 'potion';
  if (p.elasticity >= 5.5) return 'charm';
  if (p.hardness >= 5) return 'weapon';
  return 'junk';
}

function deriveStats(c: ItemCategory, e: Element, p: Props): CraftedItem['stats'] {
  const r = (v: number) => Math.round(v * 10) / 10;
  switch (c) {
    case 'weapon':
      return { attack: r(1 + p.hardness * 0.3 + p.weight * 0.15), range: r(1.1 + Math.max(0, 8 - p.weight) * 0.05) };
    case 'spell':
      return { power: r(1 + p.magic * 0.35 + (e === 'fire' ? p.heat : e === 'water' ? p.water : p.elasticity) * 0.15) };
    case 'potion':
      return { heal: Math.max(1, Math.round(p.water * 0.3 + p.magic * 0.2)) };
    case 'charm':
      return { speed: r(Math.min(0.5, p.elasticity * 0.04)) };
    default:
      return {};
  }
}

const ADJ: Record<PropKey, string[]> = {
  hardness: ['堅牢な', '鋼の', '岩砕きの'],
  weight: ['重厚な', 'ずっしりした', '大地の'],
  heat: ['灼熱の', '燃える', '紅蓮の'],
  water: ['潤いの', '深淵の', '清流の'],
  magic: ['神秘の', '輝く', '星詠みの'],
  elasticity: ['弾む', 'しなやかな', 'ぷにぷにの'],
};

const NOUN: Record<ItemCategory, Partial<Record<Element, string[]>> & { default: string[] }> = {
  weapon: { default: ['剣', 'ブレード', '斧', '槌'], fire: ['炎剣', 'フレイムブレード'], water: ['水刃'], earth: ['岩槌', '大斧'], thunder: ['雷剣'] },
  spell: {
    default: ['オーブ', '杖'],
    fire: ['火炎の杖', 'フレイムオーブ'],
    water: ['水流の杖', 'アクアオーブ'],
    wind: ['疾風の杖', 'ウィンドオーブ'],
    thunder: ['雷鳴の杖'],
    earth: ['大地の杖'],
  },
  potion: { default: ['ポーション', '霊薬', '雫'] },
  charm: { default: ['お守り', '護符', 'ペンダント'], wind: ['風の護符'] },
  junk: { default: ['謎の塊', 'ガラクタ', '不思議な欠片'] },
};

function makeName(c: ItemCategory, e: Element, p: Props, reactions: string[], trait: string | null, h: number): string {
  const sorted = [...PROP_KEYS].sort((a, b) => p[b] - p[a]);
  const adjPool = ADJ[sorted[0]];
  const adj = adjPool[Math.floor(hrand(h, 11) * adjPool.length)];
  const nouns = NOUN[c][e] ?? NOUN[c].default;
  const noun = nouns[Math.floor(hrand(h, 12) * nouns.length)];
  const prefix = trait ? `${trait}` : reactions.includes('蒸気') && hrand(h, 13) < 0.5 ? '蒸気の' : '';
  return `${prefix}${adj}${noun}`;
}

function itemColor(e: Element, p: Props): string {
  switch (e) {
    case 'fire':
      return '#ff6a2b';
    case 'water':
      return '#3f8cff';
    case 'wind':
      return '#8ff0b0';
    case 'thunder':
      return '#ffe14a';
    case 'earth':
      return '#b08a5a';
    default:
      return p.magic > 5 ? '#c49bff' : '#c8c8c8';
  }
}
