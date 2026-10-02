/**
 * The icons that ship with the platform.
 *
 * Every lucide icon, under its own id, plus the platform's own ids from `catalogue.json` -
 * `light`, `relay`, `printer` - each drawn as one of them or shipping a drawing of its own. A
 * shipped id is what a bundle's `defaultIcon` and the interface's own chrome name, so it is
 * listed first and cannot be renamed; re-pointing it in the catalogue file changes every device
 * that uses it.
 *
 * Read from disk once, at start. The lucide files are installed with this package rather than
 * fetched, so the catalogue is there when the internet is not.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { z } from 'zod';

import {
  iconFrameSchema,
  iconIdSchema,
  iconNodeSchema,
  type IconFrame,
  type IconNode,
} from '@nebulahome/contracts';

/** One icon that ships with the platform. */
export type BuiltinIcon = {
  readonly id: string;
  readonly name: string;
  readonly keywords: readonly string[];
  readonly node: IconNode;
  readonly frame: IconFrame;

  /** Whether the platform names it in `catalogue.json`, and so lists it first. */
  readonly isCurated: boolean;
};

/** The box every lucide icon is drawn in. */
const LUCIDE_FRAME: IconFrame = { x: 0, y: 0, size: 24 };

/** One entry of `catalogue.json`: a lucide drawing under the platform's id, or a drawing of its own. */
export const catalogueEntrySchema = z.union([
  z.strictObject({
    id: iconIdSchema,
    name: z.string().trim().min(1).max(64),
    keywords: z.array(z.string().trim().min(1).max(32)).max(20),
    lucide: iconIdSchema,
  }),
  z.strictObject({
    id: iconIdSchema,
    name: z.string().trim().min(1).max(64),
    keywords: z.array(z.string().trim().min(1).max(32)).max(20),
    node: iconNodeSchema.min(1),
    frame: iconFrameSchema,
  }),
]);

/** One entry of `catalogue.json`. */
export type CatalogueEntry = z.output<typeof catalogueEntrySchema>;

const catalogueFileSchema = z.object({ entries: z.array(catalogueEntrySchema) });
const nodesFileSchema = z.record(iconIdSchema, iconNodeSchema);
const tagsFileSchema = z.record(iconIdSchema, z.array(z.string()));

/**
 * Reads and checks one JSON file.
 *
 * @param path - Where it is.
 * @param schema - What it must hold.
 * @returns Its contents.
 */
function readJson<T>(path: string, schema: z.ZodType<T>): T {
  return schema.parse(JSON.parse(readFileSync(path, 'utf8')));
}

/**
 * Names an icon from its id: `triangle-alert` reads as `Triangle alert`.
 *
 * @param id - The lucide id.
 * @returns The name.
 */
export function nameOf(id: string): string {
  const words = id.split('-').join(' ');

  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Finds the lucide files, through this package's own dependency on them.
 *
 * @returns The directory `lucide-static` is installed in.
 */
function lucideDirectory(): string {
  const require = createRequire(import.meta.url);

  return dirname(require.resolve('lucide-static/package.json'));
}

/**
 * Reads the platform's own entries.
 *
 * @returns The entries, in the file's order.
 */
function readCatalogue(): CatalogueEntry[] {
  return readJson(fileURLToPath(new URL('../catalogue.json', import.meta.url)), catalogueFileSchema)
    .entries;
}

/** What loading may be told. */
export type LoadBuiltinIconsOptions = {
  /** The platform's entries, instead of `catalogue.json`. For tests. */
  readonly catalogue?: readonly CatalogueEntry[];
};

/**
 * Loads every icon that ships with the platform: the catalogue's own first, then lucide's.
 *
 * @param options - The entries to use instead of the file, for tests.
 * @returns The icons, curated first, in a stable order.
 * @throws {Error} When a catalogue entry names a lucide icon that does not exist. A bad entry is
 * a mistake in the repository, and the service should fail to start rather than serve a
 * catalogue with a hole where a bundle expects a drawing.
 */
export function loadBuiltinIcons(options: LoadBuiltinIconsOptions = {}): BuiltinIcon[] {
  const directory = lucideDirectory();
  const nodes = readJson(join(directory, 'icon-nodes.json'), nodesFileSchema);
  const tags = readJson(join(directory, 'tags.json'), tagsFileSchema);
  const entries = options.catalogue ?? readCatalogue();

  const curated = entries.map((entry): BuiltinIcon => {
    if ('lucide' in entry) {
      const node = nodes[entry.lucide];

      if (node === undefined) {
        throw new Error(
          `catalogue.json names the lucide icon ${entry.lucide} for ${entry.id}, and there is no such icon`,
        );
      }

      return {
        id: entry.id,
        name: entry.name,
        keywords: entry.keywords,
        node,
        frame: LUCIDE_FRAME,
        isCurated: true,
      };
    }

    return {
      id: entry.id,
      name: entry.name,
      keywords: entry.keywords,
      node: entry.node,
      frame: entry.frame,
      isCurated: true,
    };
  });

  const taken = new Set(curated.map((icon) => icon.id));
  const lucide = Object.entries(nodes)
    .filter(([id]) => !taken.has(id))
    .map(([id, node]): BuiltinIcon => ({
      id,
      name: nameOf(id),
      keywords: tags[id] ?? [],
      node,
      frame: LUCIDE_FRAME,
      isCurated: false,
    }));

  return [...curated, ...lucide];
}
