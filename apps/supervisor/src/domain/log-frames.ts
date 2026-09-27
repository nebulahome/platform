/**
 * A container's logs, read out of the bytes Docker sends them in.
 *
 * A container without a terminal has its two streams multiplexed into one: each frame is an
 * eight-byte header - the stream, three zero bytes, the length - and then that many bytes. One
 * with a terminal has one stream, as it was written. With `timestamps` asked for, every line
 * starts with the time Docker received it, to the nanosecond.
 */
import type { ContainerLogLine } from '@nebula-home/contracts';

/** The length of a frame's header. */
const HEADER_BYTES = 8;

/** The longest line kept, so one runaway line cannot fill the page. */
const MAXIMUM_LINE_LENGTH = 16_384;

/** A line's leading time, as Docker writes it. */
const TIMESTAMP = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(\.\d+)?(Z|[+-]\d{2}:\d{2}) /;

/**
 * Splits one line into its time and its text.
 *
 * @param line - The line as Docker sent it.
 * @param stream - Which stream it came on.
 * @returns The line, its time kept to the millisecond.
 */
function parseLine(line: string, stream: ContainerLogLine['stream']): ContainerLogLine {
  const match = TIMESTAMP.exec(line);

  if (match === null) {
    return { at: null, stream, text: line.slice(0, MAXIMUM_LINE_LENGTH) };
  }

  const [whole, seconds = '', fraction = '', zone = ''] = match;
  const at = new Date(`${seconds}${fraction.slice(0, 4)}${zone}`);

  return {
    at: Number.isNaN(at.getTime()) ? null : at,
    stream,
    text: line.slice(whole.length).slice(0, MAXIMUM_LINE_LENGTH),
  };
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
  if (hasTerminal) {
    return splitLines(bytes.toString('utf8')).map((line) => parseLine(line, 'stdout'));
  }

  const lines: ContainerLogLine[] = [];
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
