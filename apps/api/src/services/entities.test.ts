/**
 * The pure part of the entity reads: the owner columns becoming the one `source` the contract
 * names.
 */
import { describe, expect, it } from 'vitest';

import { toSourceRef } from './entities.js';

describe('toSourceRef', () => {
  it('names the package that registered an adapter entity', () => {
    expect(toSourceRef('adapter', 'pkg-mqtt', null)).toBe('pkg-mqtt');
  });

  it('names the integration instance that registered an adapter entity', () => {
    expect(toSourceRef('adapter', null, 'bambu-lab-1')).toBe('bambu-lab-1');
  });

  it('keeps the reserved kinds as they are', () => {
    expect(toSourceRef('derived', null, null)).toBe('derived');
    expect(toSourceRef('system', null, null)).toBe('system');
  });
});
