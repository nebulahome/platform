/**
 * What every entity card is given: the entity, its state now, and how the card is set up.
 *
 * Worked out once per card, by the card that dispatches to a kind, so a light card and a sensor
 * card read the same entity the same way - the live channel's state when it has spoken, the
 * page's otherwise - and each kind only decides how to draw it.
 */
import type {
  CapabilityState,
  DashboardEntityCard,
  EntityView,
  IconView,
} from '@nebulahome/contracts';

import type { CardSize } from '@/dashboard/card-sizes';
import { dateTimeFormat } from '@/i18n/formatters';
import { clockText } from '@/lib/format-time';
import type { EntityKind } from '@/library/entity-kind';
import type { Reading } from '@/library/entity-reading';
import type { CardCommand } from '@/routes/dashboard/cards/use-card-command';

/** One entity card, ready to draw. */
export type EntityCardModel = {
  /** The card as the layout stores it. */
  readonly card: DashboardEntityCard;

  /** The entity it shows. */
  readonly entity: EntityView;

  /** Its state now, capability by capability. */
  readonly state: CapabilityState;

  /** Its reading in words, and whether it can be reached. */
  readonly reading: Reading;

  /** When its state last arrived, in milliseconds since the epoch. */
  readonly reportedAt: number | null;

  /** When its state last changed. */
  readonly changedAt: Date | null;

  /** What the card is headed: the person's own title, or the entity's name. */
  readonly title: string;

  /** Where the entity is. */
  readonly subtitle: string | null;

  /** The icon the card draws: the one chosen for the card, or the entity's own. */
  readonly icon: IconView | undefined;

  /** What kind of thing it is, for the tile. */
  readonly kind: EntityKind;

  /** The size it is drawn at: its own, or the nearest this kind is drawn for. */
  readonly size: CardSize;

  /**
   * Whether this person may command it, and it takes commands at all. When not, the card draws no
   * control: a toggle, a slider or a button would only be refused.
   */
  readonly canControl: boolean;

  /** Whether this person may read its history, for a card that draws it. */
  readonly canReadHistory: boolean;

  /** Whether it cannot be reached: its controls stay, switched off, and its value is the last. */
  readonly isOffline: boolean;

  /** The card's command path: every control sends through it. */
  readonly command: CardCommand;

  /** The parts of the card that were switched off in its settings (`Show`). */
  readonly hidden: ReadonlySet<string>;
};

/**
 * Whether a card's controls can be used now: it may be commanded, it can be reached, and no other
 * command of the card is waiting for its answer.
 *
 * @param model - The card.
 * @param capability - The control's own capability, which stays usable while it is the one out.
 * @returns True when the control takes input.
 */
export function canUse(model: EntityCardModel, capability?: string): boolean {
  const { sending } = model.command;

  return model.canControl && !model.isOffline && (sending === null || sending === capability);
}

/** The sizes a card is drawn at, named by their cells. */
export type SizeKey = '1x1' | '2x1' | '1x2' | '2x2' | '2x3';

/**
 * Names a size by its cells.
 *
 * @param size - The size.
 * @returns `1x2` and the like.
 */
export function sizeKey(size: CardSize): SizeKey {
  const key = `${String(size.w)}x${String(size.h)}`;

  return key === '2x1' || key === '1x2' || key === '2x2' || key === '2x3' ? key : '1x1';
}

/**
 * The day and the time, for a moment before today.
 *
 * @returns The formatter, in the reader's language.
 */
const EARLIER = (): Intl.DateTimeFormat =>
  dateTimeFormat({
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

/**
 * Writes when something happened, as briefly as a card has room for.
 *
 * @param when - The moment.
 * @param now - What counts as today.
 * @returns `08:12` today, `Mon 08:12` before.
 */
export function cardTime(when: Date, now: Date = new Date()): string {
  return when.toDateString() === now.toDateString() ? clockText(when) : EARLIER().format(when);
}
