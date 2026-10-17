// Species definitions for the autonomous ecosystem.

export type Species = 'slime' | 'deer' | 'wolf';

export type CreatureState =
  | 'wander'
  | 'idle'
  | 'seek_food'
  | 'eat'
  | 'flee'
  | 'rest'
  | 'hunt'
  | 'chase'
  | 'migrate'
  | 'dead';

export const STATE_LABELS: Record<CreatureState, string> = {
  wander: '散策',
  idle: '待機',
  seek_food: '食料探し',
  eat: '食事',
  flee: '逃走',
  rest: '休息',
  hunt: '狩り',
  chase: '追跡',
  migrate: '移住',
  dead: '死亡',
};

export interface SpeciesDef {
  id: Species;
  name: string;
  idPrefix: string;
  maxHp: number;
  /** Walking speed (tiles/s). */
  speed: number;
  /** Running speed multiplier when fleeing / chasing. */
  runMul: number;
  vision: number;
  /** Hunger gained per second (0..100 scale). */
  hungerRate: number;
  lifespan: number;
  radius: number;
  /** Plant kinds this species eats. */
  eats: ('grass' | 'berry')[];
  popCap: number;
  initial: number;
  description: string;
  variantName: string;
}

export const SPECIES: Record<Species, SpeciesDef> = {
  slime: {
    id: 'slime',
    name: 'スライム',
    idPrefix: 'SLM',
    maxHp: 3,
    speed: 1.0,
    runMul: 1.7,
    vision: 5,
    hungerRate: 1.1,
    lifespan: 520,
    radius: 0.22,
    eats: ['grass'],
    popCap: 30,
    initial: 14,
    description: 'ぷるぷる跳ねる。草を食べて大きくなると分裂する。危険からは逃げる。',
    variantName: 'ゴールドスライム',
  },
  deer: {
    id: 'deer',
    name: 'シカ',
    idPrefix: 'DER',
    maxHp: 6,
    speed: 1.6,
    runMul: 2.3,
    vision: 7,
    hungerRate: 0.95,
    lifespan: 760,
    radius: 0.3,
    eats: ['grass', 'berry'],
    popCap: 26,
    initial: 10,
    description: '草食動物。食べ物を探し、捕食者を避け、安全な場所で休む。',
    variantName: 'シロシカ',
  },
  wolf: {
    id: 'wolf',
    name: 'オオカミ',
    idPrefix: 'WLF',
    maxHp: 10,
    speed: 1.7,
    runMul: 2.6,
    vision: 9,
    hungerRate: 0.55,
    lifespan: 900,
    radius: 0.3,
    eats: [],
    popCap: 7,
    initial: 3,
    description: '捕食者。空腹になると草食動物を探して追いかける。食後は休む。村には近づきたがらない。',
    variantName: 'ギンロウ',
  },
};

export const SPECIES_IDS = Object.keys(SPECIES) as Species[];
