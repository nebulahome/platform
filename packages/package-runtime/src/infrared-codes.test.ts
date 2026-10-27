/**
 * The codec on known vectors: a Broadlink packet built by hand, Pronto and raw lists round trip,
 * each protocol written and read back - also through the jitter a learned code carries - and a
 * Flipper Zero file with both entry types and a line that is not one.
 */
import { describe, expect, it } from 'vitest';

import type { InfraredCode, InfraredProtocol } from '@nebulahome/contracts';

import {
  BROADLINK_TICK_US,
  decodeBroadlink,
  decodeInfraredProtocol,
  decodePronto,
  decodeRawTimings,
  encodeBroadlink,
  encodeInfraredProtocol,
  encodePronto,
  encodeRawTimings,
  parseFlipperIr,
} from './infrared-codes.js';

/**
 * Pulses as a learned code has them: marks long and spaces short by up to a tenth, in turn.
 *
 * @param pulses - The protocol's pulses.
 * @returns The same pulses, jittered.
 */
function jittered(pulses: readonly number[]): number[] {
  return pulses.map((pulse, index) => Math.round(pulse * (index % 2 === 0 ? 1.1 : 0.92)));
}

describe('Broadlink', () => {
  /** A packet by hand: IR, sent once, 274 ticks (0x00 0x01 0x12), 137, 17, 51, the close, padding. */
  const packet = Buffer.from([
    0x26, 0x00, 0x08, 0x00, 0x00, 0x01, 0x12, 0x89, 0x11, 0x33, 0x0d, 0x05, 0, 0, 0, 0,
  ]).toString('base64');

  it('reads ticks of 269/8192 ms, a long one escaped by 0x00, without the 0x0d 0x05 close', () => {
    expect(BROADLINK_TICK_US).toBeCloseTo(32.84, 2);
    expect(decodeBroadlink(packet)).toEqual({
      signal: 'ir',
      carrierHz: 38_000,
      pulses: [8997, 4499, 558, 1675],
    });
  });

  it('writes the same bytes back', () => {
    expect(encodeBroadlink(decodeBroadlink(packet))).toBe(packet);
  });

  it('reads a radio packet as RF on 433 MHz, and writes it back as one', () => {
    const rf = Buffer.from([0xb2, 0x00, 0x04, 0x00, 0x0a, 0x14, 0x0d, 0x05]).toString('base64');
    const code = decodeBroadlink(rf);

    expect(code).toEqual({
      signal: 'rf',
      carrierHz: 0,
      frequencyHz: 433_920_000,
      pulses: [328, 657],
    });
    expect(Buffer.from(encodeBroadlink(code), 'base64')[0]).toBe(0xb2);
  });

  it('sends a train as many times as its repeat byte says', () => {
    const twice = Buffer.from([0x26, 0x01, 0x04, 0x00, 0x11, 0x33, 0x0d, 0x05]).toString('base64');

    expect(decodeBroadlink(twice).pulses).toEqual([558, 1675, 558, 1675]);
  });

  it('recognises the protocol a learned code was sent in', () => {
    const nec = encodeInfraredProtocol({ name: 'nec', address: 0x04, command: 0x08 });
    const learned: InfraredCode = { ...nec, pulses: jittered(nec.pulses) };
    const { protocol, ...withoutProtocol } = learned;

    expect(protocol).toBeDefined();
    expect(decodeBroadlink(encodeBroadlink(withoutProtocol)).protocol).toEqual({
      name: 'nec',
      address: 0x04,
      command: 0x08,
    });
  });

  it('refuses what is not a packet', () => {
    expect(() => decodeBroadlink('not base64!')).toThrow('base64');
    expect(() => decodeBroadlink(Buffer.from([0x01, 0, 0, 0]).toString('base64'))).toThrow(
      'Broadlink',
    );
    expect(() => decodeBroadlink(Buffer.from([0x26, 0, 2, 0, 0, 1]).toString('base64'))).toThrow(
      'cut short',
    );
  });
});

describe('Pronto', () => {
  /** 38 kHz (0x006D), two pairs sent once. */
  const pronto = '0000 006D 0002 0000 0157 00AC 0015 0040';

  it('reads the learned form: the carrier from its frequency word, pulses in its periods', () => {
    expect(decodePronto(pronto)).toEqual({
      signal: 'ir',
      carrierHz: 38_029,
      pulses: [9019, 4523, 552, 1683],
    });
  });

  it('writes the same words back', () => {
    expect(encodePronto(decodePronto(pronto))).toBe(pronto);
  });

  it('sends what is sent once, then the repeated part once', () => {
    expect(decodePronto('0000 006D 0001 0001 0157 00AC 0015 0040').pulses).toEqual([
      9019, 4523, 552, 1683,
    ]);
  });

  it('pads a code ending on a mark, and carries no radio', () => {
    expect(encodePronto({ signal: 'ir', carrierHz: 38_000, pulses: [9000] })).toMatch(
      /^0000 006D 0001 0000 0156 /u,
    );
    expect(encodePronto({ signal: 'rf', carrierHz: 0, pulses: [300, 900] })).toBeNull();
  });

  it('refuses other forms and short codes', () => {
    expect(() => decodePronto('0100 006D 0001 0000 0157 00AC')).toThrow('learned');
    expect(() => decodePronto('0000 006D 0003 0000 0157 00AC')).toThrow('3 pairs');
    expect(() => decodePronto('0000 6D')).toThrow('four hex digits');
  });
});

describe('raw timings', () => {
  it('reads an unsigned list as a mark and a space in turn', () => {
    expect(decodeRawTimings('9000 4500, 560;560\n560').pulses).toEqual([9000, 4500, 560, 560, 560]);
  });

  it('reads a signed list, two of a kind as one and a leading space dropped', () => {
    expect(decodeRawTimings('[-20000, 9000, -4500, -100, 560]').pulses).toEqual([9000, 4600, 560]);
  });

  it('writes a signed list that reads back the same', () => {
    const code: InfraredCode = { signal: 'ir', carrierHz: 38_000, pulses: [9000, 4500, 560] };

    expect(encodeRawTimings(code)).toBe('9000, -4500, 560');
    expect(decodeRawTimings(encodeRawTimings(code), 38_000)).toEqual(code);
  });

  it('refuses what is not a pulse', () => {
    expect(() => decodeRawTimings('9000 abc')).toThrow('abc is not a pulse');
    expect(() => decodeRawTimings('9000 0 560')).toThrow('0 is not a pulse');
    expect(() => decodeRawTimings('')).toThrow('no pulses');
  });
});

describe('protocols', () => {
  const protocols: InfraredProtocol[] = [
    { name: 'nec', address: 0x04, command: 0x08 },
    { name: 'nec-ext', address: 0x87ee, command: 0xa05d },
    { name: 'samsung32', address: 0x07, command: 0x02 },
    { name: 'sirc', address: 1, command: 21 },
    { name: 'sirc15', address: 0x97, command: 0x1a },
    { name: 'sirc20', address: 0x1a3a, command: 0x39 },
    { name: 'rc5', address: 0, command: 12 },
    { name: 'rc5', address: 0x14, command: 0x4b },
  ];

  it.each(protocols)('reads back $name $address/$command, as written and as learned', (sent) => {
    const code = encodeInfraredProtocol(sent);

    expect(code.protocol).toEqual(sent);
    expect(code.pulses.length % 2).toBe(0);
    expect(decodeInfraredProtocol(code.pulses)).toEqual(sent);
    expect(decodeInfraredProtocol(jittered(code.pulses))).toEqual(sent);
  });

  it('writes NEC as its 9 ms leader and 32 bits, the lowest first, with the inverses', () => {
    const { pulses, carrierHz } = encodeInfraredProtocol({ name: 'nec', address: 4, command: 8 });
    const spaces = [...Array(32).keys()].map((bit) => pulses[3 + bit * 2]);

    expect(carrierHz).toBe(38_000);
    expect(pulses.slice(0, 2)).toEqual([9000, 4500]);
    // 0x04, 0xFB, 0x08, 0xF7, each read from its lowest bit.
    expect(spaces.map((space) => (space === 1690 ? 1 : 0)).join('')).toBe(
      '00100000110111110001000011101111',
    );
    expect(pulses.reduce((sum, pulse) => sum + pulse, 0)).toBe(108_000);
  });

  it('writes Sony power (0xA90) as 12 bits, three frames of 45 ms', () => {
    const { pulses, carrierHz } = encodeInfraredProtocol({ name: 'sirc', address: 1, command: 21 });
    const bits = [...Array(12).keys()].map((bit) => (pulses[2 + bit * 2] === 1200 ? 1 : 0));

    expect(carrierHz).toBe(40_000);
    expect(bits.join('')).toBe('101010010000');
    expect(pulses.reduce((sum, pulse) => sum + pulse, 0)).toBe(135_000);
  });

  it('writes RC5 as Manchester halves of 889 µs, starting on the first mark', () => {
    const { pulses, carrierHz } = encodeInfraredProtocol({ name: 'rc5', address: 0, command: 12 });

    expect(carrierHz).toBe(36_000);
    // 1 1 0 00000 001100: a mark, a space, a long mark after the toggle's 0…
    expect(pulses.slice(0, 4)).toEqual([889, 889, 1778, 889]);
    expect(pulses.every((pulse, index) => index === pulses.length - 1 || pulse % 889 === 0)).toBe(
      true,
    );
  });

  it('recognises nothing in timings of no protocol, and refuses what does not fit one', () => {
    expect(decodeInfraredProtocol([3000, 3000, 500, 500, 500])).toBeUndefined();
    expect(decodeInfraredProtocol([])).toBeUndefined();
    expect(() => encodeInfraredProtocol({ name: 'nec', address: 0x100, command: 1 })).toThrow(
      'nec carries an address up to 0xff',
    );
  });
});

describe('parseFlipperIr', () => {
  const learned = jittered(
    encodeInfraredProtocol({ name: 'nec', address: 0x00, command: 0x45 }).pulses,
  ).slice(0, -1);
  const file = [
    'Filetype: IR signals file',
    'Version: 1',
    '#',
    'name: Power',
    'type: parsed',
    'protocol: Samsung32',
    'address: 07 00 00 00',
    'command: 02 00 00 00',
    '#',
    'name: Vol_up',
    'type: raw',
    'frequency: 38000',
    'duty_cycle: 0.330000',
    `data: ${learned.slice(0, 40).join(' ')}`,
    `data: ${learned.slice(40).join(' ')}`,
    '#',
    'this line is not a field',
    'name: Input',
    'type: parsed',
    'protocol: Kaseikyo',
    'address: 41 54 32 00',
    'command: 1B 00 00 00',
    'name: Mute',
    'type: parsed',
    'protocol: RC5X',
    'address: 00 00 00 00',
    'command: 0D 00 00 00',
  ].join('\r\n');

  it('reads a parsed entry into timings and a raw one as written, each named', () => {
    const { codes } = parseFlipperIr(file);

    expect(codes.map(({ name, line }) => ({ name, line }))).toEqual([
      { name: 'Power', line: 4 },
      { name: 'Vol_up', line: 10 },
      { name: 'Mute', line: 23 },
    ]);
    expect(codes[0]?.code).toEqual(
      encodeInfraredProtocol({ name: 'samsung32', address: 7, command: 2 }),
    );
    expect(codes[1]?.code).toEqual({
      signal: 'ir',
      carrierHz: 38_000,
      pulses: learned,
      protocol: { name: 'nec', address: 0, command: 0x45 },
    });
    expect(codes[2]?.code.protocol).toEqual({ name: 'rc5', address: 0, command: 0x4d });
  });

  it('says which lines it could not use, and why', () => {
    expect(parseFlipperIr(file).problems).toEqual([
      { line: 17, text: 'this line is not a field', reason: 'Not a "key: value" line' },
      {
        line: 20,
        text: 'name: Input',
        reason: 'Nebula does not read Kaseikyo codes yet',
      },
    ]);
  });

  it('refuses a file of another kind whole', () => {
    expect(parseFlipperIr('Filetype: Flipper SubGhz Key File\nVersion: 1')).toEqual({
      codes: [],
      problems: [
        {
          line: 1,
          text: 'Filetype: Flipper SubGhz Key File',
          reason: 'Not a Flipper Zero infrared file',
        },
      ],
    });
  });
});
