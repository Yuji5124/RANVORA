// npm run models:check — validates public/models/*.glb (see validate.ts).
import { runCli } from './validate';

process.exit(await runCli());
