/**
 * What the Add-a-block picker offers, in words rather than in the format's own vocabulary, with
 * the glyph each block carries on its card.
 *
 * Kept per family - triggers, conditions, actions - because the same word means different blocks
 * in each: a `time` trigger fires at a moment, a `time` condition holds through a stretch of the
 * day and is called "Time and days". The value is the format's; the label is the reader's. Then is
 * two groups, as the board draws them: Actions, the things that do something, and Control, the
 * blocks that hold other blocks. A block the engine cannot run yet stays in the list, dimmed, with
 * the reason.
 */
import type { BlockLane, UiIconId } from '@nebulahome/ui';

import type { BlockFamily } from '@/library/block-path';

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

/** How one kind reads, and its glyph. */
type Kind = {
  readonly label: string;
  readonly description?: string;
  readonly glyph: UiIconId;
  readonly unavailable?: string;
};

/** The kinds of each family. */
const KINDS: Readonly<Record<BlockFamily, Readonly<Record<string, Kind>>>> = {
  trigger: {
    entity: {
      label: 'Entity state',
      description: 'An entity changes state',
      glyph: 'activity',
    },
    entity_numeric: {
      label: 'Numeric threshold',
      description: 'A number crosses a value',
      glyph: 'gauge',
    },
    time: {
      label: 'Time',
      description: 'A time of day, the sun, or a schedule',
      glyph: 'clock',
    },
    sun: { label: 'Time', description: 'Sunrise, sunset, the golden hour…', glyph: 'sunset' },
    quiet: { label: 'Time', description: 'The quietest time of the day', glyph: 'moon' },
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
    webhook: { label: 'Webhook', description: 'A link that starts it', glyph: 'webhook' },
  },
  condition: {
    entity: {
      label: 'Entity state',
      description: 'An entity is in a state',
      glyph: 'activity',
    },
    entity_numeric: {
      label: 'Numeric',
      description: 'A number is past a value',
      glyph: 'gauge',
    },
    time: {
      label: 'Between two times',
      description: 'A stretch of the day',
      glyph: 'clock',
    },
    days: {
      label: 'On certain days',
      description: 'Some days of the week',
      glyph: 'calendar',
    },
    sun: { label: 'Sun', description: 'Day, night, the golden hour…', glyph: 'sun' },
    expression: { label: 'Expression', description: 'A formula over readings', glyph: 'braces' },
    and: {
      label: 'All of',
      description: 'A group whose conditions must all hold',
      glyph: 'list-filter',
    },
    or: {
      label: 'Any of',
      description: 'A group where one condition is enough',
      glyph: 'list-filter',
    },
    area_occupancy: {
      label: 'Area occupancy',
      glyph: 'users',
      unavailable: 'Not available any more: remove it to save',
    },
  },
  action: {
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
    http_request: {
      label: 'HTTP request',
      description: 'Call an address on the web',
      glyph: 'send',
    },
    if: { label: 'If / else', description: 'Run one branch or the other', glyph: 'git-branch' },
    switch: { label: 'Switch', description: 'Pick a branch from an entity state', glyph: 'split' },
    for: { label: 'For', description: 'Repeat a number of times', glyph: 'repeat' },
    while: { label: 'While', description: 'Check, run, repeat while true', glyph: 'repeat' },
    do_while: {
      label: 'Do while',
      description: 'Run once, then repeat while true',
      glyph: 'repeat',
    },
    sequence: {
      label: 'Sequence',
      description: 'Group blocks that run in order',
      glyph: 'list-ordered',
    },
    parallel: {
      label: 'Parallel',
      description: 'Run several branches together',
      glyph: 'columns-2',
    },
    stop: { label: 'End this run', description: 'Stop', glyph: 'octagon-x' },
  },
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
 * @param family - Their family.
 * @param types - The kinds, as the format names them.
 * @returns The choices.
 */
function toChoices(family: BlockFamily, types: readonly string[]): readonly EditorChoice[] {
  return types.map((value) => {
    const entry = KINDS[family][value];

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
 * @param family - The block's family.
 * @param kind - The block's kind, as the document names it.
 * @returns The label, or the kind with its underscores spaced out.
 */
export function labelForKind(family: BlockFamily, kind: string): string {
  return KINDS[family][kind]?.label ?? kind.replaceAll('_', ' ');
}

/**
 * The kind a trigger's card shows, as the board names it: an entity block is Entity state or
 * Numeric threshold by what it watches, and the sun is a Time, picked under At.
 *
 * @param trigger - The trigger.
 * @param trigger.type - Its kind.
 * @param trigger.change - An entity trigger's change.
 * @param trigger.change.kind - State or numeric.
 * @returns The kind to look up.
 */
export function triggerKindOf(trigger: {
  readonly type: string;
  readonly change?: { readonly kind: string };
}): string {
  return trigger.type === 'entity' && trigger.change?.kind === 'numeric'
    ? 'entity_numeric'
    : trigger.type;
}

/**
 * The kind a condition's card shows, as the board names it: Entity state or Numeric, Between
 * two times or On certain days.
 *
 * @param condition - The condition.
 * @param condition.type - Its kind.
 * @param condition.match - An entity condition's match.
 * @param condition.match.kind - State or numeric.
 * @param condition.from - A time condition's start.
 * @param condition.to - A time condition's end.
 * @returns The kind to look up.
 */
export function conditionKindOf(condition: {
  readonly type: string;
  readonly match?: { readonly kind: string };
  readonly from?: string | undefined;
  readonly to?: string | undefined;
}): string {
  if (condition.type === 'entity' && condition.match?.kind === 'numeric') {
    return 'entity_numeric';
  }

  return condition.type === 'time' && condition.from === undefined && condition.to === undefined
    ? 'days'
    : condition.type;
}

/**
 * A block's glyph.
 *
 * @param family - The block's family.
 * @param kind - The block's kind.
 * @returns Its icon id.
 */
export function glyphForKind(family: BlockFamily, kind: string): UiIconId {
  return KINDS[family][kind]?.glyph ?? 'circle-dot';
}

/**
 * Why a kind of block cannot run.
 *
 * @param family - The block's family.
 * @param kind - The block's kind.
 * @returns The reason, or undefined when it can.
 */
export function unavailableReason(family: BlockFamily, kind: string): string | undefined {
  return KINDS[family][kind]?.unavailable;
}

/**
 * Whether this build knows a kind of block at all.
 *
 * @param family - The block's family.
 * @param kind - The block's kind.
 * @returns True when it has a label for it.
 */
export function isKnownKind(family: BlockFamily, kind: string): boolean {
  return KINDS[family][kind] !== undefined;
}

/** The trigger picker. */
export const TRIGGER_CHOICE_GROUPS: readonly EditorChoiceGroup[] = [
  {
    title: 'Triggers',
    lane: 'when',
    choices: toChoices('trigger', [
      'entity',
      'entity_numeric',
      'time',
      'event',
      'manual',
      'webhook',
    ]),
  },
];

/** The condition picker: every condition, and the groups that hold them. */
export const CONDITION_CHOICE_GROUPS: readonly EditorChoiceGroup[] = [
  {
    title: 'Conditions',
    lane: 'if',
    choices: toChoices('condition', [
      'entity',
      'entity_numeric',
      'time',
      'days',
      'sun',
      'expression',
    ]),
  },
  { title: 'Groups', lane: 'if', choices: toChoices('condition', ['and', 'or']) },
];

/** The Then picker: actions, then the blocks that hold others. */
export const ACTION_CHOICE_GROUPS: readonly EditorChoiceGroup[] = [
  {
    title: 'Actions',
    lane: 'then',
    choices: toChoices('action', [
      'command',
      'scene',
      'automation',
      'wait_duration',
      'wait_for',
      'wait_for_trigger',
      'notify',
      'package_service',
      'http_request',
    ]),
  },
  {
    title: 'Control',
    lane: 'control',
    choices: toChoices('action', [
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
