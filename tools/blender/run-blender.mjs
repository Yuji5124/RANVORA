// Runs tools/blender/build_models.py with a local Blender install.
// Set BLENDER_PATH to override the executable location.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const script = path.join(here, 'build_models.py');

const candidates = [
  process.env.BLENDER_PATH,
  'C:/Program Files/Blender Foundation/Blender 4.4/blender.exe',
  'C:/Program Files/Blender Foundation/Blender 4.5/blender.exe',
  'C:/Program Files/Blender Foundation/Blender 4.3/blender.exe',
  '/Applications/Blender.app/Contents/MacOS/Blender',
  'blender',
].filter(Boolean);

const blender = candidates.find((p) => p === 'blender' || existsSync(p));
const extra = process.argv.slice(2);
console.log(`Using Blender: ${blender}`);
const res = spawnSync(blender, ['--background', '--factory-startup', '--python', script, '--', ...extra], {
  stdio: 'inherit',
});
process.exit(res.status ?? 1);
