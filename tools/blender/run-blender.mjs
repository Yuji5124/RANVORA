// Runs a tools/blender script with a local Blender install (default build_models.py).
//   node tools/blender/run-blender.mjs                       -> build_models.py (static models)
//   node tools/blender/run-blender.mjs build_creatures.py -- --only hornfang
// Set BLENDER_PATH to override the executable location.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));

const candidates = [
  process.env.BLENDER_PATH,
  'C:/Program Files/Blender Foundation/Blender 4.4/blender.exe',
  'C:/Program Files/Blender Foundation/Blender 4.5/blender.exe',
  'C:/Program Files/Blender Foundation/Blender 4.3/blender.exe',
  '/Applications/Blender.app/Contents/MacOS/Blender',
  'blender',
].filter(Boolean);

const blender = candidates.find((p) => p === 'blender' || existsSync(p));
const argv = process.argv.slice(2);
const name = argv[0]?.endsWith('.py') ? argv.shift() : 'build_models.py';
if (argv[0] === '--') argv.shift();
const script = path.join(here, name);
if (!existsSync(script)) {
  console.error(`No such Blender script: tools/blender/${name}`);
  process.exit(1);
}
const extra = argv;
console.log(`Using Blender: ${blender}  (${name})`);
const res = spawnSync(blender, ['--background', '--factory-startup', '--python', script, '--', ...extra], {
  stdio: 'inherit',
});
process.exit(res.status ?? 1);
