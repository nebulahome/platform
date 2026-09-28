import { describe, expect, it } from 'vitest';

import {
  cursorOfNanos,
  logsReplyOf,
  nanosOfCursor,
  parseLogEntries,
  parseLogs,
} from './log-frames.js';

/**
 * One multiplexed frame, as Docker writes it.
 *
 * @param stream - 1 for stdout, 2 for stderr.
 * @param text - What the frame carries.
 * @returns The frame's bytes.
 */
function frame(stream: 1 | 2, text: string): Buffer {
  const body = Buffer.from(text, 'utf8');
  const header = Buffer.alloc(8);

  header[0] = stream;
  header.writeUInt32BE(body.length, 4);

  return Buffer.concat([header, body]);
}

describe('parseLogs', () => {
  it('reads the two streams out of a multiplexed answer, with their times', () => {
    const lines = parseLogs(
      Buffer.concat([
        frame(1, '2026-09-27T14:02:44.097123456Z Zigbee2MQTT started\n'),
        frame(2, '2026-09-27T14:02:45.000000000Z Failed to connect to the adapter\n'),
      ]),
      false,
    );

    expect(lines).toEqual([
      {
        at: new Date('2026-09-27T14:02:44.097Z'),
        stream: 'stdout',
        text: 'Zigbee2MQTT started',
      },
      {
        at: new Date('2026-09-27T14:02:45.000Z'),
        stream: 'stderr',
        text: 'Failed to connect to the adapter',
      },
    ]);
  });

  it('joins a line split across two frames of the same stream', () => {
    const lines = parseLogs(
      Buffer.concat([frame(1, '2026-09-27T14:02:44Z half a '), frame(1, 'line\n')]),
      false,
    );

    expect(lines.map((line) => line.text)).toEqual(['half a line']);
  });

  it('reads a container with a terminal as one stream', () => {
    const lines = parseLogs(Buffer.from('2026-09-27T14:02:44Z ready\nno time here\n'), true);

    expect(lines).toEqual([
      { at: new Date('2026-09-27T14:02:44Z'), stream: 'stdout', text: 'ready' },
      { at: null, stream: 'stdout', text: 'no time here' },
    ]);
  });

  it('keeps a last line that has no newline', () => {
    expect(parseLogs(frame(1, 'unfinished'), false)).toEqual([
      { at: null, stream: 'stdout', text: 'unfinished' },
    ]);
  });
});

describe('reading a log again from where the last read ended', () => {
  const answer = Buffer.concat([
    frame(1, '2026-09-27T14:02:44.1Z first\n'),
    frame(1, '2026-09-27T14:02:44.123456789Z second\n'),
    frame(2, '2026-09-27T14:02:45Z third\n'),
  ]);

  it('keeps each time to the nanosecond, and turns it into a cursor and back', () => {
    const entries = parseLogEntries(answer, false);
    const second = entries[1]?.nanos ?? 0n;

    expect(cursorOfNanos(second)).toBe('1790517764.123456789');
    expect(nanosOfCursor('1790517764.123456789')).toBe(second);
    expect(cursorOfNanos(entries[0]?.nanos ?? 0n)).toBe('1790517764.100000000');
  });

  it('answers the newest lines and the cursor of the last', () => {
    const reply = logsReplyOf(parseLogEntries(answer, false), { tail: 2 });

    expect(reply.lines.map((line) => line.text)).toEqual(['second', 'third']);
    expect(reply.cursor).toBe('1790517765.000000000');
    expect(reply.isTruncated).toBe(false);
  });

  it('leaves out the line at the cursor, which Docker sends again, and what came before', () => {
    const reply = logsReplyOf(parseLogEntries(answer, false), {
      tail: 200,
      since: '1790517764.123456789',
    });

    expect(reply.lines.map((line) => line.text)).toEqual(['third']);
  });

  it('keeps the cursor it was asked with when nothing new came', () => {
    const reply = logsReplyOf([], { tail: 200, since: '1790517765.000000000' });

    expect(reply).toEqual({ lines: [], cursor: '1790517765.000000000', isTruncated: false });
  });

  it('keeps the newest lines when the reply would weigh too much', () => {
    const long = 'x'.repeat(16_000);
    const many = Buffer.concat(
      [...Array.from({ length: 40 }).keys()].map((index) =>
        frame(
          1,
          `2026-09-27T14:02:${String(10 + index).padStart(2, '0')}Z ${long}${String(index)}\n`,
        ),
      ),
    );
    const reply = logsReplyOf(parseLogEntries(many, false), { tail: 200 });

    expect(reply.isTruncated).toBe(true);
    expect(reply.lines.length).toBeLessThan(40);
    expect(reply.lines.at(-1)?.text.endsWith('39')).toBe(true);
  });
});
