import { O as OptionField, S as FormValues, T as NoFields, d as EntityTypeDefinition, lt as EntityId, x as Fields } from "./json.js";
//#region src/definitions/card.d.ts
/** The cells a card can cover: 1×1, 2×1, 2×2 and 2×3. */
type CardSize = 'small' | 'wide' | 'medium' | 'large';
/** How a card fills its frame: inside its padding, or to its edges. */
type CardPadding = 'default' | 'none';
/** A card, as declared. */
type CardDefinition<TId extends string = string, TSize extends CardSize = CardSize, TOptions extends Fields<OptionField> = Fields<OptionField>> = {
  readonly kind: 'card';
  readonly id: TId;
  readonly name: string;
  readonly description?: string;
  /** A catalogue icon id, as everywhere in the interface. */
  readonly icon: string;
  /** The sizes it can be drawn at; the first is what it is added at. `['medium']` when not said. */
  readonly sizes?: readonly TSize[];
  readonly padding?: CardPadding;
  /** What its inspector asks, per card on a dashboard. */
  readonly options?: TOptions;
};
/** The sizes a card is drawn at. */
type SizeOf<TCard> = TCard extends CardDefinition<string, infer TSize> ? TSize : CardSize;
/** The values of a card's options, defaults applied. */
type OptionsOf<TCard> = TCard extends CardDefinition<string, CardSize, infer TOptions> ? FormValues<TOptions> : never;
/**
 * Declares a card.
 *
 * @param card - Its id, name, icon, sizes and options.
 * @returns The card, for `definePackage`'s `cards` and for its component's props.
 */
declare function defineCard<const TId extends string, const TSize extends CardSize = 'medium', const TOptions extends Fields<OptionField> = NoFields>(card: Omit<CardDefinition<TId, TSize, TOptions>, 'kind'>): CardDefinition<TId, TSize, TOptions>;
//#endregion
//#region src/props.d.ts
/** A component of the package: a function of its props, or one React wrapped (`memo`). */
type PackageComponent<TProps> = ((props: TProps) => unknown) | {
  readonly $$typeof: symbol;
};
/** How a component is loaded: `() => import('./card.js')`, to it or to a module that exports it. */
type Loader<TProps> = () => Promise<PackageComponent<TProps> | {
  readonly default: PackageComponent<TProps>;
}>;
/** What the package's own page is given. */
type PageProps = {
  readonly packageId: string;
};
/** What the package's background is given. Since 1.6. */
type BackgroundProps = {
  readonly packageId: string;
};
/** What a card is given. */
type CardProps<TCard extends CardDefinition = CardDefinition> = {
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
type EntityViewProps<TType extends EntityTypeDefinition = EntityTypeDefinition> = {
  readonly packageId: string;
  readonly entityId: EntityId;
  readonly type: TType['id'];
};
//#endregion
export { PackageComponent as a, CardPadding as c, SizeOf as d, defineCard as f, Loader as i, CardSize as l, CardProps as n, PageProps as o, EntityViewProps as r, CardDefinition as s, BackgroundProps as t, OptionsOf as u };