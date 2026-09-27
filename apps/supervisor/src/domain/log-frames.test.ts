import { describe, expect, it } from 'vitest';

import { parseLogs } from './log-frames.js';

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
