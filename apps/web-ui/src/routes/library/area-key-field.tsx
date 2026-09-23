/**
 * A field that holds an area by its key: the house, a floor or a room, listed under its floor.
 *
 * An automation names an area by its key - `living_room` - because the key never changes. It
 * used to be typed, which asked a person to remember a slug the interface had invented for
 * them; now it is chosen from the house as the areas page arranges it. Before there is a house
 * there is nothing to choose, and the field is typed as it was.
 */
import { SelectField, TextField } from '@nebula-home/ui';

import { areaChoices } from '@/lib/area-tree';
import { useAreas } from '@/routes/library/use-areas';

/** What the field needs. */
export type AreaKeyFieldProps = {
  /** What the area is for. */
  readonly label: string;

  /** The key chosen so far; empty for none. */
  readonly value: string;

  /** Called with the new key. */
  readonly onChange: (key: string) => void;
};

/**
 * Renders the field.
 *
 * @param props - See {@link AreaKeyFieldProps}.
 * @returns The field.
 */
export function AreaKeyField(props: AreaKeyFieldProps) {
  const { label, value, onChange } = props;
  const { areas, tree } = useAreas();

  if (tree === null) {
    return (
      <TextField
        label={label}
        size="compact"
        placeholder="living_room"
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      />
    );
  }

  const keys = new Map(areas.map((area) => [area.id, area.key]));
  const options = areaChoices(tree).map((choice) => ({
    ...choice,
    value: choice.value === '' ? '' : (keys.get(choice.value) ?? choice.value),
    label: choice.value === '' ? 'Choose an area…' : choice.label,
  }));
  const isKnown = options.some((option) => option.value === value);

  return (
    <SelectField
      label={label}
      size="compact"
      // A key the house no longer has is kept visible rather than shown as a blank choice.
      options={isKnown ? options : [...options, { value, label: value }]}
      value={value}
      onChange={onChange}
    />
  );
}
