import { describe, expect, it } from 'vitest';

import { matterPairingCodeSchema } from './matter.js';

describe('matterPairingCodeSchema', () => {
  it('reads a manual code as written, groups and all', () => {
    expect(matterPairingCodeSchema.parse('3497-011-2332')).toBe('34970112332');
    expect(matterPairingCodeSchema.parse(' 3497 011 2332 ')).toBe('34970112332');
    expect(matterPairingCodeSchema.parse('749701123365521327694')).toBe('749701123365521327694');
  });

  it('keeps a QR code as its text', () => {
    expect(matterPairingCodeSchema.parse('MT:Y.K9042C00KA0648G00')).toBe('MT:Y.K9042C00KA0648G00');
  });

  it('refuses what is no pairing code', () => {
    expect(matterPairingCodeSchema.safeParse('1234').success).toBe(false);
    expect(matterPairingCodeSchema.safeParse('3497-011-233a').success).toBe(false);
    expect(matterPairingCodeSchema.safeParse('MT:short').success).toBe(false);
    expect(matterPairingCodeSchema.safeParse('').success).toBe(false);
  });
});
