/**
 * The last step of `pnpm --filter @nebulahome/web-ui build`: the built assets compressed beside
 * themselves, for the proxy to send as they are (`compression.ts`).
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { precompressFolder } from './compression.js';

/** Where the build puts the files named by their content. */
const ASSETS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'assets');

const count = await precompressFolder(ASSETS);

process.stdout.write(`Compressed ${String(count)} asset file(s) ahead of time\n`);
