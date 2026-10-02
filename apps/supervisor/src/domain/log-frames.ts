/**
 * A container's logs, read out of the bytes Docker sends them in.
 *
 * A container without a terminal has its two streams multiplexed into one: each frame is an
 * eight-byte header - the stream, three zero bytes, the length - and then that many bytes. One
 * with a terminal has one stream, as it was written. With `timestamps` asked for, every line
 * starts with the time Docker received it, to the nanosecond.
 *
 * That time is also where a page following the log carries on from: kept to the nanosecond, as
 * Docker's own `since` takes it, so the next read asks from exactly the last line - Docker answers
 * that line again, `since` being inclusive, and it is left out here.
 */
import {
  CONTAINER_LOG_MAXIMUM_CHARACTERS,
  type ContainerLogLine,
  type ContainerLogsReply,
} from '@nebulahome/contracts';

/** The length of a frame's header. */
const HEADER_BYTES = 8;

/** The longest line kept, so one runaway line cannot fill the page. */
const MAXIMUM_LINE_LENGTH = 16_384;

/** A line's leading time, as Docker writes it. */
const TIMESTAMP = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(\.\d+)?(Z|[+-]\d{2}:\d{2}) /;

/** Nanoseconds in a second, as a bigint. */
const NANOS_PER_SECOND = 1_000_000_000n;

/** One line, and the time Docker received it to the nanosecond, when it carried one. */
export type LogEntry = {
  readonly line: ContainerLogLine;
  readonly nanos: bigint | null;
};

/**
 * Splits one line into its time and its text.
 *
 * @param line - The line as Docker sent it.
 * @param stream - Which stream it came on.
 * @returns The line, its time kept to the millisecond, and to the nanosecond beside it.
 */
function parseLine(line: string, stream: ContainerLogLine['stream']): LogEntry {
  const match = TIMESTAMP.exec(line);

  if (match === null) {
    return { line: { at: null, stream, text: line.slice(0, MAXIMUM_LINE_LENGTH) }, nanos: null };
  }

  const [whole, seconds = '', fraction = '', zone = ''] = match;
  const at = new Date(`${seconds}${fraction.slice(0, 4)}${zone}`);
  const wholeMs = new Date(`${seconds}${zone}`).getTime();
  const nanos = Number.isNaN(wholeMs)
    ? null
    : BigInt(wholeMs / 1000) * NANOS_PER_SECOND +
      BigInt(fraction.slice(1).padEnd(9, '0').slice(0, 9) || '0');

  return {
    line: {
      at: Number.isNaN(at.getTime()) ? null : at,
      stream,
      text: line.slice(whole.length).slice(0, MAXIMUM_LINE_LENGTH),
    },
    nanos,
  };
}

/**
 * A cursor, as the nanoseconds it stands for.
 *
 * @param cursor - `1790608123.123456789`.
 * @returns The nanoseconds since 1970.
 */
export function nanosOfCursor(cursor: string): bigint {
  const [seconds = '0', fraction = ''] = cursor.split('.');

  return BigInt(seconds) * NANOS_PER_SECOND + BigInt(fraction.padEnd(9, '0').slice(0, 9) || '0');
}

/**
 * Nanoseconds, as a cursor - and as Docker's `since` takes them.
 *
 * @param nanos - The nanoseconds since 1970.
 * @returns `1790608123.123456789`.
 */
export function cursorOfNanos(nanos: bigint): string {
  const seconds = nanos / NANOS_PER_SECOND;
  const fraction = nanos % NANOS_PER_SECOND;

  return `${seconds.toString()}.${fraction.toString().padStart(9, '0')}`;
}

/**
 * Splits text into lines, dropping the empty last one a trailing newline leaves.
 *
 * @param text - The text.
 * @returns Its lines.
 */
function splitLines(text: string): string[] {
  const all = text.replaceAll('\r\n', '\n').split('\n');

  return all.at(-1) === '' ? all.slice(0, -1) : all;
}

/**
 * Reads the lines out of what `GET /containers/{id}/logs` answered.
 *
 * @param bytes - The answer.
 * @param hasTerminal - Whether the container has a terminal: its logs are then not multiplexed.
 * @returns Every line, oldest first.
 */
export function parseLogs(bytes: Buffer, hasTerminal: boolean): ContainerLogLine[] {
  return parseLogEntries(bytes, hasTerminal).map((entry) => entry.line);
}

/**
 * Reads the lines out of what `GET /containers/{id}/logs` answered, each with its time to the
 * nanosecond.
 *
 * @param bytes - The answer.
 * @param hasTerminal - Whether the container has a terminal: its logs are then not multiplexed.
 * @returns Every line, oldest first.
 */
export function parseLogEntries(bytes: Buffer, hasTerminal: boolean): LogEntry[] {
  if (hasTerminal) {
    return splitLines(bytes.toString('utf8')).map((line) => parseLine(line, 'stdout'));
  }

  const lines: LogEntry[] = [];
  const pending: Record<ContainerLogLine['stream'], string> = { stdout: '', stderr: '' };
  let offset = 0;

  while (offset + HEADER_BYTES <= bytes.length) {
    const stream = bytes[offset] === 2 ? 'stderr' : 'stdout';
    const length = bytes.readUInt32BE(offset + 4);
    const start = offset + HEADER_BYTES;
    const end = Math.min(start + length, bytes.length);

    pending[stream] += bytes.toString('utf8', start, end);
    offset = end;

    // A frame usually holds whole lines; one that ends mid-line is completed by the next frame
    // of the same stream.
    const text = pending[stream];
    const last = text.lastIndexOf('\n');

    if (last !== -1) {
      lines.push(...splitLines(text.slice(0, last + 1)).map((line) => parseLine(line, stream)));
      pending[stream] = text.slice(last + 1);
    }
  }

  for (const stream of ['stdout', 'stderr'] as const) {
    if (pending[stream].length > 0) {
      lines.push(parseLine(pending[stream], stream));
    }
  }

  return lines;
}

/**
 * What a read of a container's log answers: the newest lines, after the cursor when there is
 * one, as many as asked and no heavier than a reply may be, and where the next read carries on.
 *
 * @param entries - Every line Docker sent, oldest first.
 * @param options - How many lines, and after which cursor.
 * @param options.tail - How many at most.
 * @param options.since - Only those after it; what the last read answered.
 * @returns The reply.
 */
export function logsReplyOf(
  entries: readonly LogEntry[],
  options: { readonly tail: number; readonly since?: string | undefined },
): ContainerLogsReply {
  const after = options.since === undefined ? null : nanosOfCursor(options.since);
  const fresh =
    after === null
      ? entries
      : entries.filter((entry) => entry.nanos === null || entry.nanos > after);
  const newest = fresh.slice(-options.tail);
  const kept: LogEntry[] = [];
  let weight = 0;

  for (let index = newest.length - 1; index >= 0; index -= 1) {
    const entry = newest[index];

    if (entry === undefined) {
      continue;
    }

    weight += entry.line.text.length + 64;

    if (weight > CONTAINER_LOG_MAXIMUM_CHARACTERS) {
      break;
    }

    kept.unshift(entry);
  }

  const last = [...kept].reverse().find((entry) => entry.nanos !== null)?.nanos ?? null;

  return {
    lines: kept.map((entry) => entry.line),
    cursor: last === null ? (options.since ?? null) : cursorOfNanos(last),
    isTruncated: kept.length < fresh.length && kept.length < options.tail,
  };
}
