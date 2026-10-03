/**
 * Writes the JSON Schemas of a bundle's files into `schemas/`, from the build's own zod schemas
 * (src/schemas.ts): `schemas/manifest.schema.json`, `driver`, `setup`, `profile`, `discovery`,
 * `account`. Run after tsdown, by `pnpm build`.
 */
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { BUNDLE_FILE_SCHEMAS, jsonSchemaOf } from '../dist/schemas.js';

const folder = fileURLToPath(new URL('../schemas', import.meta.url));

await rm(folder, { recursive: true, force: true });
await mkdir(folder, { recursive: true });

await Promise.all(
  Object.keys(BUNDLE_FILE_SCHEMAS).map(async (name) =>
    writeFile(
      path.join(folder, `${name}.schema.json`),
      `${JSON.stringify(jsonSchemaOf(name), null, 2)}\n`,
    ),
  ),
);
