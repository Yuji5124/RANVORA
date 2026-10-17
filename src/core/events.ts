// World event log. Every notable change in the simulation is recorded with
// the ids that caused it, so unexpected stories can be investigated later.

export type EventType =
  | 'world_generated'
  | 'birth'
  | 'split'
  | 'death_starvation'
  | 'death_old_age'
  | 'death_predation'
  | 'death_player'
  | 'hunt_start'
  | 'hunt_fail'
  | 'flee'
  | 'migration'
  | 'plant_spread'
  | 'plant_withered'
  | 'plant_burned'
  | 'plant_bloom'
  | 'spawn_pickup'
  | 'mutation'
  | 'population_boom'
  | 'population_crash'
  | 'extinction'
  | 'desperate_hunt'
  | 'giant_slime'
  | 'nightfall'
  | 'daybreak'
  | 'player_attacked'
  | 'player_discovery'
  | 'synthesis';

export interface WorldEvent {
  id: number;
  /** Simulation time in seconds. */
  t: number;
  type: EventType;
  message: string;
  /** Entity that caused the event. */
  actor?: string;
  /** Entity the event happened to. */
  target?: string;
  x?: number;
  z?: number;
  /** Rare events are also saved to the codex. */
  rare?: boolean;
  data?: Record<string, number | string | boolean>;
}

export type EventListener = (e: WorldEvent) => void;

export class EventLog {
  readonly events: WorldEvent[] = [];
  readonly counts = new Map<EventType, number>();
  private nextId = 1;
  private listeners: EventListener[] = [];

  constructor(private readonly capacity = 3000) {}

  push(e: Omit<WorldEvent, 'id'>): WorldEvent {
    const ev: WorldEvent = { id: this.nextId++, ...e };
    this.events.push(ev);
    if (this.events.length > this.capacity) this.events.splice(0, this.events.length - this.capacity);
    this.counts.set(e.type, (this.counts.get(e.type) ?? 0) + 1);
    for (const l of this.listeners) l(ev);
    return ev;
  }

  on(l: EventListener): () => void {
    this.listeners.push(l);
    return () => {
      this.listeners = this.listeners.filter((x) => x !== l);
    };
  }

  count(type: EventType): number {
    return this.counts.get(type) ?? 0;
  }

  /** Events involving an entity id (as actor or target). */
  involving(id: string): WorldEvent[] {
    return this.events.filter((e) => e.actor === id || e.target === id);
  }

  recent(n: number): WorldEvent[] {
    return this.events.slice(-n);
  }
}

export function formatSimTime(t: number): string {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}
