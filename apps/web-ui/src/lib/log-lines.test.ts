import { describe, expect, it } from 'vitest';

import { readLine, segmentsOf, withoutEscapes } from '@/lib/log-lines';

describe('readLine', () => {
  it("reads pino's JSON: its level by number and its message", () => {
    const line = readLine('{"level":40,"time":1,"msg":"An MQTT session failed","url":"mqtt://x"}');

    expect(line.level).toBe('warning');
    expect(line.message).toBe('An MQTT session failed');
    expect(line.json?.['url']).toBe('mqtt://x');
  });

  it("reads Zigbee2MQTT's own format", () => {
    expect(readLine('[2026-09-28 13:40:01] info: \tz2m: Starting Zigbee2MQTT').level).toBe('info');
    expect(readLine('[2026-09-28 13:40:02] error: \tz2m: Failed to start zigbee').level).toBe(
      'error',
    );
  });

  it('reads a bracketed or bare word near the start, and level=', () => {
    expect(readLine('[WARN] low disk').level).toBe('warning');
    expect(readLine('2026/09/28 13:40:01 ERROR could not bind').level).toBe('error');
    expect(readLine('time=1 level=debug msg=hello').level).toBe('debug');
  });

  it('gives a line that says nothing of its level none, and keeps a word inside a word', () => {
    expect(readLine('Listening on port 8080').level).toBeNull();
    expect(readLine('The errorless path').level).toBeNull();
  });

  it('keeps a line that only looks like JSON as text', () => {
    const line = readLine('{not json}');

    expect(line.json).toBeNull();
    expect(line.message).toBe('{not json}');
  });
});

describe('segmentsOf', () => {
  it('turns colour codes into stretches, and resets them', () => {
    expect(segmentsOf('\u001B[31merror\u001B[0m: \u001B[1mbold\u001B[22m done')).toEqual([
      { text: 'error', tone: 'danger', isBold: false },
      { text: ': ', tone: null, isBold: false },
      { text: 'bold', tone: null, isBold: true },
      { text: ' done', tone: null, isBold: false },
    ]);
  });

  it('removes every other escape sequence', () => {
    expect(withoutEscapes('\u001B[2Kcleared\u001B[1G line')).toBe('cleared line');
  });
});
