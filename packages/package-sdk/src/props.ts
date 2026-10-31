/**
 * What the platform hands a package's components - its page, its cards and its entity views -
 * and how a component is loaded (PACKAGES_DOCS.md 6.3).
 *
 * Here rather than in `/ui` because `nebula.config.ts` types its loaders with them, and the config
 * names no React: a component is a function of its props.
 */
import type { CardDefinition, OptionsOf, SizeOf } from './definitions/card.js';
import type { EntityTypeDefinition } from './definitions/entity-type.js';
import type { EntityId } from './entities.js';

/** A component of the package: a function of its props, or one React wrapped (`memo`). */
export type PackageComponent<TProps> = ((props: TProps) => unknown) | { readonly $$typeof: symbol };

/** How a component is loaded: `() => import('./card.js')`, to it or to a module that exports it. */
export type Loader<TProps> = () => Promise<
  PackageComponent<TProps> | { readonly default: PackageComponent<TProps> }
>;

/** What the package's own page is given. */
export type PageProps = {
  readonly packageId: string;
};

/** What the package's background is given. Since 1.6. */
export type BackgroundProps = {
  readonly packageId: string;
};

/** What a card is given. */
export type CardProps<TCard extends CardDefinition = CardDefinition> = {
  readonly packageId: string;
  readonly cardId: TCard['id'];

  /** The card's declared name. */
  readonly name: string;

  /** What the owner titled this card, if anything. */
  readonly title: string | null;

  /** The size it is drawn at now. */
  readonly size: SizeOf<TCard>;

  /** What its inspector asked, defaults applied. */
  readonly options: OptionsOf<TCard>;

  /** Whether the dashboard is being edited: no interaction is expected. */
  readonly isEditing: boolean;
};

/** What an entity view is given. */
export type EntityViewProps<TType extends EntityTypeDefinition = EntityTypeDefinition> = {
  readonly packageId: string;
  readonly entityId: EntityId;
  readonly type: TType['id'];
};
