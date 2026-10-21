// Base materials. Each has numeric properties (0-10) that drive synthesis.

export const PROP_KEYS = ['hardness', 'weight', 'heat', 'water', 'magic', 'elasticity'] as const;
export type PropKey = (typeof PROP_KEYS)[number];
export type Props = Record<PropKey, number>;

export const PROP_LABELS: Record<PropKey, string> = {
  hardness: '硬度',
  weight: '重量',
  heat: '熱',
  water: '水',
  magic: '魔力',
  elasticity: '弾性',
};

export type MaterialId =
  | 'wood'
  | 'stone'
  | 'iron'
  | 'grass'
  | 'mushroom'
  | 'crystal'
  | 'fire_stone'
  | 'water_stone'
  | 'wind_feather'
  | 'slime_core'
  | 'moss_fiber'
  | 'ore_core'
  | 'aqua_gel'
  | 'horn_chip';

export interface MaterialDef {
  id: MaterialId;
  name: string;
  color: string;
  /** Pickup / icon shape. */
  shape: 'log' | 'chunk' | 'ingot' | 'leaf' | 'mushroom' | 'gem' | 'orb' | 'feather' | 'core';
  props: Props;
  description: string;
}

const p = (hardness: number, weight: number, heat: number, water: number, magic: number, elasticity: number): Props => ({
  hardness,
  weight,
  heat,
  water,
  magic,
  elasticity,
});

export const MATERIALS: Record<MaterialId, MaterialDef> = {
  wood: { id: 'wood', name: '木', color: '#a0703c', shape: 'log', props: p(3, 3, 2, 2, 1, 4), description: '木を叩くと手に入る。燃えやすく、しなる。' },
  stone: { id: 'stone', name: '石', color: '#9a9a96', shape: 'chunk', props: p(6, 7, 1, 0, 0, 0), description: 'どこにでもある硬い石。' },
  iron: { id: 'iron', name: '鉄', color: '#7d8ea3', shape: 'ingot', props: p(9, 8, 2, 0, 0, 1), description: '鉱脈の岩から採れる。熱で鍛えると強くなる。' },
  grass: { id: 'grass', name: '草', color: '#6cc04a', shape: 'leaf', props: p(0, 0.5, 1, 5, 2, 6), description: '草むらから採れる。生き物の食料でもある。' },
  mushroom: { id: 'mushroom', name: 'キノコ', color: '#e0503a', shape: 'mushroom', props: p(1, 1, 1, 6, 5, 5), description: '森の日陰に生える。不思議な力を秘める。' },
  crystal: { id: 'crystal', name: '水晶', color: '#7fe8ff', shape: 'gem', props: p(8, 3, 0, 1, 9, 0), description: '洞窟の近くで光る結晶。魔力の塊。' },
  fire_stone: { id: 'fire_stone', name: '炎の石', color: '#ff6a2b', shape: 'orb', props: p(5, 4, 10, 0, 6, 0), description: '触れると熱い。宝箱や岩場で見つかる。' },
  water_stone: { id: 'water_stone', name: '水の石', color: '#3f8cff', shape: 'orb', props: p(4, 4, 0, 10, 6, 1), description: '小川のほとりに転がる、水を湛えた石。' },
  wind_feather: { id: 'wind_feather', name: '風の羽', color: '#e8fff0', shape: 'feather', props: p(0, 0, 2, 1, 7, 8), description: '風に乗って草原に舞い落ちる羽。' },
  slime_core: { id: 'slime_core', name: 'スライムの核', color: '#66d4ff', shape: 'core', props: p(1, 2, 1, 7, 6, 10), description: 'スライムを倒すと残る。ぷにぷにと弾む。' },
  // Phase 2B: dropped by the new species. Ordinary materials: they work in the property-based synthesis.
  moss_fiber: { id: 'moss_fiber', name: '苔の繊維', color: '#6f9e45', shape: 'leaf', props: p(1, 1, 0, 7, 4, 5), description: 'モスリングの体を覆う苔。しっとりと水を含む。' },
  ore_core: { id: 'ore_core', name: '鉱核', color: '#b48a52', shape: 'ingot', props: p(9, 9, 4, 0, 5, 0), description: 'シャードゴーレムを動かしていた重い核。ほのかに温かい。' },
  aqua_gel: { id: 'aqua_gel', name: '水晶ゼリー', color: '#7fe8e0', shape: 'orb', props: p(0, 2, 0, 9, 5, 9), description: 'ドリフトジェリーの透き通った体液。よく弾む。' },
  horn_chip: { id: 'horn_chip', name: '角片', color: '#3a3330', shape: 'gem', props: p(7, 3, 3, 1, 4, 3), description: 'ホーンファングの角の欠片。鋭く、わずかに魔力を帯びる。' },
};

export const MATERIAL_IDS = Object.keys(MATERIALS) as MaterialId[];

export function isMaterialId(id: string): id is MaterialId {
  return id in MATERIALS;
}
