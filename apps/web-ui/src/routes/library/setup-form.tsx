/**
 * The controls a bundle's `setup.json` asks for, one per field.
 *
 * The declaration says the type and the words; the page owns the draft and hears every change
 * under the field's key. Nothing here decides what is valid - `setup-values` does, with the same
 * schema the API runs - so this component is only the mapping from a field type to a control,
 * and the place the field's help and error are shown.
 */
import type { SetupField, SetupGroup } from '@nebula-home/contracts';
import { Segmented, SelectField, TextField } from '@nebula-home/ui';

import { PasswordField } from '@/components/password-field';
import type { DraftValue, SetupDraft } from '@/library/setup-values';

/** What the form needs. */
export type SetupFormProps = {
  /** Which fields, in which order. */
  readonly group: SetupGroup;

  /** What each control holds. */
  readonly draft: SetupDraft;

  /** What is wrong with a field, by key. */
  readonly errors: Readonly<Record<string, string>>;

  /** The secret fields a saved value already exists for. */
  readonly kept: readonly string[];

  /** Called with the field key and what its control now holds. */
  readonly onChange: (key: string, value: DraftValue) => void;
};

/**
 * The text of a draft entry, for a control that shows text.
 *
 * @param value - What the draft holds.
 * @returns The text, blank for a switch position.
 */
function textOf(value: DraftValue | undefined): string {
  return typeof value === 'string' ? value : '';
}

/** Units a person reads better spelled out: "In seconds." rather than "In s.". */
const UNIT_WORDS: Readonly<Record<string, string>> = {
  ms: 'milliseconds',
  s: 'seconds',
  min: 'minutes',
  h: 'hours',
};

/**
 * What a number field warns about, for what its control holds now.
 *
 * @param field - The declaration.
 * @param value - What the control holds.
 * @returns The bundle's warning, or a plain one, when the value is a number below `warnBelow`;
 * undefined otherwise - including while the value is not a number yet, which is the error's job.
 */
function warningOf(
  field: Extract<SetupField, { type: 'number' }>,
  value: DraftValue | undefined,
): string | undefined {
  const text = textOf(value).trim();
  const number = Number(text);

  if (field.warnBelow === undefined || text === '' || !Number.isFinite(number)) {
    return undefined;
  }

  if (number >= field.warnBelow) {
    return undefined;
  }

  const unit = field.unit === undefined ? '' : ` ${field.unit}`;

  return field.warning ?? `Below ${String(field.warnBelow)}${unit} is not advised.`;
}

/**
 * Renders one field.
 *
 * @param props - The field and the form's callbacks.
 * @param props.field - The declaration.
 * @param props.value - What the control holds.
 * @param props.error - What is wrong with it.
 * @param props.isKept - Whether a saved secret exists for it.
 * @param props.onChange - Where the new value goes.
 * @returns The control.
 */
function Field(props: {
  readonly field: SetupField;
  readonly value: DraftValue | undefined;
  readonly error: string | undefined;
  readonly isKept: boolean;
  readonly onChange: (value: DraftValue) => void;
}) {
  const { field, value, error, isKept, onChange } = props;
  const help = field.help;

  switch (field.type) {
    case 'secret':
      return (
        <PasswordField
          label={field.label}
          name={field.key}
          autoComplete="off"
          size="medium"
          hasRules={false}
          required={field.isRequired && !isKept}
          value={textOf(value)}
          placeholder={isKept ? 'Kept as saved · type to replace' : undefined}
          hint={help}
          error={error}
          onChange={onChange}
        />
      );
    case 'boolean':
      return (
        <Segmented
          label={field.label}
          options={[
            { value: 'on', label: 'On' },
            { value: 'off', label: 'Off' },
          ]}
          value={value === true ? 'on' : 'off'}
          onChange={(next) => {
            onChange(next === 'on');
          }}
        />
      );
    case 'choice':
      return (
        <SelectField
          label={field.label}
          options={field.choices}
          value={textOf(value)}
          hint={help}
          error={error}
          onChange={onChange}
        />
      );
    case 'number':
      return (
        <TextField
          label={field.label}
          name={field.key}
          type="number"
          inputMode={field.isInteger ? 'numeric' : 'decimal'}
          size="medium"
          required={field.isRequired}
          min={field.min}
          max={field.max}
          step={field.isInteger ? 1 : 'any'}
          value={textOf(value)}
          hint={
            field.unit === undefined
              ? help
              : [help, `In ${UNIT_WORDS[field.unit] ?? field.unit}.`].filter(Boolean).join(' ')
          }
          warning={error === undefined ? warningOf(field, value) : undefined}
          error={error}
          onChange={(event) => {
            onChange(event.target.value);
          }}
        />
      );
    case 'list':
      return (
        <TextField
          label={field.label}
          name={field.key}
          autoComplete="off"
          type="text"
          size="medium"
          required={field.isRequired}
          value={textOf(value)}
          placeholder={field.placeholder}
          hint={[help, 'Separate several with commas.'].filter(Boolean).join(' ')}
          error={error}
          onChange={(event) => {
            onChange(event.target.value);
          }}
        />
      );
    case 'text':
      return (
        <TextField
          label={field.label}
          name={field.key}
          autoComplete="off"
          type="text"
          size="medium"
          required={field.isRequired}
          value={textOf(value)}
          placeholder={field.placeholder}
          hint={help}
          error={error}
          onChange={(event) => {
            onChange(event.target.value);
          }}
        />
      );
  }
}

/**
 * Renders the controls of one group.
 *
 * @param props - See {@link SetupFormProps}.
 * @returns The controls, in declaration order. Nothing at all for a group with no fields.
 */
export function SetupForm(props: SetupFormProps) {
  const { group, draft, errors, kept, onChange } = props;

  return (
    <>
      {group.fields.map((field) => (
        <Field
          key={field.key}
          field={field}
          value={draft[field.key]}
          error={errors[field.key]}
          isKept={kept.includes(field.key)}
          onChange={(value) => {
            onChange(field.key, value);
          }}
        />
      ))}
    </>
  );
}
