/**
 * The JSON Schemas of a bundle's files, for an editor: `src/manifest.json` and the others carry a
 * `$schema` pointing at them, and are checked and completed as they are typed.
 *
 * Generated at build from the zod schemas `hub` reads the files with - the same ones `validate`
 * runs - into `schemas/<file>.schema.json`. A JSON Schema says less than zod - a refinement, a
 * check across files - so a file the editor accepts may still be refused by `validate`; never the
 * other way round. The manifest's is the sources': without `version` and `sdk`, which the build
 * writes, and without what the catalogue stamps.
 */
import { z } from 'zod';

import { integrationSetupSchema, modbusTemplateSchema } from '@nebulahome/contracts';
import {
  accountDeclarationSchema,
  driverManifestSchema,
  integrationProfileSchema,
  vendorDiscoverySchema,
  vendorManifestSchema,
} from '@nebulahome/package-runtime';

/** Each file's schema, by the name its JSON Schema is written under. */
export const BUNDLE_FILE_SCHEMAS = {
  manifest: vendorManifestSchema.omit({
    version: true,
    sdk: true,
    integrity: true,
    signature: true,
  }),
  driver: driverManifestSchema,
  setup: integrationSetupSchema,
  profile: integrationProfileSchema,
  discovery: vendorDiscoverySchema,
  account: accountDeclarationSchema,
  'modbus-template': modbusTemplateSchema,
} as const;

/** The names of the files a JSON Schema is written for. */
export type BundleFileName = keyof typeof BUNDLE_FILE_SCHEMAS;

/**
 * One file's JSON Schema, with room for the `$schema` that points at it.
 *
 * @param name - The file.
 * @returns The JSON Schema.
 */
export function jsonSchemaOf(name: BundleFileName): Record<string, unknown> {
  const json = z.toJSONSchema(BUNDLE_FILE_SCHEMAS[name], {
    io: 'input',
    unrepresentable: 'any',
  }) as Record<string, unknown>;
  const properties = json['properties'];

  return {
    ...json,
    title: `NebulaHome integration: ${name}.json`,
    ...(properties !== null && typeof properties === 'object'
      ? {
          properties: {
            $schema: {
              type: 'string',
              description: 'The JSON Schema an editor checks the file with.',
            },
            ...properties,
          },
        }
      : {}),
  };
}
