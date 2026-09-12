/**
 * Choosing the thing an automation is about.
 *
 * A dropdown when the registry has entities, and a text field when it does not. A new
 * installation has no entities at all — nothing has been adopted yet — and a select with no
 * options is a control that cannot be used; a text field at least lets somebody write the rule
 * they are planning for the light they are about to plug in.
 *
 * The two are the same field to whoever is filling it in, which is why the switch lives here
 * rather than at every call site.
 *
 * The list is read once and shared: several of these appear in one editor, and TanStack Query
 * answers all of them from the one request the first of them makes.
 */
import { useQuery } from '@tanstack/react-query';

import { SelectField, TextField } from '@nebula-home/ui';

import { fetchEntities, LIBRARY_QUERY_KEYS } from '@/library/api';

/** What the field needs. */
export type EntityFieldProps = {
  /** What this address is for. */
  readonly label: string;

  /** The address chosen so far. */
  readonly value: string;

  /** Called with the new address. */
  readonly onChange: (value: string) => void;
};

/**
 * Renders an entity chooser.
 *
 * @param props - See {@link EntityFieldProps}.
 * @returns The field.
 */
export function EntityField(props: EntityFieldProps) {
  const { label, value, onChange } = props;

  const entities = useQuery({
    queryKey: LIBRARY_QUERY_KEYS.entities,

    /**
     * Reads every entity the registry knows.
     *
     * @param context - What TanStack Query provides, including the cancellation signal.
     * @param context.signal - Cancels the request when the component goes away.
     * @returns Every entity.
     */
    queryFn: async ({ signal }: { signal: AbortSignal }) => fetchEntities(signal),
  });

  const options = (entities.data ?? []).map((entity) => ({
    value: entity.entityId,
    label: entity.areaName === null ? entity.name : `${entity.name} · ${entity.areaName}`,
  }));

  if (options.length === 0) {
    return (
      <TextField
        label={label}
        value={value}
        size="compact"
        placeholder="light.hallway_ceiling"
        hint={
          entities.isPending
            ? undefined
            : 'Nothing adopted yet, so this is typed rather than chosen.'
        }
        onChange={(event) => {
          onChange(event.target.value);
        }}
      />
    );
  }

  return (
    <SelectField
      label={label}
      size="compact"
      options={value === '' ? [{ value: '', label: 'Choose one…' }, ...options] : options}
      value={value}
      onChange={onChange}
    />
  );
}
