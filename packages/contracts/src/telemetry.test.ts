import { describe, expect, it } from 'vitest';

import { HISTORY_IMPORT_MAX_READINGS, historyImportRequestSchema } from './telemetry.js';

describe('a history import request', () => {
  const request = {
    integrationId: 'pun-zone',
    entityId: 'sensor.pun_this_hour',
    readings: [{ observedAt: '2026-11-02T13:00:00.000Z', value: 0.21 }],
  };

  it('carries dated readings of one entity', () => {
    expect(historyImportRequestSchema.parse(request).readings).toEqual([
      { observedAt: new Date('2026-11-02T13:00:00.000Z'), value: 0.21 },
    ]);
  });

  it('refuses no readings, too many, an undated one and a number that is not one', () => {
    const reading = { observedAt: '2026-11-02T13:00:00.000Z', value: 1 };

    expect(historyImportRequestSchema.safeParse({ ...request, readings: [] }).success).toBe(false);
    expect(
      historyImportRequestSchema.safeParse({
        ...request,
        readings: Array.from({ length: HISTORY_IMPORT_MAX_READINGS + 1 }, () => reading),
      }).success,
    ).toBe(false);
    expect(
      historyImportRequestSchema.safeParse({ ...request, readings: [{ value: 1 }] }).success,
    ).toBe(false);
    expect(
      historyImportRequestSchema.safeParse({
        ...request,
        readings: [{ ...reading, value: Number.POSITIVE_INFINITY }],
      }).success,
    ).toBe(false);
  });
});
