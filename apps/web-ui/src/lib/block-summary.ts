/**
 * What a block says on its closed card: one sentence a person could read aloud.
 *
 * "Living room motion turns on", "Sunset, 15 min before", "22:00 → 06:30 (crosses midnight)",
 * "Living room ceiling · level 60% over 2 s". Names come from the house - the entity's name, the
 * room's, the scene's - through {@link BlockNames}; without one, the address is spelled out, so a
 * summary still reads before the house has been fetched.
 */
import type {
  AutomationAction,
  AutomationCondition,
  AutomationTrigger,
  BooleanTree,
  DayOfWeek,
} from '@nebulahome/contracts';

import { formatDuration } from '@/lib/duration';

/** Where the names in a summary come from. */
export type BlockNames = {
  /** An entity's name, or undefined when the house has none for it. */
  readonly entity: (entityId: string) => string | undefined;

  /** An area's name, by its key. */
  readonly area?: (areaKey: string) => string | undefined;

  /** A scene's name, by its key. */
  readonly scene?: (sceneKey: string) => string | undefined;

  /** An automation's name, by its key. */
  readonly automation?: (automationKey: string) => string | undefined;

  /** A state of an entity in its own words: a motion sensor's `on` is "Detected". */
  readonly stateWord?: (entityId: string, token: string) => string | undefined;
};

/** Names when there is no house to read them from: the addresses, spelled out. */
export const NO_NAMES: BlockNames = {
  /**
   * Knows no entity's name.
   *
   * @returns Nothing.
   */
  entity: () => undefined,
};

/**
 * An address spelled out: `light.living_room` reads "living room".
 *
 * @param address - The address or key.
 * @returns The words.
 */
export function spelled(address: string): string {
  const [, object] = address.split('.');

  return (object ?? address).replaceAll('_', ' ');
}

/**
 * The first letter raised.
 *
 * @param text - The text.
 * @returns It, capitalised.
 */
function capitalised(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * An entity's name, or what to say when none was chosen.
 *
 * @param names - The house.
 * @param entityId - The entity.
 * @returns Its name.
 */
function entityName(names: BlockNames, entityId: string): string {
  if (entityId === '') {
    return 'Choose an entity';
  }

  return names.entity(entityId) ?? capitalised(spelled(entityId));
}

/** What an entity entering a state does, by the state's word. */
const BECOMES: Readonly<Record<string, string>> = {
  on: 'turns on',
  off: 'turns off',
  open: 'opens',
  closed: 'closes',
  opening: 'starts opening',
  closing: 'starts closing',
  locked: 'locks',
  unlocked: 'unlocks',
  jammed: 'jams',
  playing: 'starts playing',
  paused: 'pauses',
  stopped: 'stops',
  unavailable: 'goes out of reach',
};

/** What an entity being in a state is, by the state's word. */
const IS: Readonly<Record<string, string>> = {
  on: 'is on',
  off: 'is off',
  unavailable: 'is out of reach',
};

/** The comparisons, as a sentence reads them when a number moves. */
const CROSSES: Readonly<Record<string, string>> = {
  lt: 'drops below',
  lte: 'drops to',
  gt: 'rises above',
  gte: 'reaches',
  eq: 'reaches',
  neq: 'moves off',
};

/** The comparisons, as a sentence reads them when a number holds. */
const COMPARES: Readonly<Record<string, string>> = {
  lt: 'below',
  lte: 'at most',
  gt: 'above',
  gte: 'at least',
  eq: 'exactly',
  neq: 'not',
};

/** Day names. */
const DAY_NAMES: Readonly<Record<DayOfWeek, string>> = {
  monday: 'Monday',
  tuesday: 'Tuesday',
  wednesday: 'Wednesday',
  thursday: 'Thursday',
  friday: 'Friday',
  saturday: 'Saturday',
  sunday: 'Sunday',
};

/**
 * " for 2 min", or nothing.
 *
 * @param forMs - How long a state must hold.
 * @returns The phrase.
 */
function forPhrase(forMs: number | null | undefined): string {
  return forMs === null || forMs === undefined || forMs <= 0 ? '' : ` for ${formatDuration(forMs)}`;
}

/**
 * What a trigger waits for.
 *
 * @param trigger - The trigger.
 * @param names - The house.
 * @returns The sentence.
 */
export function triggerSummary(trigger: AutomationTrigger, names: BlockNames = NO_NAMES): string {
  switch (trigger.type) {
    case 'state': {
      const name = entityName(names, trigger.entityId);
      const to = trigger.to ?? '';
      const from = trigger.from ?? '';
      const moves =
        to === ''
          ? from === ''
            ? 'changes'
            : `leaves ${from}`
          : from === ''
            ? (BECOMES[to] ?? `becomes ${to}`)
            : `goes from ${from} to ${to}`;

      return `${name} ${moves}${forPhrase(trigger.forMs)}`;
    }
    case 'numeric_state': {
      return `${entityName(names, trigger.entityId)} ${CROSSES[trigger.operator] ?? trigger.operator} ${String(trigger.value)}${forPhrase(trigger.forMs)}`;
    }
    case 'time': {
      const { at } = trigger;

      if (at.kind === 'clock') {
        return `Every day at ${at.time}`;
      }

      if (at.kind === 'cron') {
        return `On the schedule ${at.expression}`;
      }

      const event = capitalised(at.event);

      if (at.offsetMinutes === 0) {
        return event;
      }

      return `${event}, ${formatDuration(Math.abs(at.offsetMinutes) * 60_000)} ${at.offsetMinutes < 0 ? 'before' : 'after'}`;
    }
    case 'event': {
      return `${trigger.event === '' ? 'An event' : trigger.event} - not available yet`;
    }
    case 'manual': {
      return 'Only when somebody asks for it';
    }
  }
}

/**
 * The days of a condition, as few words as say them.
 *
 * @param days - The days.
 * @param joiner - What goes between the last two: "and", "or".
 * @returns "Weekdays", "Saturday and Sunday", "Mon, Wed, Fri".
 */
export function daysPhrase(days: readonly DayOfWeek[], joiner = 'and'): string {
  const set = new Set(days);
  const weekdays: DayOfWeek[] = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'];

  if (set.size === 7) {
    return 'Every day';
  }

  if (set.size === 5 && weekdays.every((day) => set.has(day))) {
    return 'Weekdays';
  }

  const ordered = (Object.keys(DAY_NAMES) as DayOfWeek[]).filter((day) => set.has(day));

  if (ordered.length <= 2) {
    return ordered.map((day) => DAY_NAMES[day]).join(` ${joiner} `);
  }

  return ordered.map((day) => DAY_NAMES[day].slice(0, 3)).join(', ');
}

/**
 * Whether a time window ends the next day.
 *
 * @param from - Its start.
 * @param to - Its end.
 * @returns True when it crosses midnight.
 */
export function crossesMidnight(from: string, to: string): boolean {
  return to < from;
}

/**
 * What a condition checks.
 *
 * @param condition - The check, negated or not.
 * @param names - The house.
 * @returns The sentence.
 */
export function conditionSummary(
  condition: AutomationCondition | BooleanTree,
  names: BlockNames = NO_NAMES,
): string {
  if ('op' in condition) {
    if (condition.op === 'not') {
      return negatedSummary(condition.item, names);
    }

    return `${condition.op === 'and' ? 'All' : 'Any'} of ${String(condition.items.length)} checks`;
  }

  switch (condition.type) {
    case 'not': {
      return negatedSummary(condition.condition, names);
    }
    case 'and':
    case 'or': {
      return `${condition.type === 'and' ? 'All' : 'Any'} of ${String(condition.conditions.length)} checks`;
    }
    case 'state': {
      const word = names.stateWord?.(condition.entityId, condition.state);

      return `${entityName(names, condition.entityId)} ${
        word === undefined || condition.state === ''
          ? (IS[condition.state] ?? `is ${condition.state === '' ? '…' : condition.state}`)
          : `is ${word.toLowerCase()}`
      }`;
    }
    case 'numeric': {
      return `${entityName(names, condition.entityId)} ${COMPARES[condition.operator] ?? condition.operator} ${String(condition.value)}`;
    }
    case 'time_window': {
      return `${condition.from} → ${condition.to}${crossesMidnight(condition.from, condition.to) ? ' (crosses midnight)' : ''}`;
    }
    case 'day_of_week': {
      return daysPhrase(condition.days);
    }
    case 'area_occupancy': {
      const area =
        condition.areaKey === ''
          ? 'a room'
          : `the ${names.area?.(condition.areaKey) ?? capitalised(spelled(condition.areaKey))}`;

      return `${condition.isOccupied ? 'Somebody' : 'Nobody'} is in ${area}`;
    }
    case 'expression': {
      return condition.expression === '' ? 'Write an expression' : condition.expression;
    }
  }
}

/**
 * What a negated check says.
 *
 * @param condition - The check inside the NOT.
 * @param names - The house.
 * @returns The sentence.
 */
function negatedSummary(condition: AutomationCondition | BooleanTree, names: BlockNames): string {
  if (!('op' in condition)) {
    if (condition.type === 'day_of_week') {
      return `Not on ${daysPhrase(condition.days, 'or')}`;
    }

    if (condition.type === 'area_occupancy') {
      return conditionSummary({ ...condition, isOccupied: !condition.isOccupied }, names);
    }

    if (condition.type === 'state') {
      const word = names.stateWord?.(condition.entityId, condition.state) ?? condition.state;

      return `${entityName(names, condition.entityId)} is not ${condition.state === '' ? '…' : word.toLowerCase()}`;
    }
  }

  return `Not: ${conditionSummary(condition, names)}`;
}

/**
 * What a command body does, in a few words: "turn on", "level 60% over 2 s".
 *
 * @param params - The command body.
 * @returns The phrase.
 */
export function commandPhrase(params: Readonly<Record<string, unknown>>): string {
  const command = typeof params['command'] === 'string' ? params['command'] : '';
  const over =
    typeof params['transitionMs'] === 'number' && params['transitionMs'] > 0
      ? ` over ${formatDuration(params['transitionMs'])}`
      : '';

  switch (command) {
    case 'set_level': {
      return `level ${String(params['level'])}%${over}`;
    }
    case 'set_position': {
      return `position ${String(params['position'])}%`;
    }
    case 'set_tilt': {
      return `tilt ${String(params['tilt'])}%`;
    }
    case 'set_target': {
      return `target ${String(params['temperature'])}°`;
    }
    case 'set_mode': {
      return `mode ${String(params['mode'])}`;
    }
    case 'set_volume': {
      return `volume ${String(params['volume'])}%`;
    }
    case 'set_color': {
      return `colour ${String(params['hue'])}° ${String(params['saturation'])}%${over}`;
    }
    case 'set_color_temp': {
      return `white ${String(params['mireds'])} mired${over}`;
    }
    case 'select_option': {
      return `option ${String(params['option'])}`;
    }
    case 'set_value': {
      return `value ${String(params['value'])}`;
    }
    case '': {
      return 'choose what to do';
    }
    default: {
      return command.replaceAll('_', ' ');
    }
  }
}

/**
 * What an action does.
 *
 * @param action - The action.
 * @param names - The house.
 * @returns The sentence.
 */
export function actionSummary(action: AutomationAction, names: BlockNames = NO_NAMES): string {
  switch (action.type) {
    case 'command': {
      return `${entityName(names, action.entityId)} · ${commandPhrase(action.params)}`;
    }
    case 'scene': {
      return action.sceneKey === ''
        ? 'Choose a scene'
        : (names.scene?.(action.sceneKey) ?? capitalised(spelled(action.sceneKey)));
    }
    case 'automation': {
      return action.automationKey === ''
        ? 'Choose an automation'
        : (names.automation?.(action.automationKey) ?? capitalised(spelled(action.automationKey)));
    }
    case 'wait_duration': {
      return formatDuration(action.durationMs);
    }
    case 'wait_for': {
      return `Until ${lowerFirst(conditionSummary(action.condition, names))}, at most ${formatDuration(action.timeoutMs)}`;
    }
    case 'wait_for_trigger': {
      return `Until ${lowerFirst(triggerSummary(action.trigger, names))}, at most ${formatDuration(action.timeoutMs)}`;
    }
    case 'notify': {
      return `${action.channel} · "${action.message}" - not available yet`;
    }
    case 'package_service': {
      return action.packageId === ''
        ? 'Choose a package'
        : `${action.packageId} · ${action.service}`;
    }
    case 'parallel': {
      return `${String(action.actions.length)} branch${action.actions.length === 1 ? '' : 'es'} side by side`;
    }
    case 'sequence': {
      return `${String(action.actions.length)} in order`;
    }
    case 'switch': {
      return `On ${entityName(names, action.entityId)} · ${String(action.cases.length)} case${action.cases.length === 1 ? '' : 's'}`;
    }
    case 'while': {
      return `While ${lowerFirst(conditionSummary(action.condition, names))}`;
    }
    case 'do_while': {
      return `Again while ${lowerFirst(conditionSummary(action.condition, names))}`;
    }
    case 'if': {
      const branches = `${String(action.then.length)} then · ${action.else === undefined ? 'no else' : `${String(action.else.length)} else`}`;

      return `If ${lowerFirst(conditionSummary(action.condition, names))} · ${branches}`;
    }
    case 'for': {
      return action.over.kind === 'count'
        ? `${String(action.over.count)} time${action.over.count === 1 ? '' : 's'}`
        : 'For each - not available yet';
    }
    case 'stop': {
      return 'Stop';
    }
  }
}

/**
 * The first letter lowered, so a phrase can follow "If" - unless it starts a name, which a
 * capital after the first letter gives away ("Living room …" stays, "Somebody is …" lowers).
 *
 * @param text - The phrase.
 * @returns It, to follow another word.
 */
function lowerFirst(text: string): string {
  const [first = ''] = text.split(' ');

  return ['Somebody', 'Nobody', 'Not:', 'Not', 'All', 'Any', 'Every', 'Weekdays'].includes(first)
    ? text.charAt(0).toLowerCase() + text.slice(1)
    : text;
}
