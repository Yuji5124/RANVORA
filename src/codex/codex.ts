// The codex (図鑑): what the player has discovered, saved in localStorage.

export type CodexKind = 'creature' | 'material' | 'item' | 'event';

export interface CodexEntry {
  key: string;
  kind: CodexKind;
  name: string;
  /** ISO date-time of first discovery. */
  discoveredAt: string;
  seed: number;
  count: number;
  data: Record<string, unknown>;
}

const STORAGE_KEY = 'ranvora.codex.v1';
const MAX_EVENTS = 150;

export class Codex {
  entries: Record<string, CodexEntry> = {};
  private listeners: ((e: CodexEntry, isNew: boolean) => void)[] = [];

  constructor(private storage: Storage | null = safeStorage()) {
    this.load();
  }

  load() {
    try {
      const raw = this.storage?.getItem(STORAGE_KEY);
      if (raw) this.entries = JSON.parse(raw);
    } catch {
      this.entries = {};
    }
  }

  save() {
    try {
      this.storage?.setItem(STORAGE_KEY, JSON.stringify(this.entries));
    } catch {
      // Storage full or unavailable: keep the in-memory codex.
    }
  }

  onChange(fn: (e: CodexEntry, isNew: boolean) => void) {
    this.listeners.push(fn);
  }

  has(key: string) {
    return key in this.entries;
  }

  /** Records a discovery. Returns true when it is new. */
  record(kind: CodexKind, key: string, name: string, seed: number, data: Record<string, unknown> = {}): boolean {
    const full = `${kind}:${key}`;
    const existing = this.entries[full];
    if (existing) {
      existing.count++;
      this.save();
      for (const l of this.listeners) l(existing, false);
      return false;
    }
    const entry: CodexEntry = { key: full, kind, name, discoveredAt: new Date().toISOString(), seed, count: 1, data };
    this.entries[full] = entry;
    if (kind === 'event') this.trimEvents();
    this.save();
    for (const l of this.listeners) l(entry, true);
    return true;
  }

  list(kind: CodexKind): CodexEntry[] {
    return Object.values(this.entries)
      .filter((e) => e.kind === kind)
      .sort((a, b) => a.discoveredAt.localeCompare(b.discoveredAt));
  }

  private trimEvents() {
    const events = this.list('event');
    for (let i = 0; i < events.length - MAX_EVENTS; i++) delete this.entries[events[i].key];
  }

  clear() {
    this.entries = {};
    this.save();
  }
}

function safeStorage(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}
