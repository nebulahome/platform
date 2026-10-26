import { describe, expect, it } from 'vitest';

import { freeName } from '@/routes/library/automation/http-request-fields';

describe('freeName', () => {
  it('gives the first p-number not taken', () => {
    expect(freeName([])).toBe('p1');
    expect(freeName(['p1', 'p2'])).toBe('p3');
    expect(freeName(['p2', 'door'])).toBe('p1');
  });
});
