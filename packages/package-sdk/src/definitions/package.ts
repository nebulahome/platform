/**
 * `definePackage`: the package, whole - what `nebula.config.ts` default-exports, and what the
 * build writes `nebula.package.json` and `setup.json` from (PACKAGES_DOCS.md 4.1).
 */
import type { Loader } from '../props.js';

import type { CardPropsFor, EntityViewPropsFor } from './bound-props.js';
import type { CardDefinition } from './card.js';
import type { ComposeDefinition, ContainerDefinition } from './containers.js';
import type { EntityTypeDefinition } from './entity-type.js';
import type { PageDefinition } from './page.js';
import type { SettingsDefinition } from './settings.js';

/** What the store files a package under. */
export type PackageCategory =
  | 'protocol'
  | 'media'
  | 'security'
  | 'energy'
  | 'climate'
  | 'visualisation'
  | 'automation'
  | 'other';

/** What a package needs besides itself. */
export type PackageRequires = {
  /** The platform, by npm range. */
  readonly platform?: string;

  /** Packages, by id and range. */
  readonly packages?: Readonly<Record<string, string>>;

  /** Services, by name, whoever provides them. */
  readonly services?: readonly string[];
};

/** The components a package draws, bound to what it declares. */
export type PackageUi<
  TCards extends readonly CardDefinition[],
  TTypes extends readonly EntityTypeDefinition[],
> = {
  /** Its own page. */
  readonly page?: PageDefinition;

  /** A component for every declared card, by its id. */
  readonly cards?: {
    readonly [TId in TCards[number]['id']]: Loader<CardPropsFor<TCards, TId>>;
  };

  /** Views of the entity types it draws itself, by their ids. */
  readonly entityViews?: {
    readonly [TId in TTypes[number]['id']]?: Loader<EntityViewPropsFor<TTypes, TId>>;
  };
};

/** What every package says, whatever it runs. */
type PackageBase<
  TCards extends readonly CardDefinition[],
  TTypes extends readonly EntityTypeDefinition[],
> = {
  /** `^[a-z][a-z0-9-]{1,63}$`, not one of the platform's names. */
  readonly id: string;

  readonly name: string;
  readonly description: string;
  readonly category: PackageCategory;

  /** The NebulaHome versions it works with, as an npm range: `^1.4.0`. */
  readonly platform: string;

  /** Its colour in the store, `#RRGGBB`. */
  readonly color?: `#${string}`;

  /** A file next to the config: `./logo.svg`. */
  readonly logo?: string | { readonly path: string; readonly padding?: number };

  readonly url?: string;

  /** `owner/name` on GitHub; read from `package.json` when not given. */
  readonly repository?: string;

  /** The server's entry module, next to the config: `./src/server/index.ts`. */
  readonly server?: string;

  readonly settings?: SettingsDefinition;
  readonly cards?: TCards;
  readonly entityTypes?: TTypes;
  readonly requires?: PackageRequires;
  readonly provides?: readonly string[];
  readonly ui?: PackageUi<TCards, TTypes>;
};

/** What `definePackage` takes: declared containers, or a compose file, or neither. */
export type PackageConfig<
  TCards extends readonly CardDefinition[] = readonly CardDefinition[],
  TTypes extends readonly EntityTypeDefinition[] = readonly EntityTypeDefinition[],
> = PackageBase<TCards, TTypes> &
  (
    | { readonly containers?: readonly ContainerDefinition[]; readonly compose?: never }
    | { readonly compose: ComposeDefinition; readonly containers?: never }
  );

/** A package, as declared. */
export type PackageDefinition<
  TCards extends readonly CardDefinition[] = readonly CardDefinition[],
  TTypes extends readonly EntityTypeDefinition[] = readonly EntityTypeDefinition[],
> = PackageConfig<TCards, TTypes> & { readonly kind: 'package' };

/* @__NO_SIDE_EFFECTS__ */
/**
 * Declares the package: `nebula.config.ts`'s default export.
 *
 * @param config - What it is, what it declares, and the components it draws.
 * @returns The package, which the build writes the manifest from.
 */
export function definePackage<
  const TCards extends readonly CardDefinition[] = readonly [],
  const TTypes extends readonly EntityTypeDefinition[] = readonly [],
>(config: PackageConfig<TCards, TTypes>): PackageDefinition<TCards, TTypes> {
  return { ...config, kind: 'package' };
}
