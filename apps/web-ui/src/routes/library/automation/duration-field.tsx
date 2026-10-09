/**
 * A field that holds a duration, written as a person writes one: "2 min", "1 h 30 min", "90".
 *
 * Shows the value in its own words; while it is being typed in, holds what is typed, and takes it
 * when the field is left or Enter is pressed. Something that is not a duration is said so, and
 * the value stays what it was.
 */
import { useState } from 'react';

import { TextField } from '@nebulahome/ui';

import { formatDuration, parseDuration } from '@/lib/duration';

/** What the field needs. */
export type DurationFieldProps = {
  readonly label: string;

  /** The duration, in milliseconds; null for none. */
  readonly value: number | null;

  /** Called with the new duration; null when the field was emptied and may be. */
  readonly onChange: (value: number | null) => void;

  /** Whether it may be left empty, which means none. */
  readonly isOptional?: boolean;

  /** The longest it may be. */
  readonly maxMs?: number;

  /** A line under it. */
  readonly hint?: string;
};

/**
 * Renders a duration field.
 *
 * @param props - See {@link DurationFieldProps}.
 * @returns The field.
 */
export function DurationField(props: DurationFieldProps) {
  const { label, value, onChange, isOptional = false, maxMs, hint } = props;
  const [typed, setTyped] = useState<string | null>(null);
  const [error, setError] = useState<string | undefined>(undefined);

  /** Takes what was typed, when it is a duration. */
  const commit = (): void => {
    if (typed === null) {
      return;
    }

    const text = typed.trim();

    setTyped(null);

    if (text === '' && isOptional) {
      setError(undefined);
      onChange(null);

      return;
    }

    const parsed = parseDuration(text);

    if (parsed === null) {
      setError('Write it as 30 s, 2 min or 1 h 30 min.');

      return;
    }

    if (maxMs !== undefined && parsed > maxMs) {
      setError(`At most ${formatDuration(maxMs)}.`);

      return;
    }

    setError(undefined);
    onChange(parsed);
  };

  return (
    <TextField
      label={label}
      size="compact"
      className="font-mono"
      value={typed ?? (value === null ? '' : formatDuration(value))}
      placeholder={isOptional ? '0 s' : undefined}
      error={error}
      hint={hint}
      onChange={(event) => {
        setTyped(event.target.value);
      }}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          commit();
        }
      }}
    />
  );
}
