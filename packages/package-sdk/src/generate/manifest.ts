/**
 * From `nebula.config.ts` to what the platform reads: `nebula.package.json` and `setup.json`
 * (PACKAGES_DOCS.md 8.3), checked against the platform's own schemas - the ones the packet-manager
 * reads a release with - so a release the platform would refuse is refused here, at build time,
 * with every problem named.
 *
 * Pure: what the declaration names on disk - the logo, the compose file, the server's entry - is
 * returned as files to copy, and their existence is the caller's to check.
 */
import path from 'node:path';

import { integrationSetupSchema, packageManifestSchema } from '@nebulahome/contracts';

import { entityField, fieldEntries, formField, isRecord } from './fields.js';
import { PackageConfigError, pathOf, problems, type Problems } from './problems.js';

/** What a release holds, generated. */
export type GeneratedPackage = {
  /** `nebula.package.json`, as the platform reads it. */
  readonly manifest: Readonly<Record<string, unknown>>;

  /** `setup.json`, or null for a package with no settings. */
  readonly setup: Readonly<Record<string, unknown>> | null;

  /** Files of the declaration to copy into the release: from the config's folder, to the release. */
  readonly copies: readonly { readonly from: string; readonly to: string }[];

  /** The server's entry module, from the config's folder, or null. */
  readonly server: string | null;

  /** Whether the package draws anything: a page, cards or entity views. */
  readonly hasUi: boolean;
};

/** What generating needs besides the declaration. */
export type GenerateOptions = {
  /** The package's `package.json`, for its version and repository. */
  readonly packageJson: Readonly<Record<string, unknown>>;

  /** The SDK version building it, for the manifest's `sdk` range. */
  readonly sdkVersion: string;

  /** Whether the interface's build wrote a stylesheet. */
  readonly hasStyles: boolean;
};

/** Where the build puts what it copies, in the release. */
export const RELEASE_PATHS = {
  manifest: 'nebula.package.json',
  setup: 'setup.json',
  compose: 'compose.yaml',
  server: 'server/index.js',
  ui: 'ui/index.js',
  styles: 'ui/index.css',
} as const;

/**
 * The range a manifest records for the SDK that built it: its major and minor, patch and
 * prerelease left out - a package built with 1.3.2-rc.1 needs a platform that implements 1.3.
 *
 * @param version - The SDK's version.
 * @returns The range, `^1.3.0`.
 */
export function sdkRangeOf(version: string): string {
  const [major = '0', minor = '0'] = version.split('-')[0]?.split('.') ?? [];

  return `^${major}.${minor}.0`;
}

/**
 * The `owner/name` of a GitHub repository, from what `package.json` says.
 *
 * @param value - `package.json`'s `repository`.
 * @returns It, or undefined when it is not one on GitHub.
 */
export function githubRepositoryOf(value: unknown): string | undefined {
  const url = isRecord(value) ? value['url'] : value;

  if (typeof url !== 'string') {
    return undefined;
  }

  const match =
    /^(?:github:)?([\w.-]+\/[\w.-]+?)(?:\.git)?$/.exec(url) ??
    /github\.com[/:]([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/.exec(url);

  return match?.[1];
}

/**
 * A path of the declaration's, as the platform writes one in a release: `./logo.svg`.
 *
 * @param file - The path in the release.
 * @returns It, with `./`.
 */
function releasePath(file: string): string {
  return `./${file}`;
}

/**
 * A declaration's fields, without the `kind` the definitions mark it with.
 *
 * @param record - The declaration.
 * @returns Its fields.
 */
function withoutKind(record: Readonly<Record<string, unknown>>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(record).filter(([key]) => key !== 'kind'));
}

/**
 * The declared cards, in the manifest's grammar.
 *
 * @param cards - `cards`.
 * @param found - Where problems go.
 * @returns The cards.
 */
function cardsOf(cards: unknown, found: Problems): Record<string, unknown>[] {
  if (!Array.isArray(cards)) {
    return [];
  }

  return cards.map((card: unknown, index): Record<string, unknown> => {
    if (!isRecord(card) || card['kind'] !== 'card') {
      found.add(pathOf(['cards', index]), 'must be a card, declared with defineCard');

      return {};
    }

    const id = typeof card['id'] === 'string' ? card['id'] : String(index);

    return {
      ...withoutKind(card),
      options: fieldEntries(card['options'], ['cards', id, 'options'], found).map(([key, raw]) =>
        formField(key, raw, 'options', ['cards', id, 'options', key], found),
      ),
    };
  });
}

/**
 * The declared entity types, in the manifest's grammar.
 *
 * @param types - `entityTypes`.
 * @param found - Where problems go.
 * @returns The types.
 */
function entityTypesOf(types: unknown, found: Problems): Record<string, unknown>[] {
  if (!Array.isArray(types)) {
    return [];
  }

  return types.map((type: unknown, index): Record<string, unknown> => {
    if (!isRecord(type) || type['kind'] !== 'entityType') {
      found.add(
        pathOf(['entityTypes', index]),
        'must be an entity type, declared with defineEntityType',
      );

      return {};
    }

    const id = typeof type['id'] === 'string' ? type['id'] : String(index);
    const commands = isRecord(type['commands']) ? Object.entries(type['commands']) : [];

    return {
      id: type['id'],
      name: type['name'],
      icon: type['icon'],
      state: fieldEntries(type['state'], ['entityTypes', id, 'state'], found).map(([key, raw]) =>
        entityField(key, raw, ['entityTypes', id, 'state', key], found),
      ),
      commands: commands.map(([commandId, command]) => ({
        id: commandId,
        name: isRecord(command) ? command['name'] : undefined,
        fields: fieldEntries(
          isRecord(command) ? command['fields'] : undefined,
          ['entityTypes', id, 'commands', commandId, 'fields'],
          found,
        ).map(([key, raw]) =>
          entityField(key, raw, ['entityTypes', id, 'commands', commandId, 'fields', key], found),
        ),
      })),
    };
  });
}

/**
 * The declared containers, in the manifest's grammar: `env` as a list, `isCache` as `cache`.
 *
 * @param containers - `containers`.
 * @param found - Where problems go.
 * @returns The containers.
 */
function containersOf(containers: unknown, found: Problems): Record<string, unknown>[] {
  if (!Array.isArray(containers)) {
    return [];
  }

  return containers.map((container: unknown, index): Record<string, unknown> => {
    if (!isRecord(container) || container['kind'] !== 'container') {
      found.add(
        pathOf(['containers', index]),
        'must be a container, declared with defineContainer',
      );

      return {};
    }

    const { env, volumes } = container;

    return {
      ...withoutKind(container),
      ...(Array.isArray(volumes)
        ? {
            volumes: volumes.map((volume: unknown) => {
              if (!isRecord(volume)) {
                return volume;
              }

              const { isCache, ...kept } = volume;

              return isCache === undefined ? kept : { ...kept, cache: isCache };
            }),
          }
        : {}),
      ...(isRecord(env)
        ? {
            env: Object.entries(env).map(([name, value]) =>
              isRecord(value)
                ? { name, value: value['value'], when: value['when'] }
                : { name, value },
            ),
          }
        : {}),
    };
  });
}

/**
 * The components a package binds, checked against what it declares.
 *
 * @param ui - `ui`.
 * @param cardIds - The ids of the declared cards.
 * @param typeIds - The ids of the declared entity types.
 * @param found - Where problems go.
 * @returns Whether it has a page, its sidebar entry, and the types it draws.
 */
function boundUi(
  ui: unknown,
  cardIds: readonly string[],
  typeIds: readonly string[],
  found: Problems,
): { page: boolean; sidebar: unknown; entityViews: string[]; hasUi: boolean } {
  const bound = isRecord(ui) ? ui : {};
  const page = bound['page'];
  const cards = isRecord(bound['cards']) ? bound['cards'] : {};
  const views = isRecord(bound['entityViews']) ? bound['entityViews'] : {};

  if (page !== undefined && (!isRecord(page) || page['kind'] !== 'page')) {
    found.add('ui.page', 'must be a page, declared with definePage');
  }

  if (isRecord(page) && typeof page['component'] !== 'function') {
    found.add('ui.page.component', "must load the page's component: () => import('./page.js')");
  }

  for (const id of cardIds) {
    if (typeof cards[id] !== 'function') {
      found.add(`ui.cards.${id}`, "the card has no component: () => import('./card.js')");
    }
  }

  for (const id of Object.keys(cards).filter((each) => !cardIds.includes(each))) {
    found.add(`ui.cards.${id}`, 'is not one of the declared cards');
  }

  for (const [id, loader] of Object.entries(views)) {
    if (!typeIds.includes(id)) {
      found.add(`ui.entityViews.${id}`, 'is not one of the declared entity types');
    } else if (typeof loader !== 'function') {
      found.add(`ui.entityViews.${id}`, "must load the view's component");
    }
  }

  const entityViews = Object.keys(views).filter((id) => typeIds.includes(id));

  return {
    page: isRecord(page),
    sidebar: isRecord(page) ? page['sidebar'] : undefined,
    entityViews,
    hasUi: isRecord(page) || cardIds.length > 0 || entityViews.length > 0,
  };
}

/**
 * Generates what a release holds from a package's declaration.
 *
 * @param definition - `nebula.config.ts`'s default export.
 * @param options - Its `package.json`, the SDK version, whether it has styles.
 * @returns The manifest, `setup.json`, and the files to copy.
 * @throws {PackageConfigError} With every problem, when it does not hold together.
 */
export function generatePackage(definition: unknown, options: GenerateOptions): GeneratedPackage {
  const found = problems();

  if (!isRecord(definition) || definition['kind'] !== 'package') {
    throw new PackageConfigError([
      'nebula.config.ts must default-export the package: export default definePackage({ … })',
    ]);
  }

  const { packageJson } = options;
  const copies: { from: string; to: string }[] = [];
  const cards = cardsOf(definition['cards'], found);
  const entityTypes = entityTypesOf(definition['entityTypes'], found);
  const containers = containersOf(definition['containers'], found);
  const cardIds = cards.flatMap((card) => (typeof card['id'] === 'string' ? [card['id']] : []));
  const typeIds = entityTypes.flatMap((type) =>
    typeof type['id'] === 'string' ? [type['id']] : [],
  );
  const ui = boundUi(definition['ui'], cardIds, typeIds, found);
  const server = typeof definition['server'] === 'string' ? definition['server'] : null;
  const compose = definition['compose'];
  const settings = definition['settings'];

  if (definition['server'] !== undefined && server === null) {
    found.add('server', "must be the server's entry module: './src/server/index.ts'");
  }

  if (compose !== undefined && (!isRecord(compose) || compose['kind'] !== 'compose')) {
    found.add('compose', 'must be a compose file, declared with defineCompose');
  }

  if (settings !== undefined && (!isRecord(settings) || settings['kind'] !== 'settings')) {
    found.add('settings', 'must be the settings, declared with defineSettings');
  }

  const settingFields = fieldEntries(
    isRecord(settings) ? settings['fields'] : undefined,
    ['settings'],
    found,
  ).map(([key, raw]) => formField(key, raw, 'settings', ['settings', key], found));

  const logo = definition['logo'];
  const logoFile = isRecord(logo) ? logo['path'] : logo;

  if (typeof logoFile === 'string') {
    const to = `logo${path.extname(logoFile)}`;

    copies.push({ from: logoFile, to });
  }

  if (isRecord(compose) && typeof compose['file'] === 'string') {
    copies.push({ from: compose['file'], to: RELEASE_PATHS.compose });
  }

  const hasContainers = containers.length > 0 || isRecord(compose);
  const repository =
    typeof definition['repository'] === 'string'
      ? definition['repository']
      : githubRepositoryOf(packageJson['repository']);

  const manifestInput = {
    id: definition['id'],
    version: packageJson['version'],
    platform: definition['platform'],
    sdk: sdkRangeOf(options.sdkVersion),
    name: definition['name'],
    description: definition['description'],
    ...(repository === undefined ? {} : { repository }),
    ...(definition['url'] === undefined ? {} : { url: definition['url'] }),
    ...(definition['color'] === undefined ? {} : { color: definition['color'] }),
    ...(typeof logoFile === 'string'
      ? {
          logo: {
            path: releasePath(`logo${path.extname(logoFile)}`),
            ...(isRecord(logo) && logo['padding'] !== undefined
              ? { padding: logo['padding'] }
              : {}),
          },
        }
      : {}),
    category: definition['category'],
    runtime: server === null ? (hasContainers ? 'container' : 'none') : 'node',
    ...(server === null ? {} : { server: { entry: releasePath(RELEASE_PATHS.server) } }),
    ...(ui.hasUi
      ? {
          ui: {
            entry: releasePath(RELEASE_PATHS.ui),
            ...(options.hasStyles ? { styles: releasePath(RELEASE_PATHS.styles) } : {}),
            page: ui.page,
            ...(ui.sidebar === undefined ? {} : { sidebar: ui.sidebar }),
            cards,
            entityViews: ui.entityViews,
          },
        }
      : {}),
    ...(settingFields.length > 0 ? { setup: releasePath(RELEASE_PATHS.setup) } : {}),
    containers,
    ...(isRecord(compose) ? { compose: { file: releasePath(RELEASE_PATHS.compose) } } : {}),
    requires: isRecord(definition['requires']) ? definition['requires'] : {},
    provides: definition['provides'] ?? [],
    entityTypes,
  };

  if (!ui.hasUi && cards.length > 0) {
    found.add('ui.cards', 'the declared cards have no components');
  }

  const manifest = packageManifestSchema.safeParse(manifestInput);

  for (const issue of manifest.error?.issues ?? []) {
    found.add(pathOf(issue.path), issue.message);
  }

  const setup =
    settingFields.length > 0
      ? integrationSetupSchema.safeParse({ transport: { fields: settingFields } })
      : null;

  for (const issue of setup?.error?.issues ?? []) {
    const [, , index, ...rest] = issue.path;
    const key = typeof index === 'number' ? settingFields[index]?.['key'] : undefined;

    found.add(
      pathOf(['settings', ...(typeof key === 'string' ? [key] : []), ...rest]),
      issue.message,
    );
  }

  if (found.list.length > 0 || !manifest.success) {
    throw new PackageConfigError(found.list);
  }

  return {
    manifest: manifest.data,
    setup: setup?.success === true ? setup.data : null,
    copies,
    server,
    hasUi: ui.hasUi,
  };
}
