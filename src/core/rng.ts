// Deterministic random number utilities.
// Every system gets its own stream derived from the world seed, so adding
// randomness in one system never shifts the results of another.

/** 32-bit FNV-1a hash of a string. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Mix several integers into one well-distributed 32-bit hash. */
export function hashInts(...values: number[]): number {
  let h = 0x9e3779b9;
  for (const v of values) {
    h ^= Math.imul((v | 0) ^ (v >>> 16), 0x85ebca6b);
    h = Math.imul((h << 13) | (h >>> 19), 5) + 0xe6546b64;
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Normalises a user-facing seed (number or text) to uint32. */
export function normalizeSeed(seed: string | number): number {
  if (typeof seed === 'number' && Number.isFinite(seed)) return seed >>> 0;
  const s = String(seed).trim();
  if (/^\d+$/.test(s)) return Number(s) >>> 0;
  return hashString(s);
}

export class Rng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0 || 0x6d2b79f5;
  }

  /** Derive an independent child stream, e.g. rng.fork('plants'). */
  static stream(seed: number, name: string): Rng {
    return new Rng(hashInts(seed, hashString(name)));
  }

  getState(): number {
    return this.state;
  }

  /** Mulberry32: float in [0, 1). */
  next(): number {
    let t = (this.state = (this.state + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  int(min: number, maxInclusive: number): number {
    return min + Math.floor(this.next() * (maxInclusive - min + 1));
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)];
  }

  /** Roughly normal distribution (sum of uniforms). */
  gauss(mean = 0, sd = 1): number {
    return mean + sd * (this.next() + this.next() + this.next() - 1.5) * 2;
  }

  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }
}

/** A stable, short, human-readable id such as "ITM-3F9A2C". */
export function shortId(prefix: string, hash: number): string {
  return `${prefix}-${(hash >>> 0).toString(16).toUpperCase().padStart(8, '0').slice(0, 6)}`;
}
