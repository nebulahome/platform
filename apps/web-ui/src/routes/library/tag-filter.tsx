/**
 * The filter on the tags page: which colour, and what the tag is on.
 *
 * The colour is a dropdown of the twelve; what a tag is on is four words, segmented. The button
 * and the sheet are the library's shared shell.
 */
import { useTranslation } from 'react-i18next';

import { TAG_COLORS, type TagColor } from '@nebulahome/contracts';
import { cn, SelectField, Segmented, TAG_FILL_CLASSES, type SelectOption } from '@nebulahome/ui';

import { defineMessage, type Message, text, translate } from '@/i18n/messages';
import { tagColourName } from '@/lib/tag-colour-names';
import type { TagFilter, TagUsage } from '@/library/tag-filters';
import { Facet, FilterSheet } from '@/routes/library/filter-sheet';

/**
 * The colours, with any first, each shown as well as named.
 *
 * @returns The choices, in the reader's language.
 */
function colourOptions(): readonly SelectOption[] {
  return [
    { value: '', label: translate('library.tagFilter.anyColour', 'Any colour') },
    ...TAG_COLORS.map((color) => ({
      value: color,
      label: tagColourName(color),
      leading: (
        <span
          aria-hidden="true"
          className={cn('size-2 shrink-0 rounded-full', TAG_FILL_CLASSES[color])}
        />
      ),
    })),
  ];
}

/** What a tag may be on. The facet above says "On"; these do not say it again. */
const USAGES: readonly { readonly value: TagUsage; readonly label: Message }[] = [
  { value: 'any', label: defineMessage('common.any', 'Any') },
  { value: 'devices', label: defineMessage('library.tagFilter.devices', 'Devices') },
  { value: 'entities', label: defineMessage('library.tagFilter.entities', 'Entities') },
  { value: 'unused', label: defineMessage('library.tagFilter.nothing', 'Nothing') },
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
  const { t } = useTranslation();

  const { filter, onChange } = props;
  const count = Number(filter.color !== '') + Number(filter.usage !== 'any');

  return (
    <FilterSheet
      label={t('library.tagFilter.narrowTheTags', 'Narrow the tags')}
      count={count}
      onClear={() => {
        onChange({ ...filter, color: '', usage: 'any' });
      }}
    >
      <Facet title={t('library.tagFilter.colour', 'Colour')}>
        <SelectField
          label={t('library.tagFilter.colour', 'Colour')}
          isLabelHidden
          size="compact"
          options={colourOptions()}
          value={filter.color}
          onChange={(value) => {
            onChange({ ...filter, color: toColor(value) });
          }}
        />
      </Facet>
      <Facet title={t('common.on', 'On')}>
        <Segmented
          label={t('common.on', 'On')}
          size="compact"
          options={USAGES.map((usage) => ({ ...usage, label: text(usage.label) }))}
          value={filter.usage}
          onChange={(value) => {
            onChange({ ...filter, usage: toUsage(value) });
          }}
        />
      </Facet>
    </FilterSheet>
  );
}
