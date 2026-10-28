import { describe, expect, it } from 'vitest';

import { infraredImportItemSchema, type InfraredCode } from '@nebulahome/contracts';
import {
  decodeBroadlink,
  decodePronto,
  decodeRawTimings,
  encodeBroadlink,
  encodeInfraredProtocol,
  encodePronto,
  encodeRawTimings,
  BROADLINK_TICK_US,
} from '@nebulahome/package-runtime';

import { infraredCodeFormats, parseInfraredImport } from './codes.js';

/** A TV's Power button: NEC, address 0x04, command 0x08. */
const POWER: InfraredCode = encodeInfraredProtocol({ name: 'nec', address: 0x04, command: 0x08 });

/** A gate's radio button on 433.92 MHz. */
const GATE: InfraredCode = {
  signal: 'rf',
  carrierHz: 0,
  frequencyHz: 433_920_000,
  pulses: [300, 900, 300, 900, 900, 300],
};

describe('Import', () => {
  it('reads Broadlink base64, Pronto and raw timings a line each, and says why a line is not one', () => {
    const text = [
      encodeBroadlink(POWER),
      '',
      encodePronto(POWER) ?? '',
      '# a comment',
      encodeRawTimings(POWER),
      'not a code at all',
      '0000 006D zz',
    ].join('\r\n');
    const { items, problems } = parseInfraredImport(text);

    expect(items.map(({ name, format }) => ({ name, format }))).toEqual([
      { name: 'Line 1', format: 'broadlink' },
      { name: 'Line 3', format: 'pronto' },
      { name: 'Line 5', format: 'raw' },
    ]);
    expect(items.map(({ code }) => code.protocol)).toEqual(
      Array.from({ length: 3 }, () => ({ name: 'nec', address: 0x04, command: 0x08 })),
    );
    expect(problems).toEqual([
      {
        line: 6,
        text: 'not a code at all',
        reason: 'Not Broadlink base64, Pronto hex or raw timings',
      },
      { line: 7, text: '0000 006D zz', reason: expect.any(String) as string },
    ]);
    // What the reply carries holds the contract.
    expect(items.every((item) => infraredImportItemSchema.safeParse(item).success)).toBe(true);
  });

  it('reads a Flipper Zero file, each entry a button, by its name or its first line', () => {
    const file = [
      'Filetype: IR signals file',
      'Version: 1',
      '#',
      'name: Power',
      'type: parsed',
      'protocol: NEC',
      'address: 04 00 00 00',
      'command: 08 00 00 00',
      '#',
      'name: Vol_up',
      'type: raw',
      'frequency: 38000',
      'duty_cycle: 0.330000',
      'data: 9000 4500 560 560 560 1690 560',
      '#',
      'name: Input',
      'type: parsed',
      'protocol: Kaseikyo',
      'address: 41 54 32 00',
      'command: 1B 00 00 00',
    ].join('\n');

    for (const parsed of [parseInfraredImport(file, 'living-room.ir'), parseInfraredImport(file)]) {
      expect(parsed.items.map(({ name, format }) => ({ name, format }))).toEqual([
        { name: 'Power', format: 'flipper' },
        { name: 'Vol_up', format: 'flipper' },
      ]);
      expect(parsed.items[0]?.code.protocol).toEqual({ name: 'nec', address: 4, command: 8 });
      expect(parsed.items[1]?.code).toMatchObject({
        carrierHz: 38_000,
        pulses: [9000, 4500, 560, 560, 560, 1690, 560],
      });
      expect(parsed.problems).toHaveLength(1);
      // The entry's protocol line: Kaseikyo is not one the codec writes.
      expect(parsed.problems[0]?.line).toBe(18);
    }
  });
});

describe('Show code', () => {
  it('writes a code in every format, each read back to the same pulses', () => {
    const formats = infraredCodeFormats({ ...POWER, protocol: undefined });

    expect(formats).toMatchObject({
      protocol: { name: 'nec', address: 0x04, command: 0x08 },
      pulseCount: POWER.pulses.length,
      carrierHz: POWER.carrierHz,
    });
    expect(decodeRawTimings(formats.raw, POWER.carrierHz).pulses).toEqual(POWER.pulses);
    expect(decodePronto(formats.pronto ?? '').protocol).toEqual(POWER.protocol);

    const broadlink = decodeBroadlink(formats.broadlink ?? '');

    // Broadlink counts in ticks of about 32.8 µs.
    broadlink.pulses.forEach((pulse, index) => {
      expect(Math.abs(pulse - (POWER.pulses[index] ?? 0))).toBeLessThanOrEqual(BROADLINK_TICK_US);
    });
  });

  it('has no Pronto and no protocol for a radio code', () => {
    const formats = infraredCodeFormats(GATE);

    expect(formats).toMatchObject({ pronto: null, protocol: null, pulseCount: 6, carrierHz: 0 });
    expect(decodeBroadlink(formats.broadlink ?? '')).toMatchObject({ signal: 'rf' });
  });
});
