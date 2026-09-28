/**
 * Making sense of one line a program wrote, for a log that is read rather than scrolled past:
 * how grave it is, what colours it asked for, and whether it is JSON.
 *
 * Programs agree on none of it, so each is a guess that fails quietly: a line whose level cannot
 * be read has none, a colour code that is not a plain one is dropped, and a line that only looks
 * like JSON stays text.
 *
 * - **Level**, from the formats met on this platform's containers: pino's JSON (`"level":30`,
 *   the platform's own services), a JSON `level` or `severity` word, `level=info`, Zigbee2MQTT's
 *   `[2026-09-28 13:40:01] info:`, and a bracketed or bare word near the start - `[WARN]`,
 *   `ERROR`.
 * - **Colours**: ANSI SGR codes - the sixteen colours, bold, reset - turned into segments the
 *   viewer draws with the theme's own tones, never inserted as markup; every other escape
 *   sequence is removed.
 */

/** How grave a line is, as far as it says. */
export type LogLevel = 'error' | 'warning' | 'info' | 'debug';

/** A tone the theme has, which a coloured stretch of a line is drawn in. */
export type LogTone = 'danger' | 'warning' | 'success' | 'accent' | 'subtle';

/** One stretch of a line, in one colour. */
export type LogSegment = {
  readonly text: string;
  readonly tone: LogTone | null;
  readonly isBold: boolean;
};

/** A line read: its level, its message, and the JSON it was, when it was. */
export type ReadLine = {
  readonly level: LogLevel | null;

  /** What to show: the message of a JSON line, else the whole line without its escape codes. */
  readonly message: string;

  /** The message's coloured stretches. */
  readonly segments: readonly LogSegment[];

  /** The whole object, for a line that was JSON; null otherwise. */
  readonly json: Readonly<Record<string, unknown>> | null;
};

/** Every escape sequence a terminal knows, the colours among them. */
// eslint-disable-next-line no-control-regex -- the escape character is what is being looked for
const ESCAPES = /\u001B\[[0-?]*[ -/]*[@-~]|\u001B[@-Z\\-_]/gu;

/** One colour code: `ESC [ … m`. */
// eslint-disable-next-line no-control-regex -- the escape character is what is being looked for
const SGR = /\u001B\[([0-9;]*)m/gu;

/** The tone of each foreground colour code. */
const TONES: Readonly<Record<number, LogTone>> = {
  30: 'subtle',
  31: 'danger',
  32: 'success',
  33: 'warning',
  34: 'accent',
  35: 'accent',
  36: 'accent',
  90: 'subtle',
  91: 'danger',
  92: 'success',
  93: 'warning',
  94: 'accent',
  95: 'accent',
  96: 'accent',
};

/** A level's word, in the spellings programs use. */
const LEVEL_WORDS: Readonly<Record<string, LogLevel>> = {
  fatal: 'error',
  panic: 'error',
  crit: 'error',
  critical: 'error',
  err: 'error',
  error: 'error',
  warn: 'warning',
  warning: 'warning',
  notice: 'info',
  info: 'info',
  information: 'info',
  debug: 'debug',
  trace: 'debug',
  verbose: 'debug',
};

/** A level word near the start of a line: `[WARN]`, `] info:`, `ERROR `, `level=debug`. */
const LEVEL_NEAR_START =
  /(?:^|[\s[\]|:(])(?:level=)?(fatal|panic|crit(?:ical)?|err(?:or)?|warn(?:ing)?|notice|info(?:rmation)?|debug|trace|verbose)(?=$|[\s\]:|,)])/iu;

/**
 * A level, from pino's number.
 *
 * @param value - 10 trace to 60 fatal.
 * @returns The level.
 */
function levelOfNumber(value: number): LogLevel {
  if (value >= 50) {
    return 'error';
  }

  if (value >= 40) {
    return 'warning';
  }

  return value >= 30 ? 'info' : 'debug';
}

/**
 * A level, from a word.
 *
 * @param word - The word.
 * @returns The level, or null for a word that is none.
 */
function levelOfWord(word: string): LogLevel | null {
  return LEVEL_WORDS[word.toLowerCase()] ?? null;
}

/**
 * Removes every escape sequence.
 *
 * @param text - The line.
 * @returns It, plain.
 */
export function withoutEscapes(text: string): string {
  return text.replaceAll(ESCAPES, '');
}

/**
 * Splits a line into its coloured stretches.
 *
 * @param text - The line, escape codes and all.
 * @returns Its stretches; one plain stretch for a line without colour.
 */
export function segmentsOf(text: string): LogSegment[] {
  const segments: LogSegment[] = [];
  let tone: LogTone | null = null;
  let isBold = false;
  let from = 0;

  /**
   * Adds the stretch before a code, its escape sequences removed.
   *
   * @param to - Where it ends.
   */
  const push = (to: number): void => {
    const part = withoutEscapes(text.slice(from, to));

    if (part !== '') {
      segments.push({ text: part, tone, isBold });
    }
  };

  for (const match of text.matchAll(SGR)) {
    push(match.index);
    from = match.index + match[0].length;

    const codes = (match[1] ?? '').split(';').map((code) => (code === '' ? 0 : Number(code)));

    for (const code of codes) {
      if (code === 0) {
        tone = null;
        isBold = false;
      } else if (code === 1) {
        isBold = true;
      } else if (code === 22) {
        isBold = false;
      } else if (code === 39) {
        tone = null;
      } else if (TONES[code] !== undefined) {
        tone = TONES[code];
      }
    }
  }

  push(text.length);

  return segments;
}

/**
 * Reads a line that is a JSON object, when it is one.
 *
 * @param text - The line, plain.
 * @returns The object, or null.
 */
function jsonOf(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();

  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) {
    return null;
  }

  try {
    const value: unknown = JSON.parse(trimmed);

    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * Reads one line: its level, its message, its colours, and its JSON.
 *
 * @param text - The line as the program wrote it.
 * @returns It, read.
 */
export function readLine(text: string): ReadLine {
  const plain = withoutEscapes(text);
  const json = jsonOf(plain);

  if (json !== null) {
    const raw = json['level'] ?? json['severity'] ?? json['lvl'];
    const level =
      typeof raw === 'number'
        ? levelOfNumber(raw)
        : typeof raw === 'string'
          ? levelOfWord(raw)
          : null;
    const said = json['msg'] ?? json['message'];
    const message = typeof said === 'string' && said !== '' ? said : plain;

    return { level, message, segments: [{ text: message, tone: null, isBold: false }], json };
  }

  const near = LEVEL_NEAR_START.exec(plain.slice(0, 64));

  return {
    level: near?.[1] === undefined ? null : levelOfWord(near[1]),
    message: plain,
    segments: segmentsOf(text),
    json: null,
  };
}
