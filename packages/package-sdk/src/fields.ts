/**
 * The field builders: one set that describes a package's settings, a card's options, the state
 * of an entity type and the arguments of its commands (PACKAGES_DOCS.md 4.10).
 *
 * Not every kind fits every place - a secret is never a card option, a timestamp is never asked
 * in a form - and the places say which they take: `SettingField`, `OptionField`, `ValueField`.
 * Each builder keeps the literal options it was given, which is what lets `SettingsOf`,
 * `OptionsOf` and `ValuesOf` give a choice the union of its values and know which fields are
 * always there.
 */

/** A condition on an earlier field of the same form: asked only while it holds one of these. */
export type ShownWhen = {
  readonly key: string;
  readonly equals: readonly (string | boolean)[];
};

/** One choice of a choice field. */
export type ChoiceOption = {
  readonly value: string;
  readonly label: string;
};

/** What every field says. */
type FieldBase = {
  /** Shown beside the control, or as the column of a value; at most 64 characters. */
  readonly label: string;

  /** Shown under it, for what the label cannot say. */
  readonly help?: string;
};

/** What a field says when a form asks it: in the settings, or a card's options. */
type InForm<TValue> = {
  /** What it holds until the owner says otherwise. */
  readonly default?: TValue;

  /** Whether the form may not be saved without it. */
  readonly isRequired?: boolean;

  /** Asked only after an earlier choice or switch. */
  readonly shownWhen?: ShownWhen;

  /** In the settings: a change reaches the running process instead of restarting it. */
  readonly isLive?: boolean;
};

/** What a field says as part of an entity type's state, or of a command's arguments. */
type InEntity = {
  /** Whether it may be missing, or null; required when not said. */
  readonly isOptional?: boolean;
};

/** A text's own limits. */
type TextLimits = {
  readonly pattern?: string;
  readonly patternMessage?: string;
  readonly minLength?: number;
  readonly maxLength?: number;
};

/** What `field.text` takes. */
export type TextOptions = FieldBase &
  InForm<string> &
  InEntity &
  TextLimits & {
    readonly placeholder?: string;
  };

/** What `field.secret` takes: like text, with nothing a form could show back. */
export type SecretOptions = FieldBase & Omit<InForm<string>, 'default'> & TextLimits;

/** What `field.number` takes. */
export type NumberOptions = FieldBase &
  InForm<number> &
  InEntity & {
    readonly min?: number;
    readonly max?: number;
    readonly isInteger?: boolean;

    /** What it is counted in: `min`, `°C`, `MB`. */
    readonly unit?: string;

    /** In a form: below this it warns, without refusing. */
    readonly warnBelow?: number;

    /** What the warning says. */
    readonly warning?: string;
  };

/** What `field.boolean` takes. */
export type BooleanOptions = FieldBase & InForm<boolean> & InEntity;

/** What `field.choice` takes. */
export type ChoiceOptions = FieldBase &
  InForm<string> &
  InEntity & {
    readonly choices: readonly ChoiceOption[];
  };

/** What `field.list` takes: several texts, each held to the same pattern. */
export type ListOptions = FieldBase &
  Omit<InForm<readonly string[]>, 'default'> & {
    readonly placeholder?: string;
    readonly minItems?: number;
    readonly maxItems?: number;
    readonly pattern?: string;
    readonly patternMessage?: string;
  };

/** What `field.timestamp` takes: an instant, as ISO 8601 text. */
export type TimestampOptions = FieldBase & InEntity;

/** A text field. */
export type TextField<TOptions extends TextOptions = TextOptions> = TOptions & {
  readonly kind: 'text';
};

/** A secret field. */
export type SecretField<TOptions extends SecretOptions = SecretOptions> = TOptions & {
  readonly kind: 'secret';
};

/** A number field. */
export type NumberField<TOptions extends NumberOptions = NumberOptions> = TOptions & {
  readonly kind: 'number';
};

/** A boolean field. */
export type BooleanField<TOptions extends BooleanOptions = BooleanOptions> = TOptions & {
  readonly kind: 'boolean';
};

/** A choice field. */
export type ChoiceField<TOptions extends ChoiceOptions = ChoiceOptions> = TOptions & {
  readonly kind: 'choice';
};

/** A list field. */
export type ListField<TOptions extends ListOptions = ListOptions> = TOptions & {
  readonly kind: 'list';
};

/** A timestamp field. */
export type TimestampField<TOptions extends TimestampOptions = TimestampOptions> = TOptions & {
  readonly kind: 'timestamp';
};

/** Any field. */
export type Field =
  TextField | SecretField | NumberField | BooleanField | ChoiceField | ListField | TimestampField;

/** A field the settings may hold: every kind a form asks. */
export type SettingField = (
  TextField | SecretField | NumberField | BooleanField | ChoiceField | ListField
) & { readonly isOptional?: never };

/** A field a card's inspector may ask: a form's kinds, no secret, nothing live. */
export type OptionField = (TextField | NumberField | BooleanField | ChoiceField | ListField) & {
  readonly isOptional?: never;
  readonly isLive?: never;
};

/** A field of an entity type's state or of a command's arguments. */
export type ValueField = (TextField | NumberField | BooleanField | ChoiceField | TimestampField) & {
  readonly isRequired?: never;
  readonly default?: never;
  readonly shownWhen?: never;
  readonly isLive?: never;
};

/** Fields by their keys: camelCase, a letter first. */
export type Fields<TField extends Field = Field> = Readonly<Record<string, TField>>;

/** No fields. */
export type NoFields = Readonly<Record<never, never>>;

/** The value a field holds: the union of its values for a choice. */
export type ValueOfField<TField> = TField extends {
  readonly kind: 'choice';
  readonly choices: readonly { readonly value: infer TValue }[];
}
  ? TValue
  : TField extends { readonly kind: 'number' }
    ? number
    : TField extends { readonly kind: 'boolean' }
      ? boolean
      : TField extends { readonly kind: 'list' }
        ? readonly string[]
        : string;

/** Flattens an intersection, so what it holds reads as one object. */
export type Simplify<TObject> = { [TKey in keyof TObject]: TObject[TKey] };

/** The keys of a form whose value is always there: those with a default, and those required. */
type PresentKeys<TFields> = {
  [TKey in keyof TFields]: TFields[TKey] extends { readonly default: unknown }
    ? TKey
    : TFields[TKey] extends { readonly isRequired: true }
      ? TKey
      : never;
}[keyof TFields];

/** The values a form holds: what has a default or is required always, anything else maybe. */
export type FormValues<TFields> = Simplify<
  { readonly [TKey in PresentKeys<TFields>]: ValueOfField<TFields[TKey]> } & {
    readonly [TKey in Exclude<keyof TFields, PresentKeys<TFields>>]?:
      ValueOfField<TFields[TKey]> | undefined;
  }
>;

/** The keys of an entity's fields that may be missing. */
type OptionalKeys<TFields> = {
  [TKey in keyof TFields]: TFields[TKey] extends { readonly isOptional: true } ? TKey : never;
}[keyof TFields];

/** The values of an entity's fields, whole: an optional field may be missing, or null. */
export type EntityValues<TFields> = Simplify<
  {
    readonly [TKey in Exclude<keyof TFields, OptionalKeys<TFields>>]: ValueOfField<TFields[TKey]>;
  } & {
    readonly [TKey in OptionalKeys<TFields>]?: ValueOfField<TFields[TKey]> | null;
  }
>;

/** The field builders. */
export const field = {
  /**
   * A text: free, or held to a length and a pattern.
   *
   * @param options - Its label and limits.
   * @returns The field.
   */
  text: <const TOptions extends TextOptions>(options: TOptions): TextField<TOptions> => ({
    ...options,
    kind: 'text',
  }),

  /**
   * A secret: stored sealed, handed to the process open, never sent to a browser.
   *
   * @param options - Its label and limits.
   * @returns The field.
   */
  secret: <const TOptions extends SecretOptions>(options: TOptions): SecretField<TOptions> => ({
    ...options,
    kind: 'secret',
  }),

  /**
   * A number, optionally whole and within a range.
   *
   * @param options - Its label, range and unit.
   * @returns The field.
   */
  number: <const TOptions extends NumberOptions>(options: TOptions): NumberField<TOptions> => ({
    ...options,
    kind: 'number',
  }),

  /**
   * On or off.
   *
   * @param options - Its label.
   * @returns The field.
   */
  boolean: <const TOptions extends BooleanOptions>(options: TOptions): BooleanField<TOptions> => ({
    ...options,
    kind: 'boolean',
  }),

  /**
   * One of a fixed list.
   *
   * @param options - Its label and its choices, 1 to 64.
   * @returns The field.
   */
  choice: <const TOptions extends ChoiceOptions>(options: TOptions): ChoiceField<TOptions> => ({
    ...options,
    kind: 'choice',
  }),

  /**
   * Several texts - addresses, topics - each held to the same pattern.
   *
   * @param options - Its label and limits.
   * @returns The field.
   */
  list: <const TOptions extends ListOptions>(options: TOptions): ListField<TOptions> => ({
    ...options,
    kind: 'list',
  }),

  /**
   * An instant, as ISO 8601 text: an entity's state or a command's argument, never a form's.
   *
   * @param options - Its label.
   * @returns The field.
   */
  timestamp: <const TOptions extends TimestampOptions>(
    options: TOptions,
  ): TimestampField<TOptions> => ({
    ...options,
    kind: 'timestamp',
  }),
};
