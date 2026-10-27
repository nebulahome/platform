import { describe, expect, it } from 'vitest';

import {
  infraredCodeSchema,
  infraredDeviceKeyOf,
  infraredLearnRequestSchema,
  infraredProfileSchema,
  infraredRemoteSaveRequestSchema,
  INFRARED_REMOTE_KIND,
} from './infrared.js';

/** An NEC code as a Broadlink learns it: 9 ms mark, 4.5 ms space, then the bits. */
const NEC_CODE = {
  signal: 'ir',
  carrierHz: 38_000,
  pulses: [9000, 4500, 560, 560, 560, 1690, 560],
  protocol: { name: 'nec', address: 0x04, command: 0x08 },
};

describe('infraredCodeSchema', () => {
  it('takes an IR code with its protocol', () => {
    expect(infraredCodeSchema.parse(NEC_CODE).protocol?.name).toBe('nec');
  });

  it('takes an RF code on 433 MHz with no carrier', () => {
    expect(
      infraredCodeSchema.parse({
        signal: 'rf',
        carrierHz: 0,
        frequencyHz: 433_920_000,
        pulses: [350, 1050, 1050, 350],
      }).frequencyHz,
    ).toBe(433_920_000);
  });

  it('refuses an IR code without a carrier, or with a frequency', () => {
    expect(infraredCodeSchema.safeParse({ ...NEC_CODE, carrierHz: 0 }).success).toBe(false);
    expect(infraredCodeSchema.safeParse({ ...NEC_CODE, frequencyHz: 433_920_000 }).success).toBe(
      false,
    );
  });

  it('refuses pulses that are no timings', () => {
    expect(infraredCodeSchema.safeParse({ ...NEC_CODE, pulses: [] }).success).toBe(false);
    expect(infraredCodeSchema.safeParse({ ...NEC_CODE, pulses: [9000, 0] }).success).toBe(false);
    expect(infraredCodeSchema.safeParse({ ...NEC_CODE, pulses: [9000.5] }).success).toBe(false);
  });

  it('refuses a protocol the codec does not know', () => {
    expect(
      infraredCodeSchema.safeParse({
        ...NEC_CODE,
        protocol: { name: 'rc6', address: 0, command: 0 },
      }).success,
    ).toBe(false);
  });
});

describe('infraredProfileSchema', () => {
  it('takes a blaster of IR, or of IR and RF', () => {
    expect(infraredProfileSchema.parse({ signals: ['ir'], receives: true }).signals).toEqual([
      'ir',
    ]);
    expect(infraredProfileSchema.parse({ signals: ['ir', 'rf'], receives: true }).signals).toEqual([
      'ir',
      'rf',
    ]);
  });

  it('refuses RF alone, or a signal twice', () => {
    expect(infraredProfileSchema.safeParse({ signals: ['rf'], receives: true }).success).toBe(
      false,
    );
    expect(infraredProfileSchema.safeParse({ signals: ['ir', 'ir'], receives: true }).success).toBe(
      false,
    );
  });
});

describe('infraredLearnRequestSchema', () => {
  it('listens for an IR code for 30 s unless said', () => {
    expect(infraredLearnRequestSchema.parse({ blasterId: 'broadlink-rm4' })).toEqual({
      blasterId: 'broadlink-rm4',
      signal: 'ir',
      timeoutMs: 30_000,
    });
  });
});

describe('infraredRemoteSaveRequestSchema', () => {
  it('lays a new remote out in three columns', () => {
    expect(
      infraredRemoteSaveRequestSchema.parse({ name: 'TV', kind: 'tv', blasterId: null }).columns,
    ).toBe(3);
  });
});

describe('infraredDeviceKeyOf', () => {
  it('keys a remote under the platform vendor', () => {
    expect(infraredDeviceKeyOf('42')).toBe('infrared-42');
    expect(INFRARED_REMOTE_KIND).toBe('infrared/remote');
  });
});
