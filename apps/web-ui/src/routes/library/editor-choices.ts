/**
 * What the Add-a-block picker offers, in words rather than in the format's own vocabulary, with
 * the glyph each block carries on its card.
 *
 * `numeric_state` is what the document calls it and "Numeric threshold" is what somebody is
 * looking for. The value is the format's; the label is the reader's. Then is two groups, as the
 * board draws them: Actions, the things that do something, and Control, the blocks that hold other
 * blocks. A block the engine cannot run yet stays in the list, dimmed, with the reason.
 */
import type { BlockLane, UiIconId } from '@nebulahome/ui';

/** One thing an Add menu offers. */
export type EditorChoice = {
  /** What the format calls it. */
  readonly value: string;

  /** What a person looking for it would call it. */
  readonly label: string;

  /** A short line under the label. */
  readonly description?: string;

  /** Its glyph. */
  readonly glyph: UiIconId;

  /** Why it cannot be added yet, when it cannot. */
  readonly unavailable?: string;
};

/** A labelled group of choices in the picker. */
export type EditorChoiceGroup = {
  /** The group heading. */
  readonly title: string;

  /** The lane, which colours the heading. */
  readonly lane: BlockLane;

  /** What the group offers. */
  readonly choices: readonly EditorChoice[];
};

/** How each kind reads, and its glyph. */
const KINDS: Readonly<
  Record<
    string,
    {
      readonly label: string;
      readonly description?: string;
      readonly glyph: UiIconId;
      readonly unavailable?: string;
    }
  >
> = {
  // Triggers.
  state: { label: 'Entity state', description: 'An entity changes state', glyph: 'activity' },
  numeric_state: {
    label: 'Numeric threshold',
    description: 'A number crosses a threshold',
    glyph: 'gauge',
  },
  time: { label: 'Time', description: 'A time of day, the sun, or a schedule', glyph: 'clock' },
  event: {
    label: 'Event',
    description: 'A device event, such as a button press',
    glyph: 'radio',
    unavailable: 'Not available yet: nothing reports device events',
  },
  manual: {
    label: 'Manual',
    description: 'Only when somebody asks for it',
    glyph: 'mouse-pointer-click',
  },

  // Conditions.
  numeric: { label: 'Numeric', description: 'A number compares to a value', glyph: 'gauge' },
  time_window: { label: 'Between two times', description: 'A stretch of the day', glyph: 'clock' },
  day_of_week: {
    label: 'On certain days',
    description: 'Some days of the week',
    glyph: 'calendar',
  },
  area_occupancy: {
    label: 'Area occupancy',
    description: 'Somebody, or nobody, is in a room',
    glyph: 'users',
  },
  expression: { label: 'Expression', description: 'A formula over readings', glyph: 'braces' },
  group_and: {
    label: 'All of',
    description: 'A group whose checks must all hold',
    glyph: 'list-filter',
  },
  group_or: {
    label: 'Any of',
    description: 'A group where one check is enough',
    glyph: 'list-filter',
  },

  // Actions.
  command: {
    label: 'Set entity',
    description: 'Tell an entity to do something',
    glyph: 'lightbulb',
  },
  scene: { label: 'Apply a scene', description: 'Apply a scene', glyph: 'layers' },
  automation: {
    label: 'Run automation',
    description: 'Start another automation by key',
    glyph: 'zap',
  },
  wait_duration: {
    label: 'Wait a fixed time',
    description: 'Wait a fixed time',
    glyph: 'hourglass',
  },
  wait_for: {
    label: 'Wait for condition',
    description: 'Wait until a condition holds',
    glyph: 'hourglass',
  },
  wait_for_trigger: {
    label: 'Wait for trigger',
    description: 'Wait until something wakes it',
    glyph: 'hourglass',
  },
  notify: {
    label: 'Notify',
    description: 'Send a notification',
    glyph: 'bell',
    unavailable: 'Not available yet: there is no notification service',
  },
  package_service: {
    label: 'Package service',
    description: 'Call a package service',
    glyph: 'package',
  },

  // Control.
  if: { label: 'If / else', description: 'Run one branch or the other', glyph: 'git-branch' },
  switch: { label: 'Switch', description: 'Pick a branch from an entity state', glyph: 'split' },
  for: { label: 'For', description: 'Repeat a number of times', glyph: 'repeat' },
  while: { label: 'While', description: 'Check, run, repeat while true', glyph: 'repeat' },
  do_while: { label: 'Do while', description: 'Run once, then repeat while true', glyph: 'repeat' },
  sequence: {
    label: 'Sequence',
    description: 'Group blocks that run in order',
    glyph: 'list-ordered',
  },
  parallel: { label: 'Parallel', description: 'Run several branches together', glyph: 'columns-2' },
  stop: { label: 'End this run', description: 'Stop', glyph: 'octagon-x' },
};

/** The blocks that hold other blocks, whose lane is control wherever they are. */
export const CONTROL_KINDS: ReadonlySet<string> = new Set([
  'if',
  'switch',
  'for',
  'while',
  'do_while',
  'sequence',
  'parallel',
  'stop',
]);

/**
 * Turns a list of kinds into choices.
 *
 * @param types - The kinds, as the format names them.
 * @returns The choices.
 */
function toChoices(types: readonly string[]): readonly EditorChoice[] {
  return types.map((value) => {
    const entry = KINDS[value];

    return {
      value,
      label: entry?.label ?? value.replaceAll('_', ' '),
      glyph: entry?.glyph ?? 'circle-dot',
      ...(entry?.description === undefined ? {} : { description: entry.description }),
      ...(entry?.unavailable === undefined ? {} : { unavailable: entry.unavailable }),
    };
  });
}

/**
 * How a block's kind reads on its card.
 *
 * @param kind - The block's kind, as the document names it.
 * @returns The label, or the kind with its underscores spaced out.
 */
export function labelForKind(kind: string): string {
  return KINDS[kind]?.label ?? kind.replaceAll('_', ' ');
}

/**
 * A block's glyph.
 *
 * @param kind - The block's kind.
 * @returns Its icon id.
 */
export function glyphForKind(kind: string): UiIconId {
  return KINDS[kind]?.glyph ?? 'circle-dot';
}

/**
 * Why a kind of block cannot run yet.
 *
 * @param kind - The block's kind.
 * @returns The reason, or undefined when it can.
 */
export function unavailableReason(kind: string): string | undefined {
  return KINDS[kind]?.unavailable;
}

/** The trigger picker. */
export const TRIGGER_CHOICE_GROUPS: readonly EditorChoiceGroup[] = [
  {
    title: 'Triggers',
    lane: 'when',
    choices: toChoices(['state', 'numeric_state', 'time', 'manual', 'event']),
  },
];

/** The condition picker: every check, and the groups that hold them. */
export const CONDITION_CHOICE_GROUPS: readonly EditorChoiceGroup[] = [
  {
    title: 'Checks',
    lane: 'if',
    choices: toChoices([
      'state',
      'numeric',
      'time_window',
      'day_of_week',
      'area_occupancy',
      'expression',
    ]),
  },
  { title: 'Groups', lane: 'if', choices: toChoices(['group_and', 'group_or']) },
];

/** The Then picker: actions, then the blocks that hold others. */
export const ACTION_CHOICE_GROUPS: readonly EditorChoiceGroup[] = [
  {
    title: 'Actions',
    lane: 'then',
    choices: toChoices([
      'command',
      'scene',
      'automation',
      'wait_duration',
      'wait_for',
      'wait_for_trigger',
      'notify',
      'package_service',
    ]),
  },
  {
    title: 'Control',
    lane: 'control',
    choices: toChoices([
      'if',
      'switch',
      'for',
      'while',
      'do_while',
      'sequence',
      'parallel',
      'stop',
    ]),
  },
];
