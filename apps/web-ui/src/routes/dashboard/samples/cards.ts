/**
 * Sample cards of the types that are not one entity's card (Together, Summary, Room, the list,
 * quick actions, Compare, Activity, Automation, Shortcut, Agenda): what the Add card catalogue draws on
 * their tiles - the first of each type - and what the lab draws, every size.
 *
 * Each family keeps its own list in its own file; this one only gathers them.
 */
import type { DashboardLeafCard, EntityView } from '@nebulahome/contracts';

import { CALENDAR_CARDS, CALENDAR_ENTITIES } from '@/routes/dashboard/samples/calendar-cards';
import { GATHERED_CARDS, GATHERED_ENTITIES } from '@/routes/dashboard/samples/gathered-cards';
import { OVERVIEW_CARDS, OVERVIEW_ENTITIES } from '@/routes/dashboard/samples/overview-cards';
import { TIMELINE_CARDS, TIMELINE_ENTITIES } from '@/routes/dashboard/samples/timeline-cards';

/** Every sample card, the first of each type the one the catalogue draws. */
export const SAMPLE_CARDS: readonly DashboardLeafCard[] = [
  ...GATHERED_CARDS,
  ...OVERVIEW_CARDS,
  ...TIMELINE_CARDS,
  ...CALENDAR_CARDS,
];

/** The entities those cards read, beside the other samples. */
export const CARD_ENTITIES: readonly EntityView[] = [
  ...GATHERED_ENTITIES,
  ...OVERVIEW_ENTITIES,
  ...TIMELINE_ENTITIES,
  ...CALENDAR_ENTITIES,
];
