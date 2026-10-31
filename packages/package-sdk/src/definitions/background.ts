/**
 * `defineBackground`: a component of the package drawn by the interface for as long as somebody is
 * signed in, whatever page is open - for what must outlive a page, sound playing in the browser
 * above all (PACKAGES_DOCS.md 4.5.1). Since 1.6.
 */
import type { BackgroundProps, Loader } from '../props.js';

/** The package's background, as declared. */
export type BackgroundDefinition = {
  readonly kind: 'background';
  readonly component: Loader<BackgroundProps>;

  /** What it does, in a sentence the package's page shows. At most 256 characters. */
  readonly description: string;
};

/* @__NO_SIDE_EFFECTS__ */
/**
 * Declares the package's background. A package has at most one: `ui.background` is a single
 * field.
 *
 * @param background - Its component's loader, and what it does.
 * @returns The background, for `definePackage`'s `ui.background`.
 */
export function defineBackground(
  background: Omit<BackgroundDefinition, 'kind'>,
): BackgroundDefinition {
  return { ...background, kind: 'background' };
}
