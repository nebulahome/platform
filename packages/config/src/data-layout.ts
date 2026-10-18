/**
 * Where the platform keeps its files.
 *
 * One directory holds everything a service writes to disk - everything but the database - so that
 * a container needs one volume and a backup one path. This is the one place its shape is written
 * down: a service asks here for the path it needs rather than joining names of its own, so the
 * folder one service writes and the folder another counts or backs up cannot drift apart. The
 * layout and its rules are in ARCHITECTURE.md §14.
 *
 * ```
 * <NEBULA_DATA_DIR>/
 * ├── hub/integrations/<vendor>/   installed integration bundles
 * ├── proxy/tls/                   certificates and the ACME account key
 * ├── packages/<id>/               one per installed feature package
 * ├── containers/<id>/<volume>/    the volumes of the containers integrations run
 * │   ├── installed/<name>/<folder>/ the folders of the containers the owner installed
 * │   └── compose/<project>/       the compose projects the owner wrote, and their folders
 * ├── secrets/                     the instance keys, when not in the environment
 * ├── cache/                       anything that can be fetched or computed again
 * │   ├── maps/                    map tiles
 * │   └── containers/<id>/<volume>/ the volumes of those containers that can be made again
 * └── backups/                     what the backups write
 * ```
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** The folder of `hub`. */
export const HUB_DIRECTORY = 'hub';

/** The integration bundles installed into `hub`, under its folder. */
export const INTEGRATIONS_DIRECTORY = 'integrations';

/** The house's Matter fabric - its keys and its nodes - under the folder of `hub`. */
export const MATTER_DIRECTORY = 'matter';

/** The folder of `proxy`. */
export const PROXY_DIRECTORY = 'proxy';

/** The certificates `proxy` serves and the ACME account that renews them, under its folder. */
export const TLS_DIRECTORY = 'tls';

/** One folder per installed feature package, each named by the package's id. */
export const PACKAGES_DIRECTORY = 'packages';

/**
 * The volumes of the containers an integration runs, one folder per container and one below it
 * per volume, written by the containers themselves and laid out by the supervisor. The owner's:
 * the Zigbee network's key and every pairing live here, so a backup takes it. A container's
 * volume that can be made again goes under the cache instead, in a folder of the same name.
 */
export const CONTAINERS_DIRECTORY = 'containers';

/**
 * The folders of the containers the owner installed from the containers page, one per container,
 * under {@link CONTAINERS_DIRECTORY}. No integration's container may take the name.
 */
export const INSTALLED_CONTAINERS_DIRECTORY = 'installed';

/**
 * The compose projects the owner wrote or uploaded, one folder per project holding its file, its
 * `.env` and every folder its services keep beside it, under {@link CONTAINERS_DIRECTORY}. No
 * integration's container may take the name.
 */
export const COMPOSE_PROJECTS_DIRECTORY = 'compose';

/**
 * The compose projects packages run, one folder per project - `nebulahome-pkg-<id>` - holding
 * the package's file, its `.env` and every folder its services keep beside it, under
 * {@link CONTAINERS_DIRECTORY}: in the configuration section of a backup with the rest of it. No
 * integration's container may take the name.
 */
export const PACKAGE_COMPOSE_DIRECTORY = 'packages';

/** The instance keys, for an installation that keeps them in files rather than the environment. */
export const SECRETS_DIRECTORY = 'secrets';

/**
 * Anything that can be fetched or computed again. Kept apart so that a backup can leave all of it
 * out with one rule, rather than knowing which folder of which service is a cache.
 */
export const CACHE_DIRECTORY = 'cache';

/** The map tiles `api` keeps for when the internet is away, under the cache. */
export const MAPS_DIRECTORY = 'maps';

/** What the backups write. */
export const BACKUPS_DIRECTORY = 'backups';

/**
 * What a backup of the data directory leaves out: its own output, which would otherwise contain
 * every earlier backup; the cache, which is fetched again; and the keys, which belong in a backup
 * only when it is encrypted, since next to a database dump they open everything sealed in it.
 */
export const BACKUP_EXCLUDES: readonly string[] = [
  BACKUPS_DIRECTORY,
  CACHE_DIRECTORY,
  SECRETS_DIRECTORY,
];

/**
 * The data directory when none is given: the repository's own `infra/data`.
 *
 * Found from where this file sits - the same depth under `src` and `dist` - rather than from the
 * working directory, which in development is each service's own package. Only right outside
 * production; a production service is refused without `NEBULA_DATA_DIR`.
 */
export const DEVELOPMENT_DATA_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../infra/data',
);

/** Every folder of the data directory a service may need, as absolute paths. */
export type DataLayout = {
  /** The data directory itself. */
  readonly root: string;

  /** The integration bundles installed into `hub`. */
  readonly integrations: string;

  /** The house's Matter fabric, which `hub` holds. */
  readonly matter: string;

  /** The certificates `proxy` serves and the ACME account key. */
  readonly proxyTls: string;

  /** The installed feature packages, one folder each. */
  readonly packages: string;

  /** The volumes of the containers integrations run, one folder each. */
  readonly containers: string;

  /** Their volumes that can be made again, under the cache. */
  readonly containerCache: string;

  /** The instance keys kept in files. */
  readonly secrets: string;

  /** Everything that can be fetched or computed again. */
  readonly cache: string;

  /** The map tiles, as `<z>/<x>/<y>.png`. */
  readonly mapTiles: string;

  /** What the backups write. */
  readonly backups: string;
};

/**
 * Lays out the data directory.
 *
 * @param config - The parsed environment of a service that composed `dataEnvSchema`.
 * @param config.NEBULA_DATA_DIR - The data directory, when one was given.
 * @returns The absolute path of every folder in it.
 */
export function resolveDataLayout(config: {
  readonly NEBULA_DATA_DIR?: string | undefined;
}): DataLayout {
  const root = config.NEBULA_DATA_DIR ?? DEVELOPMENT_DATA_DIR;
  const cache = path.join(root, CACHE_DIRECTORY);

  return {
    root,
    integrations: path.join(root, HUB_DIRECTORY, INTEGRATIONS_DIRECTORY),
    matter: path.join(root, HUB_DIRECTORY, MATTER_DIRECTORY),
    proxyTls: path.join(root, PROXY_DIRECTORY, TLS_DIRECTORY),
    packages: path.join(root, PACKAGES_DIRECTORY),
    containers: path.join(root, CONTAINERS_DIRECTORY),
    containerCache: path.join(cache, CONTAINERS_DIRECTORY),
    secrets: path.join(root, SECRETS_DIRECTORY),
    cache,
    mapTiles: path.join(cache, MAPS_DIRECTORY),
    backups: path.join(root, BACKUPS_DIRECTORY),
  };
}
