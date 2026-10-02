/**
 * `defineCard`: a card for the dashboard (PACKAGES_DOCS.md 4.3).
 *
 * Data only - what the editor lists and the card's inspector asks. Its component is bound in
 * `definePackage`'s `ui.cards`, by the card's id.
 */
import type { FormValues, Fields, NoFields, OptionField } from '../fields.js';

/** The cells a card can cover: 1×1, 2×1, 2×2 and 2×3. */
export type CardSize = 'small' | 'wide' | 'medium' | 'large';

/** How a card fills its frame: inside its padding, or to its edges. */
export type CardPadding = 'default' | 'none';

/** A card, as declared. */
export type CardDefinition<
  TId extends string = string,
  TSize extends CardSize = CardSize,
  TOptions extends Fields<OptionField> = Fields<OptionField>,
> = {
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
export type SizeOf<TCard> = TCard extends CardDefinition<string, infer TSize> ? TSize : CardSize;

/** The values of a card's options, defaults applied. */
export type OptionsOf<TCard> =
  TCard extends CardDefinition<string, CardSize, infer TOptions> ? FormValues<TOptions> : never;

/* @__NO_SIDE_EFFECTS__ */
/**
 * Declares a card.
 *
 * @param card - Its id, name, icon, sizes and options.
 * @returns The card, for `definePackage`'s `cards` and for its component's props.
 */
export function defineCard<
  const TId extends string,
  const TSize extends CardSize = 'medium',
  const TOptions extends Fields<OptionField> = NoFields,
>(card: Omit<CardDefinition<TId, TSize, TOptions>, 'kind'>): CardDefinition<TId, TSize, TOptions> {
  return { ...card, kind: 'card' };
}
