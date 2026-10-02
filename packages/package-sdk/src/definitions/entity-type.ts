/**
 * `defineEntityType`: a kind of entity of the package's own, which no capability of the platform
 * describes (PACKAGES_DOCS.md 4.4). An entity of one has the `custom` capability.
 */
import type { EntityValues, Fields, NoFields, ValueField } from '../fields.js';

/** A command an entity type takes. */
export type CommandDeclaration = {
  readonly name: string;

  /** Its arguments, at most 8. */
  readonly fields?: Fields<ValueField>;
};

/** Commands by their ids. */
export type CommandDeclarations = Readonly<Record<string, CommandDeclaration>>;

/** An entity type, as declared. */
export type EntityTypeDefinition<
  TId extends string = string,
  TState extends Fields<ValueField> = Fields<ValueField>,
  TCommands extends CommandDeclarations = CommandDeclarations,
> = {
  readonly kind: 'entityType';
  readonly id: TId;
  readonly name: string;

  /** A catalogue icon id. */
  readonly icon: string;

  /** What its state holds: 1 to 32 fields. */
  readonly state: TState;

  /** The commands it takes, at most 16. */
  readonly commands?: TCommands;
};

/** The values of an entity type's state, whole: an optional field may be missing, or null. */
export type ValuesOf<TType> =
  TType extends EntityTypeDefinition<string, infer TState> ? EntityValues<TState> : never;

/** The ids of an entity type's commands. */
export type CommandsOf<TType> =
  TType extends EntityTypeDefinition<string, Fields<ValueField>, infer TCommands>
    ? keyof TCommands & string
    : never;

/** The arguments of one of an entity type's commands. */
export type ArgsOf<TType, TCommand extends CommandsOf<TType>> =
  TType extends EntityTypeDefinition<string, Fields<ValueField>, infer TCommands>
    ? TCommands[TCommand] extends { readonly fields: infer TFields }
      ? EntityValues<TFields>
      : NoFields
    : never;

/* @__NO_SIDE_EFFECTS__ */
/**
 * Declares an entity type.
 *
 * @param type - Its id, name, icon, state and commands.
 * @returns The type, for `definePackage`'s `entityTypes`, the server's `ctx.custom` and its view.
 */
export function defineEntityType<
  const TId extends string,
  const TState extends Fields<ValueField>,
  const TCommands extends CommandDeclarations = NoFields,
>(
  type: Omit<EntityTypeDefinition<TId, TState, TCommands>, 'kind'>,
): EntityTypeDefinition<TId, TState, TCommands> {
  return { ...type, kind: 'entityType' };
}
