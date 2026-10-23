/**
 * What a block says on its closed card: one sentence a person could read aloud.
 *
 * "Living room motion turns on", "Sunset, 15 min before", "22:00 → 06:30 (crosses midnight)",
 * "Living room ceiling · level 60% over 2 s". Names come from the house - the entity's name, the
 * scene's - through {@link BlockNames}; without one, the address is spelled out, so a summary still
 * reads before the house has been fetched. A block its author named reads as that name, and the
 * card is given this sentence for when the name is not enough.
 *
 * Every sentence is a whole template in the catalogue, with the names and numbers put into it, so
 * a language orders its words its own way rather than this file gluing English pieces together.
 * Day and month names come from `Intl`, in the language the interface speaks.
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

import { dateTimeFormat, listFormat } from '@/i18n/formatters';
import { currentLocale } from '@/i18n/language';
import { defineMessage, text, translate, type Message } from '@/i18n/messages';
import { commandLabel } from '@/lib/command-choices';
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
 * A sentence, and whether it begins with a name - which keeps its capital when the sentence
 * follows another word ("If Living room lux below 50", but "If from 18:00").
 */
type Said = { readonly text: string; readonly isNamed: boolean };

/**
 * An address spelled out: `light.living_room` reads "living room".
 *
 * @param address - The entity id, or a key.
 * @returns The words.
 */
export function spelled(address: string): string {
  const [, object] = address.split('.');

  return (object ?? address).replaceAll('_', ' ');
}

/**
 * A phrase with its first letter raised.
 *
 * @param phrase - The phrase.
 * @returns It, capitalised.
 */
function capitalised(phrase: string): string {
  return phrase.charAt(0).toLocaleUpperCase(currentLocale()) + phrase.slice(1);
}

/**
 * A sentence made to follow another word: its first letter lowered, unless it begins with a name.
 *
 * @param said - The sentence.
 * @returns The phrase.
 */
function following(said: Said): string {
  return said.isNamed
    ? said.text
    : said.text.charAt(0).toLocaleLowerCase(currentLocale()) + said.text.slice(1);
}

/**
 * An entity's name, or the address spelled out.
 *
 * @param names - The house.
 * @param entityId - The entity.
 * @returns The name.
 */
function entityName(names: BlockNames, entityId: string): string {
  if (entityId === '') {
    return translate('automations.summary.chooseEntity', 'Choose an entity');
  }

  return names.entity(entityId) ?? capitalised(spelled(entityId));
}

/** What an entity entering a state does, by the state's word. */
const BECOMES: Readonly<Record<string, Message>> = {
  on: defineMessage('automations.summary.becomes.on', '{{name}} turns on'),
  off: defineMessage('automations.summary.becomes.off', '{{name}} turns off'),
  open: defineMessage('automations.summary.becomes.open', '{{name}} opens'),
  closed: defineMessage('automations.summary.becomes.closed', '{{name}} closes'),
  opening: defineMessage('automations.summary.becomes.opening', '{{name}} starts opening'),
  closing: defineMessage('automations.summary.becomes.closing', '{{name}} starts closing'),
  locked: defineMessage('automations.summary.becomes.locked', '{{name}} locks'),
  unlocked: defineMessage('automations.summary.becomes.unlocked', '{{name}} unlocks'),
  jammed: defineMessage('automations.summary.becomes.jammed', '{{name}} jams'),
  playing: defineMessage('automations.summary.becomes.playing', '{{name}} starts playing'),
  paused: defineMessage('automations.summary.becomes.paused', '{{name}} pauses'),
  stopped: defineMessage('automations.summary.becomes.stopped', '{{name}} stops'),
  unavailable: defineMessage(
    'automations.summary.becomes.unavailable',
    '{{name}} goes out of reach',
  ),
};

/** The comparisons, as a sentence reads them when a number moves. */
const CROSSES: Readonly<Record<string, Message>> = {
  lt: defineMessage('automations.summary.crosses.lt', '{{name}} drops below {{value}}'),
  lte: defineMessage('automations.summary.crosses.lte', '{{name}} drops to {{value}}'),
  gt: defineMessage('automations.summary.crosses.gt', '{{name}} rises above {{value}}'),
  gte: defineMessage('automations.summary.crosses.gte', '{{name}} reaches {{value}}'),
  eq: defineMessage('automations.summary.crosses.eq', '{{name}} reaches {{value}}'),
  neq: defineMessage('automations.summary.crosses.neq', '{{name}} moves off {{value}}'),
};

/** The comparisons, as a sentence reads them when a number holds. */
const COMPARES: Readonly<Record<string, Message>> = {
  lt: defineMessage('automations.summary.compares.lt', 'below'),
  lte: defineMessage('automations.summary.compares.lte', 'at most'),
  gt: defineMessage('automations.summary.compares.gt', 'above'),
  gte: defineMessage('automations.summary.compares.gte', 'at least'),
  eq: defineMessage('automations.summary.compares.eq', 'exactly'),
  neq: defineMessage('automations.summary.compares.neq', 'not'),
};

/** The week, Monday first, as `Intl` counts it from a Monday. */
const WEEK: readonly DayOfWeek[] = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
];

/**
 * A day's name in the interface's language.
 *
 * @param day - The day.
 * @param isShort - Its short name: "Mon".
 * @returns The name, capitalised.
 */
export function dayName(day: DayOfWeek, isShort = false): string {
  // 1 January 2024 was a Monday; UTC so no zone moves it to another day.
  const moment = Date.UTC(2024, 0, 1 + WEEK.indexOf(day), 12);

  return capitalised(
    dateTimeFormat({ weekday: isShort ? 'short' : 'long', timeZone: 'UTC' })
      .format(moment)
      .replace(/\.$/u, ''),
  );
}

/**
 * A month's name in the interface's language.
 *
 * @param index - Which, from 0.
 * @param isShort - Its short name: "Jun".
 * @returns The name, capitalised.
 */
function monthName(index: number, isShort: boolean): string {
  const moment = Date.UTC(2024, index, 15, 12);

  return capitalised(
    dateTimeFormat({ month: isShort ? 'short' : 'long', timeZone: 'UTC' })
      .format(moment)
      .replace(/\.$/u, ''),
  );
}

/** The moments of the sun, as a card reads them. */
const SUN_EVENTS: Readonly<Record<string, Message>> = {
  sunrise: defineMessage('sun.events.sunrise', 'Sunrise'),
  sunset: defineMessage('sun.events.sunset', 'Sunset'),
  dawn: defineMessage('sun.events.dawn', 'Dawn'),
  dusk: defineMessage('sun.events.dusk', 'Dusk'),
  solar_noon: defineMessage('sun.events.solarNoon', 'Solar noon'),
  solar_midnight: defineMessage('sun.events.solarMidnight', 'Solar midnight'),
  golden_hour_start: defineMessage('sun.events.goldenHourStart', 'Golden hour started'),
  golden_hour_end: defineMessage('sun.events.goldenHourEnd', 'Golden hour ended'),
  blue_hour_start: defineMessage('sun.events.blueHourStart', 'Blue hour started'),
  blue_hour_end: defineMessage('sun.events.blueHourEnd', 'Blue hour ended'),
  midnight_sun_start: defineMessage('sun.events.midnightSunStart', 'Midnight sun started'),
  midnight_sun_end: defineMessage('sun.events.midnightSunEnd', 'Midnight sun ended'),
  polar_night_start: defineMessage('sun.events.polarNightStart', 'Polar night started'),
  polar_night_end: defineMessage('sun.events.polarNightEnd', 'Polar night ended'),
  elevation_crossed: defineMessage('sun.events.elevationCrossed', 'Sun elevation crossed a limit'),
  elevation_changed: defineMessage('sun.events.elevationChanged', 'Sun elevation changed'),
};

/** The phases of the sun, as a condition card reads them. */
const SUN_PHASES: Readonly<Record<string, Message>> = {
  day: defineMessage('sun.phases.day', 'Day'),
  twilight: defineMessage('sun.phases.twilight', 'Twilight'),
  night: defineMessage('sun.phases.night', 'Night'),
  golden_hour: defineMessage('sun.phases.goldenHour', 'Golden hour'),
  blue_hour: defineMessage('sun.phases.blueHour', 'Blue hour'),
  midnight_sun: defineMessage('sun.phases.midnightSun', 'Midnight sun'),
  polar_night: defineMessage('sun.phases.polarNight', 'Polar night'),
  above: defineMessage('sun.phases.above', 'Sun above'),
  below: defineMessage('sun.phases.below', 'Sun below'),
};

/** Morning and evening, for the moments that come twice a day. */
const SUN_PERIODS: Readonly<Record<string, Message>> = {
  morning: defineMessage('sun.periods.morning', 'morning'),
  evening: defineMessage('sun.periods.evening', 'evening'),
};

/**
 * A moment of the sun in words.
 *
 * @param event - The moment: `sunrise`.
 * @returns How a card says it; the token for one this build does not know.
 */
export function sunEventWord(event: string): string {
  const known = SUN_EVENTS[event];

  return known === undefined ? event : text(known);
}

/**
 * A phase of the sun in words.
 *
 * @param phase - The phase: `night`.
 * @returns How a card says it; the token for one this build does not know.
 */
export function sunPhaseWord(phase: string): string {
  const known = SUN_PHASES[phase];

  return known === undefined ? phase : text(known);
}

/**
 * Morning or evening in words.
 *
 * @param period - The period.
 * @returns The word.
 */
function periodWord(period: string): string {
  const known = SUN_PERIODS[period];

  return known === undefined ? period : text(known);
}

/**
 * A sentence with how long it has to hold, when it has to.
 *
 * @param said - The sentence.
 * @param forMs - How long, or nothing.
 * @returns It, with the duration when there is one.
 */
function withFor(said: string, forMs: number | null | undefined): string {
  return forMs === null || forMs === undefined || forMs <= 0
    ? said
    : translate('automations.summary.withFor', '{{said}} for {{duration}}', {
        said,
        duration: formatDuration(forMs),
      });
}

/**
 * The days a schedule or a window keeps, in as few words as say them.
 *
 * @param days - The days; none means every day.
 * @param joiner - How two days join: `and` for a schedule, `or` for a NOT.
 * @returns "Weekdays", "Saturday and Sunday", "Mon, Wed, Fri".
 */
export function daysPhrase(days: readonly DayOfWeek[], joiner: 'and' | 'or' = 'and'): string {
  const set = new Set(days);
  const weekdays: DayOfWeek[] = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'];

  if (set.size === 0 || set.size === 7) {
    return translate('automations.summary.days.every', 'Every day');
  }

  if (set.size === 5 && weekdays.every((day) => set.has(day))) {
    return translate('automations.summary.days.weekdays', 'Weekdays');
  }

  if (set.size === 2 && set.has('saturday') && set.has('sunday')) {
    return joiner === 'and'
      ? translate('automations.summary.days.weekends', 'Weekends')
      : translate('automations.summary.days.saturdayOrSunday', 'Saturday or Sunday');
  }

  const ordered = WEEK.filter((day) => set.has(day));

  if (ordered.length <= 2) {
    return listFormat({
      style: 'long',
      type: joiner === 'and' ? 'conjunction' : 'disjunction',
    }).format(ordered.map((day) => dayName(day)));
  }

  return ordered.map((day) => dayName(day, true)).join(', ');
}

/**
 * The months a schedule keeps, in as few words as say them.
 *
 * @param months - The months; none or all of them is every month.
 * @returns "June", "Jun–Aug", "Jan, Mar"; empty for every month.
 */
export function monthsPhrase(months: readonly Month[]): string {
  const indexes = [...new Set(months.map((month) => MONTHS.indexOf(month)))].toSorted(
    (left, right) => left - right,
  );

  if (indexes.length === 0 || indexes.length === 12) {
    return '';
  }

  const [first = 0] = indexes;
  const last = indexes.at(-1) ?? first;
  const isRun = indexes.length > 2 && last - first === indexes.length - 1;

  if (indexes.length === 1) {
    return monthName(first, false);
  }

  return isRun
    ? `${monthName(first, true)}–${monthName(last, true)}`
    : indexes.map((index) => monthName(index, true)).join(', ');
}

/**
 * Says whether a window runs past midnight.
 *
 * @param from - Its start, `HH:mm`.
 * @param to - Its end.
 * @returns True when it ends before it starts.
 */
export function crossesMidnight(from: string, to: string): boolean {
  return to < from;
}

/**
 * A moment of the sun moved by an offset: "Sunset, 15 min before".
 *
 * @param said - The moment.
 * @param minutes - The offset; negative is before.
 * @returns The sentence.
 */
function withOffset(said: string, minutes: number | undefined): string {
  if (minutes === undefined || minutes === 0) {
    return said;
  }

  const duration = formatDuration(Math.abs(minutes) * 60_000);

  return minutes < 0
    ? translate('automations.summary.offsetBefore', '{{said}}, {{duration}} before', {
        said,
        duration,
      })
    : translate('automations.summary.offsetAfter', '{{said}}, {{duration}} after', {
        said,
        duration,
      });
}

/**
 * What a trigger waits for, and whether the sentence begins with a name.
 *
 * @param trigger - The trigger.
 * @param names - The house.
 * @returns The sentence.
 */
function triggerSaid(trigger: AutomationTrigger, names: BlockNames): Said {
  switch (trigger.type) {
    case 'entity': {
      const name = entityName(names, trigger.entityId);
      const { change } = trigger;

      if (change.kind === 'numeric') {
        const crosses = CROSSES[change.operator];
        const value = String(change.value);
        const said =
          crosses === undefined
            ? `${name} ${change.operator} ${value}`
            : text(crosses, { name, value });

        return { text: withFor(said, trigger.forMs), isNamed: true };
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
        names.stateWord?.(trigger.entityId, token)?.toLocaleLowerCase(currentLocale()) ?? token;
      const becomes = BECOMES[to];
      const said =
        to === ''
          ? from === ''
            ? translate('automations.summary.changes', '{{name}} changes', { name })
            : translate('automations.summary.leaves', '{{name}} leaves {{from}}', {
                name,
                from: word(from),
              })
          : from === ''
            ? becomes === undefined
              ? translate('automations.summary.becomesOther', '{{name}} becomes {{to}}', {
                  name,
                  to: word(to),
                })
              : text(becomes, { name })
            : translate('automations.summary.goesFromTo', '{{name}} goes from {{from}} to {{to}}', {
                name,
                from: word(from),
                to: word(to),
              });

      return { text: withFor(said, trigger.forMs), isNamed: true };
    }
    case 'time': {
      const { at } = trigger;

      if (at.kind === 'cron') {
        return {
          text:
            cronWords(at.expression) ??
            translate('automations.summary.cron', 'On the schedule {{expression}}', {
              expression: at.expression,
            }),
          isNamed: false,
        };
      }

      const days = daysPhrase(at.weekdays ?? []);
      const months = monthsPhrase(at.months ?? []);

      return {
        text:
          months === ''
            ? translate('automations.summary.at', '{{days}} at {{time}}', { days, time: at.time })
            : translate('automations.summary.atIn', '{{days}} at {{time}} in {{months}}', {
                days,
                time: at.time,
                months,
              }),
        isNamed: false,
      };
    }
    case 'sun': {
      if (trigger.event === 'elevation_crossed') {
        const elevation = String(trigger.elevation ?? 0);
        const said =
          trigger.direction === 'rising'
            ? translate(
                'automations.summary.sunCrossesRising',
                'Sun crosses {{elevation}}° rising',
                {
                  elevation,
                },
              )
            : trigger.direction === 'setting'
              ? translate(
                  'automations.summary.sunCrossesSetting',
                  'Sun crosses {{elevation}}° setting',
                  { elevation },
                )
              : translate('automations.summary.sunCrosses', 'Sun crosses {{elevation}}°', {
                  elevation,
                });

        return { text: withOffset(said, trigger.offsetMinutes), isNamed: false };
      }

      const event = sunEventWord(trigger.event);
      const isTwiceDaily = [
        'golden_hour_start',
        'golden_hour_end',
        'blue_hour_start',
        'blue_hour_end',
      ].includes(trigger.event);
      const said =
        trigger.period === undefined || !isTwiceDaily
          ? event
          : translate('automations.summary.withPeriod', '{{said}} ({{period}})', {
              said: event,
              period: periodWord(trigger.period),
            });

      return { text: withOffset(said, trigger.offsetMinutes), isNamed: false };
    }
    case 'event': {
      return {
        text:
          trigger.event === ''
            ? translate('automations.summary.eventUnavailable', 'An event - not available yet')
            : translate(
                'automations.summary.namedEventUnavailable',
                '{{event}} - not available yet',
                {
                  event: trigger.event,
                },
              ),
        isNamed: trigger.event !== '',
      };
    }
    case 'manual': {
      return {
        text: translate('automations.summary.manual', 'Only when somebody asks for it'),
        isNamed: false,
      };
    }
    case 'webhook': {
      const address = `…/hooks/${trigger.hookId.slice(0, 8)}`;

      return {
        text:
          trigger.method === 'any'
            ? translate('automations.summary.webhookAny', 'Called at {{address}}', { address })
            : translate('automations.summary.webhook', '{{method}} to {{address}}', {
                method: trigger.method,
                address,
              }),
        isNamed: trigger.method !== 'any',
      };
    }
  }
}

/**
 * An address as a card shows it: no scheme, and `…` for each parameter.
 *
 * @param url - The address, with `{{ name }}` where a parameter goes.
 * @returns `hooks.example.com/house/…/state`.
 */
export function shortAddress(url: string): string {
  return url.replace(/^https?:\/\//iu, '').replaceAll(/\{\{[^}]*\}\}/gu, '…');
}

/**
 * What a trigger waits for.
 *
 * @param trigger - The trigger.
 * @param names - The house.
 * @returns The sentence.
 */
export function triggerSummary(trigger: AutomationTrigger, names: BlockNames = NO_NAMES): string {
  return triggerSaid(trigger, names).text;
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

  return listFormat({ style: 'long', type: 'disjunction' }).format(
    states.map(
      (token) => names.stateWord?.(entityId, token)?.toLocaleLowerCase(currentLocale()) ?? token,
    ),
  );
}

/**
 * A sentence negated as a person would say it: "Not night", "Not from 18:00".
 *
 * @param said - The sentence.
 * @returns It, negated.
 */
function negated(said: Said): Said {
  return {
    text: translate('automations.summary.not', 'Not {{said}}', { said: following(said) }),
    isNamed: false,
  };
}

/**
 * What a condition checks, its NOT included, and whether the sentence begins with a name.
 *
 * @param condition - The condition.
 * @param names - The house.
 * @returns The sentence.
 */
function conditionSaid(condition: ConditionNode, names: BlockNames): Said {
  const isNot = condition.isNot === true;

  if (isConditionGroup(condition)) {
    const count = condition.conditions.length;
    const said =
      condition.type === 'and'
        ? isNot
          ? translate('automations.summary.group.notAll', {
              count,
              defaultValue_one: 'Not all of {{count}} condition',
              defaultValue_other: 'Not all of {{count}} conditions',
            })
          : translate('automations.summary.group.all', {
              count,
              defaultValue_one: 'All of {{count}} condition',
              defaultValue_other: 'All of {{count}} conditions',
            })
        : isNot
          ? translate('automations.summary.group.none', {
              count,
              defaultValue_one: 'None of {{count}} condition',
              defaultValue_other: 'None of {{count}} conditions',
            })
          : translate('automations.summary.group.any', {
              count,
              defaultValue_one: 'Any of {{count}} condition',
              defaultValue_other: 'Any of {{count}} conditions',
            });

    return { text: said, isNamed: false };
  }

  switch (condition.type) {
    case 'entity': {
      const name = entityName(names, condition.entityId);
      const { match } = condition;

      if (match.kind === 'numeric') {
        const compares = COMPARES[match.operator];
        const comparison = compares === undefined ? match.operator : text(compares);
        const value = String(match.value);

        return {
          text: isNot
            ? translate(
                'automations.summary.isNotCompared',
                '{{name}} not {{comparison}} {{value}}',
                {
                  name,
                  comparison,
                  value,
                },
              )
            : translate('automations.summary.isCompared', '{{name}} {{comparison}} {{value}}', {
                name,
                comparison,
                value,
              }),
          isNamed: true,
        };
      }

      const states = statesPhrase(condition.entityId, match.states, names);

      return {
        text: isNot
          ? translate('automations.summary.isNot', '{{name}} is not {{states}}', { name, states })
          : translate('automations.summary.is', '{{name}} is {{states}}', { name, states }),
        isNamed: true,
      };
    }
    case 'time': {
      const { from, to, days = [] } = condition;
      const window =
        from !== undefined && to !== undefined
          ? crossesMidnight(from, to)
            ? translate(
                'automations.summary.windowMidnight',
                '{{from}} → {{to}} (crosses midnight)',
                {
                  from,
                  to,
                },
              )
            : `${from} → ${to}`
          : from === undefined
            ? to === undefined
              ? ''
              : translate('automations.summary.until', 'Until {{to}}', { to })
            : translate('automations.summary.from', 'From {{from}}', { from });
      const onDays = days.length === 0 ? '' : daysPhrase(days, isNot ? 'or' : 'and');

      if (window === '') {
        return {
          text: isNot
            ? translate('automations.summary.notOn', 'Not on {{days}}', { days: onDays })
            : onDays,
          isNamed: false,
        };
      }

      const said: Said = { text: onDays === '' ? window : `${window} · ${onDays}`, isNamed: false };

      return isNot ? negated(said) : said;
    }
    case 'sun': {
      const phase = sunPhaseWord(condition.phase);
      const shown =
        condition.phase === 'above' || condition.phase === 'below'
          ? `${phase} ${String(condition.elevation ?? 0)}°`
          : phase;
      const said: Said = {
        text: isNot ? negated({ text: shown, isNamed: false }).text : shown,
        isNamed: false,
      };

      return condition.period === undefined
        ? said
        : {
            text: translate('automations.summary.withPeriod', '{{said}} ({{period}})', {
              said: said.text,
              period: periodWord(condition.period),
            }),
            isNamed: false,
          };
    }
    case 'expression': {
      const said =
        condition.expression === ''
          ? translate('automations.summary.writeExpression', 'Write an expression')
          : condition.expression;

      return {
        text: isNot
          ? translate('automations.summary.notExpression', 'Not: {{said}}', { said })
          : said,
        isNamed: condition.expression !== '' && !isNot,
      };
    }
    default: {
      // A check this build no longer has: area occupancy, from an older automation.
      const gone = (condition as { readonly type?: unknown }).type;

      return {
        text: translate('automations.summary.gone', '{{check}} - not available any more', {
          check: capitalised((typeof gone === 'string' ? gone : 'check').replaceAll('_', ' ')),
        }),
        isNamed: true,
      };
    }
  }
}

/**
 * What a condition checks, its NOT included.
 *
 * @param condition - The condition.
 * @param names - The house.
 * @returns The sentence.
 */
export function conditionSummary(condition: ConditionNode, names: BlockNames = NO_NAMES): string {
  return conditionSaid(condition, names).text;
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
    return translate('automations.summary.always', 'always');
  }

  return conditions.length === 1
    ? following(conditionSaid(only, names))
    : translate('automations.summary.conditionsHold', {
        count: conditions.length,
        defaultValue_one: '{{count}} condition holds',
        defaultValue_other: '{{count}} conditions hold',
      });
}

/**
 * What a command body does, in a few words: "turn on", "level 60% over 2 s".
 *
 * @param params - The command body.
 * @returns The phrase.
 */
export function commandPhrase(params: Readonly<Record<string, unknown>>): string {
  const command = typeof params['command'] === 'string' ? params['command'] : '';
  const transitionMs = typeof params['transitionMs'] === 'number' ? params['transitionMs'] : 0;
  /**
   * A phrase with how long the change takes, when it takes any time.
   *
   * @param said - The phrase.
   * @returns It, with the transition.
   */
  const over = (said: string): string =>
    transitionMs > 0
      ? translate('automations.summary.over', '{{said}} over {{duration}}', {
          said,
          duration: formatDuration(transitionMs),
        })
      : said;

  switch (command) {
    case 'turn_on': {
      return over(translate('automations.summary.commands.turnOn', 'turn on'));
    }
    case 'turn_off': {
      return over(translate('automations.summary.commands.turnOff', 'turn off'));
    }
    case 'set_level': {
      return over(
        translate('automations.summary.commands.level', 'level {{level}}%', {
          level: String(params['level']),
        }),
      );
    }
    case 'set_position': {
      return translate('automations.summary.commands.position', 'position {{position}}%', {
        position: String(params['position']),
      });
    }
    case 'set_tilt': {
      return translate('automations.summary.commands.tilt', 'tilt {{tilt}}%', {
        tilt: String(params['tilt']),
      });
    }
    case 'set_target': {
      return translate('automations.summary.commands.target', 'target {{temperature}}°', {
        temperature: String(params['temperature']),
      });
    }
    case 'set_mode': {
      return translate('automations.summary.commands.mode', 'mode {{mode}}', {
        mode: String(params['mode']),
      });
    }
    case 'set_volume': {
      return translate('automations.summary.commands.volume', 'volume {{volume}}%', {
        volume: String(params['volume']),
      });
    }
    case 'set_color': {
      const hue = typeof params['hue'] === 'number' ? params['hue'] : 0;
      const saturation = typeof params['saturation'] === 'number' ? params['saturation'] : 0;

      return over(
        translate('automations.summary.commands.colour', 'colour {{hex}}', {
          hex: hsToHex(hue, saturation).toUpperCase(),
        }),
      );
    }
    case 'set_color_temp': {
      const mireds = typeof params['mireds'] === 'number' ? params['mireds'] : 0;

      return over(
        translate('automations.summary.commands.white', 'white {{kelvin}}', {
          kelvin: mireds > 0 ? `${String(miredsToKelvin(mireds))} K` : '…',
        }),
      );
    }
    case 'select_option': {
      return translate('automations.summary.commands.option', 'option {{option}}', {
        option: String(params['option']),
      });
    }
    case 'set_value': {
      return translate('automations.summary.commands.value', 'value {{value}}', {
        value: String(params['value']),
      });
    }
    case 'set_source': {
      return translate('automations.summary.commands.source', 'source {{source}}', {
        source: String(params['source']),
      });
    }
    case 'set_mute': {
      return params['isMuted'] === true
        ? translate('automations.summary.commands.mute', 'mute')
        : translate('automations.summary.commands.unmute', 'unmute');
    }
    case 'clean_rooms': {
      const rooms = Array.isArray(params['rooms']) ? params['rooms'].length : 0;

      return translate('automations.summary.commands.cleanRooms', 'clean {{count}} rooms', {
        count: String(rooms),
      });
    }
    case 'record': {
      return translate('automations.summary.commands.record', 'record for {{seconds}} s', {
        seconds: String(params['durationSeconds']),
      });
    }
    case '': {
      return translate('automations.summary.commands.choose', 'choose what to do');
    }
    default: {
      return commandLabel(command).toLocaleLowerCase(currentLocale());
    }
  }
}

/**
 * How many blocks, in words.
 *
 * @param count - How many.
 * @returns "1 block", "3 blocks".
 */
function blocks(count: number): string {
  return translate('automations.summary.blocks', {
    count,
    defaultValue_one: '{{count}} block',
    defaultValue_other: '{{count}} blocks',
  });
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
        ? translate('automations.summary.chooseScene', 'Choose a scene')
        : (names.scene?.(action.sceneKey) ?? capitalised(spelled(action.sceneKey)));
    }
    case 'automation': {
      return action.automationKey === ''
        ? translate('automations.summary.chooseAutomation', 'Choose an automation')
        : (names.automation?.(action.automationKey) ?? capitalised(spelled(action.automationKey)));
    }
    case 'wait_duration': {
      return formatDuration(action.durationMs);
    }
    case 'wait_for': {
      return translate('automations.summary.waitFor', 'Until {{what}}, at most {{duration}}', {
        what: conditionsPhrase(action.conditions, names),
        duration: formatDuration(action.timeoutMs),
      });
    }
    case 'wait_for_trigger': {
      return translate('automations.summary.waitFor', 'Until {{what}}, at most {{duration}}', {
        what: following(triggerSaid(action.trigger, names)),
        duration: formatDuration(action.timeoutMs),
      });
    }
    case 'notify': {
      return translate(
        'automations.summary.notifyUnavailable',
        '{{channel}} · "{{message}}" - not available yet',
        { channel: action.channel, message: action.message },
      );
    }
    case 'package_service': {
      return action.packageId === ''
        ? translate('automations.summary.choosePackage', 'Choose a package')
        : `${action.packageId} · ${action.service}`;
    }
    case 'http_request': {
      return action.url === ''
        ? translate('automations.summary.chooseAddress', 'Write the address')
        : `${action.method} ${shortAddress(action.url)}`;
    }
    case 'parallel': {
      const count = action.branches.reduce((total, branch) => total + branch.length, 0);
      const branches = translate('automations.summary.branches', {
        count: action.branches.length,
        defaultValue_one: '{{count}} branch',
        defaultValue_other: '{{count}} branches',
      });

      return `${branches} · ${blocks(count)}`;
    }
    case 'sequence': {
      return translate('automations.summary.sequence', '{{blocks}}, one after the other', {
        blocks: blocks(action.actions.length),
      });
    }
    case 'switch': {
      return translate('automations.summary.switch', 'On {{name}} · {{cases}}', {
        name: entityName(names, action.entityId),
        cases: translate('automations.summary.cases', {
          count: action.cases.length,
          defaultValue_one: '{{count}} case',
          defaultValue_other: '{{count}} cases',
        }),
      });
    }
    case 'while': {
      return action.conditions.length === 0
        ? translate('automations.summary.whileEmpty', 'While … - add a condition')
        : translate('automations.summary.while', 'While {{conditions}}', {
            conditions: conditionsPhrase(action.conditions, names),
          });
    }
    case 'do_while': {
      return action.conditions.length === 0
        ? translate('automations.summary.againWhileEmpty', 'Again while … - add a condition')
        : translate('automations.summary.againWhile', 'Again while {{conditions}}', {
            conditions: conditionsPhrase(action.conditions, names),
          });
    }
    case 'if': {
      const then = translate('automations.summary.thenCount', '{{count}} then', {
        count: action.then.length,
      });
      const otherwise =
        action.else === undefined
          ? translate('automations.summary.noElse', 'no else')
          : translate('automations.summary.elseCount', '{{count}} else', {
              count: action.else.length,
            });
      const branches = `${then} · ${otherwise}`;

      return action.conditions.length === 0
        ? translate('automations.summary.alwaysBranches', 'Always · {{branches}}', { branches })
        : translate('automations.summary.if', 'If {{conditions}} · {{branches}}', {
            conditions: conditionsPhrase(action.conditions, names),
            branches,
          });
    }
    case 'for': {
      return action.over.kind === 'count'
        ? translate('automations.summary.repeat', 'Repeat {{times}} · {{blocks}}', {
            times: translate('automations.summary.times', {
              count: action.over.count,
              defaultValue_one: '{{count}} time',
              defaultValue_other: '{{count}} times',
            }),
            blocks: blocks(action.actions.length),
          })
        : translate('automations.summary.forEachUnavailable', 'For each - not available yet');
    }
    case 'stop': {
      return translate('automations.summary.stop', 'Stop here');
    }
  }
}
