/**
 * A calendar's mark: its icon on a tile of its colour, or - for a person's own calendar - the
 * person's initial on a round one, as the settings rows and the share list draw it.
 */
import type { CalendarView, IconView } from '@nebulahome/contracts';
import { AppIcon, CatalogueIcon, cn, TAG_TINT_CLASSES } from '@nebulahome/ui';

import { toInitials } from '@/lib/initials';

/** What the mark needs. */
export type CalendarMarkProps = {
  readonly calendar: Pick<CalendarView, 'kind' | 'name' | 'color'>;

  /** Its icon from the catalogue; the calendar glyph while it is read or when it has none. */
  readonly icon: IconView | undefined;

  /** A row's 36px, or a list's 26px. */
  readonly size?: 'medium' | 'small';
};

/**
 * Renders the mark.
 *
 * @param props - See {@link CalendarMarkProps}.
 * @returns The mark.
 */
export function CalendarMark(props: CalendarMarkProps) {
  const { calendar, icon, size = 'medium' } = props;
  const isPerson = calendar.kind === 'personal';
  // Even, so the glyph has whole pixels round it inside the border: 34 and 24 pixels of room.
  const glyph = size === 'medium' ? 18 : 14;

  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex shrink-0 items-center justify-center border font-medium',
        TAG_TINT_CLASSES[calendar.color],
        size === 'medium' ? 'size-9 text-ui' : 'size-6.5 text-label',
        isPerson ? 'rounded-full' : size === 'medium' ? 'rounded-field' : 'rounded-chip',
      )}
    >
      {isPerson ? (
        toInitials(calendar.name).slice(0, 1)
      ) : icon === undefined ? (
        <AppIcon id="calendar" size={glyph} />
      ) : (
        <CatalogueIcon node={icon.node} frame={icon.frame} size={glyph} />
      )}
    </span>
  );
}
