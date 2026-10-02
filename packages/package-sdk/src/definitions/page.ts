/**
 * `definePage`: the package's own page, with routes of its own, opened from the page the platform
 * draws for every package - and, when asked, from the interface's sidebar (PACKAGES_DOCS.md 4.5).
 */
import type { Loader, PageProps } from '../props.js';

/** An entry of the page in the interface's sidebar. */
export type SidebarEntry = {
  /** What it says; the package's name when not given. At most 32 characters. */
  readonly label?: string;

  /** A catalogue icon id; the package's logo when not given. */
  readonly icon?: string;
};

/** The package's page, as declared. */
export type PageDefinition = {
  readonly kind: 'page';
  readonly component: Loader<PageProps>;
  readonly sidebar?: SidebarEntry;
};

/* @__NO_SIDE_EFFECTS__ */
/**
 * Declares the package's page. A package has at most one: `ui.page` is a single field.
 *
 * @param page - Its component's loader, and its sidebar entry if any.
 * @returns The page, for `definePackage`'s `ui.page`.
 */
export function definePage(page: Omit<PageDefinition, 'kind'>): PageDefinition {
  return { ...page, kind: 'page' };
}
