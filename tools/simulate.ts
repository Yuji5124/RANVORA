// Headless research run: `npm run sim -- <seed> <minutes>`
// Prints population over time and the rare events that occurred.
import { generateWorld } from '../src/world/generator';
import { Simulation } from '../src/sim/simulation';
import { formatSimTime } from '../src/core/events';
import { normalizeSeed } from '../src/core/rng';

const seed = normalizeSeed(process.argv[2] ?? '12345');
const minutes = Number(process.argv[3] ?? 20);
const t0 = performance.now();
const world = generateWorld(seed);
const sim = new Simulation(world);
const ticks = minutes * 600;
for (let i = 0; i < ticks; i++) {
  sim.step();
  if (i % 600 === 0) {
    console.log(
      `${formatSimTime(sim.time).padStart(6)}  slime ${String(sim.count('slime')).padStart(3)}  deer ${String(sim.count('deer')).padStart(3)}  wolf ${String(sim.count('wolf')).padStart(3)}  plants ${sim.aliveplants()}`,
    );
  }
}
const ms = performance.now() - t0;
console.log(`\nseed=${seed} simulated ${minutes} min in ${ms.toFixed(0)} ms, fingerprint=${sim.fingerprint()}`);
const counts = [...sim.events.counts.entries()].map(([k, v]) => `${k}:${v}`).join('  ');
console.log(counts);
console.log('\nRare events:');
for (const e of sim.events.events.filter((e) => e.rare)) console.log(`  [${formatSimTime(e.t)}] ${e.message}`);
const deaths: Record<string, number> = {};
for (const e of sim.events.events) {
  if (e.type.startsWith('death_') && e.target) {
    const k = `${e.type}:${e.target.slice(0, 3)}`;
    deaths[k] = (deaths[k] ?? 0) + 1;
  }
}
console.log('\nDeaths:', deaths);
