/**
 * The filter on the tags page: which colour, and what the tag is on.
 *
 * The colour is a dropdown of the twelve; what a tag is on is four words, segmented. The button
 * and the sheet are the library's shared shell.
 */
import { TAG_COLORS, type TagColor } from '@nebula-home/contracts';
import {
  cn,
  SelectField,
  Segmented,
  TAG_FILL_CLASSES,
  type SegmentedOption,
  type SelectOption,
} from '@nebula-home/ui';

import type { TagFilter, TagUsage } from '@/library/tag-filters';
import { Facet, FilterSheet } from '@/routes/library/filter-sheet';

/** The colours, with any first, each shown as well as named. */
const COLOURS: readonly SelectOption[] = [
  { value: '', label: 'Any colour' },
  ...TAG_COLORS.map((color) => ({
    value: color,
    label: color.charAt(0).toUpperCase() + color.slice(1),
    leading: (
      <span
        aria-hidden="true"
        className={cn('size-2 shrink-0 rounded-full', TAG_FILL_CLASSES[color])}
      />
    ),
  })),
];

/** What a tag may be on. The facet above says "On"; these do not say it again. */
const USAGES: readonly SegmentedOption<TagUsage>[] = [
  { value: 'any', label: 'Any' },
  { value: 'devices', label: 'Devices' },
  { value: 'entities', label: 'Entities' },
  { value: 'unused', label: 'Nothing' },
];

/**
 * Reads a dropdown value back as a colour, or blank.
 *
 * @param value - What the dropdown chose.
 * @returns The colour it names, or blank for any.
 */
function toColor(value: string): TagColor | '' {
  return TAG_COLORS.find((color) => color === value) ?? '';
}

/**
 * Reads a segmented value back as a usage.
 *
 * @param value - What was chosen.
 * @returns The usage it names, or any.
 */
function toUsage(value: string): TagUsage {
  return USAGES.find((usage) => usage.value === value)?.value ?? 'any';
}

/** What the filter needs. */
export type TagFilterButtonProps = {
  readonly filter: TagFilter;

  /** Called with the filter as it now stands. */
  readonly onChange: (filter: TagFilter) => void;
};

/**
 * Renders the button and its sheet.
 *
 * @param props - See {@link TagFilterButtonProps}.
 * @returns The control.
 */
export function TagFilterButton(props: TagFilterButtonProps) {
  const { filter, onChange } = props;
  const count = Number(filter.color !== '') + Number(filter.usage !== 'any');

  return (
    <FilterSheet
      label="Narrow the tags"
      count={count}
      width="wide"
      onClear={() => {
        onChange({ ...filter, color: '', usage: 'any' });
      }}
    >
      <Facet title="Colour">
        <SelectField
          label="Colour"
          isLabelHidden
          size="compact"
          options={COLOURS}
          value={filter.color}
          onChange={(value) => {
            onChange({ ...filter, color: toColor(value) });
          }}
        />
      </Facet>
      <Facet title="On">
        <Segmented
          label="On"
          size="compact"
          options={USAGES}
          value={filter.usage}
          onChange={(value) => {
            onChange({ ...filter, usage: toUsage(value) });
          }}
        />
      </Facet>
    </FilterSheet>
  );
}
