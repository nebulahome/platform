/**
 * What the three Add menus offer, in words rather than in the format's own vocabulary.
 *
 * `numeric_state` is what the document calls it and "A number crosses a threshold" is what
 * somebody is looking for. The value is the format's; the label is the reader's.
 *
 * Here rather than in the component because it is content, and because the three lists are the
 * one place the editor's coverage is stated: what is missing from these is what the editor
 * cannot yet write.
 */
import {
  EDITABLE_ACTIONS,
  EDITABLE_CONDITIONS,
  EDITABLE_TRIGGERS,
} from '@/library/automation-draft';

/** One thing an Add menu offers. */
export type EditorChoice = {
  /** What the format calls it. */
  readonly value: string;

  /** What a person looking for it would call it. */
  readonly label: string;
};

/** How each kind reads in a menu. */
const LABELS: Readonly<Record<string, string>> = {
  // Triggers.
  state: 'An entity changes state',
  numeric_state: 'A number crosses a threshold',
  time: 'A time, a schedule or the sun',
  event: 'Something happens',
  manual: 'Only when asked',

  // Conditions. `state` and `numeric` differ from the triggers above by what they ask for: a
  // trigger fires on the change, a condition checks what is true right now.
  numeric: 'A number compares',
  time_window: 'Between two times',
  day_of_week: 'On certain days',
  area_occupancy: 'A room is occupied',
  expression: 'An expression holds',

  // Actions.
  command: 'Tell an entity to do something',
  scene: 'Apply a scene',
  automation: 'Run another automation',
  wait_duration: 'Wait a while',
  wait_for: 'Wait for something',
  notify: 'Send a notification',
  package_service: 'Call a package service',
};

/**
 * Turns a list of kinds into a menu.
 *
 * @param types - The kinds, as the format names them.
 * @returns The menu.
 */
function toChoices(types: readonly string[]): readonly EditorChoice[] {
  return types.map((value) => ({ value, label: LABELS[value] ?? value.replaceAll('_', ' ') }));
}

/** What each of the editor's three Add menus offers. */
export const EDITOR_CHOICES = {
  /** Everything that can wake an automation. */
  triggers: toChoices(EDITABLE_TRIGGERS),

  /** Every condition that does not compose others. */
  conditions: toChoices(EDITABLE_CONDITIONS),

  /** Every action that does not hold others. */
  actions: toChoices(EDITABLE_ACTIONS),
} as const;
