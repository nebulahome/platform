/**
 * The filters of the lists that had none: scenes, packages, a vendor's devices, people, tokens.
 *
 * Each is a search - the rule every search box follows ({@link matchesQuery}) - and at most one
 * or two facets, kept in the address like every other list's ({@link ListCodec}). Pure, so what a
 * list lets through is tested without the page.
 */
import type { PackageState, SceneView } from '@nebula-home/contracts';

import { matchesQuery } from '@/lib/search-text';
import { nonDefault, readChoice, type ListCodec } from '@/lib/use-list-state';

// --- scenes ---------------------------------------------------------------------------------

/** What the scenes page is narrowed by. */
export type SceneFilter = {
  readonly search: string;

  /** Only scenes placed in this area, by key; blank for any. */
  readonly areaKey: string;
};

/** Every scene. */
export const OPEN_SCENE_FILTER: SceneFilter = { search: '', areaKey: '' };

/** How the scenes filter lives in the address. */
export const SCENE_FILTER_CODEC: ListCodec<SceneFilter> = {
  keys: ['q', 'area'],

  /**
   * Reads the filter.
   *
   * @param params - The query.
   * @returns The filter.
   */
  read: (params) => ({ search: params.get('q') ?? '', areaKey: params.get('area') ?? '' }),

  /**
   * Writes what differs from the open filter.
   *
   * @param filter - The filter.
   * @returns The query entries.
   */
  write: (filter) => nonDefault({ q: [filter.search, ''], area: [filter.areaKey, ''] }),
};

/**
 * Whether a scene belongs in the list.
 *
 * @param scene - The scene.
 * @param filter - The filter.
 * @param words - Its area's name and its members' names, for the search.
 * @param words.areaName - The name of the area it is placed in.
 * @param words.memberNames - The names of the entities it sets, and of their rooms.
 * @returns True when the filter admits it.
 */
export function matchesSceneFilter(
  scene: SceneView,
  filter: SceneFilter,
  words: { readonly areaName?: string | undefined; readonly memberNames?: readonly string[] } = {},
): boolean {
  if (filter.areaKey !== '' && scene.areaKey !== filter.areaKey) {
    return false;
  }

  return matchesQuery(
    [scene.name, scene.key, words.areaName, ...(words.memberNames ?? [])],
    filter.search,
  );
}

// --- packages -------------------------------------------------------------------------------

/** What the packages page is narrowed by. */
export type PackageFilter = {
  readonly search: string;

  /** Only packages in this state; blank for any. */
  readonly state: PackageState | '';
};

/** Every package. */
export const OPEN_PACKAGE_FILTER: PackageFilter = { search: '', state: '' };

/**
 * The packages filter's codec, for the states the page can name.
 *
 * @param states - Every state a package can be in.
 * @returns The codec.
 */
export function packageFilterCodec(states: readonly PackageState[]): ListCodec<PackageFilter> {
  return {
    keys: ['q', 'state'],

    /**
     * Reads the filter.
     *
     * @param params - The query.
     * @returns The filter.
     */
    read: (params) => ({
      search: params.get('q') ?? '',
      state: readChoice<PackageState | ''>(params, 'state', ['', ...states], ''),
    }),

    /**
     * Writes what differs from the open filter.
     *
     * @param filter - The filter.
     * @returns The query entries.
     */
    write: (filter) => nonDefault({ q: [filter.search, ''], state: [filter.state, ''] }),
  };
}

// --- a vendor's devices ---------------------------------------------------------------------

/** How a device on a vendor's page stands. */
export const DEVICE_STANDINGS = ['any', 'running', 'failing', 'disabled'] as const;

/** How a device on a vendor's page stands. */
export type DeviceStandingChoice = (typeof DEVICE_STANDINGS)[number];

/** What a vendor's device table is narrowed by. */
export type VendorDeviceFilter = {
  readonly search: string;
  readonly standing: DeviceStandingChoice;
};

/** Every device. */
export const OPEN_VENDOR_DEVICE_FILTER: VendorDeviceFilter = { search: '', standing: 'any' };

/** How the vendor device filter lives in the address. */
export const VENDOR_DEVICE_FILTER_CODEC: ListCodec<VendorDeviceFilter> = {
  keys: ['q', 'standing'],

  /**
   * Reads the filter.
   *
   * @param params - The query.
   * @returns The filter.
   */
  read: (params) => ({
    search: params.get('q') ?? '',
    standing: readChoice(params, 'standing', DEVICE_STANDINGS, 'any'),
  }),

  /**
   * Writes what differs from the open filter.
   *
   * @param filter - The filter.
   * @returns The query entries.
   */
  write: (filter) => nonDefault({ q: [filter.search, ''], standing: [filter.standing, 'any'] }),
};

// --- people and tokens ----------------------------------------------------------------------

/** A search and one facet, for the settings lists. */
export type SearchAndFacet = {
  readonly search: string;

  /** The facet's value; blank for any. */
  readonly facet: string;
};

/** Everything. */
export const OPEN_SEARCH_AND_FACET: SearchAndFacet = { search: '', facet: '' };

/**
 * A codec for a search and one facet, under the facet's own key.
 *
 * @param facetKey - The query key the facet is kept under: `role`, `status`.
 * @returns The codec.
 */
export function searchAndFacetCodec(facetKey: string): ListCodec<SearchAndFacet> {
  return {
    keys: ['q', facetKey],

    /**
     * Reads the filter.
     *
     * @param params - The query.
     * @returns The filter.
     */
    read: (params) => ({ search: params.get('q') ?? '', facet: params.get(facetKey) ?? '' }),

    /**
     * Writes what differs from the open filter.
     *
     * @param filter - The filter.
     * @returns The query entries.
     */
    write: (filter) => nonDefault({ q: [filter.search, ''], [facetKey]: [filter.facet, ''] }),
  };
}

/** Whether an account may sign in. */
export const PERSON_STATUSES = ['any', 'active', 'disabled'] as const;

/** What the people list is narrowed by. */
export type PeopleFilter = {
  readonly search: string;

  /** Only people with this role, by key; blank for any. */
  readonly role: string;

  readonly status: (typeof PERSON_STATUSES)[number];
};

/** Everyone. */
export const OPEN_PEOPLE_FILTER: PeopleFilter = { search: '', role: '', status: 'any' };

/** How the people filter lives in the address. */
export const PEOPLE_FILTER_CODEC: ListCodec<PeopleFilter> = {
  keys: ['q', 'role', 'status'],

  /**
   * Reads the filter.
   *
   * @param params - The query.
   * @returns The filter.
   */
  read: (params) => ({
    search: params.get('q') ?? '',
    role: params.get('role') ?? '',
    status: readChoice(params, 'status', PERSON_STATUSES, 'any'),
  }),

  /**
   * Writes what differs from the open filter.
   *
   * @param filter - The filter.
   * @returns The query entries.
   */
  write: (filter) =>
    nonDefault({ q: [filter.search, ''], role: [filter.role, ''], status: [filter.status, 'any'] }),
};
