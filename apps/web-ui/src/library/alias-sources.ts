/**
 * An alias's sources as the editor holds them, and what their formula reads right now.
 *
 * **A source keeps its colour.** The colour was the first one free when the row was made, and
 * rows were re-coloured by position whenever the alias was opened, so removing `t1` turned `t2`
 * red on the next visit. Now the colour follows from the variable's name - the same name is the
 * same colour on every visit - and only when two names land on one colour does the second move
 * to the next free one.
 *
 * **The formula is worked out as it is typed**, with the same evaluator `core` runs and the
 * sources' live readings, so the editor can say "Reads 21.3 °C" or name what is wrong while the
 * person is still writing rather than after a save.
 */
import {
  aliasScalarFromState,
  evaluateAliasExpression,
  scanAliasExpression,
  TAG_COLORS,
  type AliasScalar,
  type AliasSourceInput,
  type EntityId,
  type EntityView,
  type TagColor,
} from '@nebulahome/contracts';

import { numberFormat } from '@/i18n/formatters';
import { translate } from '@/i18n/messages';
import { capabilityStateOf } from '@/library/entity-control';
import type { LiveReading } from '@/live/live-store';

/** One source as the form holds it. */
export type SourceDraft = {
  /** Which row this is, for React: fixed when the row is made, never an index. */
  readonly rowKey: string;
  readonly variableName: string;
  readonly entityId: string;
};

/** What a variable name must look like, as the contract checks it. */
export const VARIABLE_PATTERN = /^[a-z][a-z0-9_]{0,31}$/u;

/**
 * The colour a name would take on its own.
 *
 * @param name - The variable name.
 * @returns A palette colour that follows from the name.
 */
function preferredColor(name: string): TagColor {
  let hash = 0;

  for (const character of name) {
    hash = (hash * 31 + character.charCodeAt(0)) % 1_000_003;
  }

  return TAG_COLORS[hash % TAG_COLORS.length] ?? TAG_COLORS[0];
}

/**
 * The colour of every source row.
 *
 * @param sources - The rows, in order.
 * @returns Each row's colour, by its key: the name's own, or the next free one on a clash.
 */
export function sourceColors(sources: readonly SourceDraft[]): ReadonlyMap<string, TagColor> {
  const colors = new Map<string, TagColor>();
  const taken = new Set<TagColor>();

  for (const source of sources) {
    const preferred = preferredColor(source.variableName.trim());
    const start = TAG_COLORS.indexOf(preferred);
    const free =
      TAG_COLORS.map((unused, offset) => TAG_COLORS[(start + offset) % TAG_COLORS.length]).find(
        (color) => color !== undefined && !taken.has(color),
      ) ?? preferred;

    colors.set(source.rowKey, free);
    taken.add(free);
  }

  return colors;
}

/**
 * What is wrong with one row's variable name.
 *
 * @param sources - Every row.
 * @param index - The row asked about.
 * @returns A sentence, or null when the name is fine.
 */
export function variableProblem(sources: readonly SourceDraft[], index: number): string | null {
  const name = sources[index]?.variableName.trim() ?? '';

  if (name === '') {
    return translate('library.aliasSources.giveItAName', 'Give it a name the formula can use.');
  }

  if (!VARIABLE_PATTERN.test(name)) {
    return translate(
      'library.aliasSources.lowerCaseLettersDigits',
      'Lower-case letters, digits and _, starting with a letter.',
    );
  }

  if (sources.some((other, at) => at !== index && other.variableName.trim() === name)) {
    return translate(
      'library.aliasSources.anotherSourceIsAlready',
      'Another source is already called {{name}}.',
      { name },
    );
  }

  return null;
}

/**
 * Sources as the API wants them.
 *
 * @param drafts - What the form holds.
 * @returns The inputs, or null while any row is incomplete or badly named.
 */
export function toSources(drafts: readonly SourceDraft[]): AliasSourceInput[] | null {
  if (drafts.some((draft, index) => variableProblem(drafts, index) !== null)) {
    return null;
  }

  const sources: AliasSourceInput[] = [];

  for (const draft of drafts) {
    const entityId = draft.entityId.trim();

    if (entityId === '') {
      return null;
    }

    // The address was chosen from the registry, which only holds valid ones; the server checks
    // it again regardless.
    sources.push({ variableName: draft.variableName.trim(), entityId: entityId as EntityId });
  }

  return sources;
}

/**
 * A name for a new source that no row has yet.
 *
 * @param sources - The rows so far.
 * @returns `t1`, `t2`, … - the first free one.
 */
export function nextVariableName(sources: readonly SourceDraft[]): string {
  const used = new Set(sources.map((source) => source.variableName.trim()));
  let number = 1;

  while (used.has(`t${String(number)}`)) {
    number += 1;
  }

  return `t${String(number)}`;
}

/** What the formula reads now, as the field says it. */
export type FormulaReading =
  | { readonly tone: 'hint'; readonly text: string }
  | { readonly tone: 'value'; readonly text: string; readonly value: string }
  | { readonly tone: 'problem'; readonly text: string };

/**
 * How a figure is written in the reading.
 *
 * @returns The formatter, in the reader's language.
 */
const numbers = (): Intl.NumberFormat => numberFormat({ maximumFractionDigits: 2 });

/**
 * Writes a result the way the alias will show it.
 *
 * @param value - What the formula produced.
 * @param capability - What the alias reads as.
 * @param unit - The unit symbol, for a number.
 * @returns The words.
 */
function spokenResult(value: AliasScalar, capability: string, unit: string): string {
  if (typeof value === 'number') {
    return unit === '' ? numbers().format(value) : `${numbers().format(value)} ${unit}`;
  }

  if (typeof value === 'boolean') {
    return capability === 'sensor_binary' ? (value ? 'On' : 'Off') : String(value);
  }

  return `"${value}"`;
}

/**
 * Works out what a formula reads right now, from its sources' live readings.
 *
 * @param expression - The formula.
 * @param sources - The rows.
 * @param entities - Every entity, by address.
 * @param readings - What the live channel has said, by address.
 * @param result - What the alias reads as, and its unit symbol.
 * @param result.capability - The capability the alias exposes.
 * @param result.unit - Its unit, or empty.
 * @returns A hint while there is nothing to work out, the value, or why it cannot be worked out.
 */
export function readFormula(
  expression: string,
  sources: readonly SourceDraft[],
  entities: ReadonlyMap<string, EntityView>,
  readings: Readonly<Record<string, LiveReading>>,
  result: { readonly capability: string; readonly unit: string },
): FormulaReading {
  if (expression.trim() === '') {
    return {
      tone: 'hint',
      text: translate(
        'library.aliasSources.writeItWithThe',
        'Write it with the variables of the sources, e.g. (t1 + t2) / 2.',
      ),
    };
  }

  const names = new Set(sources.map((source) => source.variableName.trim()));
  const unknown = scanAliasExpression(expression)
    .filter((span) => span.kind === 'ident')
    .map((span) => expression.slice(span.start, span.end))
    .find((word) => !names.has(word));

  if (unknown !== undefined) {
    return {
      tone: 'problem',
      text: translate(
        'library.aliasSources.unknownIsNotOne',
        '{{unknown}} is not one of the sources.',
        { unknown },
      ),
    };
  }

  const bindings = new Map<string, AliasScalar>();

  for (const source of sources) {
    const entity = entities.get(source.entityId);

    if (entity === undefined) {
      return {
        tone: 'hint',
        text: translate(
          'library.aliasSources.chooseAnEntityFor',
          'Choose an entity for every source to see what it reads.',
        ),
      };
    }

    const value = aliasScalarFromState(capabilityStateOf(entity, readings[source.entityId]));

    if (value === undefined) {
      return {
        tone: 'hint',
        text: translate(
          'library.aliasSources.nothingToReadYet',
          '{{variable}} has nothing to read yet, so the formula waits for it.',
          { variable: source.variableName.trim() },
        ),
      };
    }

    bindings.set(source.variableName.trim(), value);
  }

  const evaluated = evaluateAliasExpression(expression, bindings);

  if (!evaluated.ok) {
    return { tone: 'problem', text: evaluated.error };
  }

  const spoken = spokenResult(evaluated.value, result.capability, result.unit);

  return {
    tone: 'value',
    text: translate('library.aliasSources.readsSpokenNow', 'Reads {{spoken}} now.', { spoken }),
    value: spoken,
  };
}
