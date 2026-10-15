/**
 * What a block says on its closed card: one sentence a person could read aloud.
 *
 * "Living room motion turns on", "Sunset, 15 min before", "22:00 → 06:30 (crosses midnight)",
 * "Living room ceiling · level 60% over 2 s". Names come from the house - the entity's name, the
 * scene's - through {@link BlockNames}; without one, the address is spelled out, so a summary still
 * reads before the house has been fetched. A block its author named reads as that name, and the
 * card is given this sentence for when the name is not enough.
 */
import {
  isConditionGroup,
  MONTHS,
  type AutomationAction,
  type AutomationTrigger,
  type ConditionNode,
  type DayOfWeek,
  type Month,
} from '@nebulahome/contracts';

import { cronWords } from '@/lib/cron-words';
import { formatDuration } from '@/lib/duration';
import { hsToHex, miredsToKelvin } from '@/library/entity-control';

/** Where the names in a summary come from. */
export type BlockNames = {
  /** An entity's name, or undefined when the house has none for it. */
  readonly entity: (entityId: string) => string | undefined;

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

/** The moments of the sun, as a card reads them. */
export const SUN_EVENT_WORDS: Readonly<Record<string, string>> = {
  sunrise: 'Sunrise',
  sunset: 'Sunset',
  dawn: 'Dawn',
  dusk: 'Dusk',
  solar_noon: 'Solar noon',
  solar_midnight: 'Solar midnight',
  golden_hour_start: 'Golden hour started',
  golden_hour_end: 'Golden hour ended',
  blue_hour_start: 'Blue hour started',
  blue_hour_end: 'Blue hour ended',
  midnight_sun_start: 'Midnight sun started',
  midnight_sun_end: 'Midnight sun ended',
  polar_night_start: 'Polar night started',
  polar_night_end: 'Polar night ended',
  elevation_crossed: 'Sun elevation crossed a limit',
  elevation_changed: 'Sun elevation changed',
};

/** The phases of the sun, as a condition card reads them. */
export const SUN_PHASE_WORDS: Readonly<Record<string, string>> = {
  day: 'Day',
  twilight: 'Twilight',
  night: 'Night',
  golden_hour: 'Golden hour',
  blue_hour: 'Blue hour',
  midnight_sun: 'Midnight sun',
  polar_night: 'Polar night',
  above: 'Sun above',
  below: 'Sun below',
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
 * The days of a block, as few words as say them.
 *
 * @param days - The days.
 * @param joiner - What goes between the last two: "and", "or".
 * @returns "Weekdays", "Saturday and Sunday", "Mon, Wed, Fri".
 */
export function daysPhrase(days: readonly DayOfWeek[], joiner = 'and'): string {
  const set = new Set(days);
  const weekdays: DayOfWeek[] = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'];

  if (set.size === 0 || set.size === 7) {
    return 'Every day';
  }

  if (set.size === 5 && weekdays.every((day) => set.has(day))) {
    return 'Weekdays';
  }

  if (set.size === 2 && set.has('saturday') && set.has('sunday')) {
    return joiner === 'and' ? 'Weekends' : 'Saturday or Sunday';
  }

  const ordered = (Object.keys(DAY_NAMES) as DayOfWeek[]).filter((day) => set.has(day));

  if (ordered.length <= 2) {
    return ordered.map((day) => DAY_NAMES[day]).join(` ${joiner} `);
  }

  return ordered.map((day) => DAY_NAMES[day].slice(0, 3)).join(', ');
}

/**
 * The months of a time trigger, as few words as say them: "June", "Jun–Aug", "Jan, Mar".
 *
 * @param months - The months.
 * @returns The words, or empty for every month.
 */
export function monthsPhrase(months: readonly Month[]): string {
  const indexes = [...new Set(months.map((month) => MONTHS.indexOf(month)))].toSorted(
    (left, right) => left - right,
  );

  if (indexes.length === 0 || indexes.length === 12) {
    return '';
  }

  /**
   * A month's name, short or long.
   *
   * @param index - Which, from 0.
   * @param isShort - Three letters.
   * @returns The name.
   */
  const name = (index: number, isShort: boolean): string => {
    const full = capitalised(MONTHS[index] ?? '');

    return isShort ? full.slice(0, 3) : full;
  };
  const [first = 0] = indexes;
  const last = indexes.at(-1) ?? first;
  const isRun = indexes.length > 2 && last - first === indexes.length - 1;

  if (indexes.length === 1) {
    return name(first, false);
  }

  return isRun
    ? `${name(first, true)}–${name(last, true)}`
    : indexes.map((index) => name(index, true)).join(', ');
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
 * An offset from a moment, in words: ", 15 min before".
 *
 * @param minutes - The offset; negative is before.
 * @returns The phrase, or nothing for none.
 */
function offsetPhrase(minutes: number | undefined): string {
  if (minutes === undefined || minutes === 0) {
    return '';
  }

  return `, ${formatDuration(Math.abs(minutes) * 60_000)} ${minutes < 0 ? 'before' : 'after'}`;
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
    case 'entity': {
      const name = entityName(names, trigger.entityId);
      const { change } = trigger;

      if (change.kind === 'numeric') {
        return `${name} ${CROSSES[change.operator] ?? change.operator} ${String(change.value)}${forPhrase(trigger.forMs)}`;
      }

      const to = change.to ?? '';
      const from = change.from ?? '';
      /**
       * A state token in the entity's own words.
       *
       * @param token - The token.
       * @returns The word, lower case.
       */
      const word = (token: string): string =>
        names.stateWord?.(trigger.entityId, token)?.toLowerCase() ?? token;
      const moves =
        to === ''
          ? from === ''
            ? 'changes'
            : `leaves ${word(from)}`
          : from === ''
            ? (BECOMES[to] ?? `becomes ${word(to)}`)
            : `goes from ${word(from)} to ${word(to)}`;

      return `${name} ${moves}${forPhrase(trigger.forMs)}`;
    }
    case 'time': {
      const { at } = trigger;

      if (at.kind === 'cron') {
        return cronWords(at.expression) ?? `On the schedule ${at.expression}`;
      }

      const days = daysPhrase(at.weekdays ?? []);
      const months = monthsPhrase(at.months ?? []);

      return `${days} at ${at.time}${months === '' ? '' : ` in ${months}`}`;
    }
    case 'sun': {
      const period =
        trigger.period === undefined ||
        !['golden_hour_start', 'golden_hour_end', 'blue_hour_start', 'blue_hour_end'].includes(
          trigger.event,
        )
          ? ''
          : ` (${trigger.period})`;

      if (trigger.event === 'elevation_crossed') {
        const way =
          trigger.direction === 'rising'
            ? ' rising'
            : trigger.direction === 'setting'
              ? ' setting'
              : '';

        return `Sun crosses ${String(trigger.elevation ?? 0)}°${way}${offsetPhrase(trigger.offsetMinutes)}`;
      }

      return `${SUN_EVENT_WORDS[trigger.event] ?? trigger.event}${period}${offsetPhrase(trigger.offsetMinutes)}`;
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
 * The states a condition accepts, in the entity's words: "on", "open or opening".
 *
 * @param entityId - The entity.
 * @param states - The tokens.
 * @param names - The house.
 * @returns The words.
 */
function statesPhrase(entityId: string, states: readonly string[], names: BlockNames): string {
  if (states.length === 0) {
    return '…';
  }

  return states
    .map((token) => names.stateWord?.(entityId, token)?.toLowerCase() ?? token)
    .join(' or ');
}

/**
 * What a condition checks, its NOT included.
 *
 * @param condition - The condition.
 * @param names - The house.
 * @returns The sentence.
 */
export function conditionSummary(condition: ConditionNode, names: BlockNames = NO_NAMES): string {
  const isNot = condition.isNot === true;

  if (isConditionGroup(condition)) {
    const count = condition.conditions.length;
    const what = `${String(count)} condition${count === 1 ? '' : 's'}`;

    if (condition.type === 'and') {
      return isNot ? `Not all of ${what}` : `All of ${what}`;
    }

    return isNot ? `None of ${what}` : `Any of ${what}`;
  }

  switch (condition.type) {
    case 'entity': {
      const name = entityName(names, condition.entityId);
      const { match } = condition;

      if (match.kind === 'numeric') {
        return `${name} ${isNot ? 'not ' : ''}${COMPARES[match.operator] ?? match.operator} ${String(match.value)}`;
      }

      return `${name} is ${isNot ? 'not ' : ''}${statesPhrase(condition.entityId, match.states, names)}`;
    }
    case 'time': {
      const { from, to, days = [] } = condition;
      const window =
        from !== undefined && to !== undefined
          ? `${from} → ${to}${crossesMidnight(from, to) ? ' (crosses midnight)' : ''}`
          : from === undefined
            ? to === undefined
              ? ''
              : `Until ${to}`
            : `From ${from}`;
      const onDays = days.length === 0 ? '' : daysPhrase(days, isNot ? 'or' : 'and');

      if (window === '') {
        return isNot ? `Not on ${onDays}` : onDays;
      }

      const said = onDays === '' ? window : `${window} · ${onDays}`;

      return isNot ? `Not ${lowerFirst(said)}` : said;
    }
    case 'sun': {
      const phase = SUN_PHASE_WORDS[condition.phase] ?? condition.phase;
      const said =
        condition.phase === 'above' || condition.phase === 'below'
          ? `${phase} ${String(condition.elevation ?? 0)}°`
          : phase;
      const period = condition.period === undefined ? '' : ` (${condition.period})`;

      return isNot ? `Not ${lowerFirst(said)}${period}` : `${said}${period}`;
    }
    case 'expression': {
      const said = condition.expression === '' ? 'Write an expression' : condition.expression;

      return isNot ? `Not: ${said}` : said;
    }
    default: {
      // A check this build no longer has: area occupancy, from an older automation.
      const gone = (condition as { readonly type?: unknown }).type;

      return `${capitalised((typeof gone === 'string' ? gone : 'check').replaceAll('_', ' '))} - not available any more`;
    }
  }
}

/**
 * What a list of conditions checks, as an If or a loop reads it.
 *
 * @param conditions - The list.
 * @param names - The house.
 * @returns One condition's sentence, a count, or "always" for none.
 */
export function conditionsPhrase(
  conditions: readonly ConditionNode[],
  names: BlockNames = NO_NAMES,
): string {
  const [only] = conditions;

  if (only === undefined) {
    return 'always';
  }

  return conditions.length === 1
    ? lowerFirst(conditionSummary(only, names))
    : `${String(conditions.length)} conditions hold`;
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
    case 'turn_on': {
      return `turn on${over}`;
    }
    case 'turn_off': {
      return `turn off${over}`;
    }
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
      const hue = typeof params['hue'] === 'number' ? params['hue'] : 0;
      const saturation = typeof params['saturation'] === 'number' ? params['saturation'] : 0;

      return `colour ${hsToHex(hue, saturation).toUpperCase()}${over}`;
    }
    case 'set_color_temp': {
      const mireds = typeof params['mireds'] === 'number' ? params['mireds'] : 0;

      return `white ${mireds > 0 ? `${String(miredsToKelvin(mireds))} K` : '…'}${over}`;
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
 * How many of something, in words.
 *
 * @param count - How many.
 * @param noun - What they are.
 * @param plural - The noun for more than one, when it is not the noun and an s.
 * @returns "1 block", "3 blocks", "2 branches".
 */
function counted(count: number, noun = 'block', plural = `${noun}s`): string {
  return `${String(count)} ${count === 1 ? noun : plural}`;
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
      return `Until ${conditionsPhrase(action.conditions, names)}, at most ${formatDuration(action.timeoutMs)}`;
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
      const blocks = action.branches.reduce((total, branch) => total + branch.length, 0);

      return `${counted(action.branches.length, 'branch', 'branches')} · ${counted(blocks)}`;
    }
    case 'sequence': {
      return `${counted(action.actions.length)}, one after the other`;
    }
    case 'switch': {
      return `On ${entityName(names, action.entityId)} · ${counted(action.cases.length, 'case')}`;
    }
    case 'while': {
      return action.conditions.length === 0
        ? 'While … - add a condition'
        : `While ${conditionsPhrase(action.conditions, names)}`;
    }
    case 'do_while': {
      return action.conditions.length === 0
        ? 'Again while … - add a condition'
        : `Again while ${conditionsPhrase(action.conditions, names)}`;
    }
    case 'if': {
      const branches = `${String(action.then.length)} then · ${action.else === undefined ? 'no else' : `${String(action.else.length)} else`}`;

      return action.conditions.length === 0
        ? `Always · ${branches}`
        : `If ${conditionsPhrase(action.conditions, names)} · ${branches}`;
    }
    case 'for': {
      return action.over.kind === 'count'
        ? `Repeat ${counted(action.over.count, 'time')} · ${counted(action.actions.length)}`
        : 'For each - not available yet';
    }
    case 'stop': {
      return 'Stop here';
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

  return [
    'Not:',
    'Not',
    'All',
    'Any',
    'None',
    'Every',
    'Weekdays',
    'Weekends',
    'From',
    'Until',
    'Day',
    'Night',
    'Twilight',
    'Golden',
    'Blue',
    'Midnight',
    'Polar',
    'Sun',
    'Sunrise',
    'Sunset',
    'Dawn',
    'Dusk',
    'Solar',
    'Only',
    'On',
    'An',
  ].includes(first)
    ? text.charAt(0).toLowerCase() + text.slice(1)
    : text;
}
