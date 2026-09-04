import { describe, expect, it } from 'vitest';

import { formatLogContext, formatLogLine } from './format.js';

describe('formatLogLine', () => {
  it('renders the documented shape', () => {
    const line = formatLogLine({
      time: '2026-09-04T10:35:19.852Z',
      level: 'info',
      service: 'core',
      msg: 'Entity registered',
    });

    expect(line).toBe('[2026-09-04T10:35:19.852Z][core][INFO] Entity registered');
  });

  it('names the package rather than the service that supervises it', () => {
    // An owner installed `nvr`; they never installed `packet-manager`.
    const line = formatLogLine({
      time: '2026-09-04T10:35:19.852Z',
      level: 'warn',
      service: 'packet-manager',
      packageId: 'nvr',
      msg: 'Camera stream dropped',
    });

    expect(line).toBe('[2026-09-04T10:35:19.852Z][nvr][WARN] Camera stream dropped');
  });

  it('accepts the numeric level history.logs stores', () => {
    const fromDatabase = formatLogLine({
      time: '2026-09-04T10:35:19.852Z',
      level: 50,
      service: 'api',
      msg: 'Request failed',
    });

    expect(fromDatabase).toBe('[2026-09-04T10:35:19.852Z][api][ERROR] Request failed');
  });

  it('renders a record identically whether it came from pino or from the database', () => {
    // The same event, encoded the two ways the platform actually stores it. If these ever
    // diverge, a line pasted from the live tail stops matching the same line in a terminal.
    const fromPino = formatLogLine({
      time: '2026-09-04T10:35:19.852Z',
      level: 'debug',
      service: 'core',
      msg: 'Handling command',
    });

    const fromDatabase = formatLogLine({
      time: new Date('2026-09-04T10:35:19.852Z'),
      level: 20,
      service: 'core',
      msg: 'Handling command',
    });

    expect(fromDatabase).toBe(fromPino);
  });

  it('accepts epoch milliseconds', () => {
    const line = formatLogLine({ time: 1_788_525_319_852, level: 'info', service: 'core' });

    expect(line.startsWith('[2026-')).toBe(true);
  });

  it('falls back rather than rendering an empty bracket', () => {
    expect(formatLogLine({ time: '2026-09-04T10:35:19.852Z' })).toBe(
      '[2026-09-04T10:35:19.852Z][unknown][LOG] ',
    );
  });

  it('does not pad the level', () => {
    // A fixed-width level would only align messages if the name bracket were fixed-width too,
    // and `core` against `packet-manager` guarantees it never is.
    const line = formatLogLine({ time: '2026-09-04T10:35:19.852Z', level: 'info', service: 'x' });

    expect(line).toContain('[INFO]');
  });
});

describe('formatLogContext', () => {
  it('renders whatever the record carries beyond the prefix', () => {
    const context = formatLogContext({
      time: '2026-09-04T10:35:19.852Z',
      level: 'info',
      service: 'core',
      msg: 'Entity registered',
      entityId: 'light.kitchen_ceiling',
    });

    expect(context).toBe('{"entityId":"light.kitchen_ceiling"}');
  });

  it('keeps the trace identifier, which varies per request', () => {
    const context = formatLogContext({ service: 'api', traceId: '01JD8Z4K2P9QF3M7X1V6R8T2NB' });

    expect(context).toContain('01JD8Z4K2P9QF3M7X1V6R8T2NB');
  });

  it('drops the version, which is identical on every line a process emits', () => {
    expect(formatLogContext({ service: 'core', version: '1.2.3' })).toBe('');
  });

  it('drops the process fields pino adds, which say nothing about the event', () => {
    expect(formatLogContext({ service: 'core', pid: 4242, hostname: 'nebula' })).toBe('');
  });

  it('returns nothing when the record is only its prefix', () => {
    expect(formatLogContext({ time: 1, level: 'info', service: 'core', msg: 'Started' })).toBe('');
  });
});
