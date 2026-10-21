/**
 * The manifest every package ships: `nebula.package.json`, at the root of its release.
 *
 * A package is what an installation adds to itself - a broker, a recorder, a 3D view of the house
 * - released from a repository of its own (`nebulahome/pkg-<id>`) on its own schedule. The
 * manifest says what it is and what it brings, in the parts the platform must know **before** the
 * package runs: the store lists it, the dashboard editor offers its cards, the supervisor runs its
 * containers, and a package or an integration that depends on another is refused or held until
 * that one is there. What it does at run time - its devices, its entities, the methods its pages
 * call - it registers when it starts, over the bus (ARCHITECTURE.md 9).
 *
 * - **`runtime`** is how its code runs: `node`, a process the packet-manager starts from `server`;
 *   `container`, the containers it declares and nothing else; `none`, pages and cards alone.
 * - **`ui`** is what it adds to the interface: a page of its own, cards for the dashboard, views
 *   for its own kinds of entity - one ES module, served same-origin and loaded on demand.
 * - **`requires`** and **`provides`** are its dependencies: packages by id and version range, and
 *   services by name - `object-detection` - that whichever package provides them satisfies, or
 *   that the platform runs itself (`mqtt-broker`). A vendor's `manifest.json` writes `requires`
 *   the same way.
 * - **`entityTypes`** are kinds of entity no capability describes - a recording, a playlist - with
 *   the fields of their state and the commands they take; an entity of one has the `custom`
 *   capability, and the package's `entityViews` draw it.
 *
 * Every package is first-party at this stage, so there is no `permissions` field: signing and
 * permission grants arrive with the Community Hub's vendor channel (ARCHITECTURE.md 10).
 */
import { z } from 'zod';

import { containerDependenciesSchema } from './container-dependencies.js';
import { iconIdSchema } from './icons.js';
import { setupFieldSchema } from './integration-setup.js';
import { packageIdSchema } from './package-id.js';
import { packageRequiresSchema, packageServiceNameSchema } from './package-requires.js';
import { semverRangeSchema, semverSchema } from './semver.js';

export { SEMVER_PATTERN } from './semver.js';
export { PACKAGE_ID_PATTERN, packageIdSchema } from './package-id.js';

/** How a package's code runs. */
export const PACKAGE_RUNTIMES = ['node', 'container', 'none'] as const;

/** How a package's code runs. */
export type PackageRuntime = (typeof PACKAGE_RUNTIMES)[number];

/** The lifecycle states `packet-manager` records for an installed package. */
export const PACKAGE_STATES = [
  'installed',
  'starting',
  'running',
  'stopped',
  'failed',
  'disabled',
  'waiting-dependency',
] as const;

/** The lifecycle state of an installed package. */
export type PackageState = (typeof PACKAGE_STATES)[number];

/**
 * Where an installed package came from: a release of the package index (`index`), or a file of
 * the platform's local folder (`local`), which is how a package is tried before it is released.
 */
export const PACKAGE_SOURCES = ['index', 'local'] as const;

/** Where an installed package came from. */
export type PackageSource = (typeof PACKAGE_SOURCES)[number];

/** What the store files a package under. */
export const PACKAGE_CATEGORIES = [
  'protocol',
  'media',
  'security',
  'energy',
  'climate',
  'visualisation',
  'automation',
  'other',
] as const;

/** What the store files a package under. */
export type PackageCategory = (typeof PACKAGE_CATEGORIES)[number];

/** A file of the package's release, relative to its root: `./ui/index.js`. */
export const packagePathSchema = z
  .string()
  .max(256)
  .regex(/^\.\/[A-Za-z0-9._/-]+$/, 'Must be a path inside the package, starting with ./')
  .refine((value) => !value.split('/').includes('..'), 'Must stay inside the package');

/** How a package's card fills its frame: inside the frame's padding, or to its edges. */
export const PACKAGE_CARD_PADDINGS = ['default', 'none'] as const;

/** How a package's card fills its frame. */
export type PackageCardPadding = (typeof PACKAGE_CARD_PADDINGS)[number];

/** The sizes a package's card may take on the dashboard's grid. */
export const PACKAGE_CARD_SIZES = ['small', 'medium', 'large', 'wide'] as const;

/** A size a package's card may take. */
export type PackageCardSize = (typeof PACKAGE_CARD_SIZES)[number];

/** A short identifier inside a package: a card's, an entity type's, a command's. */
const localIdSchema = z.string().regex(/^[a-z][a-z0-9_-]{0,31}$/, 'Must be a short lower-case id');

/** A card a package adds to the dashboard editor's list. */
export const packageCardSchema = z.strictObject({
  id: localIdSchema,
  name: z.string().min(1).max(64),
  description: z.string().max(256).optional(),
  icon: iconIdSchema,

  /** The sizes it can be drawn at; the first is what it is added at. */
  sizes: z.array(z.enum(PACKAGE_CARD_SIZES)).min(1).max(4).default(['medium']),

  /** What the card's inspector asks, in the setup grammar: the card's own options. */
  options: z.array(setupFieldSchema).max(16).default([]),

  /** `none` draws the card to its frame's edges: an image, a map, a canvas. */
  padding: z.enum(PACKAGE_CARD_PADDINGS).default('default'),
});

/** A card a package adds to the dashboard. */
export type PackageCard = z.output<typeof packageCardSchema>;

/** The kinds of value a field of a package's entity type holds. */
export const PACKAGE_FIELD_TYPES = ['text', 'number', 'boolean', 'choice', 'timestamp'] as const;

/** One field of a package's entity type: part of its state, or an argument of a command. */
export const packageEntityFieldSchema = z
  .strictObject({
    key: z.string().regex(/^[a-z][a-zA-Z0-9]{0,31}$/, 'Must be a camelCase key'),
    type: z.enum(PACKAGE_FIELD_TYPES),
    label: z.string().min(1).max(64),

    /** For a number: what it is counted in. */
    unit: z.string().min(1).max(16).optional(),

    /** For a choice: the values it may take. */
    choices: z
      .array(z.strictObject({ value: z.string().min(1).max(64), label: z.string().min(1).max(64) }))
      .min(1)
      .max(64)
      .optional(),

    /** Whether it may be missing; required when not said. */
    isOptional: z.boolean().default(false),
  })
  .superRefine((field, context) => {
    if (field.type === 'choice' && field.choices === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['choices'],
        message: 'A choice lists its choices',
      });
    }

    if (field.type !== 'choice' && field.choices !== undefined) {
      context.addIssue({ code: 'custom', path: ['choices'], message: 'Only a choice has choices' });
    }

    if (field.type !== 'number' && field.unit !== undefined) {
      context.addIssue({ code: 'custom', path: ['unit'], message: 'Only a number has a unit' });
    }
  });

/** One field of a package's entity type. */
export type PackageEntityField = z.output<typeof packageEntityFieldSchema>;

/**
 * A kind of entity a package defines, which no capability describes: what its state holds and
 * which commands it takes. An entity of one has the `custom` capability, `{ packageId, type }`.
 */
export const packageEntityTypeSchema = z
  .strictObject({
    id: localIdSchema,
    name: z.string().min(1).max(64),
    icon: iconIdSchema,
    state: z.array(packageEntityFieldSchema).min(1).max(32),
    commands: z
      .array(
        z.strictObject({
          id: localIdSchema,
          name: z.string().min(1).max(64),
          fields: z.array(packageEntityFieldSchema).max(8).default([]),
        }),
      )
      .max(16)
      .default([]),
  })
  .superRefine((type, context) => {
    duplicates(type.state.map((field) => field.key)).forEach((key) => {
      context.addIssue({ code: 'custom', path: ['state'], message: `${key} is there twice` });
    });
    duplicates(type.commands.map((command) => command.id)).forEach((id) => {
      context.addIssue({ code: 'custom', path: ['commands'], message: `${id} is there twice` });
    });
  });

/** A kind of entity a package defines. */
export type PackageEntityType = z.output<typeof packageEntityTypeSchema>;

/** What a package adds to the interface. */
export const packageUiSchema = z.strictObject({
  /** The ES module the interface loads, built by `@nebulahome/package-sdk/vite`. */
  entry: packagePathSchema,

  /** Its stylesheet, when it has one. */
  styles: packagePathSchema.optional(),

  /** Whether it has a page of its own, opened from the package's page in the interface. */
  page: z.boolean().default(false),

  /**
   * An entry of its page in the interface's sidebar, while it runs: what it says - the package's
   * name when not given - and its icon - the package's logo when not given.
   */
  sidebar: z
    .strictObject({
      label: z.string().min(1).max(32).optional(),
      icon: iconIdSchema.optional(),
    })
    .optional(),

  /** The cards it adds to the dashboard editor. */
  cards: z.array(packageCardSchema).max(16).default([]),

  /** Which of its entity types it draws itself, on an entity's page. */
  entityViews: z.array(localIdSchema).max(16).default([]),
});

/** What a package adds to the interface. */
export type PackageUi = z.output<typeof packageUiSchema>;

/**
 * The words that appear more than once in a list.
 *
 * @param values - The list.
 * @returns Each repeated word, once.
 */
function duplicates(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const repeated = new Set<string>();

  for (const value of values) {
    if (seen.has(value)) {
      repeated.add(value);
    }

    seen.add(value);
  }

  return [...repeated];
}

/** The contents of `nebula.package.json`. */
export const packageManifestSchema = z
  .strictObject({
    id: packageIdSchema,
    version: semverSchema,

    /** The platform versions it works with: checked before it is installed or started. */
    platform: semverRangeSchema,

    /** The package SDK versions it was written against: `@nebulahome/package-sdk`. */
    sdk: semverRangeSchema,

    name: z.string().min(1).max(64),
    description: z.string().min(1).max(512),

    /** Its repository on GitHub, `owner/name`: where its releases are. */
    repository: z
      .string()
      .regex(/^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/, 'Must be owner/name on GitHub')
      .optional(),

    /** Its home page. */
    url: z.url().max(512).optional(),

    /** The colour of its card in the store, `#RRGGBB`. */
    color: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .optional(),

    logo: z
      .strictObject({ path: packagePathSchema, padding: z.int().min(0).max(16).optional() })
      .optional(),

    category: z.enum(PACKAGE_CATEGORIES),
    runtime: z.enum(PACKAGE_RUNTIMES),

    /** For `node`: the module the packet-manager runs, whose default export is `defineServer`. */
    server: z.strictObject({ entry: packagePathSchema }).optional(),

    ui: packageUiSchema.optional(),

    /** What configuring it asks, in the setup grammar of a vendor's `setup.json`. */
    setup: packagePathSchema.optional(),

    /** The containers it runs, in the grammar a vendor declares them in. */
    containers: containerDependenciesSchema,

    /**
     * A compose file it runs instead of declared containers: the supervisor runs it as a project
     * of its own, under the platform's rules (PACKAGES.md 7).
     */
    compose: z.strictObject({ file: packagePathSchema }).optional(),

    requires: packageRequiresSchema,

    /** The services it provides, which a vendor or another package may require by name. */
    provides: z.array(packageServiceNameSchema).max(16).default([]),

    entityTypes: z.array(packageEntityTypeSchema).max(16).default([]),
  })
  .superRefine((manifest, context) => {
    /**
     * Records a problem.
     *
     * @param path - Where.
     * @param message - What.
     */
    const problem = (path: (string | number)[], message: string): void => {
      context.addIssue({ code: 'custom', path, message });
    };

    if (manifest.runtime === 'node' && manifest.server === undefined) {
      problem(['server'], 'A node package names the module it runs');
    }

    if (manifest.runtime !== 'node' && manifest.server !== undefined) {
      problem(['server'], `A ${manifest.runtime} package runs no module of its own`);
    }

    if (
      manifest.runtime === 'container' &&
      manifest.containers.length === 0 &&
      manifest.compose === undefined
    ) {
      problem(['containers'], 'A container package declares its containers or a compose file');
    }

    if (manifest.runtime === 'none' && manifest.containers.length > 0) {
      problem(['containers'], 'A package that runs nothing declares no containers');
    }

    if (manifest.runtime === 'none' && manifest.compose !== undefined) {
      problem(['compose'], 'A package that runs nothing has no compose file');
    }

    if (manifest.compose !== undefined && manifest.containers.length > 0) {
      problem(['compose'], 'A package declares containers or a compose file, not both');
    }

    if (manifest.ui?.sidebar !== undefined && !manifest.ui.page) {
      problem(['ui', 'sidebar'], 'Only a package with a page of its own has an entry for it');
    }

    if (manifest.runtime === 'none' && manifest.ui === undefined) {
      problem(['ui'], 'A package that runs nothing adds something to the interface');
    }

    if (manifest.id in manifest.requires.packages) {
      problem(['requires', 'packages'], 'A package does not require itself');
    }

    const provided = new Set(manifest.provides);

    for (const service of manifest.requires.services) {
      if (provided.has(service)) {
        problem(['requires', 'services'], `${service} is provided by the package itself`);
      }
    }

    duplicates(manifest.provides).forEach((service) => {
      problem(['provides'], `${service} is there twice`);
    });
    duplicates(manifest.entityTypes.map((type) => type.id)).forEach((id) => {
      problem(['entityTypes'], `${id} is there twice`);
    });

    const types = new Set(manifest.entityTypes.map((type) => type.id));

    for (const [index, view] of (manifest.ui?.entityViews ?? []).entries()) {
      if (!types.has(view)) {
        problem(['ui', 'entityViews', index], `${view} is not one of the package's entity types`);
      }
    }

    duplicates((manifest.ui?.cards ?? []).map((card) => card.id)).forEach((id) => {
      problem(['ui', 'cards'], `${id} is there twice`);
    });
  });

/** The contents of `nebula.package.json`. */
export type PackageManifest = z.output<typeof packageManifestSchema>;

/** A route a running package asks `proxy` to forward to it. */
export const packageRouteSchema = z.object({
  /** The path prefix this package serves, such as `/nvr`. */
  pathPrefix: z
    .string()
    .regex(/^\/[a-z0-9/_-]*$/, 'Must be a lower-case path prefix')
    .refine((prefix) => !/^\/(api|health|ready)(\/|$)/.test(prefix), {
      message: 'Reserved prefix: /api, /health and /ready belong to the platform',
    }),

  /** Where `proxy` forwards matching requests. */
  upstream: z.string().min(1).max(512),

  /** Whether the prefix is removed before forwarding. */
  hasStrippedPrefix: z.boolean().default(true),

  /** A permission the caller must hold, checked by `proxy` before forwarding. */
  requiresPermission: z.string().max(128).optional(),

  /** Whether this route carries WebSocket upgrades. */
  isWebsocket: z.boolean().default(false),
});

/** A route a running package asks `proxy` to forward to it. */
export type PackageRoute = z.output<typeof packageRouteSchema>;
