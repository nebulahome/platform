/**
 * What the Add-block modal offers, in words rather than in the format's own vocabulary.
 *
 * `numeric_state` is what the document calls it and "A number crosses a threshold" is what
 * somebody is looking for. The value is the format's; the label is the reader's.
 *
 * Groups keep the Then list scannable: control flow, waits, and things that do something sit
 * apart so a search for "wait" does not drown in "run automation".
 */
import {
  EDITABLE_ACTIONS,
  EDITABLE_TRIGGERS,
  IF_ADDABLE_CONDITIONS,
} from '@/library/automation-draft';

/** One thing an Add menu offers. */
export type EditorChoice = {
  /** What the format calls it. */
  readonly value: string;

  /** What a person looking for it would call it. */
  readonly label: string;

  /** A short line under the label, when the modal shows one. */
  readonly description?: string;
};

/** A labelled group of choices in the picker. */
export type EditorChoiceGroup = {
  /** The group heading. */
  readonly title: string;

  /** What the group offers. */
  readonly choices: readonly EditorChoice[];
};

/** How each kind reads in a menu. */
const LABELS: Readonly<Record<string, { readonly label: string; readonly description?: string }>> =
  {
    // Triggers.
    state: { label: 'Entity state', description: 'Fires when an entity changes state' },
    numeric_state: {
      label: 'Numeric threshold',
      description: 'Fires when a number crosses a threshold',
    },
    time: { label: 'Time', description: 'A clock time, a cron schedule, or the sun' },
    event: { label: 'Event', description: 'A device or platform event' },
    manual: { label: 'Manual', description: 'Only when somebody asks for it' },

    // Conditions (If add modal is state-only; other labels stay for badges and legacy cards).
    numeric: { label: 'A number compares' },
    time_window: { label: 'Between two times' },
    day_of_week: { label: 'On certain days' },
    area_occupancy: { label: 'A room is occupied' },
    expression: { label: 'An expression holds' },

    // Actions — leaf.
    command: { label: 'Set entity', description: 'Tell an entity to do something' },
    scene: { label: 'Scene', description: 'Apply a scene' },
    automation: { label: 'Run automation', description: 'Start another automation by key' },
    wait_duration: { label: 'Delay', description: 'Wait a fixed time' },
    wait_for: { label: 'Wait for condition', description: 'Wait until a condition holds' },
    wait_for_trigger: {
      label: 'Wait for trigger',
      description: 'Wait until something wakes it',
    },
    notify: { label: 'Notify', description: 'Send a notification' },
    package_service: { label: 'Package service', description: 'Call a package service' },
    stop: { label: 'Stop', description: 'End this run' },

    // Actions — nested templates.
    if: { label: 'If / else', description: 'Run one branch or the other' },
    parallel: { label: 'Parallel', description: 'Run several branches together' },
    sequence: { label: 'Sequence', description: 'Group blocks that run in order' },
    switch: { label: 'Switch', description: 'Pick a branch from an entity state' },
    while: { label: 'While', description: 'Check, run, repeat while true' },
    do_while: { label: 'Do while', description: 'Run once, then repeat while true' },
    for: { label: 'For', description: 'Repeat a count or for each item' },
  };

/**
 * Turns a list of kinds into choices.
 *
 * @param types - The kinds, as the format names them.
 * @returns The choices.
 */
function toChoices(types: readonly string[]): readonly EditorChoice[] {
  return types.map((value) => {
    const entry = LABELS[value];

    return {
      value,
      label: entry?.label ?? value.replaceAll('_', ' '),
      ...(entry?.description === undefined ? {} : { description: entry.description }),
    };
  });
}

/**
 * Readable label for a block kind badge.
 *
 * @param kind - The block's kind, as the document names it.
 * @returns The label, or the kind with its underscores spaced out.
 */
export function labelForKind(kind: string): string {
  return LABELS[kind]?.label ?? kind.replaceAll('_', ' ');
}

/** What each of the editor's three Add pickers offers. */
export const EDITOR_CHOICES = {
  /** Everything that can wake an automation. */
  triggers: toChoices(EDITABLE_TRIGGERS),

  /** Entity-state checks only — what the If Add modal offers. */
  ifConditions: toChoices(IF_ADDABLE_CONDITIONS),

  /** Nested condition pickers (if / while / do-while) — same entity-state checks. */
  nestedConditions: toChoices(IF_ADDABLE_CONDITIONS),

  /** Every action, including nested templates. */
  actions: toChoices(EDITABLE_ACTIONS),
} as const;

/** Then picker groups, for the searchable modal. */
export const ACTION_CHOICE_GROUPS: readonly EditorChoiceGroup[] = [
  {
    title: 'Control',
    choices: toChoices([
      'if',
      'parallel',
      'sequence',
      'switch',
      'while',
      'do_while',
      'for',
      'stop',
    ]),
  },
  {
    title: 'Wait',
    choices: toChoices(['wait_duration', 'wait_for', 'wait_for_trigger']),
  },
  {
    title: 'Do',
    choices: toChoices(['command', 'scene', 'automation', 'notify', 'package_service']),
  },
];

/** Trigger picker as a single group. */
export const TRIGGER_CHOICE_GROUPS: readonly EditorChoiceGroup[] = [
  { title: 'Triggers', choices: EDITOR_CHOICES.triggers },
];

/** If / nested condition picker as a single group. */
export const CONDITION_CHOICE_GROUPS: readonly EditorChoiceGroup[] = [
  { title: 'Conditions', choices: EDITOR_CHOICES.ifConditions },
];
