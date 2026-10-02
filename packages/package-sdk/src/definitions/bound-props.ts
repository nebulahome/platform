/**
 * The props of the component bound to one declaration, found among the package's by its id.
 */
import type { CardProps, EntityViewProps } from '../props.js';

import type { CardDefinition } from './card.js';
import type { EntityTypeDefinition } from './entity-type.js';

/** The props of the component of the card with this id. */
export type CardPropsFor<TCards extends readonly CardDefinition[], TId extends string> = CardProps<
  Extract<TCards[number], { readonly id: TId }>
>;

/** The props of the view of the entity type with this id. */
export type EntityViewPropsFor<
  TTypes extends readonly EntityTypeDefinition[],
  TId extends string,
> = EntityViewProps<Extract<TTypes[number], { readonly id: TId }>>;
