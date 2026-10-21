// Species definitions for the autonomous ecosystem.
//
// Behaviour that used to be written per species inside the simulation
// (who hunts whom, who herds, who flees to the village, how slimes split...)
// is described here as data. The values for slime / deer / wolf reproduce the
// original behaviour exactly, so a world with only those three replays the
// same history as before (see tests/unit/reproducibility.test.ts).
//
// Adding a species = adding an entry here (+ a model). It then lives in the
// same state machine: it eats, flees, hunts, breeds, migrates and dies.

import type { MaterialId } from '../items/materials';

export type Species = 'slime' | 'deer' | 'wolf' | 'mossling' | 'shardgolem' | 'driftjelly' | 'hornfang';

/** Creature/material family. Kept in sync with Lineage in src/progression/lineage.ts. */
export type SpeciesLineage = 'flora' | 'mineral' | 'aqua' | 'beast';

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

/** Where a species likes to live. Spawning, wandering and migration stay near it. */
export type Habitat = 'forest' | 'water' | 'rock';

export interface DropDef {
  id: MaterialId;
  chance: number;
  min: number;
  max: number;
}

export interface SpeciesDef {
  id: Species;
  name: string;
  idPrefix: string;
  lineage: SpeciesLineage;
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
  /** Plant kinds this species eats (grazers). */
  eats: ('grass' | 'berry')[];
  popCap: number;
  initial: number;
  description: string;
  variantName: string;

  // ---- behaviour (data instead of per-species code) ----
  /** 'predator' hunts other creatures; 'grazer' eats plants and flees from predators. */
  role: 'grazer' | 'predator';
  /** Species this predator hunts normally. */
  prey: Species[];
  /** Species it eats only when starving (hunger > 70). */
  preyDesperate: Species[];
  /** Added to the distance when choosing between visible prey (lower = preferred). */
  preyBias: Partial<Record<Species, number>>;
  /** Hunger restored by a normal / a desperate meal. */
  preyFill: number;
  desperateFill: number;
  /** How a grazer notices predators: 'oblivious' only when chased or touching, 'alert' from afar. */
  wariness: 'oblivious' | 'alert';
  /** Fear of the player: a fixed range, or a share of the species' vision. */
  playerFearRange: number;
  playerFearVisionMul?: number;
  /** Active at night: no night vision penalty, hungrier at night. */
  nocturnal: boolean;
  /** Drifts towards its own kind when wandering. */
  herds: boolean;
  /** Keeps out of the village unless starving. */
  avoidsVillage: boolean;
  /** Runs towards the village when fleeing. */
  fleesToVillage: boolean;
  /** Rests when fed and calm. */
  restsWhenFed: boolean;
  /** Bites the player when starving and close. */
  bitesPlayerWhenStarving: boolean;
  /** HP lost per second at full hunger. */
  starveDamage: number;
  /** Hunger restored per unit of plant biomass eaten. */
  biteFill: number;
  /** Seconds without food before migrating. */
  migrateAfter: number;
  wanderRadius: number;
  /** Reproduces by splitting after eating (slime mechanic) instead of mating. */
  splits: boolean;
  breed: { minAge: number; maxHunger: number; cooldown: number };
  /** Spawn group size; 'all' = one group of `initial`. */
  groupSize: number | 'all';
  spawnMinVillageDist: number;
  immigrantGroup: number;
  habitat?: Habitat;
  /** Max distance (tiles) from the habitat for spawning / wandering. */
  habitatRange?: number;
  /** Drops when the player defeats it (new species; slime/deer/wolf keep their original rule). */
  drops?: DropDef[];
  /**
   * Render-side data. key = public/models/<key>.glb (and the modelSpecs.json fallback).
   * The model's size is baked into the GLB (tools/blender/creatures/creatures.json `scale`),
   * so there is no extra scale here. emoteHeight = where the emote bubble floats (tiles).
   * variantTint = colour a rare variant leans towards. Nothing in src/sim/ reads these.
   */
  model: { key: string; emoteHeight: number; minimapColor: string; variantTint: string };
}

const CLASSIC = {
  preyBias: {},
  preyFill: 80,
  desperateFill: 30,
  nocturnal: false,
  avoidsVillage: false,
  fleesToVillage: false,
  restsWhenFed: false,
  bitesPlayerWhenStarving: false,
  starveDamage: 0.22,
  biteFill: 95,
  migrateAfter: 6,
  wanderRadius: 6,
  splits: false,
  spawnMinVillageDist: 10,
  immigrantGroup: 3,
} as const;

export const SPECIES: Record<Species, SpeciesDef> = {
  slime: {
    ...CLASSIC,
    id: 'slime',
    name: 'スライム',
    idPrefix: 'SLM',
    lineage: 'aqua',
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
    role: 'grazer',
    prey: [],
    preyDesperate: [],
    wariness: 'oblivious',
    playerFearRange: 0,
    playerFearVisionMul: 0.7,
    herds: false,
    biteFill: 120,
    migrateAfter: 10,
    wanderRadius: 3,
    splits: true,
    breed: { minAge: 120, maxHunger: 40, cooldown: 200 },
    groupSize: 1,
    model: { key: 'slime', emoteHeight: 0.75, minimapColor: '#5fd0ff', variantTint: '#ffd23f' },
  },
  deer: {
    ...CLASSIC,
    id: 'deer',
    name: 'シカ',
    idPrefix: 'DER',
    lineage: 'beast',
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
    role: 'grazer',
    prey: [],
    preyDesperate: [],
    wariness: 'alert',
    playerFearRange: 3.5,
    herds: true,
    fleesToVillage: true,
    restsWhenFed: true,
    breed: { minAge: 60, maxHunger: 35, cooldown: 90 },
    groupSize: 4,
    model: { key: 'deer', emoteHeight: 1.45, minimapColor: '#ffb35c', variantTint: '#f4f4f4' },
  },
  wolf: {
    ...CLASSIC,
    id: 'wolf',
    name: 'オオカミ',
    idPrefix: 'WLF',
    lineage: 'beast',
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
    role: 'predator',
    prey: ['deer'],
    // Mosslings are new prey for starving wolves; in a classic world there are none, so nothing changes.
    preyDesperate: ['slime', 'mossling'],
    preyBias: { slime: 3, mossling: 2 },
    wariness: 'alert',
    playerFearRange: 0,
    nocturnal: true,
    herds: true,
    avoidsVillage: true,
    bitesPlayerWhenStarving: true,
    starveDamage: 0.1,
    breed: { minAge: 120, maxHunger: 40, cooldown: 200 },
    groupSize: 'all',
    spawnMinVillageDist: 22,
    immigrantGroup: 2,
    model: { key: 'wolf', emoteHeight: 1.15, minimapColor: '#ff5a5a', variantTint: '#d8e4ff' },
  },

  // ---------------------------------------------------------------- Phase 2B
  mossling: {
    ...CLASSIC,
    id: 'mossling',
    name: 'モスリング',
    idPrefix: 'MOS',
    lineage: 'flora',
    maxHp: 4,
    speed: 1.15,
    runMul: 2.0,
    vision: 6,
    hungerRate: 0.9,
    lifespan: 640,
    radius: 0.22,
    eats: ['berry', 'grass'],
    popCap: 20,
    initial: 9,
    description: '苔むした小さな森の住人。木陰で木の実を食べ、群れで暮らす。獣に狙われると森へ逃げ込む。',
    variantName: 'ハナモスリング',
    role: 'grazer',
    prey: [],
    preyDesperate: [],
    wariness: 'alert',
    playerFearRange: 3,
    herds: true,
    biteFill: 105,
    migrateAfter: 8,
    wanderRadius: 4,
    breed: { minAge: 50, maxHunger: 40, cooldown: 80 },
    groupSize: 3,
    habitat: 'forest',
    habitatRange: 3,
    drops: [
      { id: 'moss_fiber', chance: 1, min: 1, max: 2 },
      { id: 'mushroom', chance: 0.2, min: 1, max: 1 },
    ],
    model: { key: 'mossling', emoteHeight: 0.8, minimapColor: '#7fd36a', variantTint: '#e6a8ff' },
  },
  shardgolem: {
    ...CLASSIC,
    id: 'shardgolem',
    name: 'シャードゴーレム',
    idPrefix: 'GLM',
    lineage: 'mineral',
    maxHp: 16,
    speed: 0.55,
    runMul: 1.3,
    vision: 5,
    hungerRate: 0.18,
    lifespan: 1800,
    radius: 0.36,
    eats: ['grass'],
    popCap: 5,
    initial: 3,
    description: '結晶を背負った岩の番人。つがいで岩場の苔をゆっくり食む。何者も恐れず、長く生きる。',
    variantName: 'アカシャードゴーレム',
    role: 'grazer',
    prey: [],
    preyDesperate: [],
    wariness: 'alert',
    playerFearRange: 0,
    // Lives in pairs: herding keeps a pair within mating range of each other.
    herds: true,
    starveDamage: 0.05,
    biteFill: 160,
    migrateAfter: 20,
    wanderRadius: 4,
    breed: { minAge: 300, maxHunger: 45, cooldown: 420 },
    groupSize: 2,
    immigrantGroup: 2,
    habitat: 'rock',
    habitatRange: 4,
    drops: [
      { id: 'ore_core', chance: 1, min: 1, max: 1 },
      { id: 'crystal', chance: 0.5, min: 1, max: 1 },
      { id: 'stone', chance: 1, min: 1, max: 2 },
    ],
    model: { key: 'shardgolem', emoteHeight: 1.6, minimapColor: '#c9a46a', variantTint: '#9ff7ff' },
  },
  driftjelly: {
    ...CLASSIC,
    id: 'driftjelly',
    name: 'ドリフトジェリー',
    idPrefix: 'JLY',
    lineage: 'aqua',
    maxHp: 3,
    speed: 0.85,
    runMul: 1.5,
    vision: 5,
    hungerRate: 0.8,
    lifespan: 480,
    radius: 0.24,
    eats: ['grass'],
    popCap: 18,
    initial: 8,
    description: '小川のほとりを漂うクラゲ。水辺の草を食べ、増えやすい。近くに来るまで危険に気づかない。',
    variantName: 'ヨイヤミジェリー',
    role: 'grazer',
    prey: [],
    preyDesperate: [],
    wariness: 'oblivious',
    playerFearRange: 0,
    playerFearVisionMul: 0.5,
    herds: false,
    biteFill: 110,
    migrateAfter: 10,
    wanderRadius: 3,
    breed: { minAge: 40, maxHunger: 45, cooldown: 60 },
    groupSize: 4,
    habitat: 'water',
    habitatRange: 3,
    drops: [
      { id: 'aqua_gel', chance: 1, min: 1, max: 2 },
      { id: 'water_stone', chance: 0.15, min: 1, max: 1 },
    ],
    model: { key: 'driftjelly', emoteHeight: 1.05, minimapColor: '#5ff2e2', variantTint: '#ff9de0' },
  },
  hornfang: {
    ...CLASSIC,
    id: 'hornfang',
    name: 'ホーンファング',
    idPrefix: 'HRN',
    lineage: 'beast',
    maxHp: 8,
    speed: 1.9,
    runMul: 2.4,
    vision: 8,
    hungerRate: 0.6,
    lifespan: 820,
    radius: 0.3,
    eats: [],
    popCap: 6,
    initial: 2,
    description: '一本角の獣。昼に狩りをし、水辺のクラゲと森のモスリングを追う。飢えるとシカにも挑む。',
    variantName: 'ツキノツノ',
    role: 'predator',
    prey: ['driftjelly', 'mossling'],
    preyDesperate: ['deer', 'slime'],
    preyBias: { mossling: 1, deer: 2, slime: 3 },
    preyFill: 70,
    desperateFill: 40,
    wariness: 'alert',
    playerFearRange: 0,
    nocturnal: false,
    herds: true,
    avoidsVillage: true,
    bitesPlayerWhenStarving: true,
    starveDamage: 0.12,
    breed: { minAge: 140, maxHunger: 40, cooldown: 220 },
    groupSize: 'all',
    spawnMinVillageDist: 18,
    immigrantGroup: 2,
    drops: [
      { id: 'horn_chip', chance: 1, min: 1, max: 1 },
      { id: 'wind_feather', chance: 0.3, min: 1, max: 1 },
    ],
    model: { key: 'hornfang', emoteHeight: 1.1, minimapColor: '#e0705a', variantTint: '#f4f4f4' },
  },
};

export const SPECIES_IDS = Object.keys(SPECIES) as Species[];
/** The original three. A world with only these replays the pre-Phase-2B history exactly. */
export const CLASSIC_SPECIES: Species[] = ['slime', 'deer', 'wolf'];
/** Phase 2B species. */
export const NEW_SPECIES: Species[] = ['mossling', 'shardgolem', 'driftjelly', 'hornfang'];

/** True when `predator` hunts `prey` (normally or only when starving). */
export function isPredatorOf(predator: Species, prey: Species): boolean {
  const d = SPECIES[predator];
  return d.prey.includes(prey) || d.preyDesperate.includes(prey);
}
