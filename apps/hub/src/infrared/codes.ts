/**
 * The Infrared broker's Import and Show code: reading what the owner pastes or drops, and writing a
 * code in the formats Show code copies. Pure, over the package runtime's codec.
 *
 * Import takes a Flipper Zero `.ir` file - by its name, or by the `Filetype:` line it opens with -
 * whose entries name their buttons; anything else is read a line at a time, each line Pronto hex
 * (learned, `0000 …`), raw timings in microseconds, or Broadlink base64, and named after its line.
 * A line or an entry that is not understood is kept with the reason, for the Import dialog's fold.
 */
import type { z } from 'zod';

import {
  INFRARED_MAXIMUM_BUTTONS,
  type InfraredCode,
  type InfraredImportItem,
  type infraredCodeFormatsReplySchema,
  type infraredImportParseReplySchema,
} from '@nebulahome/contracts';
import {
  decodeBroadlink,
  decodeInfraredProtocol,
  decodePronto,
  decodeRawTimings,
  encodeBroadlink,
  encodePronto,
  encodeRawTimings,
  parseFlipperIr,
  type InfraredImportProblem,
} from '@nebulahome/package-runtime';

/** What an import found: the codes, and the lines not understood with why. */
export type InfraredImportParsed = z.output<typeof infraredImportParseReplySchema>;

/** A code in each format Show code copies, and what it says of it. */
export type InfraredCodeFormats = z.output<typeof infraredCodeFormatsReplySchema>;

/** What a Flipper Zero file opens with. */
const FLIPPER_HEADER = /^\s*Filetype:\s*IR (?:signals|library) file/imu;

/** Learned Pronto: `0000`, then words of four hex digits. */
const PRONTO_LINE = /^0000(?:\s+[0-9a-f]{4})+$/iu;

/** Raw timings: numbers, signed or not, and what separates them. */
const RAW_LINE = /^[\d\s,;+\-[\]()]+$/u;

/** Broadlink: base64, no spaces. */
const BASE64_LINE = /^[A-Za-z0-9+/]+={0,2}$/u;

/**
 * A failure in a sentence, for the fold.
 *
 * @param error - Whatever was thrown.
 * @returns Its message, cut.
 */
function messageOf(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 512);
}

/**
 * A problem as the reply carries it.
 *
 * @param problem - The problem.
 * @returns It, its text and reason cut.
 */
function problemOf(problem: InfraredImportProblem): InfraredImportParsed['problems'][number] {
  return {
    line: problem.line,
    text: problem.text.slice(0, 256),
    reason: problem.reason.slice(0, 512),
  };
}

/**
 * Reads one pasted line.
 *
 * @param line - The line, trimmed.
 * @returns The code and the format it was in, or why it is not one.
 */
function readLine(
  line: string,
): { format: InfraredImportItem['format']; code: InfraredCode } | { reason: string } {
  try {
    if (PRONTO_LINE.test(line)) {
      return { format: 'pronto', code: decodePronto(line) };
    }

    if (RAW_LINE.test(line)) {
      return { format: 'raw', code: decodeRawTimings(line) };
    }

    if (BASE64_LINE.test(line)) {
      return { format: 'broadlink', code: decodeBroadlink(line) };
    }
  } catch (error: unknown) {
    return { reason: messageOf(error) };
  }

  return { reason: 'Not Broadlink base64, Pronto hex or raw timings' };
}

/**
 * Keeps as many codes as a remote holds, saying so when there were more.
 *
 * @param parsed - Everything found.
 * @returns What the reply carries.
 */
function capped(parsed: InfraredImportParsed): InfraredImportParsed {
  const extra =
    parsed.items.length > INFRARED_MAXIMUM_BUTTONS
      ? [
          {
            line: null,
            text: '',
            reason: `Only the first ${String(INFRARED_MAXIMUM_BUTTONS)} codes are read`,
          },
        ]
      : [];

  return {
    items: parsed.items.slice(0, INFRARED_MAXIMUM_BUTTONS),
    problems: [...extra, ...parsed.problems].slice(0, INFRARED_MAXIMUM_BUTTONS),
  };
}

/**
 * Reads pasted text or a dropped file.
 *
 * @param text - The text, or the file's contents.
 * @param fileName - The file's name, when one was dropped.
 * @returns The codes found, each named, and what was not understood.
 */
export function parseInfraredImport(text: string, fileName?: string): InfraredImportParsed {
  if (fileName?.toLowerCase().endsWith('.ir') === true || FLIPPER_HEADER.test(text)) {
    const file = parseFlipperIr(text);

    return capped({
      items: file.codes.map((each) => ({
        name: each.name.trim().slice(0, 64) || `Line ${String(each.line)}`,
        format: 'flipper',
        code: each.code,
      })),
      problems: file.problems.map(problemOf),
    });
  }

  const items: InfraredImportItem[] = [];
  const problems: InfraredImportParsed['problems'] = [];

  for (const [index, raw] of text.split(/\r?\n/u).entries()) {
    const line = raw.trim();

    if (line === '' || line.startsWith('#')) {
      continue;
    }

    const read = readLine(line);

    if ('code' in read) {
      items.push({ name: `Line ${String(index + 1)}`, format: read.format, code: read.code });
    } else {
      problems.push(problemOf({ line: index + 1, text: line, reason: read.reason }));
    }
  }

  return capped({ items, problems });
}

/**
 * Writes a code in each format Show code copies it as.
 *
 * @param code - The code.
 * @returns Broadlink base64, Pronto (null for RF), raw timings, and its protocol, pulses and
 * carrier.
 */
export function infraredCodeFormats(code: InfraredCode): InfraredCodeFormats {
  return {
    broadlink: encodeBroadlink(code),
    pronto: encodePronto(code),
    raw: encodeRawTimings(code),
    protocol:
      code.signal === 'ir' ? (code.protocol ?? decodeInfraredProtocol(code.pulses) ?? null) : null,
    pulseCount: code.pulses.length,
    carrierHz: code.carrierHz,
  };
}
